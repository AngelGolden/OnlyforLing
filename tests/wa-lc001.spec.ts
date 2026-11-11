import { test, expect, type Locator, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { compileStory } from "../src/story-engine/compiler";
import {
  sendPresetReply,
  waitAwaitingReply,
  type PlaybackMap,
} from "./fixtures/wa-playback";

/**
 * WA_LC_001｜明年的主唱：事件触发与实时消息时间规则。
 * 消息原文独立于 scripts/import-wa-lc001.mjs，重新解析用户规格第三章表格，
 * 避免「自己验证自己」。
 */
const SPEC = "data/wa-lc001/乐队群聊触发事件.txt";
const ROW_RE = /^\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|\s*(.*?)\s*\|\s*$/;
type PackRow = { no: number; sender: string; body: string };

function parsePack(): PackRow[] {
  const lines = readFileSync(SPEC, "utf8")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/);
  const rows = lines
    .map((l) => l.match(ROW_RE))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => ({
      no: Number(m[1]),
      sender: m[2].trim(),
      body: m[3].trim(),
    }));
  if (rows.length !== 9)
    throw new Error(`规格第三章应有 9 条固定消息，实际 ${rows.length} 条`);
  rows.forEach((r, i) => {
    if (r.no !== i + 1) throw new Error(`第 ${i + 1} 行顺序异常：${r.no}`);
  });
  return rows;
}

const PACK = parsePack();
const LC_IDS = Array.from(
  { length: 9 },
  (_, i) => `msg_lc001_${String(i + 1).padStart(2, "0")}`,
);
const MIMI_IDS = Array.from(
  { length: 14 },
  (_, i) => `msg_mimi001_${String(i + 1).padStart(2, "0")}`,
);
const GROUP = "Late Checkout 🎸";
const NOTES = "打开备忘录";
const PHOTOS = "打开相册";
const WHATSAPP = "打开WhatsApp";
const MIMI = "Mimi 🧋";

let cachedWork: any = null;
let cachedRaw: any = null;
function story() {
  if (!cachedRaw)
    cachedRaw = JSON.parse(readFileSync("stories/template/story.json", "utf8"));
  if (!cachedWork) cachedWork = compileStory(cachedRaw).work;
  return { raw: cachedRaw, work: cachedWork };
}
const PIN = String(story().raw.phone?.passcode ?? "");

/** 与 Phone.realLocalStamp() 相同口径：设备本地真实时间 YYYY-MM-DD HH:MM。 */
function localStamp(d = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function unlockPhone(phone: Locator) {
  await phone.getByRole("button", { name: "轻触解锁" }).click();
  for (const d of PIN)
    await phone.getByRole("button", { name: "密码键" + d }).click();
  await expect(
    phone.getByRole("button", { name: "搜索", exact: true }),
  ).toBeVisible({ timeout: 10000 });
}

async function loadPhone(page: Page): Promise<Locator> {
  const { work } = story();
  await page.route("**/work.json", (route) =>
    route.fulfill({ json: structuredClone(work) }),
  );
  await page.goto("/");
  const phone = page.locator(".phone-shell");
  await unlockPhone(phone);
  return phone;
}

async function readSave(page: Page): Promise<{ id: string; state: any }> {
  return page.evaluate(async () => {
    const req = indexedDB.open("foundphone-studio");
    const db: IDBDatabase = await new Promise((res, rej) => {
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    const all: any[] = await new Promise((res, rej) => {
      const r = db
        .transaction("saves", "readonly")
        .objectStore("saves")
        .getAll();
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    db.close();
    return { id: all[0]?.id ?? "", state: all[0]?.state ?? {} };
  });
}
const readState = async (page: Page): Promise<any> =>
  (await readSave(page)).state;

async function writeState(page: Page, state: any) {
  await page.evaluate(async (next: any) => {
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
    await new Promise((res, rej) => {
      const r = store.put({ ...all[0], state: next });
      r.onsuccess = () => res(null);
      r.onerror = () => rej(r.error);
    });
    await new Promise((res) => (tx.oncomplete = () => res(null)));
    db.close();
  }, state);
}

type SeedOptions = {
  ep00?: boolean;
  mimiStatus?: string;
  notes?: boolean;
  photos?: boolean;
  /** 验收13：把 MIMI-001 停在当前账号回复处，并解锁该消息包条目。 */
  mimiAwaiting?: boolean;
};

/** 直接把四项前置状态写回存档（跳过耗时的 14 条对话播放），再刷新让 Runtime 恢复。 */
async function prepare(
  page: Page,
  opts: SeedOptions = {},
): Promise<{ phone: Locator; beforeStamp: string }> {
  const phone = await loadPhone(page);
  const current = await readState(page);
  const s = structuredClone(current);
  const mimiDone = (opts.mimiStatus ?? "completed") === "completed";
  const delivered = opts.mimiAwaiting
    ? [MIMI_IDS[0]]
    : mimiDone
      ? [...MIMI_IDS]
      : [];
  s.completed = (s.completed ?? []).filter((x: string) => x !== "WA_LC_001");
  if (!s.completed.includes("WA_EP00_COMPLETE"))
    s.completed.push("WA_EP00_COMPLETE");
  // 本文件只验收 WA_LC_001：把后续 WA_LC_002 记为「已触发」，否则「打开群聊看完
  // 9 条后返回主屏」会按新剧情投递学姐私聊，干扰这里的 messageTimes / 通知断言。
  // WA_LC_002 本身由 tests/wa-lc002.spec.ts 独立验收。
  if (!s.completed.includes("WA_LC_002")) s.completed.push("WA_LC_002");
  s.variables = {
    ...(s.variables ?? {}),
    WA_EP00_DIALOGUE_COMPLETE: opts.ep00 ?? true,
    MIMI_001_TRIGGERED: true,
    notes_reviewed: opts.notes ?? false,
    photos_reviewed: opts.photos ?? false,
    WA_LC_001_TRIGGERED: false,
    WA_LC_002_TRIGGERED: true,
  };
  s.playback = {
    ...(s.playback ?? {}),
    "MIMI-001": {
      eventId: "MIMI-001",
      playbackStatus: opts.mimiAwaiting
        ? "playing"
        : (opts.mimiStatus ?? "completed"),
      nextMessageIndex: delivered.length,
      deliveredMessageIds: delivered,
      messageIds: [...MIMI_IDS],
      appId: "whatsapp",
      thread: MIMI,
      order: 0,
    },
  };
  s.unlocked = [
    ...new Set<string>([
      ...(s.unlocked ?? []),
      ...(opts.mimiAwaiting ? MIMI_IDS : []),
    ]),
  ];
  s.ui = {
    ...(s.ui ?? {}),
    notes: { ...(s.ui?.notes ?? {}), scrolledToEnd: false },
    photos: { ...(s.ui?.photos ?? {}), scrolledToEnd: false },
  };
  s.messageTimes = {};
  s.notifications = (s.notifications ?? []).filter(
    (n: string) => !n.includes(PACK[0].body),
  );
  await writeState(page, s);
  await page.reload();
  await unlockPhone(phone);
  return { phone, beforeStamp: localStamp() };
}

async function goHome(phone: Locator) {
  await phone.getByRole("button", { name: "返回桌面", exact: true }).click();
}

async function openApp(phone: Locator, label: string) {
  await goHome(phone);
  await phone.getByRole("button", { name: label, exact: true }).click();
}

/** 真正把 App 列表滚动到末尾，并等浏览标记写入存档。 */
async function browseToEnd(
  page: Page,
  phone: Locator,
  which: "notes" | "photos",
) {
  await openApp(phone, which === "notes" ? NOTES : PHOTOS);
  const skin = which === "notes" ? ".native-notes" : ".native-photos";
  const list = phone.locator(`${skin} .catalog-scroll`).first();
  await expect(list).toBeVisible({ timeout: 15000 });
  if (which === "photos")
    await expect(
      phone.locator(".native-photos .photo-mosaic button").first(),
    ).toBeVisible({ timeout: 15000 });
  else
    await expect(phone.locator(".native-notes .notes-row").first()).toBeVisible({
      timeout: 15000,
    });
  const size = await list.evaluate((el) => ({
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  }));
  expect(size.scrollHeight, `${which} 列表必须可滚动`).toBeGreaterThan(
    size.clientHeight,
  );
  await list.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect
    .poll(async () => (await readState(page))?.ui?.[which]?.scrolledToEnd, {
      timeout: 10000,
    })
    .toBe(true);
}

async function triggered(page: Page) {
  return expect
    .poll(async () => (await readState(page))?.variables?.WA_LC_001_TRIGGERED, {
      timeout: 10000,
    })
    .toBe(true);
}
async function notTriggered(page: Page) {
  const s = await readState(page);
  expect(s.completed).not.toContain("WA_LC_001");
  expect(s.variables?.WA_LC_001_TRIGGERED).toBe(false);
  expect(s.playback?.["WA_LC_001"]).toBeUndefined();
  expect(s.unlocked?.filter((id: string) => LC_IDS.includes(id))).toEqual([]);
  return s;
}

/** 完整前置条件 + 两个 App 都完成浏览 + 从最后浏览的 App 返回主屏。 */
async function fullTrigger(page: Page, order: "notes-first" | "photos-first") {
  const { phone } = await prepare(page);
  const first = order === "notes-first" ? "notes" : "photos";
  const second = order === "notes-first" ? "photos" : "notes";
  await browseToEnd(page, phone, first);
  await goHome(phone);
  await browseToEnd(page, phone, second);
  const stampAt = localStamp();
  await goHome(phone);
  await triggered(page);
  return { phone, stampAt };
}

async function openGroup(phone: Locator) {
  await openApp(phone, WHATSAPP);
  await expect(phone.locator(".whatsapp-ui")).toBeVisible({ timeout: 15000 });
  const row = phone.locator(".wa-chat-row", { hasText: GROUP }).first();
  await expect(row).toBeVisible();
  await row.click();
}

/** 等待 WA_LC_001 的 9 条消息逐条播放完毕。 */
async function waitPackDelivered(page: Page) {
  await expect
    .poll(
      async () =>
        (await readState(page))?.playback?.["WA_LC_001"]?.deliveredMessageIds
          ?.length ?? 0,
      { timeout: 60000 },
    )
    .toBe(9);
}

// ─────────────────────────────────────────────────── 1 / 2 前置条件不满足

test("验收1｜学姐指定私聊未完成时，返回主屏不触发 WA_LC_001", async ({
  page,
}) => {
  test.setTimeout(120000);
  const { phone } = await prepare(page, {
    ep00: false,
    notes: true,
    photos: true,
  });
  await browseToEnd(page, phone, "photos");
  await goHome(phone);
  const s = await notTriggered(page);
  expect(s.variables?.WA_EP00_DIALOGUE_COMPLETE).toBe(false);
  expect(s.variables?.notes_reviewed).toBe(true);
  expect(s.variables?.photos_reviewed).toBe(true);
});

test("验收2｜MIMI-001 未完整结束时，返回主屏不触发 WA_LC_001", async ({
  page,
}) => {
  test.setTimeout(120000);
  const { phone } = await prepare(page, {
    mimiStatus: "pending",
    notes: true,
    photos: true,
  });
  await browseToEnd(page, phone, "notes");
  await goHome(phone);
  const s = await notTriggered(page);
  expect(s.playback["MIMI-001"].playbackStatus).toBe("pending");
  expect(s.variables?.WA_EP00_DIALOGUE_COMPLETE).toBe(true);
});

// ─────────────────────────────────────────────────── 3 / 4 只浏览一个 App

test("验收3｜只浏览 Notes 不触发；补浏览 Photos 后从 Photos 返回主屏触发", async ({
  page,
}) => {
  test.setTimeout(150000);
  const { phone } = await prepare(page);

  await browseToEnd(page, phone, "notes");
  await goHome(phone);
  let s = await notTriggered(page);
  expect(s.variables?.notes_reviewed).toBe(true);
  expect(s.variables?.photos_reviewed).toBe(false);
  expect(s.ui?.notes?.scrolledToEnd).toBe(false);

  await browseToEnd(page, phone, "photos");
  await goHome(phone);
  await triggered(page);
  s = await readState(page);
  expect(s.variables?.photos_reviewed).toBe(true);
  expect(s.completed.filter((x: string) => x === "WA_LC_001")).toHaveLength(1);
});

test("验收4｜只浏览 Photos 不触发；补浏览 Notes 后从 Notes 返回主屏触发", async ({
  page,
}) => {
  test.setTimeout(150000);
  const { phone } = await prepare(page);

  await browseToEnd(page, phone, "photos");
  await goHome(phone);
  let s = await notTriggered(page);
  expect(s.variables?.photos_reviewed).toBe(true);
  expect(s.variables?.notes_reviewed).toBe(false);

  await browseToEnd(page, phone, "notes");
  await goHome(phone);
  await triggered(page);
  s = await readState(page);
  expect(s.variables?.notes_reviewed).toBe(true);
});

// ─────────────────────────────────────────────────── 5 尚未返回主屏

test("验收5｜两项浏览状态都成立但仍在 App 内时，事件不触发", async ({
  page,
}) => {
  test.setTimeout(120000);
  const { phone } = await prepare(page, { notes: true, photos: true });
  await browseToEnd(page, phone, "notes");
  // 故意不点返回桌面，停留在备忘录里：四项状态都成立，但没有 home 动作
  let s = await readState(page);
  expect(s.variables?.notes_reviewed).toBe(true);
  expect(s.variables?.photos_reviewed).toBe(true);
  expect(s.completed).toContain("WA_EP00_COMPLETE");
  expect(s.playback["MIMI-001"].playbackStatus).toBe("completed");
  await notTriggered(page);
  // 每秒推进的 advance 也不能把它补触发
  await page.waitForTimeout(1600);
  await notTriggered(page);
  s = await readState(page);
  expect(s.scheduled ?? []).toEqual([]);
  // 只有真正按「返回桌面」才触发
  await goHome(phone);
  await triggered(page);
});

// ─────────────────────────────────────────────────── 6 / 7 正式触发与顺序

test("验收6｜两项都完成后从最后浏览的 App 返回主屏时触发", async ({
  page,
}) => {
  test.setTimeout(150000);
  const { phone } = await fullTrigger(page, "notes-first");
  const s = await readState(page);
  expect(s.completed.filter((x: string) => x === "WA_LC_001")).toHaveLength(1);
  expect(s.playback["WA_LC_001"].playbackStatus).toBe("pending");
  expect(s.playback["WA_LC_001"].messageIds).toEqual(LC_IDS);
  expect(s.playback["WA_LC_001"].thread).toBe(GROUP);
  expect(s.playback["WA_LC_001"].deliveredMessageIds).toEqual([]);
  expect(s.unlocked.filter((id: string) => LC_IDS.includes(id))).toEqual(
    LC_IDS,
  );
  // 只入队、不写历史、不自动播放
  expect(Object.values(s.messages ?? {}).flat()).toHaveLength(0);
  expect(await phone.locator(".phone-screen").getAttribute("data-app")).toBe(
    "",
  );
});

test("验收7｜Notes→Photos 与 Photos→Notes 两种顺序都能触发", async ({
  page,
}) => {
  test.setTimeout(150000);
  // 顺序一：Notes → Photos
  await fullTrigger(page, "notes-first");
  expect((await readState(page)).variables?.WA_LC_001_TRIGGERED).toBe(true);

  // 同一浏览器上下文里重新做一份干净存档，换顺序再走一遍
  const { phone } = await prepare(page, { notes: false, photos: false });
  await browseToEnd(page, phone, "photos");
  await goHome(phone);
  await browseToEnd(page, phone, "notes");
  await goHome(phone);
  await triggered(page);
  const s = await readState(page);
  expect(s.variables?.notes_reviewed).toBe(true);
  expect(s.variables?.photos_reviewed).toBe(true);
  expect(s.completed.filter((x: string) => x === "WA_LC_001")).toHaveLength(1);
});

// ─────────────────────────────────────────────────── 8 通知与不强制跳转

test("验收8｜触发后生成 WhatsApp 群聊通知，但不强制切换 App", async ({
  page,
}) => {
  test.setTimeout(150000);
  const { phone } = await fullTrigger(page, "notes-first");
  const s = await readState(page);
  const notices = (s.notifications ?? []).filter((n: string) =>
    n.includes(PACK[0].body),
  );
  expect(notices).toHaveLength(1);
  expect(notices[0]).toContain("@whatsapp|");
  expect(notices[0]).toContain(GROUP);
  expect(notices[0]).toContain(`>whatsapp:${GROUP}`);
  // 触发时玩家正在返回主屏，不能自动打开 WhatsApp / 群聊
  expect(await phone.locator(".phone-screen").getAttribute("data-app")).toBe(
    "",
  );
  await expect(phone.locator(".whatsapp-ui")).toHaveCount(0);
  await expect(phone.locator(".wa-thread-profile")).toHaveCount(0);
  // 主屏 WhatsApp 图标角标 = 该 App 尚未清除的通知数（开场通知 + 本次群聊通知）
  const whatsappNotices = (s.notifications ?? []).filter((n: string) =>
    n.startsWith("@whatsapp|"),
  ).length;
  expect(whatsappNotices).toBeGreaterThanOrEqual(notices.length);
  const badge = phone
    .getByRole("button", { name: WHATSAPP, exact: true })
    .locator(".app-badge");
  await expect(badge).toHaveText(String(whatsappNotices));
});

// ─────────────────────────────────────────────────── 9 / 10 固定消息与无自动回复

test("验收9+10｜群聊出现 9 条固定消息（顺序/发信人一致），机主无自动回复", async ({
  page,
}) => {
  test.setTimeout(180000);
  const { phone } = await fullTrigger(page, "photos-first");
  await openGroup(phone);
  await waitPackDelivered(page);

  const s = await readState(page);
  const pk = s.playback["WA_LC_001"];
  expect(pk.messageIds).toEqual(LC_IDS);
  expect(pk.deliveredMessageIds).toEqual(LC_IDS);
  expect(pk.playbackStatus).toBe("completed");
  expect(pk.nextMessageIndex).toBe(9);
  expect(new Set(pk.deliveredMessageIds).size).toBe(9);
  expect(Object.values(s.messages ?? {}).flat()).toHaveLength(0);

  // 9 条消息在界面上的顺序、正文、发信人名字
  const packBubbles = phone.locator(
    ".skin-message.wa-fade .wa-group-bubble",
  );
  await expect(packBubbles).toHaveCount(9, { timeout: 20000 });
  const rendered = await packBubbles.evaluateAll((els) =>
    els.map((e) => ({
      sender: e.querySelector(".wa-group-sender")?.textContent?.trim() ?? "",
      body: e.querySelector(".skin-bubble")?.childNodes[0]?.textContent?.trim() ?? "",
    })),
  );
  for (let i = 0; i < PACK.length; i++) {
    expect(rendered[i].sender, `第 ${i + 1} 条发信人`).toBe(PACK[i].sender);
    expect(rendered[i].body, `第 ${i + 1} 条内容`).toBe(PACK[i].body);
  }
  // 机主不发送任何消息，也没有等待回复的输入框
  await expect(
    phone.locator(".skin-compose[data-awaiting-reply='1']"),
  ).toHaveCount(0);
  await expect(
    phone.locator(".skin-message.wa-fade.outgoing"),
  ).toHaveCount(0);
  expect(
    (await readState(page)).playback["WA_LC_001"].deliveredMessageIds.filter(
      (id: string) => !LC_IDS.includes(id),
    ),
  ).toEqual([]);
});

// ─────────────────────────────────────────────────── 11 动态时间戳

test("验收11｜9 条新消息共用触发时的真实本地时间，不出现预设故事时间", async ({
  page,
}) => {
  test.setTimeout(150000);
  const { phone, stampAt } = await fullTrigger(page, "notes-first");
  const s = await readState(page);
  const times: Record<string, string> = s.messageTimes ?? {};
  const stamps = LC_IDS.map((id) => times[id]);
  expect(stamps.every(Boolean), "9 条消息都必须有时间戳").toBe(true);
  expect(new Set(stamps).size, "9 条共用一个实际事件时间").toBe(1);
  const stamp = stamps[0];
  expect(stamp).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  expect([stampAt, localStamp()]).toContain(stamp);
  // 不是任何写死的故事时间（MIMI-001 的 2026-11-07 20:46 之类）
  expect(stamp.startsWith("2026-11-07 20:")).toBe(false);
  // 源数据用 @now 占位，真实时间只来自 Runtime.messageTimes
  const lc = story().work.data.whatsapp.filter((i: any) =>
    LC_IDS.includes(i.id),
  );
  expect(lc.map((i: any) => i.time)).toEqual(Array(9).fill("@now"));

  await openGroup(phone);
  await waitPackDelivered(page);
  const shownTimes = await phone
    .locator(".skin-message.wa-fade .wa-group-bubble .skin-bubble small")
    .allTextContents();
  expect(shownTimes).toHaveLength(9);
  for (const t of shownTimes) expect(t.trim()).toBe(stamp.slice(-5));
  expect((await readState(page)).messageTimes).toEqual(times);
});

// ─────────────────────────────────────────────────── 12 历史聊天不变

test("验收12｜已有历史聊天时间戳保持不变", async ({ page }) => {
  test.setTimeout(150000);
  const { phone } = await fullTrigger(page, "photos-first");
  const { raw, work } = story();
  const groupChat = raw.chats.find((c: any) => c.id === "wa-late-checkout");
  const history = groupChat.messages.filter(
    (m: any) => !m.hidden && !LC_IDS.includes(m.id),
  );
  expect(history.length).toBeGreaterThan(80);
  // 编译产物的历史时间逐条与源数据一致（事件消息除外）
  for (const m of history) {
    const compiled = work.data.whatsapp.find((i: any) => i.id === m.id);
    expect(compiled.time).toBe(m.time);
  }
  const s = await readState(page);
  const times = s.messageTimes ?? {};
  expect(Object.keys(times).sort()).toEqual([...LC_IDS].sort());
  for (const m of history) expect(times[m.id]).toBeUndefined();

  await openGroup(phone);
  await expect(
    phone.locator(".skin-message", { hasText: history[0].body }).first(),
  ).toContainText(history[0].time.slice(-5));
});

// ─────────────────────────────────────────────────── 13 玩家发送时间

test("验收13｜玩家点击发送时才为发出的消息生成真实本地时间", async ({
  page,
}) => {
  test.setTimeout(180000);
  const { phone } = await prepare(page, {
    ep00: true,
    mimiAwaiting: true,
  });
  const outgoingId = MIMI_IDS[1];
  let s = await readState(page);
  expect(s.messageTimes?.[outgoingId]).toBeUndefined();

  await openApp(phone, WHATSAPP);
  await expect(phone.locator(".whatsapp-ui")).toBeVisible({ timeout: 15000 });
  await phone.locator(".wa-chat-row", { hasText: MIMI }).first().click();
  await waitAwaitingReply(phone);
  s = await readState(page);
  // 自动打字 / 等待回复阶段不生成发送时间
  expect(s.messageTimes?.[outgoingId]).toBeUndefined();

  const stampAt = localStamp();
  await sendPresetReply(page, phone, async () =>
    (await readState(page)).playback as PlaybackMap,
  );
  s = await readState(page);
  const sent = s.messageTimes?.[outgoingId];
  expect(sent).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  expect([stampAt, localStamp()]).toContain(sent);
  // 源数据里的 2026-11-07 20:47 不再作为发送时间
  expect(sent).not.toBe("2026-11-07 20:47");
  expect(s.playback["MIMI-001"].deliveredMessageIds).toContain(outgoingId);

  // 刷新后该发送时间保持不变
  await page.reload();
  await unlockPhone(phone);
  expect((await readState(page)).messageTimes?.[outgoingId]).toBe(sent);
});

// ─────────────────────────────────────────────────── 14 持久化与去重

test("验收14｜刷新、离开、重新进入后不重复投递，消息时间戳不变", async ({
  page,
}) => {
  test.setTimeout(180000);
  const { phone } = await fullTrigger(page, "notes-first");
  // 刚触发、还没读群聊时只有一条本次事件通知
  const atTrigger = await readState(page);
  expect(
    (atTrigger.notifications ?? []).filter((n: string) =>
      n.includes(PACK[0].body),
    ).length,
  ).toBe(1);

  await openGroup(phone);
  await waitPackDelivered(page);
  const first = await readState(page);
  const times = first.messageTimes;
  // 打开会话 = 已读：按既有逻辑清除该会话通知
  expect(
    (first.notifications ?? []).filter((n: string) =>
      n.includes(PACK[0].body),
    ).length,
  ).toBe(0);

  // 离开群聊再回来
  await openApp(phone, WHATSAPP);
  await openGroup(phone);
  await expect(
    phone.locator(".skin-message.wa-fade .wa-group-bubble"),
  ).toHaveCount(9);
  let s = await readState(page);
  expect(s.playback["WA_LC_001"].deliveredMessageIds).toEqual(LC_IDS);
  expect(s.messageTimes).toEqual(times);
  expect(s.completed.filter((x: string) => x === "WA_LC_001")).toHaveLength(1);

  // 刷新页面、重新解锁、再进群聊
  await page.reload();
  await unlockPhone(phone);
  await openGroup(phone);
  await expect(
    phone.locator(".skin-message.wa-fade .wa-group-bubble"),
  ).toHaveCount(9);
  s = await readState(page);
  expect(s.playback["WA_LC_001"].deliveredMessageIds).toEqual(LC_IDS);
  expect(s.playback["WA_LC_001"].playbackStatus).toBe("completed");
  expect(s.messageTimes).toEqual(times);
  expect(s.variables?.notes_reviewed).toBe(true);
  expect(s.variables?.photos_reviewed).toBe(true);
  expect(s.completed.filter((x: string) => x === "WA_LC_001")).toHaveLength(1);
  // 重复进入 / 刷新都不得重新发出本次事件通知
  expect(
    (s.notifications ?? []).filter((n: string) => n.includes(PACK[0].body))
      .length,
  ).toBe(0);
});

// ─────────────────────────────────────────────────── 15 无时间驱动触发

test("验收15｜本事件不使用故事时间、倒计时或后台定时器", async ({ page }) => {
  test.setTimeout(120000);
  const { raw } = story();
  const node = raw.events.find((e: any) => e.id === "WA_LC_001");
  expect(node.event).toBe("home");
  expect(node.once).toBe(true);
  expect(node.delayMs).toBeUndefined();
  expect(node.type).not.toBe("delay");
  expect(["time", "timer", "date"]).not.toContain(node.event);
  for (const a of node.actions ?? [])
    expect(["time", "date", "delay"]).not.toContain(a.type);
  for (const c of node.conditions ?? []) {
    expect(c.key).not.toMatch(/time|date|clock|elapsed/i);
    expect(String(c.value)).not.toMatch(/^\d{4}-\d{2}-\d{2}/);
  }
  // 校验层仍然禁止时钟 / 定时器事件
  const validator = readFileSync("scripts/story.mjs", "utf8");
  expect(validator).toContain('n.event === "time" || n.event === "timer"');

  const { phone } = await prepare(page, { notes: false, photos: false });
  // 只等待、不操作，不得自动触发（advance 每秒推进仍不会命中 home 事件）
  await page.waitForTimeout(2600);
  await notTriggered(page);
  const s = await readState(page);
  expect(s.scheduled ?? []).toEqual([]);
  expect((s.trace ?? []).filter((t: string) => /^(timer|time):/.test(t))).toEqual(
    [],
  );
  await expect(phone.locator(".phone-screen")).toBeVisible();
});

// ─────────────────────────────────────────────────── 附加静态约束

test("验收S｜9 条固定消息零改写、稳定 ID、复用既有成员且不新建联系人", async () => {
  const { raw, work } = story();
  const chat = raw.chats.find((c: any) => c.id === "wa-late-checkout");
  const lc = chat.messages.filter((m: any) => LC_IDS.includes(m.id));
  expect(lc.map((m: any) => m.id)).toEqual(LC_IDS);
  expect(lc.map((m: any) => m.sender)).toEqual(PACK.map((r) => r.sender));
  expect(lc.map((m: any) => m.body)).toEqual(PACK.map((r) => r.body));
  expect(lc.map((m: any) => m.time)).toEqual(Array(9).fill("@now"));
  for (const m of lc) {
    expect(m.hidden).toBe(true);
    expect(m.outgoing).toBe(false);
    expect(["keyboard_c", "drummer_a", "lingling"]).toContain(m.senderId);
    expect(chat.participants).toContain(m.senderId);
  }
  // 联系人集合没有新增重复成员
  const ids = raw.contacts.map((c: any) => c.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids).toContain("lingling");
  expect(ids).toContain("keyboard_c");
  expect(ids).toContain("drummer_a");
  // 编译后 9 条消息带齐既有群聊身份信息，没有新建会话
  const compiled = work.data.whatsapp.filter((i: any) => LC_IDS.includes(i.id));
  expect(compiled).toHaveLength(9);
  expect(new Set(compiled.map((i: any) => i.meta.conversationId)).size).toBe(1);
  expect(compiled[0].meta.conversationId).toBe("wa-late-checkout");
  expect(new Set(compiled.map((i: any) => i.title)).size).toBe(1);
  expect(compiled[0].title).toBe(GROUP);
  // 整个群聊历史 86 条 + 事件 9 条，原有顺序不变
  expect(chat.messages.length).toBe(95);
  expect(chat.messages.slice(0, 86).some((m: any) => LC_IDS.includes(m.id))).toBe(
    false,
  );
  // 事件节点：6 个条件、9 个 unlock、1 个变量、1 个通知
  const node = raw.events.find((e: any) => e.id === "WA_LC_001");
  expect(node.conditions.map((c: any) => c.key)).toEqual([
    "completed:WA_EP00_COMPLETE",
    "WA_EP00_DIALOGUE_COMPLETE",
    "playback:MIMI-001",
    "notes_reviewed",
    "photos_reviewed",
    "WA_LC_001_TRIGGERED",
  ]);
  expect(node.actions.filter((a: any) => a.type === "unlock")).toHaveLength(9);
  expect(node.actions.filter((a: any) => a.type === "notification")).toHaveLength(
    1,
  );
  expect(node.actions.filter((a: any) => a.type === "variable")).toEqual([
    { type: "variable", key: "WA_LC_001_TRIGGERED", value: true },
  ]);
});
