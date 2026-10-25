import { createHash } from 'node:crypto';

/**
 * 意向词库。每个分组命中一次只计一次权重，避免同一句话堆词刷分。
 * 想调整判断标准，改这里即可，不用动其它代码。
 */
export const INTENT_GROUPS = [
  {
    tag: 'contact',
    weight: 40,
    words: ['私信', '联系我', '加我', '加v', '加微', 'vx', '微信', '电话', '手机号', '怎么联系', '留个联系'],
  },
  {
    tag: 'purchase',
    weight: 35,
    words: ['怎么买', '哪里买', '求链接', '要链接', '下单', '购买', '拍下', '要一个', '来一个', '想买', '团购', '代理'],
  },
  {
    tag: 'price',
    weight: 30,
    words: ['多少钱', '价格', '怎么卖', '报价', '收费', '几块', '多少钱一套', '有优惠', '活动价', '预算'],
  },
  {
    tag: 'question',
    weight: 15,
    words: ['怎么用', '怎么弄', '有效果吗', '靠谱吗', '真的吗', '适用', '适合', '能行吗', '有用吗', '求教', '请教'],
  },
  {
    tag: 'region',
    weight: 10,
    words: ['同城', '本地', '附近', '西安', '北京', '上海', '深圳', '广州', '成都', '杭州'],
  },
];

/** 命中即判定为噪音，直接扣分 */
export const NOISE_GROUPS = [
  {
    tag: 'noise',
    weight: -45,
    words: ['互粉', '互赞', '互关', '刷单', '刷量', '广告位', '招主播', '诚招代理', '加群', '进群', '抽奖'],
  },
];

const MAX_ACTIVITY_BONUS = 12;
const MAX_KEYWORD_BONUS = 36;
const KEYWORD_UNIT = 12;

export function normalizeText(input) {
  return String(input ?? '')
    .replace(/[\u200b-\u200f\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * 指纹用于跨次采集、跨设备去重。
 * 用「平台 + 类型 + 作者 + 正文」而不是平台内 id —— 各平台 DOM 里拿不到稳定 id，
 * 但同一作者发同样的话，基本可以认为是同一条。
 */
export function fingerprint({ platform, kind, authorId, authorName, text }) {
  const key = [platform, kind, authorId || authorName || '', normalizeText(text)].join('\u0001');
  return createHash('sha1').update(key).digest('hex');
}

/**
 * 解析平台的相对时间文本，拿不到就返回 null。
 * 只支持公共可见的几种写法，不猜。
 */
export function parseRelativeTime(raw, now = Date.now()) {
  if (!raw) return null;
  const text = String(raw).trim();

  const absolute = text.match(/(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})/);
  if (absolute) {
    const [, y, m, d] = absolute;
    // 平台只给到「日期」，没有时区。按 UTC 零点存，避免在 UTC+8 下整体退一天。
    const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  if (/刚刚/.test(text)) return new Date(now).toISOString();
  if (/昨天/.test(text)) return new Date(now - 86400000).toISOString();
  if (/前天/.test(text)) return new Date(now - 2 * 86400000).toISOString();

  const unitMap = {
    秒: 1000,
    分钟: 60000,
    分: 60000,
    小时: 3600000,
    时: 3600000,
    天: 86400000,
    周: 7 * 86400000,
  };
  const relative = text.match(/(\d+)\s*(秒|分钟|分|小时|时|天|周)\s*前/);
  if (relative) {
    const [, amount, unit] = relative;
    return new Date(now - Number(amount) * unitMap[unit]).toISOString();
  }

  return null;
}

export function parseCount(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.max(0, Math.round(raw));
  const text = String(raw ?? '').trim();
  if (!text) return 0;

  const number = text.match(/(\d+(?:\.\d+)?)/);
  if (!number) return 0;
  const value = Number(number[1]);
  if (/万|w/i.test(text)) return Math.round(value * 10000);
  if (/千|k/i.test(text)) return Math.round(value * 1000);
  return Math.round(value);
}

function matchedGroups(text, groups) {
  const hits = [];
  let score = 0;
  for (const group of groups) {
    if (group.words.some((word) => text.includes(word))) {
      score += group.weight;
      hits.push(group.tag);
    }
  }
  return { score, hits };
}

/**
 * 给一条采集内容打分。返回 0-100 的整数与命中标签。
 * 纯函数：同样的输入永远同样的输出（除了依赖 now 的新鲜度）。
 */
export function scoreItem(item, options = {}) {
  const { keywords = [], now = Date.now() } = options;
  const text = normalizeText(item.text);

  if (!text) return { score: 0, tags: [] };

  const positive = matchedGroups(text, INTENT_GROUPS);
  const noise = matchedGroups(text, NOISE_GROUPS);

  let score = positive.score + noise.score;

  const keywordHits = keywords
    .map((keyword) => normalizeText(keyword))
    .filter(Boolean)
    .filter((keyword) => text.includes(keyword)).length;
  score += Math.min(MAX_KEYWORD_BONUS, keywordHits * KEYWORD_UNIT);

  const likes = parseCount(item.likeCount);
  if (likes > 0) score += Math.min(MAX_ACTIVITY_BONUS, Math.log10(1 + likes) * 6);

  const postedAt = item.postedAt ?? parseRelativeTime(item.postedAtRaw, now);
  if (postedAt) {
    const age = now - new Date(postedAt).getTime();
    if (age >= 0 && age < 86400000) score += 8;
    else if (age < 7 * 86400000) score += 4;
  }

  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const tags = [...new Set([...positive.hits, ...noise.hits])];
  return { score: clamped, tags };
}
