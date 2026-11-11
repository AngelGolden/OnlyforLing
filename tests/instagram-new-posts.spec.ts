/**
 * Instagram｜学姐个人主页新增 10 条帖子专项验收。
 *
 * 数据真源是 data/instagram-posts/学姐主页新增帖子.txt（用户原文逐字副本）。
 * 本文件里 GOLDEN 是人工照抄规格的独立期望表，用来校验生成数据没有改写 / 漏项。
 * 页面数据来自 src/skins/instagram-data.ts，因此需要先 build，预览服务读取 dist 资源。
 */
import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { compileStory } from "../src/story-engine/compiler";
import {
  ACCOUNTS,
  FEED_POSTS,
  IG001_POST_ID,
  POST_BY_ID,
  POSTS,
  profilePosts,
  timeKey,
  type IgPost,
} from "../src/skins/instagram-data";
import {
  LINGLING_NEW_POSTS,
  LINGLING_NEW_RAW_TIMES,
} from "../src/skins/instagram-lingling-posts";

const PIN = "0511";
const IG = "打开Instagram";
const BASE = "http://127.0.0.1:4173";
const SPEC = "data/instagram-posts/学姐主页新增帖子.txt";
const IMAGE_MAP = "data/instagram-posts/image-sources.json";
const OMAKASE = "post_ll_20261106_omakase";

type Locator = ReturnType<Page["locator"]>;
type GoldenComment = {
  userId: string;
  text: string;
  replyTo?: string;
  replyToCommentId?: string;
};
type Golden = {
  postId: string;
  rawTime: string;
  publishedAt: string;
  caption: string;
  images: number[];
  likes: number;
  likesLabel: string;
  commentCount: number;
  location?: string;
  comments: GoldenComment[];
};

const C = (postId: string, n: number) =>
  `${postId}_c${String(n).padStart(2, "0")}`;

/** 逐条照抄用户规格；顺序是 POST 填写顺序，不是展示顺序。 */
const GOLDEN: Golden[] = [
  {
    postId: "post_ll_20261102_taiyuan",
    rawTime: "2026-11-02 17:42",
    publishedAt: "2026-11-02 17:42",
    caption: "go to taiyuan🍁🍂",
    images: [1],
    likes: 20800,
    likesLabel: "20.8k",
    commentCount: 450,
    comments: [
      { userId: "angel.golden", text: "太原已经冷到要穿大衣了吗" },
      {
        userId: "linglingkwong",
        text: "要著羽绒褛",
        replyTo: "angel.golden",
        replyToCommentId: C("post_ll_20261102_taiyuan", 1),
      },
      {
        userId: "angel.golden",
        text: "出差辛苦了！学姐注意保暖",
        replyTo: "linglingkwong",
        replyToCommentId: C("post_ll_20261102_taiyuan", 2),
      },
    ],
  },
  {
    postId: "post_ll_20261104_Fly",
    rawTime: "2026-11-04 16:40",
    publishedAt: "2026-11-04 16:40",
    caption: "✈️",
    images: [2, 3],
    likes: 23400,
    likesLabel: "23.4K",
    commentCount: 241,
    location: "Hongkong",
    comments: [],
  },
  {
    postId: "post_ll_20260917_pai",
    rawTime: "2026-09-17  18：23",
    publishedAt: "2026-09-17 18:23",
    caption: "🖤",
    images: [4, 5, 6],
    likes: 50600,
    likesLabel: "50.6K",
    commentCount: 845,
    comments: [
      { userId: "angel.golden", text: "今日担当大明星的一日摄影师" },
      {
        userId: "linglingkwong",
        text: "影得好靓，下次再搵你。",
        replyTo: "angel.golden",
        replyToCommentId: C("post_ll_20260917_pai", 1),
      },
    ],
  },
  {
    postId: "post_ll_20261006_Morning",
    rawTime: "2026-10-06 11：23",
    publishedAt: "2026-10-06 11:23",
    caption: "Morning 💚",
    images: [7, 8],
    likes: 31600,
    likesLabel: "31.6K",
    commentCount: 410,
    comments: [],
  },
  {
    postId: "post_ll_20260930_aw",
    rawTime: "2026-09-30 18：20",
    publishedAt: "2026-09-30 18:20",
    caption: "Got the fan kit ready for you when we meet 🍌",
    images: [9],
    likes: 21900,
    likesLabel: "21.9K",
    commentCount: 320,
    comments: [],
  },
  {
    postId: "post_ll_20260814_dior",
    rawTime: "2026-08-14 17：20",
    publishedAt: "2026-08-14 17:20",
    caption: "🤍🤍🤍",
    images: [10, 11],
    likes: 44900,
    likesLabel: "44.9K",
    commentCount: 620,
    comments: [],
  },
  {
    postId: "post_ll_20260608_flower",
    rawTime: "2026-06-08 12：21",
    publishedAt: "2026-06-08 12:21",
    caption: "❤️🤍",
    images: [12],
    likes: 20000,
    likesLabel: "20K",
    commentCount: 120,
    comments: [{ userId: "angel.golden", text: "这是什么花" }],
  },
  {
    postId: "post_ll_20260522_life",
    rawTime: "2026-05-22 14：29",
    publishedAt: "2026-05-22 14:29",
    caption: "Life in little details 🕊️",
    images: [13, 14, 15],
    likes: 27800,
    likesLabel: "27.8K",
    commentCount: 198,
    comments: [],
  },
  {
    postId: "post_ll_20260502_run",
    rawTime: "2026-05-02 06：59",
    publishedAt: "2026-05-02 06:59",
    caption: "Morning Run 🏃🏻‍♀️☕️",
    images: [16, 17],
    likes: 35100,
    likesLabel: "35.1K",
    commentCount: 210,
    comments: [],
  },
  {
    postId: "post_ll_20260420_Night",
    rawTime: "2026-04-20 20：39",
    publishedAt: "2026-04-20 20:39",
    caption: "Good Night 🫶🏼",
    images: [18, 19],
    likes: 25900,
    likesLabel: "25.9K",
    commentCount: 213,
    comments: [],
  },
];

/** 7 条旧帖 + 10 条新帖按发布时间倒序合并后的唯一正确顺序。 */
const MERGED_ORDER = [
  "post_ll_20261106_omakase",
  "post_ll_20261104_Fly",
  "post_ll_20261102_taiyuan",
  "post_ll_20261019_rehearsal",
  "post_ll_20261006_Morning",
  "post_ll_20260930_aw",
  "post_ll_20260917_pai",
  "post_ll_20260914_model",
  "post_ll_20260814_dior",
  "post_ll_20260618_fitness",
  "post_ll_20260608_flower",
  "post_ll_20260522_life",
  "post_ll_20260502_run",
  "post_ll_20260420_Night",
  "post_ll_20260314_dogs",
  "post_ll_20251220_christmas",
  "post_ll_20251102_editorial",
];

/** 原有 7 条帖子的关键字段快照（ID / 时间 / 文案 / 图片 / 互动数据）。 */
const OLD_SNAPSHOT: Record<
  string,
  { publishedAt: string; caption: string; images: number; likes: number; commentCount: number }
> = {
  post_ll_20251102_editorial: {
    publishedAt: "2025-11-02 20:15",
    caption: "今日同狗狗一齊影相 ☺️",
    images: 1,
    likes: 9841,
    commentCount: 50,
  },
  post_ll_20251220_christmas: {
    publishedAt: "2025-12-19 23:35",
    caption: "今晚的燈光好漂亮。\n謝謝每一個來到現場的人。🎄",
    images: 1,
    likes: 11200,
    commentCount: 230,
  },
  post_ll_20260314_dogs: {
    publishedAt: "2026-03-14 18:30",
    caption: "今日終於準時收工，可以陪牠們一會。",
    images: 1,
    likes: 15600,
    commentCount: 57,
  },
  post_ll_20260618_fitness: {
    publishedAt: "2026-06-18 09:40",
    caption: "今日返嚟训练。",
    images: 1,
    likes: 18400,
    commentCount: 130,
  },
  post_ll_20260914_model: {
    publishedAt: "2026-09-14 21:10",
    caption: "某人帮我影嘅后台相\n一齊放出。",
    images: 3,
    likes: 23700,
    commentCount: 310,
  },
  post_ll_20261019_rehearsal: {
    publishedAt: "2026-10-19 23:26",
    caption: "最近比較喜歡留在排練室。",
    images: 1,
    likes: 23200,
    commentCount: 150,
  },
  post_ll_20261106_omakase: {
    publishedAt: "2026-11-06 20:43",
    caption: "慢慢吃完一餐飯，好像也是一種充電。🍣",
    images: 2,
    likes: 26800,
    commentCount: 120,
  },
};

const mediaSrc = (n: number) =>
  `./ig-media/ll-new-${String(n).padStart(2, "0")}.jpg`;

async function loadTemplatePlayer(page: Page) {
  const raw = JSON.parse(readFileSync("stories/template/story.json", "utf8"));
  const { work } = compileStory(raw);
  await page.route("**/work.json", (route) => route.fulfill({ json: work }));
  await page.goto("/");
  const phone = page.locator(".phone-shell");
  await phone.getByRole("button", { name: "轻触解锁" }).click();
  for (const d of PIN)
    await phone.getByRole("button", { name: "密码键" + d }).click();
  await expect(
    phone.getByRole("button", { name: "搜索", exact: true }),
  ).toBeVisible({ timeout: 10000 });
  return phone;
}

async function openInstagram(phone: Locator) {
  await phone.getByRole("button", { name: "返回桌面", exact: true }).click();
  await phone.getByRole("button", { name: IG, exact: true }).click();
  await expect(phone.locator(".igx-ui")).toBeVisible({ timeout: 15000 });
}

async function openLinglingProfile(phone: Locator) {
  await phone
    .locator(".igx-bottom")
    .getByRole("button", { name: "搜索", exact: true })
    .click();
  await phone.getByRole("textbox", { name: "搜索账号" }).fill("linglingkwong");
  await phone.locator('.igx-result[data-user-id="linglingkwong"]').click();
  const profile = phone.locator(
    '.igx-profile[data-profile-id="linglingkwong"]',
  );
  await expect(profile).toBeVisible();
  return profile;
}

async function back(phone: Locator) {
  await phone
    .locator(".igx-ui")
    .getByRole("button", { name: "返回", exact: true })
    .click();
}

async function openPost(phone: Locator, postId: string) {
  await phone.locator(`.igx-cell[data-post-id="${postId}"]`).click();
  const detail = phone.locator(`.igx-post-detail[data-post-id="${postId}"]`);
  await expect(detail).toBeVisible();
  return detail;
}

async function readRuntime(page: Page): Promise<any> {
  return page.evaluate(async () => {
    const req = indexedDB.open("foundphone-studio");
    const db: IDBDatabase = await new Promise((res, rej) => {
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    const tx = db.transaction("saves", "readonly");
    const all: any[] = await new Promise((res, rej) => {
      const r = tx.objectStore("saves").getAll();
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    db.close();
    return all[0]?.state ?? {};
  });
}

const project = (p: IgPost) => ({
  postId: p.postId,
  userId: p.userId,
  publishedAt: p.publishedAt,
  location: p.location ?? "",
  caption: p.caption,
  media: p.media.map((m) => (m.type === "image" ? m.src : m.poster)),
  likes: p.likes,
  likesLabel: p.likesLabel ?? "",
  commentCount: p.commentCount,
  comments: p.comments.map((c) => ({
    commentId: c.commentId,
    userId: c.userId,
    text: c.text,
    replyTo: c.replyTo ?? "",
    replyToCommentId: c.replyToCommentId ?? "",
  })),
  inFeed: p.inFeed ?? false,
  eventHook: p.eventHook ?? "",
});

const expected = (g: Golden) => ({
  postId: g.postId,
  userId: "linglingkwong",
  publishedAt: g.publishedAt,
  location: g.location ?? "",
  caption: g.caption,
  media: g.images.map(mediaSrc),
  likes: g.likes,
  likesLabel: g.likesLabel,
  commentCount: g.commentCount,
  comments: g.comments.map((c, i) => ({
    commentId: C(g.postId, i + 1),
    userId: c.userId,
    text: c.text,
    replyTo: c.replyTo ?? "",
    replyToCommentId: c.replyToCommentId ?? "",
  })),
  inFeed: false,
  eventHook: "",
});

test("验收 1/2/3｜10 条 POST 逐字导入、全部归属学姐、19 张图片零改写且可访问", async ({
  page,
}) => {
  test.setTimeout(120000);
  const spec = readFileSync(SPEC, "utf8");
  const map = JSON.parse(readFileSync(IMAGE_MAP, "utf8")).files;

  expect(LINGLING_NEW_POSTS).toHaveLength(10);
  expect(map).toHaveLength(19);
  expect(LINGLING_NEW_POSTS.map(project)).toEqual(GOLDEN.map(expected));
  expect(POSTS.filter((p) => p.userId === "linglingkwong")).toHaveLength(17);

  for (const g of GOLDEN) {
    expect(spec, `${g.postId} 不在逐字规格里`).toContain(g.postId);
    expect(spec, `${g.postId} 原始时间丢失`).toContain(g.rawTime);
    expect(spec, `${g.postId} 文案丢失`).toContain(g.caption);
    expect(spec, `${g.postId} 点赞原文丢失`).toContain(g.likesLabel);
    expect(spec, `${g.postId} 评论数丢失`).toContain(String(g.commentCount));
    expect(LINGLING_NEW_RAW_TIMES[g.postId]).toBe(g.rawTime);
    expect(timeKey(g.publishedAt)).toBe(timeKey(g.rawTime));
    for (const c of g.comments) {
      const line = c.replyTo
        ? `- @//${c.userId}/ 回复 @//${c.replyTo}/：${c.text}`
        : `- @//${c.userId}/：${c.text}`;
      expect(spec, `评论原文丢失: ${line}`).toContain(line);
    }
    if (g.location) expect(spec).toContain(`位置：\n${g.location}`);
  }
  // 只有 POST 02 填了位置；其余 9 条与未填评论的帖子不能凭空多出内容。
  expect(spec.match(/位置：/g)).toHaveLength(1);

  for (const m of map) {
    const copied = readFileSync(`public/ig-media/${m.file}`);
    expect(
      copied.equals(readFileSync(m.source)),
      `${m.file} 与用户原图不一致`,
    ).toBe(true);
    const res = await page.request.get(`${BASE}/ig-media/${m.file}`);
    expect(res.status(), `图片不可访问: ${m.file}`).toBe(200);
  }
});

test("验收 4/5｜新旧 17 条按香港时间统一倒序，新增历史帖插入到对应位置", async ({
  page,
}) => {
  test.setTimeout(120000);
  const ids = profilePosts("linglingkwong").map((p) => p.postId);
  expect(ids).toEqual(MERGED_ORDER);
  // 每一对相邻帖子的发布时间都不倒挂。
  const times = profilePosts("linglingkwong").map((p) =>
    timeKey(p.publishedAt),
  );
  for (let i = 1; i < times.length; i++)
    expect(times[i - 1]).toBeGreaterThanOrEqual(times[i]);

  // 香港 UTC+8 解释：18:23 HKT = 10:23 UTC；同一时刻的全角输入排序键一致。
  expect(timeKey("2026-09-17 18:23")).toBe(Date.UTC(2026, 8, 17, 10, 23));
  expect(timeKey("2026-09-17  18：23")).toBe(
    timeKey("2026-09-17 18:23"),
  );

  const phone = await loadTemplatePlayer(page);
  await openInstagram(phone);
  const profile = await openLinglingProfile(phone);
  const uiIds = await profile
    .locator(".igx-cell")
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-post-id")));
  expect(uiIds, "界面顺序必须与数据层一致").toEqual(MERGED_ORDER);

  // 代表性插入位置：11 月新帖夹在 11/06 与 10/19 之间；4 月历史帖夹在 5 月与 3 月之间。
  expect(uiIds.indexOf("post_ll_20261102_taiyuan")).toBe(
    uiIds.indexOf(OMAKASE) + 2,
  );
  expect(uiIds.indexOf("post_ll_20260420_Night")).toBe(
    uiIds.indexOf("post_ll_20260502_run") + 1,
  );
});

test("验收 6｜多图帖子按给定顺序展示，不拆帖；文案/点赞/评论数/位置按规格", async ({
  page,
}) => {
  test.setTimeout(180000);
  const phone = await loadTemplatePlayer(page);
  await openInstagram(phone);
  await openLinglingProfile(phone);

  for (const g of GOLDEN) {
    const detail = await openPost(phone, g.postId);
    const imgs = await detail
      .locator(".igx-media img.igx-photo")
      .evaluateAll((els) => els.map((e) => e.getAttribute("src")));
    expect(imgs, `${g.postId} 图片顺序/数量不符`).toEqual(
      g.images.map(mediaSrc),
    );
    expect(
      await detail.locator(".igx-media-count").count(),
      `${g.postId} 多图标记不符`,
    ).toBe(g.images.length > 1 ? 1 : 0);

    const caption = (
      await detail.locator(".igx-caption span").allInnerTexts()
    ).join("");
    expect(caption, `${g.postId} 文案不是逐字原文`).toBe(g.caption);

    const likes = detail.locator(".igx-likes");
    expect(await likes.innerText(), `${g.postId} 点赞原文`).toContain(
      g.likesLabel,
    );
    expect(await likes.getAttribute("data-likes")).toBe(String(g.likes));
    expect(await detail.locator(".igx-comment-link").innerText()).toContain(
      String(g.commentCount),
    );
    expect(await detail.locator(".igx-time").innerText()).toContain(
      g.publishedAt.split(" ")[1],
    );
    expect(
      await detail.locator(".igx-location").count(),
      `${g.postId} 位置显示不符`,
    ).toBe(g.location ? 1 : 0);
    if (g.location)
      expect(await detail.locator(".igx-location").innerText()).toBe(
        g.location,
      );
    await back(phone);
  }
});

test("验收 7｜评论与回复关联正确，未提供的评论不出现", async ({ page }) => {
  test.setTimeout(150000);
  const phone = await loadTemplatePlayer(page);
  await openInstagram(phone);
  await openLinglingProfile(phone);

  const checkComments = async (g: Golden) => {
    const detail = await openPost(phone, g.postId);
    await detail.locator(".igx-comment-link").click();
    const rows = phone.locator(".igx-comments .igx-comment[data-comment-id]");
    await expect(rows).toHaveCount(g.comments.length);
    for (let i = 0; i < g.comments.length; i++) {
      const c = g.comments[i];
      const row = rows.nth(i);
      expect(await row.getAttribute("data-comment-id")).toBe(
        C(g.postId, i + 1),
      );
      expect(await row.getAttribute("data-reply-to-comment")).toBe(
        c.replyToCommentId ?? "",
      );
      const text = await row.innerText();
      expect(text, `${g.postId} 第 ${i + 1} 条评论用户名`).toContain(
        c.userId,
      );
      expect(text, `${g.postId} 第 ${i + 1} 条评论正文`).toContain(c.text);
      if (c.replyTo)
        expect(text, `${g.postId} 第 ${i + 1} 条回复用户名`).toContain(
          `@${c.replyTo}`,
        );
    }
    await back(phone); // 评论页 → 帖子详情
    await back(phone); // 帖子详情 → 主页
  };

  for (const g of GOLDEN.filter((x) => x.comments.length)) await checkComments(g);
  // 没有填写评论的帖子：评论区只保留文案那条，不编造其余评论。
  for (const g of GOLDEN.filter((x) => !x.comments.length)) {
    const detail = await openPost(phone, g.postId);
    await detail.locator(".igx-comment-link").click();
    await expect(
      phone.locator(".igx-comments .igx-comment[data-comment-id]"),
    ).toHaveCount(0);
    await back(phone);
    await back(phone);
  }
});

test("验收 8/9｜原有 7 条帖子零改动，IG-001 仍只绑定 omakase，事件条件不变", async () => {
  const story = JSON.parse(
    readFileSync("stories/template/story.json", "utf8"),
  );
  for (const [id, snap] of Object.entries(OLD_SNAPSHOT)) {
    const p = POST_BY_ID[id];
    expect(p, `旧帖 ${id} 丢失`).toBeTruthy();
    expect(p.publishedAt).toBe(snap.publishedAt);
    expect(p.caption).toBe(snap.caption);
    expect(p.media).toHaveLength(snap.images);
    expect(p.likes).toBe(snap.likes);
    expect(p.commentCount).toBe(snap.commentCount);
    expect(p.likesLabel).toBeUndefined();
  }
  expect(POSTS.filter((p) => p.eventHook === "IG-001").map((p) => p.postId)).toEqual([
    IG001_POST_ID,
  ]);
  expect(POST_BY_ID[OMAKASE].eventHook).toBe("IG-001");
  expect(POST_BY_ID[OMAKASE].publishedAt).toBe("2026-11-06 20:43");
  expect(FEED_POSTS.map((p) => p.postId)).toEqual([
    OMAKASE,
    "post_ag_20261105_quiet",
    "post_lc_20261105_room",
    "post_pd_20261102_rain",
  ]);
  // 账号资料 / 头像 / 昵称 / 帖子数沿用原值，没有新建账号。
  const ling = ACCOUNTS.find((a) => a.userId === "linglingkwong");
  expect(ling).toMatchObject({
    username: "linglingkwong",
    displayName: "Lingling Kwong 鄺玲玲",
    avatar: "./ig-media/avatar-lingling.jpg",
    posts: "53",
    followers: "10.8万",
    following: "41",
  });
  expect(ACCOUNTS).toHaveLength(7);

  // 新增帖子不写进 story.json，也不改任何事件 / 聊天条件。
  expect(story.content.instagram).toEqual([]);
  expect(story.events).toHaveLength(14);
  const ev = story.events.find((e: { id: string }) => e.id === "IG-001");
  expect(ev.event).toBe("variable");
  expect(ev.target).toBe("ui:instagram:igxLikeIntent");
  expect(ev.once).toBe(true);
  expect(ev.conditions.some((c: any) => c.value === "post_ll_20261106_omakase")).toBe(
    true,
  );
  expect(JSON.stringify(story.events)).not.toContain("post_ll_20261104_Fly");
});

test("验收 9｜点赞新增帖不触发 IG-001 或任何 WhatsApp 事件", async ({ page }) => {
  test.setTimeout(120000);
  const phone = await loadTemplatePlayer(page);
  await openInstagram(phone);
  await openLinglingProfile(phone);
  const detail = await openPost(phone, "post_ll_20261104_Fly");
  await detail.getByRole("button", { name: "点赞", exact: true }).click();
  await expect(
    detail.getByRole("button", { name: "取消点赞", exact: true }),
  ).toBeVisible();

  // 等一次存档写入，避免读到点击前的旧状态。
  await expect
    .poll(async () => (await readRuntime(page))?.ui?.instagram?.igxLiked?.length ?? 0, {
      timeout: 15000,
    })
    .toBeGreaterThan(0);
  const state = await readRuntime(page);
  expect(state.ui?.instagram?.igxLikeIntent).toBeUndefined();
  expect(state.playback?.["IG-001"]).toBeUndefined();
  expect(JSON.stringify(state.playback ?? {})).not.toContain("msg_ig001");
});
