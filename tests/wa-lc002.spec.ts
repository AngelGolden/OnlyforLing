import { test, expect, type Locator, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { compileStory } from "../src/story-engine/compiler";
import { sendPresetReply, type PlaybackMap } from "./fixtures/wa-playback";

/**
 * WA_LC_002｜想當面說的話：最终私聊事件验收。
 * 46 条消息原文独立于 scripts/import-wa-lc002.mjs，重新解析用户规格第四章，
 * 避免「自己验证自己」。
 */
const SPEC = "data/wa-lc002/想當面說的話.txt";
const ROW_RE = /^(\d+)\.\s+\*\*(.+?)：\*\*\s*(.+?)\s*$/;
type Row = { no: number; sender: string; body: string };

function parseRows(): Row[] {
  const lines = readFileSync(SPEC, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith("## 四、固定对话内容"));
  const end = lines.findIndex((l, i) => i > start && l.startsWith("## 五、"));
  if (start < 0 || end < 0) throw new Error("规格第四章/第五章定位失败");
  const rows: Row[] = [];
  for (const line of lines.slice(start, end)) {
    const m = ROW_RE.exec(line);
    if (!m) continue;
    rows.push({ no: Number(m[1]), sender: m[2], body: m[3] });
  }
  if (rows.length !== 46)
    throw new Error(`规格第四章应有 46 条固定消息，实际 ${rows.length} 条`);
  rows.forEach((r, i) => {
    if (r.no !== i + 1) throw new Error(`第 ${i + 1} 行顺序异常：${r.no}`);
    if (r.sender !== "鄺學姐" && r.sender !== "机主")
      throw new Error(`第 ${r.no} 条发送者异常：${r.sender}`);
  });
  return rows;
}
const ROWS = parseRows();
const pad = (n: number) => String(n).padStart(2, "0");
const LC1_IDS = Array.from({ length: 9 }, (_, i) => `msg_lc001_${pad(i + 1)}`);
const LC2_IDS = Array.from({ length: 46 }, (_, i) => `msg_lc002_${pad(i + 1)}`);
const MIMI_IDS = Array.from(
  { length: 14 },
  (_, i) => `msg_mimi001_${pad(i + 1)}`,
);
const OWNER_IDS = LC2_IDS.filter((_, i) => ROWS[i].sender === "机主");
const PEER_IDS = LC2_IDS.filter((_, i) => ROWS[i].sender === "鄺學姐");
const GROUP = "Late Checkout 🎸";
const LINGLING = "邝学姐 💙";
const MIMI = "Mimi 🧋";
const WHATSAPP = "打开WhatsApp";
const FIRST_BODY = ROWS[0].body;
const LAST_BODY = ROWS[45].body;

let cachedWork: any = null;
let cachedRaw: any = null;
function story() {
  if (!cachedRaw)
    cachedRaw = JSON.parse(readFileSync("stories/template/story.json", "utf8"));
  if (!cachedWork) cachedWork = compileStory(cachedRaw).work;
  return { raw: cachedRaw, work: cachedWork };
}
const PIN = String(story().raw.phone?.passcode ?? "");

function localStamp(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
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
const readPlayback = async (page: Page): Promise<PlaybackMap> =>
  (await readState(page)).playback ?? {};

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

type Seed = {
  /** WA_LC_001 是否已成功触发 */
  lc1Triggered?: boolean;
  /** WA_LC_001 的 9 条群聊消息已播放条数（<9 表示没看完） */
  lc1Delivered?: number;
};

/**
 * 跳过耗时的开场 / MIMI-001 14 条对话与 Notes / Photos 浏览，直接把
 * WA_LC_001 阶段的状态写回存档；之后的「打开群聊 → 播完 9 条 → 返回主屏」
 * 全部走真实 UI 操作，不用写状态伪造触发。
 */
async function prepare(page: Page, seed: Seed = {}) {
  const lc1Triggered = seed.lc1Triggered ?? true;
  const lc1Delivered = seed.lc1Delivered ?? 0;
  const phone = await loadPhone(page);
  const s = structuredClone(await readState(page));
  s.completed = [
    ...(s.completed ?? []).filter(
      (x: string) => x !== "WA_LC_001" && x !== "WA_LC_002",
    ),
    "WA_EP00_COMPLETE",
    ...(lc1Triggered ? ["WA_LC_001"] : []),
  ];
  s.variables = {
    ...(s.variables ?? {}),
    WA_EP00_DIALOGUE_COMPLETE: true,
    MIMI_001_TRIGGERED: true,
    notes_reviewed: true,
    photos_reviewed: true,
    WA_LC_001_TRIGGERED: lc1Triggered,
    WA_LC_001_READ_COMPLETE: false,
    WA_LC_002_TRIGGERED: false,
  };
  s.playback = {
    "MIMI-001": {
      eventId: "MIMI-001",
      playbackStatus: "completed",
      nextMessageIndex: 14,
      deliveredMessageIds: [...MIMI_IDS],
      messageIds: [...MIMI_IDS],
      appId: "whatsapp",
      thread: MIMI,
      order: 0,
    },
    ...(lc1Triggered
      ? {
          "WA_LC_001": {
            eventId: "WA_LC_001",
            playbackStatus: lc1Delivered >= 9 ? "completed" : "playing",
            nextMessageIndex: lc1Delivered,
            deliveredMessageIds: LC1_IDS.slice(0, lc1Delivered),
            messageIds: [...LC1_IDS],
            appId: "whatsapp",
            thread: GROUP,
            order: 1,
          },
        }
      : {}),
  };
  s.unlocked = [
    ...new Set<string>([
      ...(s.unlocked ?? []),
      ...MIMI_IDS,
      // WA_LC_001 真实触发时用 9 个 unlock 动作一次性解锁整包消息，与「已送达几条」无关。
      // 这里必须等价还原，否则 hidden 消息不进 AppContent.items，PackReveal 的剧本为空，
      // 群聊 9 条永远不会开始播放（visible() 要求 hidden 项已在 s.unlocked）。
      ...(lc1Triggered ? LC1_IDS : []),
    ]),
  ];
  s.visited = [...new Set<string>([...(s.visited ?? []), "whatsapp"])];
  s.messageTimes = {};
  s.notifications = [];
  s.ui = {
    ...(s.ui ?? {}),
    whatsapp: { ...(s.ui?.whatsapp ?? {}), waReplyDraft: "" },
  };
  await writeState(page, s);
  await page.reload();
  await unlockPhone(phone);
  return { phone, stampAt: localStamp() };
}

async function goHome(phone: Locator) {
  await phone.getByRole("button", { name: "返回桌面", exact: true }).click();
}

async function openWhatsApp(phone: Locator) {
  await goHome(phone);
  await phone.getByRole("button", { name: WHATSAPP, exact: true }).click();
  await expect(phone.locator(".whatsapp-ui")).toBeVisible({ timeout: 15000 });
}

async function openThread(phone: Locator, title: string) {
  const row = phone.locator(".wa-chat-row", { hasText: title }).first();
  await expect(row).toBeVisible({ timeout: 15000 });
  await row.click();
}

async function waitDelivered(page: Page, eventId: string, n: number) {
  await expect
    .poll(
      async () =>
        (await readState(page))?.playback?.[eventId]?.deliveredMessageIds
          ?.length ?? 0,
      { timeout: 90000 },
    )
    .toBe(n);
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

const notTriggered = async (page: Page) => {
  const s = await readState(page);
  expect(s.completed).not.toContain("WA_LC_002");
  expect(s.variables?.WA_LC_002_TRIGGERED).toBe(false);
  expect(s.playback?.["WA_LC_002"]).toBeUndefined();
  expect(
    (s.notifications ?? []).filter((n: string) => n.includes(FIRST_BODY)),
  ).toHaveLength(0);
  return s;
};

const triggered = (page: Page) =>
  expect
    .poll(async () => (await readState(page))?.variables?.WA_LC_002_TRIGGERED, {
      timeout: 15000,
    })
    .toBe(true);

/** 真实走完 WA_LC_001 的收尾：打开群聊 → 9 条自动播完 → 返回主屏触发。 */
async function fullTrigger(page: Page) {
  const { phone, stampAt } = await prepare(page);
  await openWhatsApp(phone);
  await openThread(phone, GROUP);
  await waitDelivered(page, "WA_LC_001", 9);
  expect((await readState(page)).playback["WA_LC_001"].playbackStatus).toBe(
    "completed",
  );
  // 群聊消息刚投递完、还没返回主屏时，绝不能提前触发 WA_LC_002。
  const beforeHome = await notTriggered(page);
  expect(beforeHome.variables?.WA_LC_001_READ_COMPLETE).toBe(false);
  await goHome(phone);
  await triggered(page);
  return { phone, stampAt };
}

// ─────────────────────────────────────────────── 验收S 静态：46 条零改写

test("验收S｜46 条固定消息逐字一致、稳定 ID、沿用学姐会话与既有通知机制", async () => {
  const { raw, work } = story();
  const chat = raw.chats.find((c: any) => c.id === "wa-lingling");
  expect(chat.title).toBe(LINGLING);
  expect(chat.participants).toEqual(["owner", "lingling"]);
  const rows = chat.messages.filter((m: any) =>
    String(m.id).startsWith("msg_lc002_"),
  );
  expect(rows).toHaveLength(46);
  expect(rows.map((m: any) => m.id)).toEqual(LC2_IDS);
  expect(rows.map((m: any) => m.body)).toEqual(ROWS.map((r) => r.body));
  expect(rows.map((m: any) => m.time)).toEqual(Array(46).fill("@now"));
  expect(rows.every((m: any) => m.hidden === true)).toBe(true);
  for (let i = 0; i < 46; i++) {
    const owner = ROWS[i].sender === "机主";
    expect(rows[i].senderId, `第 ${i + 1} 条发信人`).toBe(
      owner ? "owner" : "lingling",
    );
    expect(rows[i].outgoing, `第 ${i + 1} 条 outgoing`).toBe(owner);
    if (!owner) expect(rows[i].sender).toBe("鄺學姐");
    expect(rows[i].meta?.sourceId).toBeUndefined();
  }
  expect(rows.at(-1).body).toBe("你願意和我一起把它實現嗎？");
  // 既有私聊历史（319 条）与三组静态历史逐字保持原样，只在末尾追加
  // WA_LC_002 的 46 条 + 电话模块的 2 条 + 音乐模块的 5 条 +
  // WA_DOUYIN_001 的 4 条 hidden 事件消息。
  expect(chat.messages.length).toBe(376);
  expect(
    chat.messages.slice(0, 319).some((m: any) =>
      String(m.id).startsWith("msg_lc002_"),
    ),
  ).toBe(false);
  expect(raw.chats.find((c: any) => c.id === "wa-late-checkout").messages)
    .toHaveLength(95);
  // 联系人集合没有新增重复成员，名称 / 头像不改。
  const ids = raw.contacts.map((c: any) => c.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids.filter((x: string) => x === "lingling")).toHaveLength(1);
  // 编译产物 46 条都在同一个现有会话里，且不进静态历史渲染路径。
  const compiled = work.data.whatsapp.filter((i: any) =>
    LC2_IDS.includes(i.id),
  );
  expect(compiled).toHaveLength(46);
  expect(new Set(compiled.map((i: any) => i.title)).size).toBe(1);
  expect(compiled[0].title).toBe(LINGLING);
  expect(new Set(compiled.map((i: any) => i.meta.conversationId)).size).toBe(1);
  expect(compiled[0].meta.conversationId).toBe("wa-lingling");
  expect(compiled.map((i: any) => i.body)).toEqual(ROWS.map((r) => r.body));
  expect(compiled.map((i: any) => i.time)).toEqual(Array(46).fill("@now"));
  expect(compiled.filter((i: any) => i.outgoing)).toHaveLength(16);
  // 事件节点：沿用导航事件 + 既有完成态 / 已访问状态，once 防重复。
  const node = raw.events.find((e: any) => e.id === "WA_LC_002");
  expect(node.event).toBe("wa_lc001_read");
  expect(node.target).toBe("whatsapp");
  expect(node.once).toBe(true);
  expect(node.type).toBe("event");
  expect(node.conditions.map((c: any) => c.key)).toEqual([
    "completed:WA_LC_001",
    "visited:whatsapp",
    "playback:WA_LC_001",
    "WA_LC_002_TRIGGERED",
  ]);
  expect(node.actions.filter((a: any) => a.type === "unlock")).toHaveLength(46);
  expect(
    node.actions
      .filter((a: any) => a.type === "unlock")
      .map((a: any) => a.key),
  ).toEqual(LC2_IDS);
  expect(node.actions.filter((a: any) => a.type === "variable")).toEqual([
    { type: "variable", key: "WA_LC_001_READ_COMPLETE", value: true },
    { type: "variable", key: "WA_LC_002_TRIGGERED", value: true },
  ]);
  const notice = node.actions.find((a: any) => a.type === "notification");
  expect(notice).toEqual({
    type: "notification",
    key: "whatsapp",
    value:
      `@whatsapp|now|${LINGLING}|${FIRST_BODY}|>whatsapp:${LINGLING}`,
  });
  // 既有节点 / 历史聊天时间戳没有被改写；电话模块 +1 节点、+2 学姐 hidden 消息。
  expect(raw.events).toHaveLength(14);
  expect(work.nodes).toHaveLength(14);
  expect(work.data.whatsapp).toHaveLength(768);
  expect(raw.content.phone).toHaveLength(9);
  expect(raw.events.find((e: any) => e.id === "WA_LC_001")).toBeTruthy();
  for (const c of raw.chats) {
    const historical = c.messages.filter(
      (m: any) => !m.hidden && !String(m.id).startsWith("msg_lc00"),
    );
    for (const m of historical) {
      const it = work.data.whatsapp.find((x: any) => x.id === m.id);
      if (it) expect(it.time, `历史消息 ${m.id} 时间被改写`).toBe(m.time);
    }
  }
});

// ─────────────────────────────────────────────── 验收1 / 2 不提前触发

test("验收1｜WA_LC_001 尚未触发时，看完群聊返回主屏也不能触发 WA_LC_002", async ({
  page,
}) => {
  test.setTimeout(180000);
  const { phone } = await prepare(page, { lc1Triggered: false });
  await openWhatsApp(phone);
  await openThread(phone, GROUP);
  expect((await readState(page)).playback?.["WA_LC_001"]).toBeUndefined();
  await goHome(phone);
  const s = await notTriggered(page);
  expect(s.completed).not.toContain("WA_LC_001");
  expect(s.variables?.WA_LC_001_TRIGGERED).toBe(false);
  expect(s.variables?.WA_LC_002_TRIGGERED).toBe(false);
  expect(s.unlocked?.filter((id: string) => LC2_IDS.includes(id))).toEqual([]);
});

test("验收2｜WA_LC_001 已触发但 9 条群聊消息没看完时，返回主屏不触发", async ({
  page,
}) => {
  test.setTimeout(180000);
  // 只播了 3 条就离开：playback:WA_LC_001 仍是 playing，不满足触发条件。
  const { phone } = await prepare(page, { lc1Delivered: 3 });
  await openWhatsApp(phone);
  // 停在聊天列表，未进入群聊把剩余 6 条看完。
  await goHome(phone);
  const s = await notTriggered(page);
  expect(s.completed).toContain("WA_LC_001");
  expect(s.playback["WA_LC_001"].playbackStatus).toBe("playing");
  expect(s.playback["WA_LC_001"].deliveredMessageIds).toEqual(
    LC1_IDS.slice(0, 3),
  );
  expect(s.variables?.WA_LC_001_READ_COMPLETE).toBe(false);
});

// ─────────────────────────────────────────────── 验收3 / 4 触发与通知

test("验收3+4｜看完 9 条群聊并返回主屏后出现学姐私聊通知，且不强制跳转", async ({
  page,
}) => {
  test.setTimeout(240000);
  const { phone } = await fullTrigger(page);
  const s = await readState(page);
  const notices = (s.notifications ?? []).filter((n: string) =>
    n.includes(FIRST_BODY),
  );
  expect(notices).toHaveLength(1);
  // story.json 里是 `|now|` 占位；alignNow() 在开屏时把它替换成真实设备本地 HH:MM。
  // 因此运行时断言必须校验「时间确为当下」，而不是死比对字符串 now。
  const hhmm = notices[0].split("|")[1];
  expect(hhmm).toMatch(/^\d{2}:\d{2}$/);
  expect(
    Math.abs(toMinutes(hhmm) - toMinutes(localStamp().slice(-5))),
    "通知时间必须是刚收到的真实本地时刻",
  ).toBeLessThanOrEqual(1);
  expect(notices[0]).toBe(
    `@whatsapp|${hhmm}|${LINGLING}|${FIRST_BODY}|>whatsapp:${LINGLING}`,
  );
  expect(s.variables?.WA_LC_001_READ_COMPLETE).toBe(true);
  expect(s.variables?.WA_LC_002_TRIGGERED).toBe(true);
  expect(s.completed.filter((x: string) => x === "WA_LC_002")).toHaveLength(1);
  const pack = s.playback["WA_LC_002"];
  expect(pack.messageIds).toEqual(LC2_IDS);
  expect(pack.deliveredMessageIds).toEqual([]);
  expect(pack.playbackStatus).toBe("pending");
  expect(pack.appId).toBe("whatsapp");
  expect(pack.thread).toBe(LINGLING);
  expect(s.unlocked?.filter((id: string) => LC2_IDS.includes(id))).toHaveLength(
    46,
  );
  // 不强制跳转：仍处于主屏，没有自动打开 WhatsApp 或学姐私聊。
  expect(await phone.locator(".phone-screen").getAttribute("data-app")).toBe(
    "",
  );
  await expect(phone.locator(".whatsapp-ui")).toHaveCount(0);
  await expect(phone.locator(".wa-thread-profile")).toHaveCount(0);
});

// ─────────────────── 验收5 / 9 / 10 / 11 / 12 / 13 / 14 / 16 完整对话

test("验收5+9+10+11+12+13+14+16｜46 条按序播放、逐条手动发送、中途恢复、最终状态与防重", async ({
  page,
}) => {
  test.setTimeout(600000);
  const { phone } = await fullTrigger(page);
  await openWhatsApp(phone);
  await openThread(phone, LINGLING);
  await expect(phone.locator(".wa-thread-profile")).toBeVisible();

  // 验收5：进入会话前 / 刚进入时，46 条不能一次性写进聊天历史。
  const early = await readState(page);
  expect(early.playback["WA_LC_002"].deliveredMessageIds.length).toBeLessThan(
    46,
  );
  const bubbles = phone.locator(".skin-messages .skin-bubble");
  expect(
    await bubbles.filter({ hasText: LAST_BODY }).count(),
    "最后一条台词不能在开场就出现",
  ).toBe(0);

  const repliesSeen: string[] = [];
  let resumed = false;
  let done = false;
  for (let step = 0; step < 500; step++) {
    const state = await readState(page);
    let delivered =
      state.playback?.["WA_LC_002"]?.deliveredMessageIds?.length ?? 0;
    if (delivered === 46) {
      done = true;
      break;
    }
    const awaiting = await phone
      .locator(".skin-compose[data-awaiting-reply='1']")
      .count();
    if (!awaiting) {
      await page.waitForTimeout(250);
      continue;
    }
    // UI 的 awaiting 已停在某条机主预设回复上，但 IndexedDB 写回是异步的：
    // 全量回归负载高时偶发读到滞后一帧的 delivered，会把下一条错认成对方消息。
    // 这里等存档游标也指向机主回复（或剧本已结束）再推进，避免测试自身 flake。
    for (let w = 0; w < 80; w++) {
      const synced = await readState(page);
      delivered =
        synced.playback?.["WA_LC_002"]?.deliveredMessageIds?.length ?? 0;
      if (delivered === 46 || ROWS[delivered]?.sender === "机主") break;
      await page.waitForTimeout(250);
    }
    if (delivered === 46) {
      done = true;
      break;
    }
    const nextId = LC2_IDS[delivered];
    expect(ROWS[delivered].sender, `第 ${delivered + 1} 条应为机主回复`).toBe(
      "机主",
    );
    repliesSeen.push(nextId);

    if (nextId === "msg_lc002_05" && !resumed) {
      // 验收11：打字完成但不发送就退出，重进后草稿与进度恢复，不自动发送。
      resumed = true;
      const field = phone.locator(".native-compose-field");
      await field.click();
      await expect(
        phone.locator(".skin-compose[data-reply-phase='draft_ready']"),
      ).toBeVisible({ timeout: 30000 });
      expect((await field.textContent())?.trim()).toBe(ROWS[4].body);
      // 验收12 / 6.5：自动打字阶段不生成该条的发送时间。
      expect(
        (await readState(page)).messageTimes?.[nextId],
        "未点击发送前不得生成发送时间",
      ).toBeUndefined();
      await goHome(phone);
      expect((await readState(page)).playback["WA_LC_002"].deliveredMessageIds)
        .toHaveLength(delivered);
      await openWhatsApp(phone);
      await openThread(phone, LINGLING);
      await expect(
        phone.locator(".skin-compose[data-reply-phase='draft_ready']"),
      ).toBeVisible({ timeout: 20000 });
      expect(
        (await phone.locator(".native-compose-field").textContent())?.trim(),
      ).toBe(ROWS[4].body);
      await phone.getByRole("button", { name: "发送消息" }).click();
      await expect
        .poll(
          async () =>
            (await readState(page)).playback["WA_LC_002"].deliveredMessageIds
              .length,
          { timeout: 20000 },
        )
        .toBe(delivered + 1);
      continue;
    }

    // 验收9 / 10：每条机主消息都要「点输入框 → 自动逐字填入 → 点发送」。
    await sendPresetReply(
      page,
      phone,
      () => readPlayback(page),
      ROWS[delivered].body,
    );
    const after = await readState(page);
    expect(
      after.playback["WA_LC_002"].deliveredMessageIds.length,
      `${nextId} 一次发送只能推进一条`,
    ).toBe(delivered + 1);
    expect(after.playback["WA_LC_002"].deliveredMessageIds.at(-1)).toBe(nextId);
    // 验收12：机主消息在真正点击发送时生成设备本地时间。
    const t = after.messageTimes?.[nextId];
    expect(t, `${nextId} 必须有发送时间`).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/,
    );
    expect(t.slice(0, 10)).toBe(localStamp().slice(0, 10));
  }
  expect(done, "46 条剧本必须在限定步数内播完").toBe(true);

  // 验收9 / 10：16 条机主预设回复逐条各操作一次，连续段没有合并或自动发送。
  expect(repliesSeen).toEqual(OWNER_IDS);
  expect(OWNER_IDS).toHaveLength(16);
  expect(new Set(repliesSeen).size).toBe(16);
  // 连续段分别验证：5-8、16-17、19-21。
  for (const group of [
    ["msg_lc002_05", "msg_lc002_06", "msg_lc002_07", "msg_lc002_08"],
    ["msg_lc002_16", "msg_lc002_17"],
    ["msg_lc002_19", "msg_lc002_20", "msg_lc002_21"],
  ]) {
    const at = repliesSeen.indexOf(group[0]);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(repliesSeen.slice(at, at + group.length)).toEqual(group);
  }

  const final = await readState(page);
  const pack = final.playback["WA_LC_002"];
  // 验收14 / 七：最后一条停在「你願意和我一起把它實現嗎？」并进入完成态。
  expect(pack.playbackStatus).toBe("completed");
  expect(pack.deliveredMessageIds).toEqual(LC2_IDS);
  expect(pack.deliveredMessageIds.at(-1)).toBe("msg_lc002_46");
  const allBubbles = await bubbles.allTextContents();
  expect(allBubbles.at(-1)).toContain(LAST_BODY);
  expect(allBubbles.at(-1)).not.toContain(FIRST_BODY);
  expect(
    await phone.locator(".skin-compose[data-awaiting-reply='1']").count(),
  ).toBe(0);

  // 验收12 / 13：时间戳只用真实本地时间，静态历史时间不受影响。
  const times = final.messageTimes ?? {};
  expect(Object.keys(times).sort()).toEqual([...LC2_IDS].sort());
  for (const id of PEER_IDS) {
    expect(times[id]).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(times[id].slice(0, 10)).toBe(localStamp().slice(0, 10));
    expect(times[id], "不得伪造故事时间").not.toMatch(/^2026-11-07 20:/);
  }
  for (const id of OWNER_IDS) {
    expect(times[id]).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  }
  const { raw, work } = story();
  for (const c of raw.chats) {
    for (const m of c.messages.filter((x: any) => !x.hidden)) {
      const it = work.data.whatsapp.find((x: any) => x.id === m.id);
      if (it) expect(it.time, `历史消息 ${m.id} 时间被改写`).toBe(m.time);
      expect(times[m.id], `历史消息 ${m.id} 不得生成新时间戳`).toBeUndefined();
    }
  }

  // 验收16：刷新、退出手机、重进后不重复触发 / 不重播，最终完成态保持。
  const fingerprint = (s: any) =>
    JSON.stringify({
      completed: (s.completed ?? []).filter((x: string) =>
        x.startsWith("WA_LC_"),
      ),
      triggered: s.variables?.WA_LC_002_TRIGGERED,
      readComplete: s.variables?.WA_LC_001_READ_COMPLETE,
      delivered: s.playback?.["WA_LC_002"]?.deliveredMessageIds,
      status: s.playback?.["WA_LC_002"]?.playbackStatus,
      times: s.messageTimes,
      unlockedLc2: (s.unlocked ?? []).filter((id: string) =>
        LC2_IDS.includes(id),
      ),
    });
  const before = fingerprint(final);
  const bubblesBefore = allBubbles.length;
  await page.reload();
  await unlockPhone(phone);
  await openWhatsApp(phone);
  await openThread(phone, LINGLING);
  await expect(
    phone.locator(".skin-messages .skin-bubble"),
  ).toHaveCount(bubblesBefore, { timeout: 20000 });
  const reentered = await readState(page);
  expect(fingerprint(reentered)).toBe(before);
  expect(reentered.playback["WA_LC_002"].playbackStatus).toBe("completed");
  expect(
    (reentered.notifications ?? []).filter((n: string) =>
      n.includes(FIRST_BODY),
    ),
  ).toHaveLength(0);
  // 再从 WhatsApp 返回主屏：once + TRIGGERED 保证不重复触发 / 不重播。
  await goHome(phone);
  const afterHome = await readState(page);
  expect(fingerprint(afterHome)).toBe(before);
  expect(afterHome.completed.filter((x: string) => x === "WA_LC_002")).toHaveLength(
    1,
  );
});
