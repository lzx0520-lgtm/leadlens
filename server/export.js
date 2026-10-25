const BOM = '\uFEFF';

function cell(value) {
  if (value === null || value === undefined) return '';
  const text = Array.isArray(value) ? value.join('|') : String(value);
  const escaped = text.replace(/"/g, '""');
  return /[",\r\n]/.test(escaped) ? `"${escaped}"` : escaped;
}

export function toCsv(rows, columns) {
  const header = columns.map((column) => cell(column.label)).join(',');
  const lines = rows.map((row) => columns.map((column) => cell(row[column.key])).join(','));
  return `${BOM}${[header, ...lines].join('\r\n')}\r\n`;
}

export const LEAD_COLUMNS = [
  { key: 'id', label: '线索ID' },
  { key: 'platform', label: '平台' },
  { key: 'author_name', label: '昵称' },
  { key: 'text', label: '内容' },
  { key: 'score', label: '意向分' },
  { key: 'tags', label: '标签' },
  { key: 'region', label: '地区' },
  { key: 'like_count', label: '点赞' },
  { key: 'status', label: '状态' },
  { key: 'note', label: '跟进备注' },
  { key: 'title', label: '来源内容' },
  { key: 'url', label: '链接' },
  { key: 'posted_at', label: '发布时间' },
  { key: 'collected_at', label: '采集时间' },
];

export const ITEM_COLUMNS = [
  { key: 'id', label: 'ID' },
  { key: 'platform', label: '平台' },
  { key: 'kind', label: '类型' },
  { key: 'author_name', label: '昵称' },
  { key: 'text', label: '内容' },
  { key: 'score', label: '意向分' },
  { key: 'tags', label: '标签' },
  { key: 'region', label: '地区' },
  { key: 'like_count', label: '点赞' },
  { key: 'title', label: '来源内容' },
  { key: 'url', label: '链接' },
  { key: 'posted_at', label: '发布时间' },
  { key: 'collected_at', label: '采集时间' },
];
