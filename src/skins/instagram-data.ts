/**
 * Instagram 固定内容数据。
 *
 * 全部账号、帖子、评论均为预设数据；数据层本身不调用任何事件派发。
 * 每个 postId 都是稳定的内部标识；排序只用 publishedAt，绝不使用 postId 排序。
 * 图片 / 视频放在 public/ig-media/，替换规则见 public/ig-media/sources.json。
 *
 * IG-001 唯一触发入口是 post_ll_20261106_omakase（邝玲玲 2026-11-06 Omakase 帖）。
 * 只有这条帖子带 eventHook；是否真正触发由故事引擎按前置条件与一次性规则判断。
 *
 * 本轮新增的 10 条学姐主页帖子由 scripts/import-instagram-posts.mjs 生成，
 * 单独放在 instagram-lingling-posts.ts，只做数据追加，不改动下面的既有帖子。
 */
import { LINGLING_NEW_POSTS } from "./instagram-lingling-posts";

const MEDIA = "./ig-media/";
const img = (file: string, alt = "") => ({
  type: "image" as const,
  src: MEDIA + file,
  alt,
});
/** poster 固定使用对应 mp4 的第一帧静态图，主页缩略图与播放前画面保持一致。 */
const vid = (file: string, poster: string) => ({
  type: "video" as const,
  src: MEDIA + file,
  poster: MEDIA + poster,
});

export type IgAccount = {
  userId: string;
  username: string;
  displayName: string;
  bio: string[];
  avatar?: string;
  posts?: string;
  followers?: string;
  following?: string;
  accent: string;
};

export type IgComment = {
  commentId: string;
  userId: string;
  text: string;
  /** 被回复者的账号 ID；界面据此显示「回复 @用户名」。 */
  replyTo?: string;
  /** 回复指向的原评论 ID；把回复明确挂到对应评论，而不只是提到某个用户名。 */
  replyToCommentId?: string;
};

export type IgMedia =
  | { type: "image"; src: string; alt: string }
  | { type: "video"; src: string; poster: string };

export type IgPost = {
  postId: string;
  userId: string;
  publishedAt: string;
  location?: string;
  caption: string;
  media: IgMedia[];
  likes: number;
  /** 用户填写的点赞原文（如 20.8k / 20K）；有值时按原文展示，避免格式化改写数据。 */
  likesLabel?: string;
  commentCount: number;
  comments: IgComment[];
  /** 是否出现在 Home Feed */
  inFeed?: boolean;
  /** 剧情事件钩子；目前只有 IG-001 的目标帖子带此标记 */
  eventHook?: "IG-001";
};

/** IG-001 唯一指定的目标帖子；从 Home Feed 与个人主页进入都使用同一个 ID。 */
export const IG001_POST_ID = "post_ll_20261106_omakase";

/** 当前登录的账号（界面上只显示 angel.golden，不出现任何解释性称呼）。 */
export const SELF_ID = "angel.golden";

export const ACCOUNTS: IgAccount[] = [
  {
    userId: "angel.golden",
    username: "angel.golden",
    displayName: "Angel Golden",
    // 规格原文写作 @//latecheckout.hk/；界面按真实 Instagram 的 @用户名 形式呈现。
    bio: [
      "PolyU · Design",
      "bass player @latecheckout.hk collecting little moments in HK ☁️",
    ],
    avatar: MEDIA + "avatar-angel.jpg",
    posts: "8",
    followers: "511",
    following: "61",
    accent: "#7b8fa8",
  },
  {
    userId: "linglingkwong",
    username: "linglingkwong",
    displayName: "Lingling Kwong 鄺玲玲",
    bio: ["PolyU · HTM", "Model · Music · Life", "Always wonder☺️"],
    avatar: MEDIA + "avatar-lingling.jpg",
    posts: "53",
    followers: "10.8万",
    following: "41",
    accent: "#b58173",
  },
  {
    userId: "latecheckout.hk",
    username: "latecheckout.hk",
    displayName: "Late Checkout",
    bio: [],
    avatar: MEDIA + "avatar-latecheckout.jpg",
    accent: "#6b7a6a",
  },
  {
    userId: "hongkongpolyu",
    username: "hongkongpolyu",
    displayName: "PolyU",
    bio: ["The Hong Kong Polytechnic University"],
    accent: "#8c4b4b",
  },
  {
    userId: "polyudiary.hk",
    username: "polyudiary.hk",
    displayName: "PolyU Diary",
    bio: [
      "A little diary of campus life.",
      "Student-run, not an official university account.",
    ],
    avatar: MEDIA + "avatar-polyudiary.png",
    accent: "#628b93",
  },
  {
    userId: "mimi.jpg",
    username: "mimi.jpg",
    displayName: "Mimi",
    bio: [],
    accent: "#9a7ba0",
  },
  {
    userId: "chloe.archive",
    username: "chloe.archive",
    displayName: "Chloe",
    bio: [],
    accent: "#a08a5f",
  },
];

export const ACCOUNT_BY_ID: Record<string, IgAccount> = Object.fromEntries(
  ACCOUNTS.map((a) => [a.userId, a]),
);

let commentSeq = 0;
const cmt = (userId: string, text: string, replyTo?: string): IgComment => ({
  commentId: `cmt_${String(++commentSeq).padStart(3, "0")}`,
  userId,
  text,
  replyTo,
});

export const POSTS: IgPost[] = [
  // ---------- Angel Golden：8 条 ----------
  {
    postId: "post_ag_20250921_campus",
    userId: SELF_ID,
    publishedAt: "2025-09-21 17:42",
    location: "The Hong Kong Polytechnic University",
    caption: "关于理大的第一张照片。\n从今天开始，慢慢把这座城市走熟。📍",
    media: [img("ag-campus.png", "陽光下的現代校園廣場")],
    likes: 186,
    commentCount: 9,
    comments: [
      cmt("mimi.jpg", "校园真的好漂亮！"),
      cmt(SELF_ID, "就是每天走路有点多hhh", "mimi.jpg"),
    ],
  },
  {
    postId: "post_ag_20251018_rehearsal",
    userId: SELF_ID,
    publishedAt: "2025-10-18 23:16",
    caption: "本来只是去听一次排练，最后还是抱着 bass 留下来了。",
    media: [img("ag-rehearsal-tour.jpg", "排练房")],
    likes: 264,
    commentCount: 17,
    comments: [
      cmt("latecheckout.hk", "欢迎加入低音部"),
      cmt("chloe.archive", "好像发现了新技能！"),
      cmt(SELF_ID, "请多关照！", "latecheckout.hk"),
    ],
  },
  {
    postId: "post_ag_20251219_christmas",
    userId: SELF_ID,
    publishedAt: "2025-12-19 23:52",
    caption:
      "第一次和 Late Checkout 一起站上台。\n台下灯太亮，反而看不清大家的脸，但听得见每个人在唱。\nps.收了很多返图，学姐的这张最最最喜欢。",
    media: [
      img("ag-bass.jpg", "贝斯与键盘"),
      img("ag-christmas-guitar.jpg", "舞台上的吉他"),
    ],
    likes: 512,
    commentCount: 38,
    comments: [
      cmt("linglingkwong", "今晚很穩，辛苦啦。☺️"),
      cmt("latecheckout.hk", "Our Christmas set!!"),
      cmt("mimi.jpg", "现场一定很棒！！"),
      cmt(SELF_ID, "学姐也辛苦啦，明年也要一起表演！", "linglingkwong"),
    ],
  },
  {
    postId: "post_ag_20260322_after_rehearsal",
    userId: SELF_ID,
    publishedAt: "2026-03-22 01:18",
    caption: "排练结束后的宵夜，永远比排练计划更准时。",
    media: [img("ag-supper.jpg", "宵夜")],
    likes: 337,
    commentCount: 16,
    comments: [
      cmt("latecheckout.hk", "下次不许再点这么多 😂"),
      cmt("mimi.jpg", "看起来很好吃"),
      cmt(SELF_ID, "可是邝学姐最后都吃完了", "latecheckout.hk"),
    ],
  },
  {
    postId: "post_ag_20260418_design",
    userId: SELF_ID,
    publishedAt: "2026-04-18 16:20",
    caption: "终于定稿。\n有人帮忙挑刺，成品果然会好一点。",
    media: [img("ag-design.png", "服装设计定稿")],
    likes: 298,
    commentCount: 13,
    comments: [cmt("chloe.archive", "排版很好看！")],
  },
  {
    postId: "post_ag_20260709_hk",
    userId: SELF_ID,
    publishedAt: "2026-07-09 19:35",
    caption: "在香港生活的日常：\n赶车、走路、找吃的。",
    media: [
      img("hk-09.jpg", "香港随拍 9"),
      img("hk-10.jpg", "香港随拍 10"),
      img("hk-11.jpg", "香港随拍 11"),
    ],
    likes: 421,
    commentCount: 22,
    comments: [],
  },
  {
    postId: "post_ag_20260809_hk",
    userId: SELF_ID,
    publishedAt: "2026-08-09 20:35",
    caption: "独家vedio。",
    media: [vid("ag-rehearsal-backstage.mp4", "ag-rehearsal-backstage-first-frame.jpg")],
    likes: 421,
    commentCount: 22,
    comments: [],
  },
  {
    // 同一则动态在规格的「Angel 主页 POST 08」记为 22:48、「Feed 04」记为 18:56。
    // 这里只保留一条帖子，采用主页的 22:48 作为唯一发布时间，Feed 与主页显示一致。
    postId: "post_ag_20261105_quiet",
    userId: SELF_ID,
    publishedAt: "2026-11-05 22:48",
    caption: "你会钟意这座城市吗。",
    media: [img("hk-12.jpg", "香港随拍 12")],
    likes: 203,
    commentCount: 8,
    comments: [],
    inFeed: true,
  },

  // ---------- Lingling Kwong：7 条 ----------
  // 规格中的「2,30 / 3,10 / 1,50 / 1,20」按 230 / 310 / 150 / 120 记入 commentCount。
  {
    postId: "post_ll_20251102_editorial",
    userId: "linglingkwong",
    publishedAt: "2025-11-02 20:15",
    caption: "今日同狗狗一齊影相 ☺️",
    media: [img("ll-dogs-shoot.jpg", "狗狗拍摄")],
    likes: 9841,
    commentCount: 50,
    comments: [],
  },
  {
    postId: "post_ll_20251220_christmas",
    userId: "linglingkwong",
    publishedAt: "2025-12-19 23:35",
    caption: "今晚的燈光好漂亮。\n謝謝每一個來到現場的人。🎄",
    media: [img("ll-christmas-piano.jpg", "弹琴返图")],
    likes: 11200,
    commentCount: 230,
    comments: [],
  },
  {
    postId: "post_ll_20260314_dogs",
    userId: "linglingkwong",
    publishedAt: "2026-03-14 18:30",
    caption: "今日終於準時收工，可以陪牠們一會。",
    media: [img("ll-dogs.jpg", "狗狗")],
    likes: 15600,
    commentCount: 57,
    comments: [],
  },
  {
    postId: "post_ll_20260618_fitness",
    userId: "linglingkwong",
    publishedAt: "2026-06-18 09:40",
    caption: "今日返嚟训练。",
    media: [img("ll-fitness.jpg", "健身")],
    likes: 18400,
    commentCount: 130,
    comments: [],
  },
  {
    postId: "post_ll_20260914_model",
    userId: "linglingkwong",
    publishedAt: "2026-09-14 21:10",
    caption: "某人帮我影嘅后台相\n一齊放出。",
    media: [
      img("ll-backstage-1.jpg", "后台照 1"),
      img("ll-backstage-2.jpg", "后台照 2"),
      img("ll-backstage-3.jpg", "后台照 3"),
    ],
    likes: 23700,
    commentCount: 310,
    comments: [],
  },
  {
    postId: "post_ll_20261019_rehearsal",
    userId: "linglingkwong",
    publishedAt: "2026-10-19 23:26",
    caption: "最近比較喜歡留在排練室。",
    media: [vid("ll-practice-room.mp4", "ll-practice-room-first-frame.jpg")],
    likes: 23200,
    commentCount: 150,
    comments: [],
  },
  {
    postId: "post_ll_20261106_omakase",
    userId: "linglingkwong",
    publishedAt: "2026-11-06 20:43",
    caption: "慢慢吃完一餐飯，好像也是一種充電。🍣",
    media: [
      img("ll-omakase-1.jpg", "日料 1"),
      img("ll-omakase-2.jpg", "日料 2"),
    ],
    likes: 26800,
    commentCount: 120,
    comments: [],
    inFeed: true,
    eventHook: "IG-001",
  },

  // ---------- 其他关注账号：Feed 中出现的动态 ----------
  {
    postId: "post_lc_20261105_room",
    userId: "latecheckout.hk",
    publishedAt: "2026-11-05 22:10",
    caption: "Back in the room.",
    media: [
      img("lc-room-1.jpg", "排练室 1"),
      img("lc-room-2.jpg", "排练室 2"),
    ],
    likes: 230,
    commentCount: 0,
    comments: [],
    inFeed: true,
  },
  {
    postId: "post_pd_20261102_rain",
    userId: "polyudiary.hk",
    publishedAt: "2026-11-02 16:20",
    caption: "The campus after rain.",
    media: [img("pd-campus-rain.png", "雨后理大")],
    likes: 1320,
    commentCount: 0,
    comments: [],
    inFeed: true,
  },

  // ---------- Lingling Kwong：本轮新增的 10 条历史帖子 ----------
  // 放在数组末尾只是数据追加；profilePosts() 会与上面 7 条旧帖合并后按发布时间统一倒序，
  // 因此 2026-04 ~ 2026-11 的历史帖会自动插到对应时间位置。
  // 这些帖子不带 inFeed / eventHook，不进入 Home Feed，也不改变 IG-001 的唯一目标帖。
  ...LINGLING_NEW_POSTS,
];

export const POST_BY_ID: Record<string, IgPost> = Object.fromEntries(
  POSTS.map((p) => [p.postId, p]),
);

/** 香港时间全年固定 UTC+8（1979 年后已无夏令时），不需要查时区表。 */
const HK_OFFSET_HOURS = 8;

/** 全角冒号 / 双空格等输入归一成 YYYY-MM-DD HH:mm；既有帖子时间不被改写。 */
export function normalizePublishedAt(raw: string): string {
  const s = raw.replace(/：/g, ":").replace(/\s+/g, " ").trim();
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s))
    throw new Error(`发布时间格式不合法: ${raw}`);
  return s;
}

/**
 * 排序键完全来自发布时间，与 postId 无关。
 * 把 YYYY-MM-DD HH:mm 统一按香港当地时间 Asia/Hong_Kong 解释成绝对毫秒数后再比较，
 * 新帖与旧帖因此落在同一条时间轴上，历史帖会自动插入对应位置。
 */
export function timeKey(publishedAt: string): number {
  const [date, time] = normalizePublishedAt(publishedAt).split(" ");
  const [y, m, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  return Date.UTC(y, m - 1, d, h - HK_OFFSET_HOURS, mi);
}

/** 倒序；时间相同时用原始下标兜底，稳定顺序不依赖 JS 引擎的 sort 实现。 */
export function sortedPosts(list: IgPost[]): IgPost[] {
  return list
    .map((p, index) => ({ p, index }))
    .sort(
      (a, b) =>
        timeKey(b.p.publishedAt) - timeKey(a.p.publishedAt) ||
        a.index - b.index,
    )
    .map(({ p }) => p);
}

export const FEED_POSTS = sortedPosts(POSTS.filter((p) => p.inFeed));

export function profilePosts(userId: string): IgPost[] {
  return sortedPosts(POSTS.filter((p) => p.userId === userId));
}

export function formatLikes(n: number): string {
  return n >= 10000 ? `${(n / 1000).toFixed(1)}K` : n.toLocaleString("en-US");
}

export function formatPostTime(publishedAt: string): string {
  const [date, time] = publishedAt.split(" ");
  const [y, m, d] = date.split("-");
  return `${y}年${Number(m)}月${Number(d)}日 · ${time}`;
}

export function displayName(userId: string): string {
  return ACCOUNT_BY_ID[userId]?.displayName ?? userId;
}
