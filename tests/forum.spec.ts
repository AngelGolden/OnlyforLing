import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

/**
 * 校园论坛验收：AFTER THE LAST SET 的空 forum 数据走预置双区内容路径。
 * 只验证论坛本身，不改其他 App；每一项都对应规格里的验收条目。
 */
const PIN = "0511";

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

const NEWEST_ORDER = [
  "forum_008_campus_week",
  "forum_007_hunghom_japanese_food",
  "forum_006_future_gig",
  "forum_005_popularity",
  "forum_004_special_care",
  "forum_003_lingling_on_campus",
  "forum_002_new_bass",
  "forum_001_christmas_live",
];

const BOARD_IDS = [
  "board_campus",
  "board_music",
  "board_people",
  "board_hunghom",
  "board_chat",
];

async function topicIds(phone: Locator): Promise<string[]> {
  return phone
    .locator(".fm-topic")
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-post-id") ?? ""));
}

test("验收1｜双区布局、两个独立搜索栏、八帖按发布时间倒序、五个板块", async ({
  page,
}) => {
  const phone = await openForum(page);

  // 两个区块各自有独立搜索栏，不合并、不改成顶部大搜索栏。
  await expect(phone.locator(".catalog-search")).toHaveCount(2);
  await expect(phone.locator(".fm-posts .catalog-search input")).toHaveAttribute(
    "placeholder",
    "搜索帖子、关键词或用户",
  );
  await expect(phone.locator(".fm-boards .catalog-search input")).toHaveAttribute(
    "placeholder",
    "搜索板块",
  );
  const boxes = await phone
    .locator(".fm-columns > section")
    .evaluateAll((els) =>
      els.map((e) => ({ x: e.getBoundingClientRect().x, w: e.getBoundingClientRect().width })),
    );
  expect(boxes).toHaveLength(2);
  // 左「帖子」在左、右「板块」在右，两块水平并排而非上下堆叠。
  expect(boxes[1].x).toBeGreaterThan(boxes[0].x + boxes[0].w - 2);
  expect(boxes[0].w).toBeGreaterThan(boxes[1].w);

  // 不出现横向溢出。
  const overflow = await phone.locator(".fm-columns").evaluate((el) => ({
    clientWidth: el.clientWidth,
    scrollWidth: el.scrollWidth,
  }));
  expect(overflow.scrollWidth).toBe(overflow.clientWidth);

  // 八条固定帖子，默认「最新」按发布时间倒序。
  await expect(phone.locator(".fm-topic")).toHaveCount(8);
  expect(await topicIds(phone)).toEqual(NEWEST_ORDER);

  // 帖子行包含标题、发帖人、板块、时间、赞/回复/浏览。
  const first = await phone.locator(".fm-topic").first().innerText();
  expect(first).toContain("最近理大是不是特别多活动？");
  expect(first).toContain("redbrickcoffee");
  expect(first).toContain("校园生活");
  expect(first).toContain("11-07 18:20");

  // 五个板块与模拟帖子数。
  await expect(phone.locator(".fm-board")).toHaveCount(5);
  expect(
    await phone
      .locator(".fm-board")
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-board-id"))),
  ).toEqual(BOARD_IDS);
  const boardText = await phone.locator(".fm-boards").innerText();
  for (const n of ["1,286 帖", "428 帖", "736 帖", "953 帖", "2,416 帖"])
    expect(boardText).toContain(n);
});

test("验收2｜左侧搜索标题/正文/发帖人，右侧搜索板块名称", async ({ page }) => {
  const phone = await openForum(page);
  const postSearch = phone.locator(".fm-posts .catalog-search input");
  const boardSearch = phone.locator(".fm-boards .catalog-search input");

  // 标题命中「Lingling」：两条公开帖。该词同时命中隐藏搜索别名，
  // 因此额外追加一条隐藏爆料帖；隐藏索引的完整验收见 forum-hidden.spec.ts。
  await postSearch.fill("Lingling");
  expect(await topicIds(phone)).toEqual([
    "forum_005_popularity",
    "forum_003_lingling_on_campus",
    "forum_hidden_009_rumor",
  ]);
  // 正文命中：只出现在 forum_001 正文里的词。
  await postSearch.fill("起鸡皮疙瘩");
  expect(await topicIds(phone)).toEqual(["forum_001_christmas_live"]);
  // 发帖人命中。
  await postSearch.fill("hunghom_eat");
  expect(await topicIds(phone)).toEqual(["forum_007_hunghom_japanese_food"]);
  // 无结果反馈。
  await postSearch.fill("完全不存在的关键词");
  expect(await topicIds(phone)).toEqual([]);
  await expect(phone.getByText("暂时没有新主题。")).toBeVisible();
  await postSearch.fill("");
  await expect(phone.locator(".fm-topic")).toHaveCount(8);

  // 右侧搜索只影响板块列表，不影响左侧帖子列表。
  await boardSearch.fill("音乐");
  expect(
    await phone
      .locator(".fm-board")
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-board-id"))),
  ).toEqual(["board_music"]);
  await expect(phone.locator(".fm-topic")).toHaveCount(8);
  await boardSearch.fill("吹水");
  expect(
    await phone
      .locator(".fm-board")
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-board-id"))),
  ).toEqual(["board_chat"]);
  await boardSearch.fill("没有这个板块");
  await expect(phone.locator(".fm-board")).toHaveCount(0);
  await expect(phone.getByText("没有找到板块。")).toBeVisible();
  await boardSearch.fill("");
  await expect(phone.locator(".fm-board")).toHaveCount(5);
});

test("验收3｜板块点击筛选、清除筛选、热门与最新排序", async ({ page }) => {
  const phone = await openForum(page);

  await phone.locator('[data-board-id="board_music"]').click();
  await expect(phone.locator(".fm-board.selected")).toHaveCount(1);
  await expect(phone.locator(".fm-filter-chip")).toBeVisible();
  expect(await topicIds(phone)).toEqual([
    "forum_006_future_gig",
    "forum_004_special_care",
    "forum_001_christmas_live",
  ]);
  expect(await phone.locator(".forum-banner strong").innerText()).toBe(
    "音乐社 / 乐队交流",
  );

  // 热门：按点赞数倒序，此时板块内最高是 forum_001（214 赞）。
  await phone.getByRole("button", { name: "按热门排序" }).click();
  expect((await topicIds(phone))[0]).toBe("forum_001_christmas_live");
  await phone.getByRole("button", { name: "按最新排序" }).click();
  expect((await topicIds(phone))[0]).toBe("forum_006_future_gig");

  await phone.getByRole("button", { name: "清除板块筛选" }).click();
  await expect(phone.locator(".fm-topic")).toHaveCount(8);
  expect(await topicIds(phone)).toEqual(NEWEST_ORDER);
  // 整体热门第一是 forum_005_popularity（426 赞）。
  await phone.getByRole("button", { name: "按热门排序" }).click();
  expect((await topicIds(phone))[0]).toBe("forum_005_popularity");
});

test("验收4｜帖子详情页展示正文、互动数据与完整分层评论", async ({ page }) => {
  const phone = await openForum(page);

  await phone.locator('[data-post-id="forum_004_special_care"]').click();
  await expect(phone.locator(".fm-detail-post")).toBeVisible();
  // 深色手机主题下详情页也必须保持浅色底 + 深色字，不能出现低对比度。
  const contrast = await phone.locator(".fm-detail-post h1").evaluate((el) => {
    const root = document.querySelector(".forum-v1");
    return {
      bg: root ? getComputedStyle(root).backgroundColor : "",
      color: getComputedStyle(el).color,
    };
  });
  expect(contrast.bg).toBe("rgb(255, 255, 255)");
  expect(contrast.color).toBe("rgb(32, 40, 51)");
  const detail = await phone.locator(".fm-detail").innerText();
  expect(detail).toContain("上次排练，主唱是不是对新 bass 特别照顾？");
  expect(detail).toContain("上次听 Late Checkout 彩排的时候");
  expect(detail).toContain("187 赞");
  expect(detail).toContain("31 回复");
  expect(detail).toContain("4205 浏览");

  await expect(phone.locator(".fm-comment")).toHaveCount(6);
  expect(
    await phone
      .locator(".fm-comment")
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-comment-id"))),
  ).toEqual([
    "forum_004_c01",
    "forum_004_c02",
    "forum_004_c03",
    "forum_004_c04",
    "forum_004_c05",
    "forum_004_c06",
  ]);
  // 楼中楼：c05 标注「回复 #4」。
  await expect(phone.locator(".fm-comment.fm-reply")).toHaveCount(1);
  expect(
    await phone.locator('[data-comment-id="forum_004_c05"]').innerText(),
  ).toContain("回复 #4");
  // 楼层号连续。
  expect(detail).toContain("#1");
  expect(detail).toContain("#6");

  await phone.getByRole("button", { name: "返回帖子列表" }).click();
  await expect(phone.locator(".fm-topic")).toHaveCount(8);

  // 另一帖同样能打开完整评论，且按 replyTo 反推真实楼中楼层级。
  await phone.locator('[data-post-id="forum_006_future_gig"]').click();
  await expect(phone.locator(".fm-comment")).toHaveCount(7);
  expect(
    await phone.locator('[data-comment-id="forum_006_c04"]').getAttribute("data-depth"),
  ).toBe("1");
  for (const id of ["forum_006_c05", "forum_006_c06", "forum_006_c07"])
    expect(
      await phone.locator(`[data-comment-id="${id}"]`).getAttribute("data-depth"),
    ).toBe("2");
});

test("验收5｜语言风格、学姐人气多用户讨论、新 bass 旁观者评论、读研传闻仅未证实", async ({
  page,
}) => {
  const phone = await openForum(page);

  // 普通话 / 粤语繁体 / 中英混合在同一社区自然交错。
  await phone.locator('[data-post-id="forum_001_christmas_live"]').click();
  const p1 = await phone.locator(".fm-detail").innerText();
  expect(p1).toContain("佢 live 真係好穩，後半段全場都跟住唱。"); // 粤语繁体 + 英语
  expect(p1).toContain("新bass是不是今年刚加入的？台上感觉还蛮自然。"); // 普通话
  expect(p1).toContain("呢位係临时顶上"); // 粤语
  await phone.getByRole("button", { name: "返回帖子列表" }).click();

  // 学姐人气由多个不同账号讨论，不是单人刷屏。
  await phone.locator('[data-post-id="forum_005_popularity"]').click();
  const users = await phone
    .locator(".fm-comment .fm-comment-head strong")
    .evaluateAll((els) => els.map((e) => e.textContent ?? ""));
  expect(users).toEqual([
    "hkafterclass",
    "mainland_student",
    "filmgrain_hk",
    "redbrickcoffee",
    "design_ki",
  ]);
  expect(new Set(users).size).toBe(5);
  await phone.getByRole("button", { name: "返回帖子列表" }).click();

  // 新 bass 被特别照顾，由旁观者评论体现。
  await phone.locator('[data-post-id="forum_004_special_care"]').click();
  const p4 = await phone.locator(".fm-detail").innerText();
  expect(p4).toContain("我都有留意到，佢真係望住右邊確認咗幾次。");
  expect(p4).toContain("佢平时对队友都几好，唔好咁快脑补啦");
  expect(p4).toContain("可能是新成员吧，主唱要照顾整体配合。");
  await phone.getByRole("button", { name: "返回帖子列表" }).click();
  await phone.locator('[data-post-id="forum_002_new_bass"]').click();
  expect(await phone.locator(".fm-detail").innerText()).toContain(
    "主唱好似幾有耐性，成日會停低同佢對拍子。",
  );
  await phone.getByRole("button", { name: "返回帖子列表" }).click();

  // 出国读研只是一条未证实传闻，随后多条留言明确表示未确认。
  await phone.locator('[data-post-id="forum_006_future_gig"]').click();
  const p6 = await phone.locator(".fm-detail").innerText();
  expect(p6).toContain("听说她有考虑出国读研？");
  expect(p6).toContain("不过完全没实锤。");
  expect(p6).toContain("未 confirm 啦");
  expect(p6).toContain("也可能只是考虑申请");
  expect(p6).toContain("先唔好乱估啦，等佢自己讲啦。");
  // 不写成已确认事实、不出现具体学校 / 国家 / offer / 录取。
  for (const forbidden of ["已录取", "拿到 offer", "确定出国", "已经申请到", "英国", "泰国", "美国"])
    expect(p6).not.toContain(forbidden);

  // 界面不出现破坏沉浸感的元叙事称呼。
  const all = await phone.locator(".forum-v1").innerText();
  expect(all).not.toMatch(/机主|玩家|手机主人|虚构|模拟器|作者指定|这是一个模拟/);
});

test("验收6｜浏览论坛不触发 WhatsApp 或任何剧情事件，也不影响其他 App", async ({
  page,
}) => {
  // 基线在「还没打开论坛」时取，连打开 App 这一步也算进去。
  await page.goto("/");
  const phone = page.locator(".phone-shell");
  await unlockAfterLoad(phone);
  const before = await storyState(page);
  await phone.getByRole("button", { name: "打开论坛", exact: true }).click();
  await expect(phone.locator(".forum-v1")).toBeVisible({ timeout: 15000 });

  const postSearch = phone.locator(".fm-posts .catalog-search input");
  const boardSearch = phone.locator(".fm-boards .catalog-search input");
  await postSearch.fill("Lingling");
  await postSearch.fill("");
  await boardSearch.fill("音乐");
  await boardSearch.fill("");
  await phone.locator('[data-board-id="board_people"]').click();
  await phone.getByRole("button", { name: "按热门排序" }).click();
  await phone.getByRole("button", { name: "清除板块筛选" }).click();
  await phone.locator('[data-post-id="forum_003_lingling_on_campus"]').click();
  await phone.getByRole("button", { name: "返回帖子列表" }).click();

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

  // 离开论坛后其他 App 仍可正常打开。
  await phone.getByRole("button", { name: "返回桌面", exact: true }).click();
  await phone.getByRole("button", { name: "打开Instagram", exact: true }).click();
  await expect(phone.locator(".igx-ui")).toBeVisible({ timeout: 15000 });
});

test("验收7｜固定数据、稳定 ID 与「纯浏览」实现约束（静态检查）", async () => {
  const data = readFileSync("src/skins/forum-data.ts", "utf8");
  const view = readFileSync("src/skins/ForumCampus.tsx", "utf8");
  const story = readFileSync("stories/template/story.json", "utf8");

  // 八条帖子、五个板块都有稳定 ID，且不按 postId 排序。
  for (const id of NEWEST_ORDER) expect(data).toContain(`postId: "${id}"`);
  for (const id of BOARD_IDS) expect(data).toContain(`id: "${id}"`);
  expect(data).toContain("return b.publishedAt.localeCompare(a.publishedAt);");
  expect(data).not.toMatch(/sort\(.*postId/);

  // 组件只读，不写 Runtime、不派发事件。
  for (const forbidden of ["p.onItem(", "p.onUi(", "p.onRead", "onPlayback", "useSkinState"])
    expect(view).not.toContain(forbidden);
  // 状态恢复接入后同行的 import 还带 useRef，这里只校验仍从 react 导入 useState，
  // 语义不变（组件用 React 本地 state，且不碰 Runtime / 事件通道）。
  expect(view).toMatch(/import \{[^}]*\buseState\b[^}]*\} from "react"/);

  // 主作品已安装论坛，但没有把论坛绑定到任何剧情事件节点。
  const parsed = JSON.parse(story);
  expect(parsed.installedApps).toContain("forum");
  const eventIds = (parsed.events ?? []).map((n: any) => n.id);
  expect(eventIds).not.toContain("FORUM-001");
});
