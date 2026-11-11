import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { compileStory } from "../src/story-engine/compiler";
import {
  driveThread,
  sendPresetReply,
  waitAwaitingReply,
  type PlaybackMap,
} from "./fixtures/wa-playback";

const PIN = "0511";
const WHATSAPP = "打开WhatsApp";
const LINGLING = "邝学姐 💙";
const MIMI = "Mimi 🧋";
const LAST_LINGLING = "只是覺得當面說會比較好。";
const NOTICE = "你跟学姐聊开了吗？";
const HISTORY_FIRST = "你今晚几点回去？";
const HISTORY_LAST = "笑了就好";
const HISTORY_COUNT = 171;
const TOTAL_BUBBLES = HISTORY_COUNT + 14;

const IDS = Array.from(
  { length: 14 },
  (_, i) => `msg_mimi001_${String(i + 1).padStart(2, "0")}`,
);
/** MIMI-001 固定剧本，顺序与内容与规格逐字一致。 */
const BODIES = [
  "你跟学姐聊开了吗？",
  "没有呢😭",
  "怎么了？",
  "学姐刚刚发消息，说下次见面有件事想当面跟我说",
  "这个语气也太正式了吧，我现在一想到就紧张",
  "你紧张什么呀？",
  "说不定她想说的，刚好就是你一直不敢问的那件事呢",
  "那万一她是想直接告诉我，她要去泰国了怎么办😭",
  "……",
  "好吧，也不是没可能",
  "😭😭 😭 😭 😭 😭 😭 😭",
  "但也有可能不是这件事啊，你先别自己吓自己",
  "听她亲口说，好不好？",
  "嗯",
];
/** 0-based：当前账号发出的消息在消息包中的下标。 */
const OWNER_INDEXES = [1, 3, 4, 7, 10, 13];

type Locator = ReturnType<Page["locator"]>;

async function unlockPhone(phone: Locator) {
  await phone.getByRole("button", { name: "轻触解锁" }).click();
  for (const d of PIN)
    await phone.getByRole("button", { name: "密码键" + d }).click();
  await expect(
    phone.getByRole("button", { name: "搜索", exact: true }),
  ).toBeVisible({ timeout: 10000 });
}

/** 用当前 template 故事编译出的 work 覆盖预览服务的 work.json，保证测的是最新数据。 */
async function loadTemplatePlayer(page: Page) {
  const raw = JSON.parse(readFileSync("stories/template/story.json", "utf8"));
  const { work } = compileStory(raw);
  await page.route("**/work.json", (route) => route.fulfill({ json: work }));
  await page.goto("/");
  const phone = page.locator(".phone-shell");
  await unlockPhone(phone);
  return phone;
}

async function goHome(phone: Locator) {
  const btn = phone.getByRole("button", { name: "返回桌面", exact: true });
  if (await btn.isVisible().catch(() => false)) await btn.click();
}

async function openApp(phone: Locator, aria: string) {
  await goHome(phone);
  await phone.getByRole("button", { name: aria, exact: true }).click();
}

async function openWhatsApp(phone: Locator) {
  await openApp(phone, WHATSAPP);
  await expect(phone.locator(".whatsapp-ui")).toBeVisible({ timeout: 15000 });
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

function mimiRow(phone: Locator) {
  return phone.locator(".wa-chat-row", { hasText: MIMI }).first();
}

function linglingRow(phone: Locator) {
  return phone.locator(".wa-chat-row", { hasText: LINGLING }).first();
}

/** 等待 MIMI-001 只入队、不播放。 */
async function waitMimiPack(page: Page) {
  await expect
    .poll(
      async () =>
        (await readRuntime(page))?.playback?.["MIMI-001"]?.messageIds?.length ??
        0,
      { timeout: 20000 },
    )
    .toBe(14);
}

/** 播完指定学姐对话（303 静态 + 304—307 打字/淡入）并等待 MIMI-001 入队。 */
async function finishLinglingDialogue(phone: Locator, page: Page) {
  await openWhatsApp(phone);
  await linglingRow(phone).click();
  await expect(
    phone.locator(".skin-bubble", { hasText: LAST_LINGLING }),
  ).toHaveCount(1, { timeout: 30000 });
  await waitMimiPack(page);
}

const readPlayback = async (page: Page): Promise<PlaybackMap> =>
  (await readRuntime(page))?.playback ?? {};
const isMimiDone = (pb: PlaybackMap) =>
  pb["MIMI-001"]?.playbackStatus === "completed";

/** 从聊天列表点进 Mimi 私聊，逐条手动发送当前账号回复直到 14 条全部落盘。 */
async function playMimiPack(phone: Locator, page: Page) {
  await mimiRow(phone).click();
  await driveThread(
    page,
    phone,
    () => readPlayback(page),
    isMimiDone,
  );
  await expect(
    phone.locator(".skin-bubble", { hasText: BODIES[12] }),
  ).toHaveCount(1, { timeout: 60000 });
  await expect
    .poll(
      async () =>
        (await readRuntime(page))?.playback?.["MIMI-001"]
          ?.playbackStatus ?? "none",
      { timeout: 20000 },
    )
    .toBe("completed");
  await expect
    .poll(async () => phone.locator(".skin-bubble").count(), {
      timeout: 20000,
    })
    .toBe(TOTAL_BUBBLES);
}

/** 检查最后 14 条气泡严格按固定剧本顺序、各出现一次、收发方向正确。 */
async function assertPackRendered(phone: Locator) {
  const bubbles = await phone.locator(".skin-bubble").allTextContents();
  expect(bubbles).toHaveLength(TOTAL_BUBBLES);
  const tail = bubbles.slice(-14).map((b) => b.trim());
  for (let i = 0; i < BODIES.length; i++)
    expect(tail[i], `第 ${i + 1} 条消息内容/顺序`).toContain(
      BODIES[i].trim(),
    );
  // 重复检查只在消息包这 14 条里做，避免历史聊天中恰好含相同单字造成误判
  for (const text of [BODIES[0], BODIES[6], BODIES[11], BODIES[13]])
    expect(
      tail.filter((b) => b.includes(text.trim())).length,
      "同一条消息不能重复写入历史: " + text,
    ).toBe(1);

  const msgs = await phone
    .locator(".skin-message")
    .evaluateAll((els) =>
      els.map((e) => ({
        text: e.querySelector(".skin-bubble")?.textContent ?? "",
        outgoing: e.classList.contains("outgoing"),
      })),
    );
  const packMsgs = msgs.slice(-14);
  OWNER_INDEXES.forEach((i) =>
    expect(packMsgs[i].outgoing, `第 ${i + 1} 条应为当前账号发出`).toBe(true),
  );
  [0, 2, 5, 6, 8, 9, 11, 12].forEach((i) =>
    expect(packMsgs[i].outgoing, `第 ${i + 1} 条应为 Mimi 发来`).toBe(false),
  );
  // 04 / 05 是当前账号连续两条，中间不得插入 Mimi 的消息
  expect(packMsgs[3].outgoing && packMsgs[4].outgoing).toBe(true);
}

// ---------------------------------------------------------------- 验收 A

test("验收A｜Mimi 联系人、独立头像与 171 条历史聊天常驻且不重复追加", async ({
  page,
}) => {
  test.setTimeout(180000);
  const phone = await loadTemplatePlayer(page);

  const baseline = await readRuntime(page);
  expect(Object.keys(baseline.playback ?? {})).toEqual([]);
  expect(baseline.variables?.MIMI_001_TRIGGERED).toBe(false);
  expect(baseline.variables?.WA_EP00_DIALOGUE_COMPLETE).toBe(false);

  await openWhatsApp(phone);
  const row = mimiRow(phone);
  await expect(row).toBeVisible();
  expect(await row.locator("strong").textContent()).toBe(MIMI);
  // 未触发事件时，聊天列表预览是最后一条历史消息，且没有未读角标
  await expect(row).toContainText(HISTORY_LAST);
  await expect(row.locator(".wa-unread")).toHaveCount(0);
  await expect(row.locator(".skin-avatar img")).toHaveCount(1);
  const avatarSrc = await row.locator(".skin-avatar img").getAttribute("src");
  expect(avatarSrc?.startsWith("data:image/jpeg;base64,")).toBe(true);

  await row.click();
  await expect(phone.locator(".wa-thread-profile .skin-avatar img")).toHaveCount(
    1,
  );
  await expect(phone.locator(".skin-bubble")).toHaveCount(HISTORY_COUNT);
  const bubbles = await phone.locator(".skin-bubble").allTextContents();
  expect(bubbles[0]).toContain(HISTORY_FIRST);
  expect(bubbles[bubbles.length - 1]).toContain(HISTORY_LAST);
  // 171 条历史消息不得提前包含 MIMI-001 的事件消息
  await expect(
    phone.locator(".skin-bubble", { hasText: NOTICE }),
  ).toHaveCount(0);
  await expect(
    phone.locator(".skin-bubble", { hasText: BODIES[6] }),
  ).toHaveCount(0);
  // 沉浸感：不得出现说明性称呼
  const threadText = await phone.locator(".skin-messages").innerText();
  for (const w of ["机主", "玩家", "手机主人", "虚构", "模拟器"])
    expect(threadText).not.toContain(w);

  // 反复进出 Mimi 私聊：历史消息不重复追加，也不产生事件包
  for (let round = 0; round < 2; round++) {
    await openApp(phone, WHATSAPP);
    await expect(mimiRow(phone)).toBeVisible();
    await mimiRow(phone).click();
    await expect(phone.locator(".skin-bubble")).toHaveCount(HISTORY_COUNT);
  }
  const s = await readRuntime(page);
  expect(Object.keys(s.playback ?? {})).toEqual([]);
  expect(s.variables?.MIMI_001_TRIGGERED).toBe(false);
  expect(Object.values(s.messages ?? {}).flat()).toHaveLength(0);
});

// ---------------------------------------------------------------- 验收 B

test("验收B1｜打开 App、只看到部分学姐对话都不触发，完整播放后才触发 MIMI-001", async ({
  page,
}) => {
  test.setTimeout(180000);
  const phone = await loadTemplatePlayer(page);

  await openWhatsApp(phone);
  // 只打开 WhatsApp App（聊天列表）不触发
  let s = await readRuntime(page);
  expect(Object.keys(s.playback ?? {})).toEqual([]);
  expect(s.variables?.MIMI_001_TRIGGERED).toBe(false);
  await expect(phone.locator(".skin-messages")).toHaveCount(0);

  await linglingRow(phone).click();
  // 刚进入学姐私聊、只看到第一条静态消息时不触发
  s = await readRuntime(page);
  expect(Object.keys(s.playback ?? {})).toEqual([]);
  expect(s.completed).not.toContain("WA_EP00_DIALOGUE_COMPLETE");

  // 播放到第二条（wa-msg-305）但还没到最后一条：仍不得触发
  await expect
    .poll(
      async () =>
        (
          (await readRuntime(page))?.ui?.whatsapp?.revealedMessages ?? []
        ).includes("wa-msg-305"),
      { timeout: 20000 },
    )
    .toBe(true);
  s = await readRuntime(page);
  expect(s.ui.whatsapp.revealedMessages).not.toContain("wa-msg-307");
  expect(Object.keys(s.playback ?? {})).toEqual([]);
  expect(s.variables?.MIMI_001_TRIGGERED).toBe(false);

  // 指定对话完整播放结束（wa-msg-307 出现）后才触发
  await expect(
    phone.locator(".skin-bubble", { hasText: LAST_LINGLING }),
  ).toHaveCount(1, { timeout: 30000 });
  await waitMimiPack(page);

  s = await readRuntime(page);
  expect(s.completed).toContain("WA_EP00_DIALOGUE_COMPLETE");
  expect(s.completed.filter((x: string) => x === "MIMI-001")).toHaveLength(1);
  expect(s.variables?.WA_EP00_DIALOGUE_COMPLETE).toBe(true);
  expect(s.variables?.MIMI_001_TRIGGERED).toBe(true);
  expect(s.ui.whatsapp.revealedMessages).toContain("wa-msg-307");
  const pk = s.playback["MIMI-001"];
  expect(pk.playbackStatus).toBe("pending");
  expect(pk.nextMessageIndex).toBe(0);
  expect(pk.deliveredMessageIds).toEqual([]);
  expect(pk.messageIds).toEqual(IDS);
  expect(pk.appId).toBe("whatsapp");
  expect(pk.thread).toBe(MIMI);
  expect(s.unlocked.filter((id: string) => IDS.includes(id))).toEqual(IDS);
  // 触发时只入队：不写聊天历史、不自动切 App、不自动播放
  expect(Object.values(s.messages ?? {}).flat()).toHaveLength(0);
  await expect(phone.locator(".wa-thread-profile")).toBeVisible();
  await expect(phone.locator(".skin-messages")).toBeVisible();
  expect(await phone.locator(".wa-thread-profile strong").textContent()).toBe(
    LINGLING,
  );
  // 只生成一条 Mimi 通知
  const notices = s.notifications.filter((n: string) => n.includes(NOTICE));
  expect(notices).toHaveLength(1);
  expect(notices[0]).toContain("Mimi 🧋");

  await phone.getByRole("button", { name: "通知中心" }).click();
  await expect(phone.locator(".notice-cards")).toContainText(NOTICE);
  await expect(phone.locator(".notice-cards")).toContainText("Mimi 🧋");
  const close = phone.getByRole("button", { name: "关闭", exact: true });
  if (await close.count()) await close.click();
});

test("验收B2｜状态恢复不自动补触发，重复进入学姐聊天不重复生成通知或消息包", async ({
  page,
}) => {
  test.setTimeout(180000);
  const phone = await loadTemplatePlayer(page);
  await finishLinglingDialogue(phone, page);

  const first = await readRuntime(page);
  const noticeCount = first.notifications.filter((n: string) =>
    n.includes(NOTICE),
  ).length;
  expect(noticeCount).toBe(1);

  // 把「只播放了前三条」的进度直接写回存档并刷新：状态恢复本身不得补触发
  await page.evaluate(async (partial: string[]) => {
    const req = indexedDB.open("foundphone-studio");
    const db: IDBDatabase = await new Promise((res, rej) => {
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    const tx = db.transaction("saves", "readwrite");
    const store = tx.objectStore("saves");
    const all: any[] = await new Promise((res, rej) => {
      const r = store.getAll();
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const rec = all[0];
    rec.state.ui = {
      ...rec.state.ui,
      whatsapp: {
        ...(rec.state.ui?.whatsapp ?? {}),
        revealedMessages: partial,
      },
    };
    await new Promise((res, rej) => {
      const r = store.put(rec);
      r.onsuccess = () => res(null);
      r.onerror = () => rej(r.error);
    });
    await new Promise((res) => (tx.oncomplete = () => res(null)));
    db.close();
  }, ["wa-msg-304", "wa-msg-305", "wa-msg-306"]);

  await page.reload();
  await unlockPhone(phone);
  const restored = await readRuntime(page);
  expect(restored.ui.whatsapp.revealedMessages).toEqual([
    "wa-msg-304",
    "wa-msg-305",
    "wa-msg-306",
  ]);
  expect(restored.playback["MIMI-001"].playbackStatus).toBe("pending");
  expect(restored.playback["MIMI-001"].deliveredMessageIds).toEqual([]);
  expect(restored.variables?.MIMI_001_TRIGGERED).toBe(true);
  expect(
    restored.notifications.filter((n: string) => n.includes(NOTICE)).length,
  ).toBe(1);

  // 重复进入学姐聊天：不得再次生成 MIMI-001 通知或消息包
  await openApp(phone, WHATSAPP);
  await linglingRow(phone).click();
  await page.waitForTimeout(700);
  const s = await readRuntime(page);
  expect(s.completed.filter((x: string) => x === "MIMI-001")).toHaveLength(1);
  expect(Object.keys(s.playback)).toEqual(["MIMI-001"]);
  expect(s.playback["MIMI-001"].messageIds).toEqual(IDS);
  expect(
    s.notifications.filter((n: string) => n.includes(NOTICE)).length,
  ).toBeLessThanOrEqual(1);
});

// ---------------------------------------------------------------- 验收 C

test("验收C｜打开 WhatsApp 不自动播放，点进 Mimi 私聊后 14 条按固定顺序播放", async ({
  page,
}) => {
  test.setTimeout(180000);
  const phone = await loadTemplatePlayer(page);
  await finishLinglingDialogue(phone, page);

  await openApp(phone, WHATSAPP);
  const row = mimiRow(phone);
  await expect(row.locator(".wa-unread")).toHaveText("14");
  await expect(row).toContainText(NOTICE);
  // 只展示聊天列表，没有进入私聊、没有开始播放
  await expect(phone.locator(".skin-messages")).toHaveCount(0);
  const before = await readRuntime(page);
  expect(before.playback["MIMI-001"].playbackStatus).toBe("pending");
  expect(before.playback["MIMI-001"].deliveredMessageIds).toEqual([]);

  await playMimiPack(phone, page);
  await assertPackRendered(phone);

  const s = await readRuntime(page);
  expect(Object.values(s.messages ?? {}).flat()).toHaveLength(0);
  expect(s.playback["MIMI-001"].playbackStatus).toBe("completed");
  expect(s.playback["MIMI-001"].deliveredMessageIds).toEqual(IDS);
  expect(s.playback["MIMI-001"].nextMessageIndex).toBe(14);

  // 播完后返回聊天列表，未读角标归零，预览变成最新一条已收到消息
  await openApp(phone, WHATSAPP);
  await expect(mimiRow(phone).locator(".wa-unread")).toHaveCount(0, {
    timeout: 10000,
  });
  await expect(mimiRow(phone)).toContainText("嗯");
});

test("验收C2｜播放中途退出可续播，刷新后进度保留，反复进入不重播", async ({
  page,
}) => {
  test.setTimeout(180000);
  const phone = await loadTemplatePlayer(page);
  await finishLinglingDialogue(phone, page);

  await openApp(phone, WHATSAPP);
  await mimiRow(phone).click();
  // 第一条对方消息自动到达后，游标停在当前账号回复；手动发一条才会继续推进。
  await waitAwaitingReply(phone);
  await sendPresetReply(page, phone, () => readPlayback(page), BODIES[1]);
  await expect
    .poll(
      async () =>
        (await readRuntime(page))?.playback?.["MIMI-001"]
          ?.deliveredMessageIds?.length ?? 0,
      { timeout: 40000 },
    )
    .toBeGreaterThanOrEqual(3);

  const mid = await readRuntime(page);
  const delivered: string[] = mid.playback["MIMI-001"].deliveredMessageIds;
  expect(delivered.length).toBeLessThan(14);
  // 已播放的必须是固定剧本的严格前缀，且无重复
  expect(delivered).toEqual(IDS.slice(0, delivered.length));
  expect(new Set(delivered).size).toBe(delivered.length);
  expect(mid.playback["MIMI-001"].nextMessageIndex).toBe(delivered.length);

  // 中途离开（回到聊天列表），再由 playMimiPack 重新点进私聊续播
  await openApp(phone, WHATSAPP);
  await expect(mimiRow(phone)).toBeVisible();
  await playMimiPack(phone, page);
  await assertPackRendered(phone);

  // 播完后反复进入、刷新，都不重播
  for (let round = 0; round < 2; round++) {
    await openApp(phone, WHATSAPP);
    await expect(mimiRow(phone).locator(".wa-unread")).toHaveCount(0);
    await mimiRow(phone).click();
    await assertPackRendered(phone);
    const s = await readRuntime(page);
    expect(s.playback["MIMI-001"].playbackStatus).toBe("completed");
    expect(s.playback["MIMI-001"].deliveredMessageIds).toEqual(IDS);
  }

  await page.reload();
  await unlockPhone(phone);
  await openApp(phone, WHATSAPP);
  await mimiRow(phone).click();
  await assertPackRendered(phone);
  const afterReload = await readRuntime(page);
  expect(afterReload.completed.filter((x: string) => x === "MIMI-001")).toHaveLength(1);
  expect(afterReload.playback["MIMI-001"].playbackStatus).toBe("completed");
  expect(afterReload.playback["MIMI-001"].deliveredMessageIds).toEqual(IDS);
  expect(
    afterReload.notifications.filter((n: string) => n.includes(NOTICE)).length,
  ).toBeLessThanOrEqual(1);
});

// ---------------------------------------------------------------- 验收 D

test("验收D｜MIMI-001 独立于 MAP-001 / IG-001 / BR-001 / 论坛与 Instagram", async ({
  page,
}) => {
  test.setTimeout(180000);
  const phone = await loadTemplatePlayer(page);
  // 全程不打开 Instagram / Maps / 论坛，只完成学姐指定对话
  await finishLinglingDialogue(phone, page);

  const s = await readRuntime(page);
  expect(s.completed).toContain("MIMI-001");
  expect(s.completed).toContain("WA_EP00_COMPLETE");
  expect(s.completed).not.toContain("MAP-001");
  expect(s.completed).not.toContain("IG-001");
  expect(s.completed).not.toContain("BR-001-RESTAURANT-SEARCH");
  expect(Object.keys(s.playback)).toEqual(["MIMI-001"]);
  expect(s.variables?.IG_001_TRIGGERED).toBe(false);
  expect(s.unlocked.filter((id: string) => id.startsWith("msg_map001_"))).toEqual([]);
  expect(s.unlocked.filter((id: string) => id.startsWith("msg_ig001_"))).toEqual([]);

  // 之后单独触发 IG-001：两个包并存，互不影响
  await openApp(phone, "打开Instagram");
  await expect(phone.locator(".igx-ui")).toBeVisible({ timeout: 15000 });
  const target = phone.locator(
    '.igx-feed .igx-post[data-post-id="post_ll_20261106_omakase"]',
  );
  await target.getByRole("button", { name: "点赞", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await readRuntime(page))?.playback?.["IG-001"]?.messageIds?.length ??
        0,
      { timeout: 20000 },
    )
    .toBe(7);
  const s2 = await readRuntime(page);
  expect(Object.keys(s2.playback).sort()).toEqual(["IG-001", "MIMI-001"]);
  expect(s2.playback["MIMI-001"].deliveredMessageIds).toEqual([]);
  expect(s2.playback["MIMI-001"].messageIds).toEqual(IDS);
  expect(s2.completed.filter((x: string) => x === "MIMI-001")).toHaveLength(1);
  expect(
    s2.notifications.filter((n: string) => n.includes(NOTICE)).length,
  ).toBeLessThanOrEqual(1);
});

// ---------------------------------------------------------------- 附加静态约束

test("验收E｜固定数据、稳定 ID、无自由输入、学姐聊天未改（静态检查）", async () => {
  const raw = JSON.parse(readFileSync("stories/template/story.json", "utf8"));
  const appSkins = readFileSync("src/AppSkins.tsx", "utf8");

  const contact = raw.contacts.find((c: any) => c.id === "mimi_friend");
  expect(contact?.name).toBe(MIMI);
  expect(contact.avatar.startsWith("data:image/jpeg;base64,")).toBe(true);
  // 编译层会把头像内联到每条消息，头像必须保持紧凑
  expect(contact.avatar.length).toBeLessThan(10000);

  const chat = raw.chats.find((c: any) => c.id === "wa-mimi");
  expect(chat.title).toBe(MIMI);
  expect(chat.participants).toEqual(["owner", "mimi_friend"]);
  expect(chat.messages).toHaveLength(185);
  const history = chat.messages.filter((m: any) => !m.hidden);
  const pack = chat.messages.filter((m: any) => m.hidden);
  expect(history).toHaveLength(171);
  expect(pack.map((m: any) => m.id)).toEqual(IDS);
  expect(pack.map((m: any) => m.body.trim())).toEqual(
    BODIES.map((b) => b.trim()),
  );
  // 稳定唯一 ID、固定时间、双向固定剧本
  expect(new Set(chat.messages.map((m: any) => m.id)).size).toBe(185);
  for (const m of chat.messages) {
    expect(m.time).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(["owner", "mimi_friend"]).toContain(m.senderId);
    expect(typeof m.body).toBe("string");
  }
  for (const m of history) expect(m.hidden).toBeUndefined();
  for (const m of pack) expect(m.hidden).toBe(true);
  expect(history[0].id).toBe("msg_mimi_h01_01");
  expect(history[history.length - 1].id).toBe("msg_mimi_h10_16");
  // 界面不得出现说明性称呼；Mimi 也不知道学姐刚发来的私聊内容
  const allBodies = chat.messages.map((m: any) => m.body).join("\n");
  for (const w of ["机主", "玩家", "手机主人", "虚构", "模拟器"])
    expect(allBodies).not.toContain(w);
  expect(history.some((m: any) => m.body.includes(NOTICE))).toBe(false);

  // 指定学姐对话完成状态独立于开场基线 WA_EP00_COMPLETE
  const ep00 = raw.events.find((e: any) => e.id === "WA_EP00_COMPLETE");
  expect(ep00.type).toBe("comment");
  expect(ep00.event).toBe("start");
  expect(ep00.actions).toHaveLength(0);
  const complete = raw.events.find(
    (e: any) => e.id === "WA_EP00_DIALOGUE_COMPLETE",
  );
  expect(complete.event).toBe("variable");
  expect(complete.target).toBe("ui:whatsapp:revealedMessages");
  expect(complete.once).toBe(true);
  expect(complete.conditions).toEqual([
    { key: "ui:whatsapp:revealedMessages", op: "includes", value: "wa-msg-307" },
  ]);
  expect(complete.actions).toEqual([
    { type: "variable", key: "WA_EP00_DIALOGUE_COMPLETE", value: true },
  ]);

  const mimi = raw.events.find((e: any) => e.id === "MIMI-001");
  expect(mimi.label).toBe("A Friend Checks In");
  expect(mimi.once).toBe(true);
  expect(mimi.event).toBe("variable");
  expect(mimi.target).toBe("WA_EP00_DIALOGUE_COMPLETE");
  expect(mimi.conditions).toEqual([
    { key: "WA_EP00_DIALOGUE_COMPLETE", op: "eq", value: true },
    { key: "MIMI_001_TRIGGERED", op: "neq", value: true },
  ]);
  expect(mimi.actions.filter((a: any) => a.type === "unlock")).toHaveLength(14);
  expect(mimi.actions.filter((a: any) => a.type === "notification")).toEqual([
    {
      type: "notification",
      key: "whatsapp",
      value: "@whatsapp|now|Mimi 🧋|你跟学姐聊开了吗？|>whatsapp:Mimi 🧋",
    },
  ]);
  // 不使用倒计时 / 时间驱动触发
  for (const e of raw.events) {
    expect(e.delayMs).toBeUndefined();
    expect(["time", "timer"]).not.toContain(e.event);
    expect(e.type).not.toBe("delay");
    for (const a of e.actions ?? [])
      expect(["time", "date", "delay"]).not.toContain(a.type);
  }

  // 学姐原有聊天记录未被改动：MIMI-001 之后 WA_LC_002 在末尾追加了 46 条
  // hidden 最终私聊事件包（msg_lc002_），电话模块再追加 2 条 hidden 事件消息
  //（msg_phone_lc1_），音乐模块再追加 5 条 hidden 事件消息（msg_music_001_），
  // WA_DOUYIN_001 再追加 4 条 hidden 事件消息（msg_wa_douyin_001_），
  // 总数 319 → 365 → 367 → 372 → 376；前 319 条保持原样，不进静态历史。
  // 此处只同步基线并显式隔离事件包，不削弱原有逐字断言。
  const lingling = raw.chats.find((c: any) => c.id === "wa-lingling");
  expect(lingling.messages).toHaveLength(376);
  const lc2Pack = lingling.messages.filter((m: any) =>
    String(m.id).startsWith("msg_lc002_"),
  );
  expect(lc2Pack).toHaveLength(46);
  expect(lc2Pack.every((m: any) => m.hidden === true)).toBe(true);
  const phonePack = lingling.messages.filter((m: any) =>
    String(m.id).startsWith("msg_phone_lc1_"),
  );
  expect(phonePack).toHaveLength(2);
  expect(phonePack.every((m: any) => m.hidden === true)).toBe(true);
  const musicPack = lingling.messages.filter((m: any) =>
    String(m.id).startsWith("msg_music_001_"),
  );
  expect(musicPack).toHaveLength(5);
  expect(musicPack.every((m: any) => m.hidden === true)).toBe(true);
  const douyinPack = lingling.messages.filter((m: any) =>
    String(m.id).startsWith("msg_wa_douyin_001_"),
  );
  expect(douyinPack).toHaveLength(4);
  expect(douyinPack.every((m: any) => m.hidden === true)).toBe(true);
  expect(lingling.messages.slice(0, 319).some((m: any) => m.hidden && String(m.id).startsWith("msg_lc002_"))).toBe(false);
  expect(lingling.messages.find((m: any) => m.id === "wa-msg-303").body).toBe(
    "下次見面時，我有些話想當面同你說。",
  );
  expect(lingling.messages.find((m: any) => m.id === "wa-msg-307").body).toBe(
    LAST_LINGLING,
  );

  // 聊天列表预览白名单已包含 MIMI-001，且没有改成「全部事件都预览」
  expect(appSkins).toContain('"MIMI-001"');
  expect(appSkins).toContain("PREVIEW_FIRST_MESSAGE_EVENTS");
});
