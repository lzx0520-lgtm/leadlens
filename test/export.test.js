import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ITEM_COLUMNS, LEAD_COLUMNS, toCsv } from '../server/export.js';

test('toCsv 输出 BOM 与表头', () => {
  const csv = toCsv([], LEAD_COLUMNS);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.ok(csv.includes('线索ID,平台,昵称'));
  assert.ok(csv.endsWith('\r\n'));
});

test('toCsv 转义引号、逗号与换行', () => {
  const csv = toCsv(
    [{ text: '他说"要买"，还问\n能不能便宜' }],
    [{ key: 'text', label: '内容' }],
  );
  const body = csv.slice(1).trimEnd();
  assert.equal(body, '内容\r\n"他说""要买""，还问\n能不能便宜"');
});

test('toCsv 把数组字段拼成竖线分隔', () => {
  const csv = toCsv([{ tags: ['price', 'contact'] }], [{ key: 'tags', label: '标签' }]);
  assert.ok(csv.includes('price|contact'));
});

test('toCsv 空值输出空字符串而不是 null', () => {
  const csv = toCsv([{ note: null, text: undefined }], [
    { key: 'note', label: '备注' },
    { key: 'text', label: '内容' },
  ]);
  const lines = csv.slice(1).trimEnd().split('\r\n');
  assert.equal(lines[1], ',');
});

test('ITEM_COLUMNS 与 LEAD_COLUMNS 都包含去重需要的关键列', () => {
  for (const columns of [ITEM_COLUMNS, LEAD_COLUMNS]) {
    const keys = columns.map((column) => column.key);
    assert.ok(keys.includes('text'));
    assert.ok(keys.includes('platform'));
    assert.ok(keys.includes('collected_at'));
  }
});
