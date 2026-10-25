import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { createStore } from '../server/db.js';
import { createServer } from '../server/index.js';

let server;
let store;
let base;

before(async () => {
  store = createStore(':memory:');
  server = createServer(store);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  base = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  store.close();
});

const post = (path, body, headers = {}) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

test('发采集数据会去重并生成线索', async () => {
  const items = [
    { platform: 'douyin', kind: 'comment', authorName: '小王', text: '这个多少钱，能私信我吗', likeCount: '2万' },
    { platform: 'douyin', kind: 'comment', authorName: '小王', text: '这个多少钱，能私信我吗', likeCount: '2万' },
    { platform: 'douyin', kind: 'comment', authorName: '路人', text: '好看' },
    { platform: 'douyin', kind: 'comment', authorName: '', text: '' },
  ];

  const response = await post('/api/ingest', { items });
  assert.equal(response.status, 200);

  const result = await response.json();
  assert.equal(result.received, 4);
  assert.equal(result.inserted, 2);
  assert.equal(result.duplicates, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.leads, 1);
});

test('GET /api/leads 返回线索并可过滤', async () => {
  const all = await (await fetch(`${base}/api/leads?status=all`)).json();
  assert.equal(all.length, 1);
  assert.equal(all[0].author_name, '小王');
  assert.ok(all[0].score >= 50);

  const none = await (await fetch(`${base}/api/leads?status=followed`)).json();
  assert.equal(none.length, 0);
});

test('PATCH /api/leads/:id 更新状态与备注', async () => {
  const [lead] = await (await fetch(`${base}/api/leads?status=all`)).json();

  const response = await fetch(`${base}/api/leads/${lead.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'followed', note: '已加微信' }),
  });
  assert.equal(response.status, 200);

  const updated = await response.json();
  assert.equal(updated.status, 'followed');
  assert.equal(updated.note, '已加微信');
});

test('PATCH 非法状态被忽略，保留原值', async () => {
  const [lead] = await (await fetch(`${base}/api/leads?status=all`)).json();
  const response = await fetch(`${base}/api/leads/${lead.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'hacked' }),
  });
  assert.equal((await response.json()).status, 'followed');
});

test('PATCH 不存在的线索返回 404', async () => {
  const response = await fetch(`${base}/api/leads/99999`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'followed' }),
  });
  assert.equal(response.status, 404);
});

test('规则 CRUD 与关键词加分生效', async () => {
  const created = await post('/api/rules', {
    name: '装修线索',
    platform: 'all',
    keywords: '量房, 装修',
    minScore: 10,
  });
  assert.equal(created.status, 201);
  const { id } = await created.json();

  const rules = await (await fetch(`${base}/api/rules`)).json();
  assert.equal(rules[0].name, '装修线索');
  assert.deepEqual(rules[0].keywords, ['量房', '装修']);

  await post('/api/ingest', {
    items: [{ platform: 'xiaohongshu', kind: 'comment', authorName: 'A', text: '装修想先量房看看' }],
  });
  const leads = await (await fetch(`${base}/api/leads?status=all`)).json();
  const hit = leads.find((lead) => lead.text.includes('量房'));
  assert.ok(hit, '关键词内容应进入线索池');

  const removed = await fetch(`${base}/api/rules/${id}`, { method: 'DELETE' });
  assert.equal((await removed.json()).deleted, true);

  const after = await (await fetch(`${base}/api/rules`)).json();
  assert.equal(after.length, 0);
});

test('规则名称必填', async () => {
  const response = await post('/api/rules', { name: '  ' });
  assert.equal(response.status, 500);
});

test('CSV 导出带 UTF-8 BOM 与附件头', async () => {
  const response = await fetch(`${base}/api/export?type=leads`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/csv/);
  assert.match(response.headers.get('content-disposition'), /attachment/);

  // 用字节判断，response.text() 会自动吃掉 BOM
  const bytes = new Uint8Array(await response.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);

  const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
  assert.ok(text.includes('意向分'));
});

test('拒绝来自陌生网页的写请求', async () => {
  const response = await post(
    '/api/ingest',
    { items: [{ platform: 'douyin', text: 'x' }] },
    { origin: 'https://evil.example.com' },
  );
  assert.equal(response.status, 403);
});

test('允许来自浏览器扩展的写请求', async () => {
  const response = await post(
    '/api/ingest',
    { items: [{ platform: 'bilibili', kind: 'comment', authorName: 'B', text: '这个怎么买' }] },
    { origin: 'chrome-extension://abcdefghijklmnop' },
  );
  assert.equal(response.status, 200);
});

test('空 items 返回 400', async () => {
  const response = await post('/api/ingest', { items: [] });
  assert.equal(response.status, 400);
});

test('非法 JSON 返回 400', async () => {
  const response = await fetch(`${base}/api/ingest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{ broken',
  });
  assert.equal(response.status, 400);
});

test('请求体超过 2MB 返回 413，而不是把连接断开', async () => {
  const response = await post('/api/ingest', {
    items: [{ platform: 'douyin', text: 'x'.repeat(2 * 1024 * 1024 + 10) }],
  });
  assert.equal(response.status, 413);
  assert.equal((await response.json()).error, '请求体过大');
});

test('未知 API 返回 404 JSON，未知页面返回 404', async () => {
  const api = await fetch(`${base}/api/nope`);
  assert.equal(api.status, 404);
  assert.ok((await api.json()).error);

  const page = await fetch(`${base}/nope.html`);
  assert.equal(page.status, 404);
});

test('静态目录穿越被拦截', async () => {
  const response = await fetch(`${base}/..%2F..%2Fpackage.json`);
  assert.ok([403, 404].includes(response.status), `实际 ${response.status}`);
});

test('健康检查可用', async () => {
  const payload = await (await fetch(`${base}/api/health`)).json();
  assert.equal(payload.ok, true);
  assert.equal(payload.service, 'leadlens');
});
