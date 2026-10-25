const $ = (id) => document.getElementById(id);

const PLATFORM_LABEL = {
  douyin: '抖音',
  kuaishou: '快手',
  xiaohongshu: '小红书',
  bilibili: 'B站',
};

const STATUS_LABEL = {
  new: '待跟进',
  reviewing: '沟通中',
  followed: '已跟进',
  ignored: '已忽略',
};

const TAG_LABEL = {
  contact: '要联系',
  purchase: '购买意向',
  price: '问价格',
  question: '咨询',
  region: '本地',
  noise: '噪音',
};

const leadCache = new Map();

const esc = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );

function safeUrl(value) {
  const text = String(value ?? '');
  return /^https?:\/\//i.test(text) ? text : '';
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...options,
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(detail.error ?? `请求失败（${response.status}）`);
  }
  return response.status === 204 ? null : response.json();
}

function fmtTime(iso) {
  if (!iso) return '—';
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return '—';
  const diff = Date.now() - time;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  if (diff < 7 * 86400000) return `${Math.floor(diff / 86400000)} 天前`;
  return new Date(time).toLocaleDateString('zh-CN');
}

const scoreClass = (score) => (score >= 75 ? 'hot' : score >= 50 ? 'warm' : '');

function platformBadge(platform) {
  return `<span class="plat">${esc(PLATFORM_LABEL[platform] ?? platform ?? '—')}</span>`;
}

function tagList(raw) {
  let tags = [];
  try {
    tags = Array.isArray(raw) ? raw : JSON.parse(raw ?? '[]');
  } catch {
    tags = [];
  }
  if (tags.length === 0) return '<span class="muted">—</span>';
  return tags.map((tag) => `<span class="tag">${esc(TAG_LABEL[tag] ?? tag)}</span>`).join('');
}

/* ---------------- 统计 ---------------- */

async function loadStats() {
  try {
    const stats = await api('/api/stats');
    $('stat-items').textContent = stats.items;
    $('stat-leads').textContent = stats.leads;
    $('stat-new').textContent = stats.newLeads;
    $('stat-followed').textContent = stats.followed;
    $('stat-rules').textContent = stats.rules;
    $('conn').className = 'conn online';
    $('conn').textContent = '本地服务已连接';
  } catch {
    $('conn').className = 'conn offline';
    $('conn').textContent = '本地服务断开';
  }
}

/* ---------------- 线索池 ---------------- */

async function loadLeads() {
  const params = new URLSearchParams({
    status: $('lead-status').value,
    platform: $('lead-platform').value,
    minScore: $('lead-min').value || '0',
    limit: '300',
  });

  const rows = await api(`/api/leads?${params}`);
  leadCache.clear();
  for (const row of rows) leadCache.set(row.id, row);

  $('lead-empty').style.display = rows.length ? 'none' : 'block';
  $('lead-rows').innerHTML = rows
    .map(
      (row) => `
      <tr class="clickable" data-id="${row.id}">
        <td><span class="score ${scoreClass(row.score)}">${row.score}</span></td>
        <td>${platformBadge(row.platform)}</td>
        <td class="author">${esc(row.author_name || '匿名')}</td>
        <td class="text"><span class="clamp">${esc(row.text)}</span></td>
        <td>${tagList(row.tags)}</td>
        <td><span class="status ${esc(row.status)}">${esc(STATUS_LABEL[row.status] ?? row.status)}</span></td>
        <td class="muted">${esc(fmtTime(row.collected_at))}</td>
      </tr>`,
    )
    .join('');
}

/* ---------------- 采集数据 ---------------- */

async function loadItems() {
  const params = new URLSearchParams({
    platform: $('item-platform').value,
    q: $('item-q').value.trim(),
    limit: '300',
  });

  const rows = await api(`/api/items?${params}`);
  $('item-empty').style.display = rows.length ? 'none' : 'block';
  $('item-rows').innerHTML = rows
    .map(
      (row) => `
      <tr>
        <td><span class="score ${scoreClass(row.score)}">${row.score}</span></td>
        <td>${platformBadge(row.platform)}</td>
        <td class="author">${esc(row.author_name || '匿名')}</td>
        <td class="text"><span class="clamp">${esc(row.text)}</span></td>
        <td class="muted">${row.like_count ?? 0}</td>
        <td class="muted">${esc(fmtTime(row.collected_at))}</td>
      </tr>`,
    )
    .join('');
}

/* ---------------- 规则 ---------------- */

async function loadRules() {
  const rows = await api('/api/rules');
  $('rule-rows').innerHTML = rows
    .map(
      (rule) => `
      <tr>
        <td>${esc(rule.name)}</td>
        <td>${rule.platform === 'all' ? '<span class="muted">全部</span>' : platformBadge(rule.platform)}</td>
        <td>${rule.keywords.length ? rule.keywords.map((w) => `<span class="tag">${esc(w)}</span>`).join('') : '<span class="muted">—</span>'}</td>
        <td>${rule.min_score}</td>
        <td><span class="status ${rule.enabled ? 'followed' : 'ignored'}">${rule.enabled ? '启用' : '停用'}</span></td>
        <td><button class="ghost" data-delete="${rule.id}" type="button">删除</button></td>
      </tr>`,
    )
    .join('') || '<tr><td colspan="6" class="empty">还没有规则，用上面的表单加一条。</td></tr>';
}

/* ---------------- 抽屉 ---------------- */

function openDrawer(id) {
  const row = leadCache.get(Number(id));
  if (!row) return;

  $('d-platform').textContent = PLATFORM_LABEL[row.platform] ?? row.platform;
  $('d-author').textContent = row.author_name || '匿名';
  $('d-score').textContent = String(row.score);
  $('d-tags').innerHTML = tagList(row.tags);
  $('d-region').textContent = row.region || '—';
  $('d-title').textContent = row.title || '—';
  $('d-text').textContent = row.text ?? '';

  const link = safeUrl(row.url);
  const linkNode = $('d-link');
  if (link) {
    linkNode.href = link;
    linkNode.style.display = 'block';
  } else {
    linkNode.style.display = 'none';
  }

  $('d-status').value = row.status;
  $('d-note').value = row.note ?? '';
  $('d-save').dataset.id = String(row.id);
  $('drawer').hidden = false;
}

function closeDrawer() {
  $('drawer').hidden = true;
}

/* ---------------- 事件绑定 ---------------- */

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((node) => node.classList.toggle('active', node === tab));
    for (const name of ['leads', 'items', 'rules']) {
      $(`panel-${name}`).classList.toggle('hidden', name !== tab.dataset.tab);
    }
    if (tab.dataset.tab === 'items') loadItems().catch(() => {});
    if (tab.dataset.tab === 'rules') loadRules().catch(() => {});
  });
});

$('lead-rows').addEventListener('click', (event) => {
  const row = event.target.closest('tr[data-id]');
  if (row) openDrawer(row.dataset.id);
});

$('lead-status').addEventListener('change', () => loadLeads().catch(() => {}));
$('lead-platform').addEventListener('change', () => loadLeads().catch(() => {}));
$('lead-min').addEventListener('change', () => loadLeads().catch(() => {}));
$('lead-refresh').addEventListener('click', () => {
  loadStats();
  loadLeads().catch(() => {});
});

$('item-platform').addEventListener('change', () => loadItems().catch(() => {}));
$('item-search').addEventListener('click', () => loadItems().catch(() => {}));
$('item-q').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') loadItems().catch(() => {});
});

$('drawer-close').addEventListener('click', closeDrawer);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeDrawer();
});

$('d-save').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  const id = button.dataset.id;
  button.disabled = true;
  button.textContent = '保存中…';
  try {
    await api(`/api/leads/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: $('d-status').value, note: $('d-note').value }),
    });
    closeDrawer();
    await Promise.all([loadStats(), loadLeads()]);
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
    button.textContent = '保存';
  }
});

$('rule-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await api('/api/rules', {
      method: 'POST',
      body: JSON.stringify({
        name: $('rule-name').value,
        platform: $('rule-platform').value,
        keywords: $('rule-keywords').value,
        minScore: Number($('rule-min').value) || 45,
      }),
    });
    $('rule-name').value = '';
    $('rule-keywords').value = '';
    await Promise.all([loadRules(), loadStats()]);
  } catch (error) {
    alert(error.message);
  }
});

$('rule-rows').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-delete]');
  if (!button) return;
  if (!confirm('删除这条规则？已经生成的线索不受影响。')) return;
  await api(`/api/rules/${button.dataset.delete}`, { method: 'DELETE' });
  await Promise.all([loadRules(), loadStats()]);
});

/* ---------------- 启动与轮询 ---------------- */

async function boot() {
  await loadStats();
  await loadLeads().catch(() => {});
  await loadRules().catch(() => {});
}

boot();
setInterval(() => {
  loadStats();
  if (!$('panel-leads').classList.contains('hidden')) loadLeads().catch(() => {});
}, 15000);
