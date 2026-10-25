/**
 * 后台中继：内容脚本 → 本地 LeadLens 服务。
 *
 * 放在 background 里发请求，是因为服务工作线程有 host_permissions，
 * 不会受页面自身 origin 的 CORS 限制，也不受页面 CSP 影响。
 * 服务没启动时，数据先在队列里排队，起来后自动补发。
 */
const INGEST_URL = 'http://127.0.0.1:8787/api/ingest';
const HEALTH_URL = 'http://127.0.0.1:8787/api/health';
const MAX_QUEUE = 3000;
const CHUNK = 100;

const todayKey = () => new Date().toISOString().slice(0, 10);

let queue = [];
let flushing = false;
let loaded = false;
let retryTimer = null;
let counters = { day: todayKey(), inserted: 0, leads: 0 };

async function loadState() {
  if (loaded) return;
  loaded = true;
  try {
    const saved = await chrome.storage.session.get(['queue', 'counters']);
    if (Array.isArray(saved.queue)) queue = saved.queue.slice(-MAX_QUEUE);
    if (saved.counters) counters = saved.counters;
  } catch {
    /* session storage 不可用时退化为内存队列 */
  }
  if (counters.day !== todayKey()) counters = { day: todayKey(), inserted: 0, leads: 0 };
}

let persistTimer = null;
function persist() {
  if (persistTimer) return;
  persistTimer = setTimeout(async () => {
    persistTimer = null;
    try {
      await chrome.storage.session.set({ queue: queue.slice(-MAX_QUEUE), counters });
    } catch {
      /* 忽略：内存队列仍然可用 */
    }
  }, 800);
}

async function updateBadge() {
  const text = counters.inserted > 0 ? String(Math.min(counters.inserted, 999)) : '';
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color: '#f5a524' });
}

async function checkHealth() {
  try {
    const response = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch {
    return false;
  }
}

async function postChunk(items) {
  const response = await fetch(INGEST_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ items }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function flush() {
  await loadState();
  if (flushing || queue.length === 0) return;
  flushing = true;

  try {
    while (queue.length > 0) {
      const chunk = queue.slice(0, CHUNK);
      const result = await postChunk(chunk);
      queue.splice(0, chunk.length);

      if (counters.day !== todayKey()) counters = { day: todayKey(), inserted: 0, leads: 0 };
      counters.inserted += Number(result.inserted) || 0;
      counters.leads += Number(result.leads) || 0;
      persist();
      await updateBadge();
    }
  } catch {
    if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
    persist();
    if (!retryTimer) {
      retryTimer = setTimeout(() => {
        retryTimer = null;
        flush();
      }, 10000);
    }
  } finally {
    flushing = false;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'leadlens:ingest') {
    const items = Array.isArray(message.items) ? message.items : [];
    queue.push(...items);
    if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
    persist();
    flush();
    sendResponse({ queued: queue.length });
    return true;
  }

  if (message?.type === 'leadlens:status') {
    (async () => {
      await loadState();
      sendResponse({
        online: await checkHealth(),
        queue: queue.length,
        counters,
      });
    })();
    return true;
  }

  if (message?.type === 'leadlens:flush') {
    (async () => {
      await loadState();
      await flush();
      sendResponse({ queue: queue.length, counters });
    })();
    return true;
  }

  return false;
});

chrome.runtime.onStartup.addListener(() => {
  loadState().then(flush);
});

loadState().then(flush);
