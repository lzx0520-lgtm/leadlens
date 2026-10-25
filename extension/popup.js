const $ = (id) => document.getElementById(id);

const SUPPORTED = [
  { host: 'douyin.com', key: 'douyin', label: '抖音' },
  { host: 'kuaishou.com', key: 'kuaishou', label: '快手' },
  { host: 'xiaohongshu.com', key: 'xiaohongshu', label: '小红书' },
  { host: 'bilibili.com', key: 'bilibili', label: 'B站' },
];

function detect(hostname) {
  const clean = String(hostname || '').replace(/^www\./, '');
  return SUPPORTED.find((item) => clean === item.host || clean.endsWith(`.${item.host}`)) ?? null;
}

function sendToTab(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) return resolve(null);
      resolve(response ?? null);
    });
  });
}

function sendToWorker(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) return resolve(null);
      resolve(response ?? null);
    });
  });
}

async function renderServer() {
  const status = await sendToWorker({ type: 'leadlens:status' });
  const dot = $('server-dot');
  const text = $('server-text');

  if (!status) {
    dot.className = 'dot offline';
    text.textContent = '后台未响应';
    return;
  }

  dot.className = `dot ${status.online ? 'online' : 'offline'}`;
  text.textContent = status.online ? '已连接' : '未启动';
  $('queue-text').textContent = String(status.queue ?? 0);
  $('stat-inserted').textContent = String(status.counters?.inserted ?? 0);
  $('stat-leads').textContent = String(status.counters?.leads ?? 0);
}

async function renderPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const platform = detect(tab?.url ? new URL(tab.url).hostname : '');
  const pageText = $('page-text');
  const matchText = $('match-text');

  if (!tab || !platform) {
    pageText.textContent = '不在支持站点';
    matchText.textContent = '—';
    return;
  }

  pageText.textContent = platform.label;
  const probe = await sendToTab(tab.id, { type: 'leadlens:probe' });
  if (!probe) {
    matchText.textContent = '需刷新页面';
    return;
  }

  matchText.textContent = `${probe.matches} 条`;
  $('selector').placeholder = `当前规则已匹配 ${probe.matches} 条`;

  const overrides = (await chrome.storage.local.get('overrides')).overrides ?? {};
  $('selector').value = overrides[platform.key]?.commentContainer ?? '';
}

async function init() {
  const { enabled = true } = await chrome.storage.local.get('enabled');
  $('toggle').checked = enabled !== false;

  await Promise.all([renderServer(), renderPage()]);
}

$('toggle').addEventListener('change', async (event) => {
  const enabled = event.target.checked;
  await chrome.storage.local.set({ enabled });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) await sendToTab(tab.id, { type: 'leadlens:toggle', enabled });
});

$('sync-now').addEventListener('click', async () => {
  const button = $('sync-now');
  button.disabled = true;
  button.textContent = '同步中…';
  await sendToWorker({ type: 'leadlens:flush' });
  await renderServer();
  button.disabled = false;
  button.textContent = '立即同步';
});

$('open-dashboard').addEventListener('click', () => {
  chrome.tabs.create({ url: 'http://127.0.0.1:8787/' });
});

$('save-selector').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const platform = detect(tab?.url ? new URL(tab.url).hostname : '');
  if (!tab || !platform) {
    $('hint').textContent = '请先在支持的站点页面上使用。';
    return;
  }

  const selector = $('selector').value.trim();
  const stored = (await chrome.storage.local.get('overrides')).overrides ?? {};
  const next = { ...stored };

  if (selector) next[platform.key] = { commentContainer: selector };
  else delete next[platform.key];

  await chrome.storage.local.set({ overrides: next });

  $('hint').textContent = selector ? '已保存，刷新页面后生效。' : '已恢复内置规则，刷新页面后生效。';
  await renderPage();
});

init();
