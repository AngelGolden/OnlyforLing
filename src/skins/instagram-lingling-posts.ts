/**
 * 由 scripts/import-instagram-posts.mjs 从用户规格逐字生成，请勿手工编辑。
 * 数据来源：data/instagram-posts/学姐主页新增帖子.txt
 * 时间已归一为 YYYY-MM-DD HH:mm（香港当地时间 Asia/Hong_Kong）；原始输入见 LINGLING_NEW_RAW_TIMES。
 * 本文件只新增学姐主页帖子：不含 inFeed / eventHook，不改变 IG-001 的唯一目标。
 */
import type { IgPost } from "./instagram-data";

export const LINGLING_NEW_POSTS: IgPost[] = [
  {
    postId: "post_ll_20261102_taiyuan",
    userId: "linglingkwong",
    publishedAt: "2026-11-02 17:42",
    caption: "go to taiyuan🍁🍂",
    media: [
      { type: "image", src: "./ig-media/ll-new-01.jpg", alt: "太原1.jpg" },
    ],
    likes: 20800,
    likesLabel: "20.8k",
    commentCount: 450,
    comments: [
      {
        commentId: "post_ll_20261102_taiyuan_c01",
        userId: "angel.golden",
        text: "太原已经冷到要穿大衣了吗",
      },
      {
        commentId: "post_ll_20261102_taiyuan_c02",
        userId: "linglingkwong",
        text: "要著羽绒褛",
        replyTo: "angel.golden",
        replyToCommentId: "post_ll_20261102_taiyuan_c01",
      },
      {
        commentId: "post_ll_20261102_taiyuan_c03",
        userId: "angel.golden",
        text: "出差辛苦了！学姐注意保暖",
        replyTo: "linglingkwong",
        replyToCommentId: "post_ll_20261102_taiyuan_c02",
      },
    ],
  },
  {
    postId: "post_ll_20261104_Fly",
    userId: "linglingkwong",
    publishedAt: "2026-11-04 16:40",
    location: "Hongkong",
    caption: "✈️",
    media: [
      { type: "image", src: "./ig-media/ll-new-02.jpg", alt: "fly1.jpg" },
      { type: "image", src: "./ig-media/ll-new-03.jpg", alt: "fly2.jpg" },
    ],
    likes: 23400,
    likesLabel: "23.4K",
    commentCount: 241,
    comments: [],
  },
  {
    postId: "post_ll_20260917_pai",
    userId: "linglingkwong",
    publishedAt: "2026-09-17 18:23",
    caption: "🖤",
    media: [
      { type: "image", src: "./ig-media/ll-new-04.jpg", alt: "🖤1.jpg" },
      { type: "image", src: "./ig-media/ll-new-05.jpg", alt: "🖤2.jpg" },
      { type: "image", src: "./ig-media/ll-new-06.jpg", alt: "🖤3.jpg" },
    ],
    likes: 50600,
    likesLabel: "50.6K",
    commentCount: 845,
    comments: [
      {
        commentId: "post_ll_20260917_pai_c01",
        userId: "angel.golden",
        text: "今日担当大明星的一日摄影师",
      },
      {
        commentId: "post_ll_20260917_pai_c02",
        userId: "linglingkwong",
        text: "影得好靓，下次再搵你。",
        replyTo: "angel.golden",
        replyToCommentId: "post_ll_20260917_pai_c01",
      },
    ],
  },
  {
    postId: "post_ll_20261006_Morning",
    userId: "linglingkwong",
    publishedAt: "2026-10-06 11:23",
    caption: "Morning 💚",
    media: [
      { type: "image", src: "./ig-media/ll-new-07.jpg", alt: "morning1 (1).jpg" },
      { type: "image", src: "./ig-media/ll-new-08.jpg", alt: "morning1 (2).jpg" },
    ],
    likes: 31600,
    likesLabel: "31.6K",
    commentCount: 410,
    comments: [],
  },
  {
    postId: "post_ll_20260930_aw",
    userId: "linglingkwong",
    publishedAt: "2026-09-30 18:20",
    caption: "Got the fan kit ready for you when we meet 🍌",
    media: [
      { type: "image", src: "./ig-media/ll-new-09.jpg", alt: "SaveClip.App_830562768_18620543860015167_7377919281963882931_n.jpg" },
    ],
    likes: 21900,
    likesLabel: "21.9K",
    commentCount: 320,
    comments: [],
  },
  {
    postId: "post_ll_20260814_dior",
    userId: "linglingkwong",
    publishedAt: "2026-08-14 17:20",
    caption: "🤍🤍🤍",
    media: [
      { type: "image", src: "./ig-media/ll-new-10.jpg", alt: "dior (2).jpg" },
      { type: "image", src: "./ig-media/ll-new-11.jpg", alt: "dior (1).jpg" },
    ],
    likes: 44900,
    likesLabel: "44.9K",
    commentCount: 620,
    comments: [],
  },
  {
    postId: "post_ll_20260608_flower",
    userId: "linglingkwong",
    publishedAt: "2026-06-08 12:21",
    caption: "❤️🤍",
    media: [
      { type: "image", src: "./ig-media/ll-new-12.jpg", alt: "flower.jpg" },
    ],
    likes: 20000,
    likesLabel: "20K",
    commentCount: 120,
    comments: [
      {
        commentId: "post_ll_20260608_flower_c01",
        userId: "angel.golden",
        text: "这是什么花",
      },
    ],
  },
  {
    postId: "post_ll_20260522_life",
    userId: "linglingkwong",
    publishedAt: "2026-05-22 14:29",
    caption: "Life in little details 🕊️",
    media: [
      { type: "image", src: "./ig-media/ll-new-13.jpg", alt: "life (1).jpg" },
      { type: "image", src: "./ig-media/ll-new-14.jpg", alt: "life (3).jpg" },
      { type: "image", src: "./ig-media/ll-new-15.jpg", alt: "life (2).jpg" },
    ],
    likes: 27800,
    likesLabel: "27.8K",
    commentCount: 198,
    comments: [],
  },
  {
    postId: "post_ll_20260502_run",
    userId: "linglingkwong",
    publishedAt: "2026-05-02 06:59",
    caption: "Morning Run 🏃🏻‍♀️☕️",
    media: [
      { type: "image", src: "./ig-media/ll-new-16.jpg", alt: "run (2).jpg" },
      { type: "image", src: "./ig-media/ll-new-17.jpg", alt: "run (1).jpg" },
    ],
    likes: 35100,
    likesLabel: "35.1K",
    commentCount: 210,
    comments: [],
  },
  {
    postId: "post_ll_20260420_Night",
    userId: "linglingkwong",
    publishedAt: "2026-04-20 20:39",
    caption: "Good Night 🫶🏼",
    media: [
      { type: "image", src: "./ig-media/ll-new-18.jpg", alt: "good night (2).jpg" },
      { type: "image", src: "./ig-media/ll-new-19.jpg", alt: "good night (1).jpg" },
    ],
    likes: 25900,
    likesLabel: "25.9K",
    commentCount: 213,
    comments: [],
  },
];

/** 用户填写的原始发布时间（含全角冒号 / 双空格），只作审计，不参与排序。 */
export const LINGLING_NEW_RAW_TIMES: Record<string, string> = {
  "post_ll_20261102_taiyuan": "2026-11-02 17:42",
  "post_ll_20261104_Fly": "2026-11-04 16:40",
  "post_ll_20260917_pai": "2026-09-17  18：23",
  "post_ll_20261006_Morning": "2026-10-06 11：23",
  "post_ll_20260930_aw": "2026-09-30 18：20",
  "post_ll_20260814_dior": "2026-08-14 17：20",
  "post_ll_20260608_flower": "2026-06-08 12：21",
  "post_ll_20260522_life": "2026-05-22 14：29",
  "post_ll_20260502_run": "2026-05-02 06：59",
  "post_ll_20260420_Night": "2026-04-20 20：39",
};
