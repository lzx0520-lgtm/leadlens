/**
 * 灌入一批演示数据，方便没装扩展时也能看到工作台长什么样。
 * 用法：node scripts/seed-demo.mjs [服务地址]
 */
const BASE = process.argv[2] ?? 'http://127.0.0.1:8787';

const RULE = {
  name: '本地装修',
  platform: 'all',
  keywords: '装修,量房,报价,定制',
  minScore: 45,
};

const ITEMS = [
  {
    platform: 'douyin',
    kind: 'comment',
    authorName: '小王要变美',
    text: '这个多少钱啊，西安能发货吗？麻烦私信我一下',
    likeCount: '1.2万',
    postedAtRaw: '3小时前',
    title: '全屋定制避坑指南',
    url: 'https://www.douyin.com/video/7300000000000000001',
  },
  {
    platform: 'douyin',
    kind: 'comment',
    authorName: '装修老李',
    text: '我们是做装修的，想了解一下你们的量房服务怎么收费',
    likeCount: '238',
    postedAtRaw: '昨天',
    title: '全屋定制避坑指南',
    url: 'https://www.douyin.com/video/7300000000000000001',
  },
  {
    platform: 'douyin',
    kind: 'comment',
    authorName: '互粉小助手',
    text: '互粉互赞，进群领福利，广告位招租',
    likeCount: '0',
    postedAtRaw: '刚刚',
    title: '装修日常',
    url: 'https://www.douyin.com/video/7300000000000000002',
  },
  {
    platform: 'xiaohongshu',
    kind: 'comment',
    authorName: 'Momo',
    text: '求链接！这个适合小户型吗',
    likeCount: '812',
    postedAtRaw: '2025-06-12',
    title: '30㎡小户型改造',
    url: 'https://www.xiaohongshu.com/explore/665f0000',
  },
  {
    platform: 'xiaohongshu',
    kind: 'comment',
    authorName: '西安土著',
    text: '同城的，想约个上门量房，怎么联系',
    likeCount: '67',
    postedAtRaw: '6小时前',
    title: '30㎡小户型改造',
    url: 'https://www.xiaohongshu.com/explore/665f0000',
  },
  {
    platform: 'xiaohongshu',
    kind: 'comment',
    authorName: '阿May',
    text: '效果真的好吗，有优惠活动价吗',
    likeCount: '96',
    postedAtRaw: '1天前',
    title: '30㎡小户型改造',
    url: 'https://www.xiaohongshu.com/explore/665f0000',
  },
  {
    platform: 'kuaishou',
    kind: 'comment',
    authorName: '东北老铁',
    text: '建材代理怎么合作，加个微信聊聊',
    likeCount: '45',
    postedAtRaw: '2小时前',
    title: '建材批发实拍',
    url: 'https://www.kuaishou.com/short-video/3x0000',
  },
  {
    platform: 'kuaishou',
    kind: 'comment',
    authorName: '二狗子',
    text: '哈哈哈笑死我了',
    likeCount: '15',
    postedAtRaw: '10分钟前',
    title: '工地搞笑合集',
    url: 'https://www.kuaishou.com/short-video/3x0001',
  },
  {
    platform: 'bilibili',
    kind: 'comment',
    authorName: '想看海的猫',
    text: 'UP主能出个报价模板吗，想请教一下',
    likeCount: '120',
    postedAtRaw: '3天前',
    title: '装修预算怎么算',
    url: 'https://www.bilibili.com/video/BV1xx411c7mD',
  },
  {
    platform: 'bilibili',
    kind: 'comment',
    authorName: '摸鱼选手',
    text: '这期讲得挺好的，学到了',
    likeCount: '3200',
    postedAtRaw: '5天前',
    title: '装修预算怎么算',
    url: 'https://www.bilibili.com/video/BV1xx411c7mD',
  },
];

async function call(path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${path} 失败：HTTP ${response.status}`);
  return response.json();
}

const health = await fetch(`${BASE}/api/health`).then((r) => r.ok).catch(() => false);
if (!health) {
  console.error(`连不上 ${BASE}，先运行 npm start`);
  process.exit(1);
}

await call('/api/rules', RULE);
const result = await call('/api/ingest', { items: ITEMS });
console.log('演示数据已写入：', result);
console.log(`打开 ${BASE} 查看`);
