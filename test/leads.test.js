import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  fingerprint,
  normalizeText,
  parseCount,
  parseRelativeTime,
  scoreItem,
} from '../server/leads.js';

test('normalizeText 去掉零宽字符并压缩空白', () => {
  assert.equal(normalizeText('  这个\u200b多少钱 \n 啊 '), '这个多少钱 啊');
  assert.equal(normalizeText(null), '');
});

test('fingerprint 对同作者同内容稳定，对内容变化敏感', () => {
  const base = { platform: 'douyin', kind: 'comment', authorName: '小王', text: ' 多少钱 ' };
  assert.equal(fingerprint(base), fingerprint({ ...base, text: '多少钱' }));
  assert.notEqual(fingerprint(base), fingerprint({ ...base, text: '多少钱呢' }));
  assert.notEqual(fingerprint(base), fingerprint({ ...base, platform: 'bilibili' }));
});

test('fingerprint 优先用 authorId，避免同名串号', () => {
  const a = fingerprint({ platform: 'douyin', kind: 'comment', authorId: 'u1', text: '求链接' });
  const b = fingerprint({ platform: 'douyin', kind: 'comment', authorId: 'u2', text: '求链接' });
  assert.notEqual(a, b);
});

test('parseCount 支持中文万/千单位', () => {
  assert.equal(parseCount('1.2万'), 12000);
  assert.equal(parseCount('3千'), 3000);
  assert.equal(parseCount('8'), 8);
  assert.equal(parseCount('赞'), 0);
  assert.equal(parseCount(undefined), 0);
});

test('parseRelativeTime 支持相对与绝对时间', () => {
  const now = new Date('2026-10-25T12:00:00Z').getTime();

  assert.equal(parseRelativeTime('3小时前', now), new Date(now - 3 * 3600000).toISOString());
  assert.equal(parseRelativeTime('昨天', now), new Date(now - 86400000).toISOString());
  assert.equal(parseRelativeTime('2026-06-12', now).slice(0, 10), '2026-06-12');
  assert.equal(parseRelativeTime('瞎写的', now), null);
});

test('scoreItem 对强意向评论给高分并打上多个标签', () => {
  const result = scoreItem({ text: '这个多少钱？西安能发货吗，麻烦私信我', likeCount: '1.2万' });
  assert.ok(result.score >= 80, `期望 >= 80，实际 ${result.score}`);
  assert.ok(result.tags.includes('contact'));
  assert.ok(result.tags.includes('price'));
});

test('scoreItem 对互粉广告类内容压低分数', () => {
  const result = scoreItem({ text: '互粉互赞，进群领福利' });
  assert.ok(result.score < 30, `期望 < 30，实际 ${result.score}`);
  assert.ok(result.tags.includes('noise'));
});

test('scoreItem 空内容直接 0 分', () => {
  assert.deepEqual(scoreItem({ text: '   ' }), { score: 0, tags: [] });
});

test('scoreItem 关键词命中额外加分且封顶', () => {
  const text = '装修报价 装修怎么算 装修求推荐 装修';
  const withoutKeyword = scoreItem({ text });
  const withKeyword = scoreItem({ text, keywords: ['装修'] });
  assert.ok(withKeyword.score >= withoutKeyword.score);
  assert.ok(withKeyword.score <= 100);
});

test('scoreItem 分数始终落在 0-100', () => {
  const cases = [
    '多少钱怎么买加微信私信我', // 全部命中
    '', // 空
    'a'.repeat(500), // 超长
  ];
  for (const text of cases) {
    const { score } = scoreItem({ text, keywords: ['a'] });
    assert.ok(score >= 0 && score <= 100, `越界: ${score}`);
    assert.equal(Number.isInteger(score), true);
  }
});

test('scoreItem 新鲜内容比陈旧内容得分高', () => {
  const now = Date.now();
  const fresh = scoreItem({ text: '求链接', postedAt: new Date(now - 3600000).toISOString() }, { now });
  const old = scoreItem({ text: '求链接', postedAt: new Date(now - 30 * 86400000).toISOString() }, { now });
  assert.ok(fresh.score > old.score);
});
