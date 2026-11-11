import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

/**
 * 隐藏论坛爆料帖验收 v1.0：A 关键词命中 / B 普通搜索防护 / C 首页与板块隐藏 /
 * D 搜索结果与详情页 / E 剧情独立性。
 *
 * 只针对 forum_hidden_009_rumor，不改动原有八条帖子的内容与行为。
 */
const PIN = "0511";
const HIDDEN = "forum_hidden_009_rumor";

type Locator = ReturnType<Page["locator"]>;

async function unlockAfterLoad(phone: Locator) {
  await phone.getByRole("button", { name: "轻触解锁" }).click();
  for (const d of PIN)
    await phone.getByRole("button", { name: "密码键" + d }).click();
  await expect(
    phone.getByRole("button", { name: "搜索", exact: true }),
  ).toBeVisible({ timeout: 10000 });
}

async function openForum(page: Page): Promise<Locator> {
  await page.goto("/");
  const phone = page.locator(".phone-shell");
  await unlockAfterLoad(phone);
  await phone.getByRole("button", { name: "打开论坛", exact: true }).click();
  await expect(phone.locator(".forum-v1")).toBeVisible({ timeout: 15000 });
  return phone;
}

async function topicIds(phone: Locator): Promise<string[]> {
  return phone
    .locator(".fm-topic")
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-post-id") ?? ""));
}

/** 把 Runtime 的关键剧情字段序列化，用于「浏览不产生新状态」的严格比对。 */
async function storyState(page: Page): Promise<string> {
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
    const s = all[0]?.state ?? {};
    return JSON.stringify({
      completed: s.completed ?? [],
      unlocked: s.unlocked ?? [],
      playback: s.playback ?? {},
      variables: s.variables ?? {},
      messages: s.messages ?? {},
      ui: s.ui ?? {},
      clues: s.clues ?? [],
      endings: s.endings ?? [],
      notifications: s.notifications ?? [],
      read: s.read ?? [],
    });
  });
}

test("测试 A｜六种指定搜索方式及组合查询均能找到隐藏帖", async ({ page }) => {
  const phone = await openForum(page);
  const postSearch = phone.locator(".fm-posts .catalog-search input");

  const queries = [
    "邝玲玲",
    "玲玲",
    "lingling",
    "Lingling",
    "Late Checkout",
    "主唱",
    // 英文大小写与组合查询同样应当命中。
    "LINGLING",
    "late checkout",
    "邝玲玲出国",
    "玲玲 主唱",
    "lingling Late Checkout",
  ];
  for (const q of queries) {
    await postSearch.fill(q);
    expect(await topicIds(phone), `查询「${q}」`).toContain(HIDDEN);
    // 命中只体现在搜索结果列表里，不会自动打开详情页。
    await expect(phone.locator(".fm-detail-post")).toHaveCount(0);
  }
});

test("测试 B｜禁止词不返回隐藏帖，公开帖搜索仍正常", async ({ page }) => {
  const phone = await openForum(page);
  const postSearch = phone.locator(".fm-posts .catalog-search input");

  const blocked = [
    "乐队",
    "换主唱", // 含别名「主唱」，必须靠禁止词整体剔除来防误命中
    "解散",
    "出国",
    "读研",
    "香港",
    "泰国",
    "爆料",
    "内部消息",
  ];
  for (const q of blocked) {
    await postSearch.fill(q);
    expect(await topicIds(phone), `查询「${q}」`).not.toContain(HIDDEN);
  }

  // 不含别名的普通全文搜索照常工作，且不会带出隐藏帖。
  await postSearch.fill("起鸡皮疙瘩");
  expect(await topicIds(phone)).toEqual(["forum_001_christmas_live"]);
  await postSearch.fill("hunghom_eat");
  expect(await topicIds(phone)).toEqual(["forum_007_hunghom_japanese_food"]);

  // 命中别名时，原有公开帖仍然按全文检索显示，隐藏帖是「额外加入」的那一条。
  await postSearch.fill("Lingling");
  const ids = await topicIds(phone);
  expect(ids).toContain("forum_005_popularity");
  expect(ids).toContain("forum_003_lingling_on_campus");
  expect(ids).toContain(HIDDEN);
  expect(ids).toHaveLength(3);
});

test("测试 C｜首页、板块列表、最新与热门排序均不显示隐藏帖", async ({
  page,
}) => {
  const phone = await openForum(page);
  const postSearch = phone.locator(".fm-posts .catalog-search input");

  // 首页默认「最新」：仍是原来的八条公开帖。
  await expect(phone.locator(".fm-topic")).toHaveCount(8);
  expect(await topicIds(phone)).not.toContain(HIDDEN);

  // 音乐社 / 乐队交流。
  await phone.locator('[data-board-id="board_music"]').click();
  expect(await topicIds(phone)).not.toContain(HIDDEN);
  expect(await topicIds(phone)).toEqual([
    "forum_006_future_gig",
    "forum_004_special_care",
    "forum_001_christmas_live",
  ]);
  // 板块筛选状态下即使搜到别名，也不把隐藏帖塞进板块列表。
  await postSearch.fill("玲玲");
  expect(await topicIds(phone)).not.toContain(HIDDEN);
  await postSearch.fill("");

  // 吹水台。
  await phone.locator('[data-board-id="board_chat"]').click();
  expect(await topicIds(phone)).not.toContain(HIDDEN);
  await phone.getByRole("button", { name: "清除板块筛选" }).click();

  // 整体切换排序，隐藏帖都不出现。
  await phone.getByRole("button", { name: "按热门排序" }).click();
  expect(await phone.locator(".fm-topic")).toHaveCount(8);
  expect(await topicIds(phone)).not.toContain(HIDDEN);
  await phone.getByRole("button", { name: "按最新排序" }).click();
  expect(await phone.locator(".fm-topic")).toHaveCount(8);
  expect(await topicIds(phone)).not.toContain(HIDDEN);
});

test("测试 D｜搜索结果卡片、详情页正文与八条评论、返回后功能正常", async ({
  page,
}) => {
  const phone = await openForum(page);
  const postSearch = phone.locator(".fm-posts .catalog-search input");

  await postSearch.fill("玲玲");
  const card = phone.locator(`[data-post-id="${HIDDEN}"]`);
  await expect(card).toBeVisible();
  const cardText = await card.innerText();
  expect(cardText).toContain("🔥【🍉】某支校园乐队明年可能要换主唱？");
  expect(cardText).toContain("Backstage");
  expect(cardText).toContain("吹水台/人物与校园活动");
  expect(cardText).toContain("10-20 21:26");
  expect(cardText).toContain("486");
  expect(cardText).toContain("137");
  expect(cardText).toContain("热门");
  // 标题与摘要不额外插入真实姓名。
  expect(cardText).not.toContain("邝玲玲");

  await card.click();
  await expect(phone.locator(".fm-detail-post")).toBeVisible();
  const detail = await phone.locator(".fm-detail").innerText();
  expect(detail).toContain("【🍉】某支校园乐队明年可能要换主唱？");
  expect(detail).toContain("先说在前面，不是完全没根据。");
  expect(detail).toContain("Late Checkout 明年可能不会维持现在这个阵容了。");
  expect(detail).toContain("先说清楚，是听来的消息，不保熟。");
  expect(detail).toContain("10-20 21:26");
  expect(detail).toContain("486 赞");
  expect(detail).toContain("137 回复");
  expect(detail).toContain("16842 浏览");
  expect(detail).not.toContain("邝玲玲");

  await expect(phone.locator(".fm-comment")).toHaveCount(8);
  expect(
    await phone
      .locator(".fm-comment")
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-comment-id"))),
  ).toEqual([
    "rumor_c01",
    "rumor_c02",
    "rumor_c03",
    "rumor_c04",
    "rumor_c05",
    "rumor_c06",
    "rumor_c07",
    "rumor_c08",
  ]);
  for (const line of [
    "如果真係有料，點解又唔敢講來源？",
    "@ 0号星球",
    "那位主唱不是中泰混血吗？她妈妈就是泰国人，考虑回那边也是情有可原吧。",
    "佢自己都未講，唔好喺度講到似confirm咁。",
    "外地进修不等于退出乐队吧，假期演出也有可能。",
    "我觉得更像是有人听到一点消息，然后自己补全了后面的剧情。",
    "唔好每次有啲风声就当真，等本人讲啦。",
    "我只是分享听到的，具体来源不方便讲。你们信不信随意。",
  ])
    expect(detail).toContain(line);

  await phone.getByRole("button", { name: "返回帖子列表" }).click();
  await expect(postSearch).toHaveValue("玲玲");
  expect(await topicIds(phone)).toContain(HIDDEN);
  await postSearch.fill("");
  await expect(phone.locator(".fm-topic")).toHaveCount(8);
  expect(await topicIds(phone)).not.toContain(HIDDEN);
});

test("测试 E｜搜索、浏览、评论全程不触发任何剧情事件", async ({ page }) => {
  await page.goto("/");
  const phone = page.locator(".phone-shell");
  await unlockAfterLoad(phone);
  const before = await storyState(page);

  await phone.getByRole("button", { name: "打开论坛", exact: true }).click();
  await expect(phone.locator(".forum-v1")).toBeVisible({ timeout: 15000 });
  const postSearch = phone.locator(".fm-posts .catalog-search input");
  for (const q of ["邝玲玲", "玲玲", "lingling", "主唱", "Late Checkout"]) {
    await postSearch.fill(q);
    expect(await topicIds(phone)).toContain(HIDDEN);
  }
  await postSearch.fill("玲玲");
  await phone.locator(`[data-post-id="${HIDDEN}"]`).click();
  await expect(phone.locator(".fm-comment")).toHaveCount(8);
  await phone.getByRole("button", { name: "返回帖子列表" }).click();
  await postSearch.fill("");
  await phone.getByRole("button", { name: "返回桌面", exact: true }).click();

  const after = await storyState(page);
  expect(after).toBe(before);
  const state = JSON.parse(after);
  expect(state.playback).toEqual({});
  expect(state.unlocked).toEqual([]);
  expect(state.ui).toEqual({});
  expect(state.clues).toEqual([]);
  expect(state.completed).not.toContain("IG-001");
  expect(state.completed).not.toContain("MAP-001");
  expect(state.completed).not.toContain("BR-001");
});

test("附加｜隐藏索引独立于公开数据，且未绑定任何剧情事件（静态检查）", async () => {
  const data = readFileSync("src/skins/forum-data.ts", "utf8");
  const view = readFileSync("src/skins/ForumCampus.tsx", "utf8");
  const story = JSON.parse(readFileSync("stories/template/story.json", "utf8"));

  // 隐藏帖不在 FORUM_POSTS 里，因此不进入普通全文搜索索引、首页与板块列表。
  const publicBlock = data.slice(
    data.indexOf("export const FORUM_POSTS"),
    data.indexOf("export const HIDDEN_RUMOR_POST_ID"),
  );
  expect(publicBlock).not.toContain(HIDDEN);
  expect(data).toContain("export const FORUM_HIDDEN_POSTS");
  expect(data).toContain("export function matchesHiddenRumor");
  expect(data).toContain('"换主唱"');
  for (const alias of ["邝玲玲", "玲玲", "lingling", "主唱", "Late Checkout"])
    expect(data).toContain(`"${alias}"`);

  // 组件仍只用本地 state，不写 Runtime。
  for (const forbidden of [
    "p.onItem(",
    "p.onUi(",
    "p.onRead",
    "onPlayback",
    "useSkinState",
  ])
    expect(view).not.toContain(forbidden);

  // 没有为论坛新增主线事件节点。
  const eventIds = (story.events ?? []).map((n: any) => n.id);
  expect(eventIds).not.toContain("FORUM-001");
  expect(eventIds).not.toContain("FORUM-HIDDEN-001");
});
