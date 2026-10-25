import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { DEFAULT_MIN_SCORE } from './config.js';
import { fingerprint, parseCount, parseRelativeTime, scoreItem } from './leads.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  fingerprint  TEXT NOT NULL UNIQUE,
  platform     TEXT NOT NULL,
  kind         TEXT NOT NULL,
  native_id    TEXT,
  parent_id    TEXT,
  url          TEXT,
  title        TEXT,
  author_name  TEXT,
  author_id    TEXT,
  text         TEXT NOT NULL,
  region       TEXT,
  like_count   INTEGER NOT NULL DEFAULT 0,
  posted_at    TEXT,
  score        INTEGER NOT NULL DEFAULT 0,
  tags         TEXT NOT NULL DEFAULT '[]',
  collected_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_items_platform  ON items(platform);
CREATE INDEX IF NOT EXISTS idx_items_collected ON items(collected_at DESC);
CREATE INDEX IF NOT EXISTS idx_items_score     ON items(score DESC);

CREATE TABLE IF NOT EXISTS leads (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id    INTEGER NOT NULL UNIQUE REFERENCES items(id) ON DELETE CASCADE,
  score      INTEGER NOT NULL,
  tags       TEXT NOT NULL DEFAULT '[]',
  status     TEXT NOT NULL DEFAULT 'new',
  note       TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_score  ON leads(score DESC);

CREATE TABLE IF NOT EXISTS rules (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  platform   TEXT NOT NULL DEFAULT 'all',
  keywords   TEXT NOT NULL DEFAULT '[]',
  min_score  INTEGER NOT NULL DEFAULT 45,
  enabled    INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
`;

const VALID_STATUS = new Set(['new', 'reviewing', 'followed', 'ignored']);

function nowIso() {
  return new Date().toISOString();
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function createStore(dbFile) {
  if (dbFile !== ':memory:') mkdirSync(dirname(dbFile), { recursive: true });
  const db = new DatabaseSync(dbFile);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);

  const stmt = {
    insertItem: db.prepare(`
      INSERT OR IGNORE INTO items
        (fingerprint, platform, kind, native_id, parent_id, url, title, author_name, author_id,
         text, region, like_count, posted_at, score, tags, collected_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    insertLead: db.prepare(`
      INSERT OR IGNORE INTO leads (item_id, score, tags, status, note, updated_at)
      VALUES (?, ?, ?, 'new', '', ?)
    `),
    listRules: db.prepare('SELECT * FROM rules ORDER BY id DESC'),
    insertRule: db.prepare(`
      INSERT INTO rules (name, platform, keywords, min_score, enabled, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `),
    deleteRule: db.prepare('DELETE FROM rules WHERE id = ?'),
  };

  const enabledRules = () => stmt.listRules.all().filter((rule) => rule.enabled === 1);

  const rulesFor = (platform) =>
    enabledRules().filter((rule) => rule.platform === 'all' || rule.platform === platform);

  function keywordsFor(platform) {
    const words = new Set();
    for (const rule of rulesFor(platform)) {
      for (const word of toArray(rule.keywords)) {
        const trimmed = String(word).trim();
        if (trimmed) words.add(trimmed);
      }
    }
    return [...words];
  }

  function thresholdFor(platform) {
    const rules = rulesFor(platform);
    if (rules.length === 0) return DEFAULT_MIN_SCORE;
    return Math.min(...rules.map((rule) => rule.min_score));
  }

  function ingest(rawItems, { now = Date.now() } = {}) {
    const result = { received: 0, inserted: 0, duplicates: 0, leads: 0, skipped: 0 };

    for (const raw of rawItems) {
      result.received += 1;
      const text = String(raw?.text ?? '').trim();
      const platform = String(raw?.platform ?? '').trim();
      if (!text || !platform) {
        result.skipped += 1;
        continue;
      }

      const kind = String(raw.kind ?? 'comment');
      const authorName = raw.authorName ? String(raw.authorName).trim().slice(0, 120) : null;
      const authorId = raw.authorId ? String(raw.authorId).trim().slice(0, 120) : null;
      const fp = fingerprint({ platform, kind, authorId, authorName, text });

      const keywords = keywordsFor(platform);
      const scored = scoreItem(
        {
          text,
          likeCount: raw.likeCount,
          postedAt: raw.postedAt ?? null,
          postedAtRaw: raw.postedAtRaw ?? null,
        },
        { keywords, now },
      );

      const info = stmt.insertItem.run(
        fp,
        platform,
        kind,
        raw.nativeId ? String(raw.nativeId) : null,
        raw.parentId ? String(raw.parentId) : null,
        raw.url ? String(raw.url) : null,
        raw.title ? String(raw.title).slice(0, 200) : null,
        authorName,
        authorId,
        text.slice(0, 4000),
        raw.region ? String(raw.region).slice(0, 60) : null,
        parseCount(raw.likeCount),
        raw.postedAt ?? parseRelativeTime(raw.postedAtRaw, now),
        scored.score,
        JSON.stringify(scored.tags),
        nowIso(),
      );

      if (Number(info.changes) === 0) {
        result.duplicates += 1;
        continue;
      }

      result.inserted += 1;
      const itemId = Number(info.lastInsertRowid);

      if (scored.score >= thresholdFor(platform)) {
        const lead = stmt.insertLead.run(itemId, scored.score, JSON.stringify(scored.tags), nowIso());
        if (Number(lead.changes) > 0) result.leads += 1;
      }
    }

    return result;
  }

  function listItems({ platform, q, minScore, limit = 100, offset = 0 } = {}) {
    const where = [];
    const params = [];
    if (platform && platform !== 'all') {
      where.push('platform = ?');
      params.push(platform);
    }
    if (q) {
      where.push('(text LIKE ? OR author_name LIKE ? OR title LIKE ?)');
      const like = `%${q}%`;
      params.push(like, like, like);
    }
    if (minScore) {
      where.push('score >= ?');
      params.push(Number(minScore));
    }
    const sql = `
      SELECT * FROM items
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY collected_at DESC, id DESC
      LIMIT ? OFFSET ?
    `;
    return db.prepare(sql).all(...params, Number(limit), Number(offset));
  }

  function listLeads({ status, minScore, platform, limit = 200, offset = 0 } = {}) {
    const where = [];
    const params = [];
    if (status && status !== 'all') {
      where.push('l.status = ?');
      params.push(status);
    }
    if (minScore) {
      where.push('l.score >= ?');
      params.push(Number(minScore));
    }
    if (platform && platform !== 'all') {
      where.push('i.platform = ?');
      params.push(platform);
    }
    const sql = `
      SELECT l.id, l.item_id, l.score, l.tags, l.status, l.note, l.updated_at,
             i.platform, i.kind, i.url, i.title, i.author_name, i.text, i.region,
             i.like_count, i.posted_at, i.collected_at
      FROM leads l JOIN items i ON i.id = l.item_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY l.score DESC, l.updated_at DESC
      LIMIT ? OFFSET ?
    `;
    return db.prepare(sql).all(...params, Number(limit), Number(offset));
  }

  function updateLead(id, { status, note }) {
    const current = db.prepare('SELECT * FROM leads WHERE id = ?').get(Number(id));
    if (!current) return null;

    const nextStatus = status && VALID_STATUS.has(status) ? status : current.status;
    const nextNote = typeof note === 'string' ? note.slice(0, 1000) : current.note;

    db.prepare('UPDATE leads SET status = ?, note = ?, updated_at = ? WHERE id = ?').run(
      nextStatus,
      nextNote,
      nowIso(),
      Number(id),
    );
    return db.prepare('SELECT * FROM leads WHERE id = ?').get(Number(id));
  }

  function stats() {
    const one = (sql) => db.prepare(sql).get();
    return {
      items: Number(one('SELECT COUNT(*) AS n FROM items').n),
      leads: Number(one('SELECT COUNT(*) AS n FROM leads').n),
      newLeads: Number(one("SELECT COUNT(*) AS n FROM leads WHERE status = 'new'").n),
      followed: Number(one("SELECT COUNT(*) AS n FROM leads WHERE status = 'followed'").n),
      rules: Number(one('SELECT COUNT(*) AS n FROM rules WHERE enabled = 1').n),
      byPlatform: db
        .prepare('SELECT platform, COUNT(*) AS n FROM items GROUP BY platform ORDER BY n DESC')
        .all()
        .map((row) => ({ platform: row.platform, count: Number(row.n) })),
    };
  }

  function listRules() {
    return stmt.listRules.all().map((rule) => ({
      ...rule,
      keywords: toArray(rule.keywords),
      enabled: rule.enabled === 1,
    }));
  }

  function createRule({ name, platform = 'all', keywords = [], minScore = DEFAULT_MIN_SCORE }) {
    const cleanName = String(name ?? '').trim();
    if (!cleanName) throw new Error('规则名称不能为空');

    const words = (Array.isArray(keywords) ? keywords : String(keywords).split(/[,，\s]+/))
      .map((word) => String(word).trim())
      .filter(Boolean)
      .slice(0, 50);

    const score = Math.max(0, Math.min(100, Number(minScore) || DEFAULT_MIN_SCORE));
    const info = stmt.insertRule.run(
      cleanName.slice(0, 80),
      String(platform || 'all'),
      JSON.stringify(words),
      score,
      1,
      nowIso(),
    );
    return Number(info.lastInsertRowid);
  }

  function deleteRule(id) {
    return Number(stmt.deleteRule.run(Number(id)).changes) > 0;
  }

  function close() {
    db.close();
  }

  return {
    raw: db,
    ingest,
    listItems,
    listLeads,
    updateLead,
    stats,
    listRules,
    createRule,
    deleteRule,
    keywordsFor,
    thresholdFor,
    close,
  };
}
