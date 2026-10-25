import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { HOST, PORT, DB_FILE, WEB_DIR, maxBodyBytes } from './config.js';
import { createStore } from './db.js';
import { ITEM_COLUMNS, LEAD_COLUMNS, toCsv } from './export.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

function originAllowed(origin) {
  if (!origin) return true;
  if (origin.startsWith('chrome-extension://')) return true;
  return /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBodyBytes) {
        reject(Object.assign(new Error('请求体过大'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('请求体不是合法 JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

async function serveStatic(res, pathname) {
  const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
  const target = normalize(join(WEB_DIR, relative));
  if (!target.startsWith(WEB_DIR + sep) && target !== join(WEB_DIR, 'index.html')) {
    return json(res, 403, { error: '禁止访问' });
  }
  try {
    const body = await readFile(target);
    res.writeHead(200, {
      'content-type': MIME[extname(target)] ?? 'application/octet-stream',
      'content-length': body.length,
      'cache-control': 'no-cache',
    });
    res.end(body);
  } catch {
    json(res, 404, { error: '页面不存在' });
  }
}

export function createServer(store) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${HOST}:${PORT}`);
    const { pathname, searchParams } = url;
    const method = req.method ?? 'GET';

    if (method === 'OPTIONS') {
      const origin = req.headers.origin;
      res.writeHead(204, {
        'access-control-allow-origin': originAllowed(origin) ? origin : HOST,
        'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
        'access-control-allow-headers': 'content-type',
        'access-control-max-age': '600',
      });
      return res.end();
    }

    if (method !== 'GET' && !originAllowed(req.headers.origin)) {
      return json(res, 403, { error: '来源不被允许' });
    }

    try {
      if (pathname === '/api/health') {
        return json(res, 200, { ok: true, service: 'leadlens', version: '0.1.0' });
      }

      if (pathname === '/api/stats' && method === 'GET') {
        return json(res, 200, store.stats());
      }

      if (pathname === '/api/items' && method === 'GET') {
        return json(
          res,
          200,
          store.listItems({
            platform: searchParams.get('platform') ?? undefined,
            q: searchParams.get('q') ?? undefined,
            minScore: searchParams.get('minScore') ?? undefined,
            limit: Math.min(Number(searchParams.get('limit')) || 100, 500),
            offset: Number(searchParams.get('offset')) || 0,
          }),
        );
      }

      if (pathname === '/api/leads' && method === 'GET') {
        return json(
          res,
          200,
          store.listLeads({
            status: searchParams.get('status') ?? undefined,
            platform: searchParams.get('platform') ?? undefined,
            minScore: searchParams.get('minScore') ?? undefined,
            limit: Math.min(Number(searchParams.get('limit')) || 200, 500),
            offset: Number(searchParams.get('offset')) || 0,
          }),
        );
      }

      const leadMatch = pathname.match(/^\/api\/leads\/(\d+)$/);
      if (leadMatch && method === 'PATCH') {
        const body = await readBody(req);
        const updated = store.updateLead(leadMatch[1], body);
        if (!updated) return json(res, 404, { error: '线索不存在' });
        return json(res, 200, updated);
      }

      if (pathname === '/api/rules' && method === 'GET') {
        return json(res, 200, store.listRules());
      }

      if (pathname === '/api/rules' && method === 'POST') {
        const body = await readBody(req);
        const id = store.createRule(body);
        return json(res, 201, { id });
      }

      const ruleMatch = pathname.match(/^\/api\/rules\/(\d+)$/);
      if (ruleMatch && method === 'DELETE') {
        return json(res, 200, { deleted: store.deleteRule(ruleMatch[1]) });
      }

      if (pathname === '/api/ingest' && method === 'POST') {
        const body = await readBody(req);
        const items = Array.isArray(body.items) ? body.items.slice(0, 500) : [];
        if (items.length === 0) return json(res, 400, { error: 'items 不能为空' });
        const result = store.ingest(items);
        return json(res, 200, result);
      }

      if (pathname === '/api/export' && method === 'GET') {
        const kind = searchParams.get('type') === 'items' ? 'items' : 'leads';
        const filters = {
          status: searchParams.get('status') ?? undefined,
          platform: searchParams.get('platform') ?? undefined,
          minScore: searchParams.get('minScore') ?? undefined,
          limit: 5000,
          offset: 0,
        };
        const rows =
          kind === 'items' ? store.listItems(filters) : store.listLeads(filters);
        const columns = kind === 'items' ? ITEM_COLUMNS : LEAD_COLUMNS;
        const csv = toCsv(
          rows.map((row) => ({ ...row, tags: JSON.parse(row.tags ?? '[]') })),
          columns,
        );
        const stamp = new Date().toISOString().slice(0, 10);
        res.writeHead(200, {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': `attachment; filename="leadlens-${kind}-${stamp}.csv"`,
          'cache-control': 'no-store',
        });
        return res.end(csv);
      }

      if (pathname.startsWith('/api/')) {
        return json(res, 404, { error: '接口不存在' });
      }

      return await serveStatic(res, pathname);
    } catch (error) {
      const status = error.status ?? 500;
      if (status === 500) console.error('[leadlens]', error);
      return json(res, status, { error: error.message ?? '服务器内部错误' });
    }
  });
}

const isEntry =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntry) {
  const store = createStore(DB_FILE);
  const server = createServer(store);
  server.listen(PORT, HOST, () => {
    const s = store.stats();
    console.log(`\n  线索透镜 LeadLens 已启动`);
    console.log(`  工作台   http://${HOST}:${PORT}`);
    console.log(`  数据库   ${DB_FILE}`);
    console.log(`  现有数据 ${s.items} 条采集 / ${s.leads} 条线索\n`);
  });

  const shutdown = () => {
    server.close(() => {
      store.close();
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
