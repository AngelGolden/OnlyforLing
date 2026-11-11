import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { compileStory } from "../src/story-engine/compiler";
import { driveThread } from "./fixtures/wa-playback";

const PIN = "0511";
const IG = "打开Instagram";
const MAPS = "打开地图";
const WHATSAPP = "打开WhatsApp";
const LINGLING = "邝学姐 💙";
const POST = "post_ll_20261106_omakase";
const OTHER_POST = "post_lc_20261105_room";

const IDS = Array.from({ length: 7 }, (_, i) => `msg_ig001_0${i + 1}`);
const BODIES = [
  "你啱啱 like 咗我嗰個 post？",
  "这么快就被学姐发现了",
  "那家日料店看起来不错，照片也拍得很好呢",
  "☺️呢間真係幾好食。",
  "而且有啲位要提早 book，週末會比較難訂。",
  "那我先把它放进备选名单，最近也在找合适的店",
  "好呀，等你慢慢揀。",
];
const NOTICE = "你啱啱 like 咗我嗰個 post？";

type Locator = ReturnType<Page["locator"]>;

async function unlockPhone(phone: Locator) {
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
  await unlockPhone(phone);
  return phone;
}

async function openApp(phone: Locator, aria: string) {
  await phone.getByRole("button", { name: "返回桌面", exact: true }).click();
  await phone.getByRole("button", { name: aria, exact: true }).click();
}

async function openInstagram(phone: Locator) {
  await openApp(phone, IG);
  await expect(phone.locator(".igx-ui")).toBeVisible({ timeout: 15000 });
}

async function openWhatsApp(phone: Locator) {
  await openApp(phone, WHATSAPP);
  await expect(phone.locator(".whatsapp-ui")).toBeVisible({ timeout: 15000 });
}

async function back(phone: Locator) {
  await phone
    .locator(".igx-ui")
    .getByRole("button", { name: "返回", exact: true })
    .click();
}

/** 直接从 Dexie 读取 Runtime，确认状态真正落盘。 */
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

async function waitForPack(page: Page) {
  await expect
    .poll(
      async () =>
        (await readRuntime(page))?.playback?.["IG-001"]?.messageIds?.length ??
        0,
      { timeout: 20000 },
    )
    .toBe(7);
}

async function likeTarget(phone: Locator, page: Page) {
  const post = phone.locator(`.igx-feed .igx-post[data-post-id="${POST}"]`);
  await post.getByRole("button", { name: "点赞", exact: true }).click();
  await waitForPack(page);
  return post;
}

async function openThread(phone: Locator) {
  const row = phone.locator(".wa-chat-row", { hasText: LINGLING }).first();
  await expect(row).toBeVisible();
  await row.click();
  return row;
}

async function waitAllPlayed(phone: Locator, page: Page) {
  // 当前账号的三条回复必须逐条点输入框并主动发送，不会自动进入历史。
  await driveThread(
    page,
    phone,
    async () => (await readRuntime(page))?.playback ?? {},
    (pb) => pb["IG-001"]?.playbackStatus === "completed",
  );
  await expect(
    phone.locator(".skin-bubble", { hasText: BODIES[6] }),
  ).toHaveCount(1, { timeout: 60000 });
  await expect
    .poll(
      async () =>
        (await readRuntime(page))?.playback?.["IG-001"]
          ?.playbackStatus ?? "none",
      { timeout: 20000 },
    )
    .toBe("completed");
}

function assertOrderOnce(bubbles: string[]) {
  const at = (t: string) => bubbles.findIndex((b) => b.includes(t));
  for (const t of BODIES) {
    expect(at(t), "消息缺失: " + t).toBeGreaterThanOrEqual(0);
    expect(bubbles.filter((b) => b.includes(t)).length, "消息重复: " + t).toBe(
      1,
    );
  }
  for (let i = 1; i < BODIES.length; i++)
    expect(at(BODIES[i]), `顺序错误: ${BODIES[i]}`).toBeGreaterThan(
      at(BODIES[i - 1]),
    );
}

async function openNoticeCenter(phone: Locator) {
  await phone.getByRole("button", { name: "通知中心" }).click();
  await expect(phone.locator(".notice-cards")).toBeVisible();
}

async function closeNoticeCenter(phone: Locator) {
  const close = phone.getByRole("button", { name: "关闭", exact: true });
  if (await close.count()) await close.click();
}

async function triggerMap001(phone: Locator) {
  await openApp(phone, MAPS);
  await expect(phone.locator(".maps-ui")).toBeVisible();
  const pill = phone.getByRole("button", { name: "搜索地点", exact: true });
  if (await pill.count()) await pill.click();
  await expect(phone.locator(".maps-recent-row").first()).toBeVisible();
  await phone
    .locator(".maps-recent-row", { hasText: "紅磡附近餐廳" })
    .first()
    .click();
  await expect(phone.locator(".maps-result-title")).toHaveText("紅磡附近餐廳");
}

// ---------------------------------------------------------------- 验收 A

test("验收A｜点赞 Omakase 帖子正确触发 IG-001 并产生一条 WhatsApp 通知", async ({
  page,
}) => {
  test.setTimeout(180000);
  const phone = await loadTemplatePlayer(page);

  const baseline = await readRuntime(page);
  expect(baseline.completed, "前置条件 WA_EP00_COMPLETE").toContain(
    "WA_EP00_COMPLETE",
  );
  expect(baseline.variables?.IG_001_TRIGGERED).toBe(false);
  expect(Object.keys(baseline.playback ?? {})).toEqual([]);

  await openInstagram(phone);
  const before = Number(
    await phone
      .locator(`.igx-feed .igx-post[data-post-id="${POST}"] .igx-likes`)
      .getAttribute("data-likes"),
  );
  const post = await likeTarget(phone, page);
  await expect(
    post.getByRole("button", { name: "取消点赞", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(
    Number(await post.locator(".igx-likes").getAttribute("data-likes")),
    "点赞数应 +1",
  ).toBe(before + 1);

  const s = await readRuntime(page);
  expect(s.completed).toContain("IG-001");
  expect(s.variables?.IG_001_TRIGGERED).toBe(true);
  expect(s.ui?.instagram?.igxLikeIntent).toBe(POST);
  expect(s.unlocked.filter((id: string) => IDS.includes(id))).toEqual(IDS);
  const pk = s.playback?.["IG-001"];
  expect(pk.playbackStatus).toBe("pending");
  expect(pk.nextMessageIndex).toBe(0);
  expect(pk.deliveredMessageIds).toEqual([]);
  expect(pk.messageIds).toEqual(IDS);
  expect(pk.appId).toBe("whatsapp");
  expect(pk.thread).toBe(LINGLING);
  // 触发时只入队，不写聊天历史、不切 App
  expect(Object.values(s.messages ?? {}).flat()).toHaveLength(0);
  await expect(phone.locator(".igx-ui")).toBeVisible();
  expect(
    s.notifications.filter((n: string) => n.includes("like 咗")).length,
    "只生成一条通知",
  ).toBe(1);

  await openNoticeCenter(phone);
  await expect(phone.locator(".notice-cards")).toContainText(NOTICE);
  await expect(phone.locator(".notice-cards")).toContainText("鄺學姐 💙");
  await closeNoticeCenter(phone);
});

// ---------------------------------------------------------------- 验收 B

test("验收B1｜浏览、评论、收藏、点赞其他帖子、刷新都不触发 IG-001", async ({
  page,
}) => {
  test.setTimeout(180000);
  const phone = await loadTemplatePlayer(page);
  await openInstagram(phone);

  // 打开学姐主页
  await phone
    .locator(`.igx-feed .igx-post[data-post-id="${POST}"]`)
    .locator(".igx-post-who .igx-username")
    .click();
  await expect(
    phone.locator('.igx-profile[data-profile-id="linglingkwong"]'),
  ).toBeVisible();
  await back(phone);

  // 浏览目标帖子详情 + 查看评论
  await phone
    .locator(`.igx-feed .igx-post[data-post-id="${POST}"]`)
    .getByRole("button", { name: "更多", exact: true })
    .click();
  await phone.getByRole("button", { name: "查看帖子详情", exact: true }).click();
  await expect(phone.locator(".igx-post-detail")).toBeVisible();
  await phone
    .locator(".igx-post-detail")
    .getByRole("button", { name: "评论", exact: true })
    .click();
  // 评论页 → 帖子详情 → Feed
  await back(phone);
  await back(phone);
  await expect(phone.locator(".igx-feed")).toBeVisible();

  // 收藏目标帖子 + 点赞其他帖子
  await phone
    .locator(`.igx-feed .igx-post[data-post-id="${POST}"]`)
    .getByRole("button", { name: "收藏", exact: true })
    .click();
  await phone
    .locator(`.igx-feed .igx-post[data-post-id="${OTHER_POST}"]`)
    .getByRole("button", { name: "点赞", exact: true })
    .click();
  await expect
    .poll(
      async () => (await readRuntime(page))?.ui?.instagram?.igxLiked ?? [],
      { timeout: 15000 },
    )
    .toContain(OTHER_POST);

  // 刷新后重新渲染已点赞状态
  await page.reload();
  await unlockPhone(phone);
  await openInstagram(phone);

  const s = await readRuntime(page);
  expect(s.completed).not.toContain("IG-001");
  expect(Object.keys(s.playback ?? {})).toEqual([]);
  expect(s.variables?.IG_001_TRIGGERED).toBe(false);
  expect(s.unlocked.filter((id: string) => IDS.includes(id))).toEqual([]);
  expect(
    s.notifications.filter((n: string) => n.includes("like 咗")).length,
  ).toBe(0);
  expect(s.ui?.instagram?.igxLikeIntent).toBeUndefined();
});

test("验收B2｜取消点赞后重新点赞、刷新、重开目标帖子不重复触发", async ({
  page,
}) => {
  test.setTimeout(180000);
  const phone = await loadTemplatePlayer(page);
  await openInstagram(phone);
  const post = await likeTarget(phone, page);

  const first = await readRuntime(page);
  const noticeCount = first.notifications.filter((n: string) =>
    n.includes("like 咗"),
  ).length;
  expect(noticeCount).toBe(1);

  // 取消点赞 → 重新点赞（一次新的有效点赞行为）
  await post.getByRole("button", { name: "取消点赞", exact: true }).click();
  await expect(
    post.getByRole("button", { name: "点赞", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await post.getByRole("button", { name: "点赞", exact: true }).click();
  await expect(
    post.getByRole("button", { name: "取消点赞", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");

  // 双击已点赞照片：不应取消点赞，也不应二次触发
  await post.locator(".igx-media").dblclick();
  await expect(
    post.getByRole("button", { name: "取消点赞", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");

  // 刷新 + 重新打开帖子
  await page.reload();
  await unlockPhone(phone);
  await openInstagram(phone);
  await phone
    .locator(`.igx-feed .igx-post[data-post-id="${POST}"]`)
    .getByRole("button", { name: "更多", exact: true })
    .click();
  await phone.getByRole("button", { name: "查看帖子详情", exact: true }).click();
  await expect(phone.locator(".igx-post-detail")).toBeVisible();

  const s = await readRuntime(page);
  expect(s.completed.filter((x: string) => x === "IG-001")).toHaveLength(1);
  expect(Object.keys(s.playback ?? {})).toEqual(["IG-001"]);
  expect(s.playback["IG-001"].messageIds).toEqual(IDS);
  expect(s.playback["IG-001"].deliveredMessageIds).toEqual([]);
  expect(s.variables?.IG_001_TRIGGERED).toBe(true);
  expect(
    s.notifications.filter((n: string) => n.includes("like 咗")).length,
    "通知只生成一次",
  ).toBe(noticeCount);
});

// ---------------------------------------------------------------- 验收 C

test("验收C｜打开 WhatsApp 不自动播放，点进私聊后七条消息按固定顺序播放", async ({
  page,
}) => {
  test.setTimeout(180000);
  const phone = await loadTemplatePlayer(page);
  await openInstagram(phone);
  await likeTarget(phone, page);

  await openWhatsApp(phone);
  const row = phone.locator(".wa-chat-row", { hasText: LINGLING }).first();
  await expect(row.locator(".wa-unread")).toHaveText("7");
  await expect(row).toContainText(NOTICE);
  // 只展示聊天列表，没有进入私聊、没有开始播放
  await expect(phone.locator(".skin-messages")).toHaveCount(0);
  const before = await readRuntime(page);
  expect(before.playback["IG-001"].playbackStatus).toBe("pending");
  expect(before.playback["IG-001"].deliveredMessageIds).toEqual([]);

  await row.click();
  await waitAllPlayed(phone, page);

  const bubbles = await phone.locator(".skin-bubble").allTextContents();
  assertOrderOnce(bubbles);

  const msgs = await phone.locator(".skin-message").evaluateAll((els) =>
    els.map((e) => ({
      text: e.querySelector(".skin-bubble")?.textContent ?? "",
      outgoing: e.classList.contains("outgoing"),
    })),
  );
  const idx = BODIES.map((b) => msgs.findIndex((m) => m.text.includes(b)));
  expect(msgs[idx[1]].outgoing, "当前账号第 1 条应为发出气泡").toBe(true);
  expect(msgs[idx[2]].outgoing, "当前账号第 2 条应为发出气泡").toBe(true);
  expect(idx[2], "当前账号两条消息应为连续气泡").toBe(idx[1] + 1);
  expect(msgs[idx[0]].outgoing).toBe(false);
  expect(msgs[idx[6]].outgoing).toBe(false);
  // 播放过程不新增回复选项，也不往 Runtime.messages 写入玩家自由回复
  const s = await readRuntime(page);
  expect(Object.values(s.messages ?? {}).flat()).toHaveLength(0);
  expect(s.playback["IG-001"].playbackStatus).toBe("completed");
  expect(s.playback["IG-001"].deliveredMessageIds).toEqual(IDS);
  expect(s.playback["IG-001"].nextMessageIndex).toBe(7);

  // 播完后返回聊天列表，未读角标归零
  await openApp(phone, WHATSAPP);
  await expect(
    phone
      .locator(".wa-chat-row", { hasText: LINGLING })
      .first()
      .locator(".wa-unread"),
  ).toHaveCount(0, { timeout: 10000 });
});

async function rowCountUnread(phone: Locator) {
  return phone
    .locator(".wa-chat-row", { hasText: LINGLING })
    .first()
    .locator(".wa-unread")
    .count();
}

// ---------------------------------------------------------------- 验收 D

test("验收D｜播完后重进、刷新均不重播，历史与播放状态持久化", async ({
  page,
}) => {
  test.setTimeout(180000);
  const phone = await loadTemplatePlayer(page);
  await openInstagram(phone);
  await likeTarget(phone, page);
  const afterLike = await readRuntime(page);
  expect(
    afterLike.notifications.filter((n: string) => n.includes("like 咗")).length,
    "触发时只生成一条通知",
  ).toBe(1);
  await openWhatsApp(phone);
  await openThread(phone);
  await waitAllPlayed(phone, page);
  const played = await readRuntime(page);
  expect(played.playback["IG-001"].deliveredMessageIds).toEqual(IDS);

  for (let round = 1; round <= 2; round++) {
    await openApp(phone, WHATSAPP);
    await expect(
      phone.locator(".wa-chat-row", { hasText: LINGLING }).first(),
    ).toBeVisible();
    expect(await rowCountUnread(phone)).toBe(0);
    await openThread(phone);
    const bubbles = await phone.locator(".skin-bubble").allTextContents();
    assertOrderOnce(bubbles);
    const s = await readRuntime(page);
    expect(s.playback["IG-001"].playbackStatus).toBe("completed");
    expect(s.playback["IG-001"].deliveredMessageIds).toEqual(IDS);
  }

  await page.reload();
  await unlockPhone(phone);
  await openApp(phone, WHATSAPP);
  await openThread(phone);
  const afterReload = await phone.locator(".skin-bubble").allTextContents();
  assertOrderOnce(afterReload);
  const s = await readRuntime(page);
  expect(s.completed.filter((x: string) => x === "IG-001")).toHaveLength(1);
  expect(s.playback["IG-001"].playbackStatus).toBe("completed");
  expect(s.playback["IG-001"].deliveredMessageIds).toEqual(IDS);
  // 通知查看后按既有规则清除；关键是全程没有被重复生成（恒 <= 1）。
  expect(
    s.notifications.filter((n: string) => n.includes("like 咗")).length,
    "通知不得重复生成",
  ).toBeLessThanOrEqual(1);
});

// ---------------------------------------------------------------- 验收 E

test("验收E｜IG-001 独立于 MAP-001 / BR-001，消息包互不覆盖", async ({
  page,
}) => {
  test.setTimeout(180000);
  const phone = await loadTemplatePlayer(page);
  await openInstagram(phone);
  await likeTarget(phone, page);

  let s = await readRuntime(page);
  expect(s.completed).toContain("IG-001");
  expect(s.completed).not.toContain("MAP-001");
  expect(s.completed).not.toContain("BR-001-RESTAURANT-SEARCH");
  expect(Object.keys(s.playback)).toEqual(["IG-001"]);
  const igPackBefore = JSON.stringify(s.playback["IG-001"]);

  // 之后单独触发 MAP-001：两个包并存，互不影响
  await triggerMap001(phone);
  s = await readRuntime(page);
  expect(s.completed).toContain("MAP-001");
  expect(Object.keys(s.playback).sort()).toEqual(["IG-001", "MAP-001"]);
  expect(s.playback["MAP-001"].messageIds).toEqual([
    "msg_map001_01",
    "msg_map001_02",
    "msg_map001_03",
    "msg_map001_04",
  ]);
  expect(s.playback["MAP-001"].deliveredMessageIds).toEqual([]);
  // IG-001 的包没有被覆盖、没有被重置
  expect(JSON.stringify(s.playback["IG-001"])).toBe(igPackBefore);
  expect(s.playback["IG-001"].messageIds).toEqual(IDS);
  expect(s.completed.filter((x: string) => x === "IG-001")).toHaveLength(1);
  expect(s.variables?.IG_001_TRIGGERED).toBe(true);
  expect(s.completed).not.toContain("BR-001-RESTAURANT-SEARCH");
});
