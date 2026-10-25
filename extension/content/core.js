/**
 * 采集引擎（在页面里运行）。
 *
 * 原则：只读取当前页面上「用户肉眼可见」的公开内容，不请求任何未公开接口，
 * 不做滚动/点击等模拟操作，不改动页面。页面停在哪，就采哪。
 */
(() => {
  const platform = globalThis.LEADLENS_DETECT?.(location.hostname);
  if (!platform) return;

  const SCAN_INTERVAL = 2500;
  const FLUSH_INTERVAL = 3500;
  const BATCH_SIZE = 30;
  const MAX_SEEN = 20000;

  const state = {
    config: globalThis.LEADLENS_PLATFORMS[platform],
    enabled: true,
    seen: new Set(),
    pending: [],
    flushTimer: null,
    lastMatchCount: 0,
    alive: true,
  };

  const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

  function pick(root, field) {
    if (!field?.selectors) return '';
    for (const selector of field.selectors) {
      let node = null;
      try {
        node = root.querySelector(selector);
      } catch {
        continue;
      }
      if (!node) continue;
      const raw = field.attr ? node.getAttribute(field.attr) : node.textContent;
      const value = clean(raw);
      if (value) return value;
    }
    return '';
  }

  function userIdFrom(link) {
    if (!link) return '';
    const match = String(link).match(/\/(?:user|profile|space)\/([A-Za-z0-9_-]{4,})/);
    return match ? match[1] : '';
  }

  function postContext() {
    return {
      title: pick(document, state.config.post?.title),
      author: pick(document, state.config.post?.author),
      url: location.href,
    };
  }

  function findContainers() {
    for (const selector of state.config.commentContainer) {
      let nodes;
      try {
        nodes = document.querySelectorAll(selector);
      } catch {
        continue;
      }
      if (nodes.length > 0) return Array.from(nodes);
    }
    return [];
  }

  function collectFrom(containers, post) {
    const items = [];
    for (const node of containers) {
      const text = pick(node, state.config.fields.text);
      if (!text || text.length < 2 || text.length > 2000) continue;

      const authorName = pick(node, state.config.fields.author);
      const authorId = userIdFrom(pick(node, state.config.fields.link));
      const dedupeKey = `${authorId || authorName}\u0001${text}`;
      if (state.seen.has(dedupeKey)) continue;

      state.seen.add(dedupeKey);
      items.push({
        platform,
        kind: 'comment',
        authorName,
        authorId,
        text,
        likeCount: pick(node, state.config.fields.likes),
        postedAtRaw: pick(node, state.config.fields.time),
        url: post.url,
        title: post.title,
      });
    }

    if (state.seen.size > MAX_SEEN) {
      state.seen = new Set([...state.seen].slice(-MAX_SEEN / 2));
    }
    return items;
  }

  function flush() {
    if (state.pending.length === 0) return;
    const batch = state.pending.splice(0, state.pending.length);
    try {
      chrome.runtime.sendMessage({ type: 'leadlens:ingest', items: batch }, () => {
        void chrome.runtime.lastError;
      });
    } catch {
      state.alive = false;
    }
  }

  function enqueue(items) {
    state.pending.push(...items);
    if (state.pending.length >= BATCH_SIZE) {
      flush();
      return;
    }
    if (!state.flushTimer) {
      state.flushTimer = setTimeout(() => {
        state.flushTimer = null;
        flush();
      }, FLUSH_INTERVAL);
    }
  }

  function scan() {
    if (!state.alive || !state.enabled) return;
    const containers = findContainers();
    state.lastMatchCount = containers.length;
    if (containers.length === 0) return;
    const items = collectFrom(containers, postContext());
    if (items.length > 0) enqueue(items);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'leadlens:probe') {
      const containers = findContainers();
      sendResponse({
        platform,
        label: state.config.label,
        matches: containers.length,
        seen: state.seen.size,
        enabled: state.enabled,
        pending: state.pending.length,
        title: postContext().title,
      });
      return true;
    }
    if (message?.type === 'leadlens:toggle') {
      state.enabled = Boolean(message.enabled);
      sendResponse({ enabled: state.enabled });
      return true;
    }
    return false;
  });

  chrome.storage.local.get(['enabled', 'overrides']).then((settings) => {
    state.enabled = settings.enabled !== false;
    const override = settings.overrides?.[platform];
    if (override?.commentContainer) {
      state.config = {
        ...state.config,
        commentContainer: [override.commentContainer, ...state.config.commentContainer],
      };
    }
    scan();
    setInterval(scan, SCAN_INTERVAL);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.enabled) return;
    state.enabled = changes.enabled.newValue !== false;
    if (state.enabled) scan();
  });
})();
