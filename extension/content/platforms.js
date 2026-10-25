/**
 * 各平台的 DOM 选择器配置。
 *
 * 平台改版很频繁，所以这里全部是「候选数组」：从左到右试，第一个能取到内容的生效。
 * 注意：fields 下的选择器是「相对于评论容器」的，post 下的选择器是「相对于整个页面」的。
 *
 * 页面改版后采集数量掉到 0，直接在扩展弹窗里填一条新的「评论容器」选择器就能救回来，
 * 不需要改代码、不需要重新打包。
 */
globalThis.LEADLENS_PLATFORMS = {
  douyin: {
    label: '抖音',
    hosts: ['douyin.com'],
    commentContainer: ['[data-e2e="comment-item"]', '[class*="comment-item"]'],
    fields: {
      author: { selectors: ['a[href*="/user/"]', '[class*="nickname"]', '[class*="author"]'] },
      text: { selectors: ['[class*="content"]', '.semi-typography', 'p'] },
      likes: { selectors: ['[class*="like"] [class*="count"]', '[class*="like"]'] },
      time: { selectors: ['[class*="create-time"]', '[class*="time"]'] },
      link: { selectors: ['a[href*="/user/"]'], attr: 'href' },
    },
    post: {
      title: { selectors: ['[data-e2e="video-desc"]', '[class*="video-title"]', 'h1'] },
      author: { selectors: ['[data-e2e="video-author"] a', '[class*="author"] a[href*="/user/"]'] },
    },
  },

  kuaishou: {
    label: '快手',
    hosts: ['kuaishou.com'],
    commentContainer: ['[class*="comment-item"]', '[class*="CommentItem"]', '.comment-item'],
    fields: {
      author: { selectors: ['[class*="user-name"]', '[class*="nickname"]', 'a[href*="/profile/"]'] },
      text: { selectors: ['[class*="comment-content"]', '[class*="content"]'] },
      likes: { selectors: ['[class*="like-count"]', '[class*="like"] [class*="count"]'] },
      time: { selectors: ['[class*="time"]', '[class*="date"]'] },
      link: { selectors: ['a[href*="/profile/"]'], attr: 'href' },
    },
    post: {
      title: { selectors: ['[class*="video-info"] h2', '[class*="caption"]', 'h2'] },
      author: { selectors: ['[class*="profile"] [class*="name"]', '[class*="user-name"]'] },
    },
  },

  xiaohongshu: {
    label: '小红书',
    hosts: ['xiaohongshu.com'],
    commentContainer: ['.comment-item', '[class*="comment-item"]'],
    fields: {
      author: { selectors: ['.author .name', '[class*="author"] [class*="name"]', '.name'] },
      text: { selectors: ['.content .note-text', '.note-text', '[class*="content"]'] },
      likes: { selectors: ['.like-wrapper .count', '[class*="like"] [class*="count"]', '.count'] },
      time: { selectors: ['.date span', '.date', '[class*="date"]'] },
      link: { selectors: ['a[href*="/user/profile/"]'], attr: 'href' },
    },
    post: {
      title: { selectors: ['#detail-title', '[class*="note-content"] .title', '.title'] },
      author: { selectors: ['.author-wrapper .username', '.username', '[class*="author"] .name'] },
    },
  },

  bilibili: {
    label: 'B站',
    hosts: ['bilibili.com'],
    commentContainer: ['.reply-item', '.sub-reply-item', '[class*="reply-item"]'],
    fields: {
      author: { selectors: ['.user-name', '.sub-user-name', '[class*="user-name"]'] },
      text: { selectors: ['.reply-content', '.sub-reply-content', '[class*="reply-content"]'] },
      likes: { selectors: ['.reply-like .like', '.sub-reply-like', '[class*="like"] span'] },
      time: { selectors: ['.reply-time', '.sub-time', '[class*="reply-time"]'] },
      link: { selectors: ['a[href*="/space/"]'], attr: 'href' },
    },
    post: {
      title: { selectors: ['h1.video-title', '.video-title', 'h1'] },
      author: { selectors: ['.up-name', '[class*="up-name"]', '.username'] },
    },
  },
};

globalThis.LEADLENS_DETECT = (hostname) => {
  const clean = String(hostname || '').replace(/^www\./, '');
  for (const [key, cfg] of Object.entries(globalThis.LEADLENS_PLATFORMS)) {
    if (cfg.hosts.some((host) => clean === host || clean.endsWith(`.${host}`))) return key;
  }
  return null;
};
