import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { compileStory } from "../src/story-engine/compiler";

const PIN = "0511";
const IG = "打开Instagram";
const BASE = "http://127.0.0.1:4173";

type Locator = ReturnType<Page["locator"]>;

async function unlockAfterLoad(phone: Locator) {
  // 与既有 immersion / whatsapp-playback 测试一致：解锁后固定输入 0511。
  await phone.getByRole("button", { name: "轻触解锁" }).click();
  for (const d of PIN)
    await phone.getByRole("button", { name: "密码键" + d }).click();
  await expect(
    phone.getByRole("button", { name: "搜索", exact: true }),
  ).toBeVisible({ timeout: 10000 });
}

async function loadTemplatePlayer(page: Page) {
  const raw = JSON.parse(readFileSync("stories/template/story.json", "utf8"));
  const { work } = compileStory(raw);
  await page.route("**/work.json", (route) => route.fulfill({ json: work }));
  await page.goto("/");
  const phone = page.locator(".phone-shell");
  await unlockAfterLoad(phone);
  return phone;
}

async function openInstagram(phone: Locator) {
  await phone.getByRole("button", { name: "返回桌面", exact: true }).click();
  await phone.getByRole("button", { name: IG, exact: true }).click();
  await expect(phone.locator(".igx-ui")).toBeVisible({ timeout: 15000 });
}

async function nav(phone: Locator, label: string) {
  await phone
    .locator(".igx-bottom")
    .getByRole("button", { name: label, exact: true })
    .click();
}

async function back(phone: Locator) {
  await phone
    .locator(".igx-ui")
    .getByRole("button", { name: "返回", exact: true })
    .click();
}

/** 直接从 Dexie 读取 Runtime，验证状态真正落盘而不是只在组件内存里。 */
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

async function reloadAndOpenInstagram(page: Page, phone: Locator) {
  await page.reload();
  await unlockAfterLoad(phone);
  await openInstagram(phone);
}

const FEED_ORDER = [
  "post_ll_20261106_omakase",
  "post_ag_20261105_quiet",
  "post_lc_20261105_room",
  "post_pd_20261102_rain",
];

const ANGEL_ORDER = [
  "post_ag_20261105_quiet",
  "post_ag_20260809_hk",
  "post_ag_20260709_hk",
  "post_ag_20260418_design",
  "post_ag_20260322_after_rehearsal",
  "post_ag_20251219_christmas",
  "post_ag_20251018_rehearsal",
  "post_ag_20250921_campus",
];

/** 学姐主页 7 条旧帖 + 本轮 10 条新帖合并后，按发布时间统一倒序的唯一正确顺序。 */
const LINGLING_ORDER = [
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

test("默认进入 Home Feed，按发布时间倒序，账号名跳转主页并可返回", async ({
  page,
}) => {
  test.setTimeout(90000);
  const phone = await loadTemplatePlayer(page);
  await openInstagram(phone);

  await expect(phone.locator(".igx-logo")).toBeVisible();
  await expect(phone.locator(".igx-stories")).toHaveCount(0);
  await expect(phone.locator(".igx-bottom > button")).toHaveCount(4);

  const ids = await phone
    .locator(".igx-feed .igx-post")
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-post-id")));
  expect(ids, "Feed 必须按发布时间倒序").toEqual(FEED_ORDER);

  const first = phone.locator(
    '.igx-feed .igx-post[data-post-id="post_ll_20261106_omakase"]',
  );
  await first.locator(".igx-post-who .igx-username").click();
  await expect(
    phone.locator('.igx-profile[data-profile-id="linglingkwong"]'),
  ).toBeVisible();
  await back(phone);
  await expect(phone.locator(".igx-feed")).toBeVisible();
});

test("Angel Golden 主页资料正确，八条帖子按时间倒序", async ({ page }) => {
  test.setTimeout(90000);
  const phone = await loadTemplatePlayer(page);
  await openInstagram(phone);
  await nav(phone, "个人主页");

  const profile = phone.locator('.igx-profile[data-profile-id="angel.golden"]');
  await expect(profile).toBeVisible();
  // 用户名显示在顶部标题栏（与真实 Instagram 一致），显示名称与简介在资料区。
  await expect(phone.locator(".igx-subhead strong")).toHaveText("angel.golden");
  const text = await profile.innerText();
  expect(text).toContain("Angel Golden");
  expect(text).toContain("PolyU · Design");
  expect(text).toContain("collecting little moments in HK");
  expect(text).toContain("511");
  expect(text).toContain("61");

  const ids = await profile
    .locator(".igx-cell")
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-post-id")));
  expect(ids).toEqual(ANGEL_ORDER);

  await back(phone);
  await expect(phone.locator(".igx-feed")).toBeVisible();
});

test("邝玲玲主页可从 Feed 与 Search 进入，17 条帖子按时间统一倒序", async ({ page }) => {
  test.setTimeout(90000);
  const phone = await loadTemplatePlayer(page);
  await openInstagram(phone);

  // Feed 路径
  await phone
    .locator('.igx-feed .igx-post[data-post-id="post_ll_20261106_omakase"]')
    .locator(".igx-post-who .igx-username")
    .click();
  const profile = phone.locator('.igx-profile[data-profile-id="linglingkwong"]');
  await expect(profile).toBeVisible();
  expect(await profile.innerText()).toContain("Lingling Kwong 鄺玲玲");
  expect(await profile.innerText()).toContain("Always wonder☺️");
  const ids = await profile
    .locator(".igx-cell")
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-post-id")));
  expect(ids, "新增历史帖必须按发布时间插入，而不是按 POST 填写顺序").toEqual(
    LINGLING_ORDER,
  );
  expect(await profile.locator('[data-post-id="post_ll_20261106_omakase"]').count()).toBe(1);

  // Search 路径
  await back(phone);
  await nav(phone, "搜索");
  await phone.getByRole("textbox", { name: "搜索账号" }).fill("linglingkwong");
  await phone.locator('.igx-result[data-user-id="linglingkwong"]').click();
  await expect(
    phone.locator('.igx-profile[data-profile-id="linglingkwong"]'),
  ).toBeVisible();
});

test("Search 可找到预设账号，推荐列表只显示四个账号", async ({ page }) => {
  test.setTimeout(90000);
  const phone = await loadTemplatePlayer(page);
  await openInstagram(phone);
  await nav(phone, "搜索");

  const box = phone.getByRole("textbox", { name: "搜索账号" });
  for (const id of [
    "angel.golden",
    "linglingkwong",
    "latecheckout.hk",
    "hongkongpolyu",
    "polyudiary.hk",
  ]) {
    await box.fill(id);
    await expect(phone.locator(`.igx-result[data-user-id="${id}"]`)).toBeVisible();
  }
  await box.fill("does-not-exist");
  await expect(phone.getByText("没有找到相关账号。")).toBeVisible();
  await phone.getByRole("button", { name: "清除搜索" }).click();
  await expect(phone.getByText("为你推荐")).toBeVisible();
  // 推荐列表不再包含第三行的 hongkongpolyu，但仍能通过搜索框找到该账号。
  await expect(phone.locator(".igx-result")).toHaveCount(4);
  await expect(
    phone.locator('.igx-result[data-user-id="hongkongpolyu"]'),
  ).toHaveCount(0);
});

test("点赞可切换、点赞数增减、刷新后保留", async ({ page }) => {
  test.setTimeout(120000);
  const phone = await loadTemplatePlayer(page);
  await openInstagram(phone);
  const id = "post_lc_20261105_room";
  const post = phone.locator(
    `.igx-feed .igx-post[data-post-id="${id}"]`,
  );
  const before = Number(await post.locator(".igx-likes").getAttribute("data-likes"));

  await post.getByRole("button", { name: "点赞", exact: true }).click();
  await expect(
    post.getByRole("button", { name: "取消点赞", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(Number(await post.locator(".igx-likes").getAttribute("data-likes"))).toBe(
    before + 1,
  );
  await expect
    .poll(
      async () => (await readRuntime(page))?.ui?.instagram?.igxLiked ?? [],
      { timeout: 15000 },
    )
    .toContain(id);

  await reloadAndOpenInstagram(page, phone);
  const again = phone.locator(`.igx-feed .igx-post[data-post-id="${id}"]`);
  await expect(
    again.getByRole("button", { name: "取消点赞", exact: true }),
  ).toHaveAttribute("aria-pressed", "true", { timeout: 15000 });
  expect(Number(await again.locator(".igx-likes").getAttribute("data-likes"))).toBe(
    before + 1,
  );

  // 再点一次取消，计数回退且落盘
  await again.getByRole("button", { name: "取消点赞", exact: true }).click();
  await expect(
    again.getByRole("button", { name: "点赞", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  expect(Number(await again.locator(".igx-likes").getAttribute("data-likes"))).toBe(
    before,
  );
});

test("预设评论可查看，自由输入评论并随刷新保留", async ({ page }) => {
  test.setTimeout(120000);
  const phone = await loadTemplatePlayer(page);
  await openInstagram(phone);
  await nav(phone, "个人主页");
  await phone
    .locator('.igx-cell[data-post-id="post_ag_20250921_campus"]')
    .click();
  const detail = phone.locator(
    '.igx-post-detail[data-post-id="post_ag_20250921_campus"]',
  );
  await expect(detail).toBeVisible();
  await detail.getByRole("button", { name: "评论", exact: true }).click();

  await expect(phone.getByText("校园真的好漂亮！")).toBeVisible();
  await expect(phone.getByText("就是每天走路有点多hhh")).toBeVisible();
  await expect(phone.getByText("回复 @mimi.jpg")).toBeVisible();

  await phone.getByRole("textbox", { name: "添加评论" }).fill("测试评论 IG-002");
  await phone.getByRole("button", { name: "发布评论" }).click();
  await expect(phone.getByText("测试评论 IG-002")).toBeVisible();
  await expect
    .poll(
      async () =>
        ((await readRuntime(page))?.ui?.instagram?.igxComments ?? []).length,
      { timeout: 15000 },
    )
    .toBe(1);

  await reloadAndOpenInstagram(page, phone);
  await nav(phone, "个人主页");
  await phone
    .locator('.igx-cell[data-post-id="post_ag_20250921_campus"]')
    .click();
  await phone
    .locator(".igx-post-detail")
    .getByRole("button", { name: "评论", exact: true })
    .click();
  await expect(phone.getByText("测试评论 IG-002")).toBeVisible();
});

test("收藏可切换并持久化，已收藏页面能看到帖子", async ({ page }) => {
  test.setTimeout(120000);
  const phone = await loadTemplatePlayer(page);
  await openInstagram(phone);
  const id = "post_pd_20261102_rain";
  const post = phone.locator(`.igx-feed .igx-post[data-post-id="${id}"]`);
  await post.getByRole("button", { name: "收藏", exact: true }).click();
  await expect(
    post.getByRole("button", { name: "取消收藏", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(
      async () => (await readRuntime(page))?.ui?.instagram?.igxSaved ?? [],
      { timeout: 15000 },
    )
    .toContain(id);

  await reloadAndOpenInstagram(page, phone);
  await nav(phone, "个人主页");
  await phone.getByRole("button", { name: "已收藏", exact: true }).click();
  await expect(phone.locator(".igx-saved")).toBeVisible();
  await expect(
    phone.locator(`.igx-saved .igx-cell[data-post-id="${id}"]`),
  ).toBeVisible();
});

test("关注状态可切换并随刷新保留，主页可返回上一页", async ({ page }) => {
  test.setTimeout(120000);
  const phone = await loadTemplatePlayer(page);
  await openInstagram(phone);

  const openLingling = async () => {
    await nav(phone, "搜索");
    await phone.getByRole("textbox", { name: "搜索账号" }).fill("linglingkwong");
    await phone.locator('.igx-result[data-user-id="linglingkwong"]').click();
    await expect(
      phone.locator('.igx-profile[data-profile-id="linglingkwong"]'),
    ).toBeVisible();
  };
  await openLingling();
  const profile = phone.locator(
    '.igx-profile[data-profile-id="linglingkwong"]',
  );
  await expect(
    profile.getByRole("button", { name: "已关注", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await profile.getByRole("button", { name: "已关注", exact: true }).click();
  await expect(
    profile.getByRole("button", { name: "关注", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await expect
    .poll(
      async () => (await readRuntime(page))?.ui?.instagram?.igxFollowing ?? [],
      { timeout: 15000 },
    )
    .not.toContain("linglingkwong");

  await back(phone);
  await expect(phone.getByText("搜索结果")).toBeVisible();

  await reloadAndOpenInstagram(page, phone);
  await openLingling();
  await expect(
    phone
      .locator('.igx-profile[data-profile-id="linglingkwong"]')
      .getByRole("button", { name: "关注", exact: true }),
  ).toHaveAttribute("aria-pressed", "false", { timeout: 15000 });
});

test("点赞非目标帖子不触发任何剧情事件，界面无元叙事措辞", async ({
  page,
}) => {
  test.setTimeout(120000);
  const phone = await loadTemplatePlayer(page);
  await openInstagram(phone);
  const before = await readRuntime(page);

  // IG-001 唯一入口是 post_ll_20261106_omakase；其他帖子点赞只是普通 Instagram 点赞。
  const id = "post_lc_20261105_room";
  const target = phone.locator(`.igx-feed .igx-post[data-post-id="${id}"]`);
  await target.getByRole("button", { name: "点赞", exact: true }).click();
  await expect
    .poll(
      async () => (await readRuntime(page))?.ui?.instagram?.igxLiked ?? [],
      { timeout: 15000 },
    )
    .toContain(id);

  const after = await readRuntime(page);
  expect(after.completed ?? [], "不得新增剧情完成记录").toEqual(
    before.completed ?? [],
  );
  expect(Object.keys(after.playback ?? {}), "不得新增消息播放包").toEqual(
    Object.keys(before.playback ?? {}),
  );
  expect(
    (after.messages?.whatsapp ?? []).length,
    "不得写入 WhatsApp 消息",
  ).toBe((before.messages?.whatsapp ?? []).length);
  expect(after.unlocked ?? [], "不得解锁新内容").toEqual(
    before.unlocked ?? [],
  );
  expect(after.variables?.IG_001_TRIGGERED).toBe(false);

  const text = (await phone.locator(".igx-ui").innerText()).replace(/\s/g, "");
  for (const word of ["机主", "玩家", "手机主人", "虚构", "模拟器"]) {
    expect(text, `Instagram 内不应出现「${word}」`).not.toContain(word);
  }
});

test("帖子菜单、分享与私信有响应，顶栏没有通知入口", async ({ page }) => {
  test.setTimeout(120000);
  const phone = await loadTemplatePlayer(page);
  await openInstagram(phone);

  // 顶栏只保留私信入口；通知图标与通知页已整体移除。
  await expect(
    phone.getByRole("button", { name: "通知", exact: true }),
  ).toHaveCount(0);
  await expect(phone.locator(".igx-topbar-actions > button")).toHaveCount(1);
  await expect(phone.getByText("暂时没有新通知。")).toHaveCount(0);

  await phone.locator(".igx-feed .igx-post").first()
    .getByRole("button", { name: "更多", exact: true }).click();
  await expect(phone.locator(".igx-sheet")).toBeVisible();
  await phone.getByRole("button", { name: "查看帖子详情", exact: true }).click();
  await expect(phone.locator(".igx-post-detail")).toBeVisible();
  await back(phone);

  await phone
    .locator(".igx-feed .igx-post")
    .first()
    .getByRole("button", { name: "分享", exact: true })
    .click();
  await expect(phone.getByText("发送给")).toBeVisible();
  await phone.locator(".igx-sheet-account").first().click();
  await expect(phone.locator(".igx-shared")).toBeVisible();
  await phone.getByRole("textbox", { name: "输入消息" }).fill("测试消息");
  await phone.getByRole("button", { name: "发送消息" }).click();
  await expect(phone.getByText("测试消息")).toBeVisible();
  await back(phone);
  await expect(phone.locator(".igx-feed")).toBeVisible();

  await nav(phone, "私信");
  await expect(phone.locator(".igx-dm")).toBeVisible();
});

test("所有预设图片与视频资源可访问，且每条照片独立渲染", async ({
  page,
}) => {
  test.setTimeout(120000);
  const phone = await loadTemplatePlayer(page);
  await openInstagram(phone);

  // 首页 + 两个主页里出现的静态资源
  const sources = new Set<string>();
  const collect = async () => {
    const imgs = await phone
      .locator(".igx-ui img")
      .evaluateAll((els) => els.map((e) => e.getAttribute("src") ?? ""));
    const videos = await phone
      .locator(".igx-ui video")
      .evaluateAll((els) => els.map((e) => e.getAttribute("src") ?? ""));
    for (const s of [...imgs, ...videos]) if (s.includes("ig-media/")) sources.add(s);
  };
  await collect();
  await nav(phone, "个人主页");
  await collect();
  await nav(phone, "首页");
  await phone
    .locator(".igx-feed")
    .getByRole("button", { name: "linglingkwong", exact: true })
    .first()
    .click();
  await collect();

  // 两段视频不在首页的 <video> 里出现，单独确认文件存在。
  sources.add("./ig-media/ag-rehearsal-backstage.mp4");
  sources.add("./ig-media/ll-practice-room.mp4");

  expect(sources.size).toBeGreaterThan(5);
  for (const src of sources) {
    const path = "/" + src.replace(/^\.\//, "").replace(/^\//, "");
    const res = await page.request.get(BASE + path);
    expect(res.status(), `资源不可访问: ${path}`).toBe(200);
  }

  // 日料帖子的两张照片必须是两个独立 <img>，不是一张拼贴图
  const omakase = phone.locator(
    '.igx-post[data-post-id="post_ll_20261106_omakase"]',
  );
  await back(phone);
  await expect(
    omakase.locator(".igx-media img.igx-photo"),
  ).toHaveCount(2);
});

test("目标帖子保留稳定 postId，并接入 IG-001 事件钩子", async () => {
  const src = readFileSync("src/skins/instagram-data.ts", "utf8");
  expect(src).toContain('postId: "post_ll_20261106_omakase"');
  expect(src).toContain(
    'export const IG001_POST_ID = "post_ll_20261106_omakase"',
  );
  expect(src).toContain('eventHook: "IG-001"');
  expect(src).not.toContain("futureEventHook");
  // UI 只登记主动点赞意图，不直接写播放状态、不读条目、不派发剧情节点。
  const skin = readFileSync("src/skins/InstagramSkin.tsx", "utf8");
  expect(skin).toContain("IG001_POST_ID");
  expect(skin).toContain('const LIKE_INTENT_KEY = "igxLikeIntent"');
  expect(skin).toContain("setLikeState");
  expect(skin).not.toContain("onPlayback");
  expect(skin).not.toContain("onItem(");
  expect(skin).not.toContain("dispatch(");
  const story = JSON.parse(
    readFileSync("stories/template/story.json", "utf8"),
  );
  const ev = story.events.find((e: { id: string }) => e.id === "IG-001");
  expect(ev, "故事数据中必须存在 IG-001 节点").toBeTruthy();
  expect(ev.once).toBe(true);
  expect(ev.event).toBe("variable");
  expect(ev.target).toBe("ui:instagram:igxLikeIntent");
});

test("视频帖封面与主页缩略图都使用对应视频的第一帧", async ({ page }) => {
  test.setTimeout(120000);
  const phone = await loadTemplatePlayer(page);
  await openInstagram(phone);

  const data = readFileSync("src/skins/instagram-data.ts", "utf8");
  expect(data).toContain(
    'vid("ag-rehearsal-backstage.mp4", "ag-rehearsal-backstage-first-frame.jpg")',
  );
  expect(data).toContain(
    'vid("ll-practice-room.mp4", "ll-practice-room-first-frame.jpg")',
  );
  for (const file of [
    "ag-rehearsal-backstage-first-frame.jpg",
    "ll-practice-room-first-frame.jpg",
  ]) {
    const res = await page.request.get(`${BASE}/ig-media/${file}`);
    expect(res.status(), `首帧封面不可访问: ${file}`).toBe(200);
  }

  await nav(phone, "个人主页");
  const angelCell = phone.locator(
    '.igx-cell[data-post-id="post_ag_20260809_hk"]',
  );
  await expect(angelCell.locator("img")).toHaveAttribute(
    "src",
    "./ig-media/ag-rehearsal-backstage-first-frame.jpg",
  );
  await angelCell.click();
  await expect(
    phone.locator('.igx-post-detail[data-post-id="post_ag_20260809_hk"] video'),
  ).toHaveAttribute(
    "poster",
    "./ig-media/ag-rehearsal-backstage-first-frame.jpg",
  );

  await back(phone);
  await nav(phone, "搜索");
  await phone.getByRole("textbox", { name: "搜索账号" }).fill("linglingkwong");
  await phone.locator('.igx-result[data-user-id="linglingkwong"]').click();
  const linglingCell = phone.locator(
    '.igx-cell[data-post-id="post_ll_20261019_rehearsal"]',
  );
  await expect(linglingCell.locator("img")).toHaveAttribute(
    "src",
    "./ig-media/ll-practice-room-first-frame.jpg",
  );
  await linglingCell.click();
  await expect(
    phone.locator(
      '.igx-post-detail[data-post-id="post_ll_20261019_rehearsal"] video',
    ),
  ).toHaveAttribute("poster", "./ig-media/ll-practice-room-first-frame.jpg");
});
