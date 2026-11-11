/**
 * WA_DOUYIN_001｜抖音八条视频浏览完成事件 · 第八章验收（10 项）+ 3 项补充。
 *
 * 四条台词、事件名称全部从规格逐字副本
 * data/douyin-wadouyin001/抖音浏览完成事件｜学姐发送 WhatsApp 消息.txt
 * 独立解析，不从导入脚本或实现文件自证。
 * 浏览、退出、刷新、通知跳转、消息播放全部走真实 UI / 真实 <video> / 真实
 * IndexedDB 存档，不直接改 Runtime 来「制造」通过。
 */
import { test, expect, type Locator, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { compileStory } from "../src/story-engine/compiler";

const SPEC = readFileSync(
  "data/douyin-wadouyin001/抖音浏览完成事件｜学姐发送 WhatsApp 消息.txt",
  "utf8",
).replace(/^\uFEFF/, "");
const LINES = SPEC.split(/\r?\n/);

const pick = (re: RegExp, label: string) => {
  const m = re.exec(SPEC);
  if (!m) throw new Error(`规格副本缺少：${label}`);
  return m[1].trim();
};
const EVENT_NAME = pick(/^(浏览完抖音八条视频后，.+?。)\s*$/m, "事件名称");

/** 第四章：`**第N条：**` 之后第一个非空行即台词，逐字照抄。 */
function parseBodies() {
  const start = LINES.findIndex((l) => l.startsWith("## 四、"));
  const end = LINES.findIndex((l) => l.startsWith("## 五、"));
  if (start < 0 || end < 0) throw new Error("规格第四 / 五章定位失败");
  const bodies: string[] = [];
  for (let i = start + 1; i < end; i++) {
    if (!/^\*\*第.+条：\*\*\s*$/.test(LINES[i])) continue;
    for (let j = i + 1; j < end; j++) {
      if (LINES[j].trim()) {
        bodies.push(LINES[j]);
        break;
      }
    }
  }
  if (bodies.length !== 4)
    throw new Error(`规格第四章应有 4 条消息，实际解析到 ${bodies.length} 条`);
  bodies.forEach((b, i) => {
    if (!b.trim() || b !== b.trim())
      throw new Error(`第 ${i + 1} 条台词为空或带前后空白`);
  });
  return bodies;
}
const BODIES = parseBodies();

const EVENT = "WA_DOUYIN_001";
const MSG_PREFIX = "msg_wa_douyin_001_";
const MSG_IDS = Array.from(
  { length: 4 },
  (_, i) => `${MSG_PREFIX}${String(i + 1).padStart(2, "0")}`,
);
const LINGLING = "邝学姐 💙";
const PEER = "鄺學姐";
const VIDEO_IDS = Array.from(
  { length: 8 },
  (_, i) => `dy_${String(i + 1).padStart(2, "0")}`,
);
const UI_TARGET = "ui:douyin:viewCompleted";

const raw = JSON.parse(readFileSync("stories/template/story.json", "utf8"));
const work = compileStory(raw).work;
const PIN = String(raw.phone?.passcode ?? "");

async function unlockPhone(phone: Locator) {
  await phone.getByRole("button", { name: "轻触解锁" }).click();
  for (const d of PIN)
    await phone.getByRole("button", { name: "密码键" + d }).click();
  await expect(
    phone.getByRole("button", { name: "搜索", exact: true }),
  ).toBeVisible({ timeout: 10000 });
}

async function openApp(phone: Locator, homeKey: string, root: string) {
  await phone.getByRole("button", { name: "返回桌面", exact: true }).click();
  await expect(async () => {
    const icon = phone.locator(`[data-home-key="${homeKey}"]`);
    await icon.scrollIntoViewIfNeeded();
    await icon.click();
  }).toPass({ timeout: 20000 });
  await expect(phone.locator(root)).toBeVisible({ timeout: 15000 });
}
const openDouyin = (phone: Locator) =>
  openApp(phone, "douyin", ".douyin-ui");
const openWhatsApp = (phone: Locator) =>
  openApp(phone, "whatsapp", ".whatsapp-ui");

async function loadDouyin(page: Page, opts: { failVideo?: string } = {}) {
  await page.route("**/work.json", (route) =>
    route.fulfill({ json: structuredClone(work) }),
  );
  if (opts.failVideo)
    await page.route(`**/dy-media/${opts.failVideo}`, (route) =>
      route.fulfill({ status: 404, body: "not found" }),
    );
  await page.goto("/?fresh=1");
  const phone = page.locator(".phone-shell");
  await unlockPhone(phone);
  await openDouyin(phone);
  return phone;
}

async function readState(page: Page): Promise<any> {
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
    return all[0]?.state ?? {};
  });
}
const progressOf = async (page: Page) => {
  const text = (await readState(page)).ui?.douyin?.viewProgress ?? "";
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
};
const noticesOf = async (page: Page) =>
  ((await readState(page)).notifications ?? []).filter((n: string) =>
    n.includes(BODIES[0]),
  );
const triggered = (page: Page) =>
  expect
    .poll(
      async () =>
        (await readState(page))?.variables?.WA_DOUYIN_001_TRIGGERED === true,
      { timeout: 20000, intervals: [200, 300, 500] },
    )
    .toBe(true);

const indexOf = (phone: Locator) =>
  phone.locator("[data-douyin-root]").getAttribute("data-douyin-index");

type VideoState = {
  videoWidth: number;
  videoHeight: number;
  readyState: number;
  paused: boolean;
};
async function videoState(page: Page, position: number): Promise<VideoState | null> {
  return page.evaluate((pos) => {
    const v = document.querySelectorAll<HTMLVideoElement>(".douyin-video")[
      pos - 1
    ];
    if (!v) return null;
    return {
      videoWidth: v.videoWidth,
      videoHeight: v.videoHeight,
      readyState: v.readyState,
      paused: v.paused,
    };
  }, position);
}
async function waitLoaded(page: Page, position: number) {
  await expect
    .poll(
      async () => {
        const v = await videoState(page, position);
        return !!v && v.videoWidth > 0 && v.videoHeight > 0 && v.readyState >= 2;
      },
      { timeout: 20000, intervals: [100, 200, 300] },
    )
    .toBe(true);
}

/** 首次完整浏览：逐条上滑，并等「该条已成功显示」的进度记录真正写进存档。 */
async function browseTo(page: Page, phone: Locator, target: number) {
  const root = phone.locator("[data-douyin-root]");
  for (let i = Number(await indexOf(phone)); i < target; i++) {
    await page.keyboard.press("ArrowDown");
    await expect(root).toHaveAttribute("data-douyin-index", String(i + 1));
    await expect(root).toHaveAttribute(
      "data-douyin-viewed-count",
      String(i + 2),
      { timeout: 25000 },
    );
  }
}

/** 只看画面是否加载，不要求进度推进：用于回看 / 重复浏览 / 失败资源。 */
async function scrollTo(page: Page, phone: Locator, target: number) {
  const root = phone.locator("[data-douyin-root]");
  let now = Number(await indexOf(phone));
  for (; now < target; now++) {
    await page.keyboard.press("ArrowDown");
    await expect(root).toHaveAttribute("data-douyin-index", String(now + 1));
    await waitLoaded(page, now + 2);
  }
  for (; now > target; now--) {
    await page.keyboard.press("ArrowUp");
    await expect(root).toHaveAttribute("data-douyin-index", String(now - 1));
    await waitLoaded(page, now);
  }
}

async function openChat(phone: Locator) {
  await openWhatsApp(phone);
  const row = phone.locator(".wa-chat-row", { hasText: LINGLING }).first();
  await expect(row).toBeVisible({ timeout: 15000 });
  await row.click();
  await expect(phone.locator(".wa-thread-profile")).toBeVisible();
  await expect(phone.locator(".wa-thread-profile")).toContainText("邝学姐");
}
const waitDelivered = (page: Page, n: number) =>
  expect
    .poll(
      async () =>
        (await readState(page)).playback?.[EVENT]?.deliveredMessageIds?.length ??
        0,
      { timeout: 90000, intervals: [200, 300, 500] },
    )
    .toBe(n);
/** 气泡第一个文本节点就是台词正文；<small> 里是时间，不能混进来。 */
const bubbleBodies = (phone: Locator) =>
  phone
    .locator(".skin-messages .skin-bubble")
    .evaluateAll((els) =>
      els.map((el) => (el.firstChild?.textContent ?? "").trim()),
    );

/** 模拟「存档里直接停在第 8 条」：卸载抖音后写 IndexedDB，再不带 fresh 重开。 */
async function seedLastVideo(page: Page, phone: Locator) {
  await phone.locator("[data-douyin-back]").click();
  await expect(phone.locator(".douyin-ui")).toHaveCount(0);
  await page.evaluate(async () => {
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
    const rec = all[0];
    if (!rec) throw new Error("存档不存在");
    rec.state.ui = {
      ...rec.state.ui,
      douyin: { ...(rec.state.ui?.douyin ?? {}), index: 7, viewProgress: "" },
    };
    await new Promise<void>((res, rej) => {
      const tx = db.transaction("saves", "readwrite");
      tx.objectStore("saves").put(rec);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  });
  await page.goto("/");
  await unlockPhone(phone);
  await openDouyin(phone);
  return phone;
}

// ─────────────────────────────── 静态：台词逐字、事件节点、其余数据零改动

test("验收S｜四条台词逐字导入，事件沿用既有 hidden+unlock 机制", () => {
  expect(EVENT_NAME).toBe("浏览完抖音八条视频后，学姐主动发来消息。");
  expect(BODIES).toEqual([
    "你呢 你鍾意香港嗎",
    "你鍾意香港啊",
    "香港都",
    "中意你",
  ]);
  const chat = raw.chats.find((c: any) => c.id === "wa-lingling");
  expect(chat.title).toBe(LINGLING);
  chat.messages.slice(-4).forEach((m: any, i: number) => {
    expect(m.id).toBe(MSG_IDS[i]);
    expect(m.body).toBe(BODIES[i]);
    expect(m.time).toBe("@now");
    expect(m.senderId).toBe("lingling");
    expect(m.sender).toBe(PEER);
    expect(m.outgoing).toBe(false);
    expect(m.hidden).toBe(true);
  });
  const node = raw.events.find((e: any) => e.id === EVENT);
  expect(node.label).toBe(EVENT_NAME);
  expect(node.type).toBe("event");
  expect(node.event).toBe("variable");
  expect(node.target).toBe(UI_TARGET);
  expect(node.once).toBe(true);
  expect(node.logic).toBe("and");
  expect(node.conditions).toEqual([
    { key: UI_TARGET, op: "eq", value: true },
    { key: "WA_DOUYIN_001_TRIGGERED", op: "neq", value: true },
  ]);
  expect(node.actions.slice(0, 4)).toEqual(
    MSG_IDS.map((id) => ({ type: "unlock", key: id, value: "" })),
  );
  expect(node.actions[4]).toEqual({
    type: "variable",
    key: "WA_DOUYIN_001_TRIGGERED",
    value: true,
  });
  expect(node.actions[5]).toEqual({
    type: "notification",
    key: "whatsapp",
    value: `@whatsapp|now|${LINGLING}|${BODIES[0]}|>whatsapp:${LINGLING}`,
  });
  expect(raw.variables.WA_DOUYIN_001_TRIGGERED).toBe(false);
  // 8 条视频与顺序不变，别的数据不被改写。
  expect(raw.content.douyin.map((i: any) => i.id)).toEqual(VIDEO_IDS);
  expect(raw.events).toHaveLength(14);
  expect(work.nodes).toHaveLength(14);
  expect(work.data.whatsapp).toHaveLength(768);
});

// ───────────────── 验收 1/2/3/4：前七条不触发、第八条投递、四条按序逐字

test("验收1/2/3/4｜前七条不触发，第八条投递，四条按序逐字呈现且保留繁体原文", async ({
  page,
}) => {
  test.setTimeout(180000);
  const phone = await loadDouyin(page);
  const root = phone.locator("[data-douyin-root]");
  await expect(root).toHaveAttribute("data-douyin-count", "8");
  await expect(root).toHaveAttribute("data-douyin-viewed-count", "1", {
    timeout: 25000,
  });
  // 验收1：第 1 到第 7 条都成功显示，但事件绝不触发。
  for (let pos = 1; pos <= 6; pos++) {
    await browseTo(page, phone, pos);
    const s = await readState(page);
    expect(s.variables?.WA_DOUYIN_001_TRIGGERED).toBe(false);
    expect(s.playback?.[EVENT]).toBeUndefined();
    expect(await noticesOf(page)).toHaveLength(0);
    expect((await progressOf(page)).viewedIds).toEqual(
      VIDEO_IDS.slice(0, pos + 1),
    );
  }
  expect(await root.getAttribute("data-douyin-view-completed")).toBe("false");

  // 验收2：第 8 条成功显示才触发一次。
  await browseTo(page, phone, 7);
  await triggered(page);
  await expect(root).toHaveAttribute("data-douyin-view-completed", "true");
  const s = await readState(page);
  expect(s.completed.filter((x: string) => x === EVENT)).toHaveLength(1);
  expect(s.playback[EVENT].messageIds).toEqual(MSG_IDS);
  expect(s.playback[EVENT].playbackStatus).toBe("pending");
  expect(s.playback[EVENT].deliveredMessageIds).toEqual([]);
  expect(s.unlocked.filter((id: string) => MSG_IDS.includes(id))).toHaveLength(4);
  const notices = await noticesOf(page);
  expect(notices).toHaveLength(1);
  expect(notices[0]).toContain(`|>whatsapp:${LINGLING}`);
  expect(notices[0].split("|")[1]).toMatch(/^\d{2}:\d{2}$/);
  // 不自动打开 WhatsApp；第 8 条视频仍在播放。
  await expect(phone.locator(".whatsapp-ui")).toHaveCount(0);
  expect((await videoState(page, 8))?.paused).toBe(false);

  // 验收3/4：四条独立气泡按序逐条呈现，文字逐字等于规格原文（繁体未改写）。
  await openChat(phone);
  const early = await readState(page);
  expect((early.playback[EVENT].deliveredMessageIds ?? []).length).toBeLessThan(4);
  await waitDelivered(page, 4);
  const bodies = await bubbleBodies(phone);
  expect(bodies.slice(-4)).toEqual(BODIES);
  expect(BODIES.map((b) => bodies.filter((x) => x === b).length)).toEqual([
    1, 1, 1, 1,
  ]);
  expect(BODIES[0]).toContain("鍾意");
  expect(BODIES[0]).toContain("嗎");
  expect(BODIES.join("")).not.toContain("钟");
  expect(BODIES.join("")).not.toContain("吗");
  const deliveredState = await readState(page);
  const times = MSG_IDS.map((id) => deliveredState.messageTimes?.[id]);
  expect(times.every((t) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(t ?? ""))).toBe(
    true,
  );
});

// ─────────────────────────────── 验收 5：只打开 / 只看部分不触发

test("验收5｜只打开抖音或只浏览部分视频不触发事件", async ({ page }) => {
  test.setTimeout(150000);
  const phone = await loadDouyin(page);
  const root = phone.locator("[data-douyin-root]");
  await expect(root).toHaveAttribute("data-douyin-viewed-count", "1", {
    timeout: 25000,
  });
  const opened = await readState(page);
  expect(opened.variables?.WA_DOUYIN_001_TRIGGERED).toBe(false);
  expect(opened.playback?.[EVENT]).toBeUndefined();
  expect(await noticesOf(page)).toHaveLength(0);

  await browseTo(page, phone, 3);
  await page.waitForTimeout(1200);
  const partial = await readState(page);
  expect(partial.variables?.WA_DOUYIN_001_TRIGGERED).toBe(false);
  expect(partial.playback?.[EVENT]).toBeUndefined();
  expect(await noticesOf(page)).toHaveLength(0);
  expect((await progressOf(page)).viewedIds).toEqual(VIDEO_IDS.slice(0, 4));
  expect(await root.getAttribute("data-douyin-view-completed")).toBe("false");
});

// ─────────────────────────────── 验收 6：直接跳到第 8 条不触发

test("验收6｜直接进入第八条视频、没有依次浏览前七条时不触发", async ({
  page,
}) => {
  test.setTimeout(150000);
  let phone = await loadDouyin(page);
  phone = await seedLastVideo(page, phone);
  const root = phone.locator("[data-douyin-root]");
  await expect(root).toHaveAttribute("data-douyin-index", "7");
  await waitLoaded(page, 8);
  await page.waitForTimeout(6000); // 覆盖 Skin 的完整轮询窗口
  const s = await readState(page);
  expect(s.variables?.WA_DOUYIN_001_TRIGGERED).toBe(false);
  expect(s.playback?.[EVENT]).toBeUndefined();
  expect(await noticesOf(page)).toHaveLength(0);
  expect((await progressOf(page)).viewedIds ?? []).toEqual([]);
  expect(await root.getAttribute("data-douyin-view-completed")).toBe("false");
});

// ─────────────────────────────── 验收 7：中途退出后恢复进度

test("验收7｜中途退出抖音再回来保留进度，继续浏览不从头开始", async ({
  page,
}) => {
  test.setTimeout(180000);
  const phone = await loadDouyin(page);
  await browseTo(page, phone, 2);
  const before = await progressOf(page);
  expect(before.viewedIds).toEqual(VIDEO_IDS.slice(0, 3));
  expect(before.lastSequentialIndex).toBe(2);

  await phone.locator("[data-douyin-back]").click();
  await expect(phone.locator(".douyin-ui")).toHaveCount(0);
  await openDouyin(phone);
  const root = phone.locator("[data-douyin-root]");
  await expect(root).toHaveAttribute("data-douyin-index", "2");
  await waitLoaded(page, 3);
  await page.waitForTimeout(1200);
  const after = await progressOf(page);
  expect(after.viewedIds).toEqual(before.viewedIds); // 不重头、不重复增加
  expect(after.lastSequentialIndex).toBe(2);
  expect(after.completed).toBe(false);

  // 从第 4 条接着往下浏览，第 8 条成功显示后触发。
  await browseTo(page, phone, 7);
  await triggered(page);
  expect((await progressOf(page)).viewedIds).toEqual(VIDEO_IDS);
});

// ─────────────────────────────── 验收 8：重复浏览 / 回看不重复触发

test("验收8｜浏览完再次浏览、从第 8 条回看再向后都不重复触发", async ({
  page,
}) => {
  test.setTimeout(180000);
  const phone = await loadDouyin(page);
  await browseTo(page, phone, 7);
  await triggered(page);
  const first = await readState(page);
  const fingerprint = JSON.stringify({
    triggered: first.variables?.WA_DOUYIN_001_TRIGGERED,
    completed: first.completed.filter((x: string) => x === EVENT),
    unlocked: (first.unlocked ?? []).filter((id: string) =>
      MSG_IDS.includes(id),
    ),
    notifications: first.notifications,
    messageTimes: first.messageTimes ?? {},
    pack: first.playback?.[EVENT],
  });

  // 回到第 1 条再重新向上滑一遍；已看过的不重复增加进度。
  await scrollTo(page, phone, 0);
  expect((await progressOf(page)).viewedIds).toEqual(VIDEO_IDS);
  await scrollTo(page, phone, 7);
  await page.waitForTimeout(1500);
  const root = phone.locator("[data-douyin-root]");
  expect(await root.getAttribute("data-douyin-view-completed")).toBe("true");
  expect(await root.getAttribute("data-douyin-viewed-count")).toBe("8");
  await expect(phone.locator(".whatsapp-ui")).toHaveCount(0);

  const again = await readState(page);
  expect(
    JSON.stringify({
      triggered: again.variables?.WA_DOUYIN_001_TRIGGERED,
      completed: again.completed.filter((x: string) => x === EVENT),
      unlocked: (again.unlocked ?? []).filter((id: string) =>
        MSG_IDS.includes(id),
      ),
      notifications: again.notifications,
      messageTimes: again.messageTimes ?? {},
      pack: again.playback?.[EVENT],
    }),
  ).toBe(fingerprint);
  expect(again.completed.filter((x: string) => x === EVENT)).toHaveLength(1);
  expect(await noticesOf(page)).toHaveLength(1);
});

// ─────────────────────────────── 验收 9：刷新 + 重进聊天不重复、时间戳不变

test("验收9｜刷新页面与重新进入 WhatsApp 不重复显示，时间戳持久化", async ({
  page,
}) => {
  test.setTimeout(180000);
  const phone = await loadDouyin(page);
  await browseTo(page, phone, 7);
  await triggered(page);
  await openChat(phone);
  await waitDelivered(page, 4);
  const before = await readState(page);
  const times = MSG_IDS.map((id) => before.messageTimes?.[id]);
  expect(times.every((t) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(t ?? ""))).toBe(
    true,
  );
  expect(before.playback[EVENT].deliveredMessageIds).toEqual(MSG_IDS);
  expect((await bubbleBodies(phone)).slice(-4)).toEqual(BODIES);

  // 不带 fresh 刷新：读同一份存档，回锁屏后重新解锁。
  await page.goto("/");
  await unlockPhone(phone);
  await openChat(phone);
  await page.waitForTimeout(2500);
  const after = await readState(page);
  expect(after.playback[EVENT].deliveredMessageIds).toEqual(MSG_IDS);
  expect(after.playback[EVENT].playbackStatus).toBe("completed");
  expect(after.completed.filter((x: string) => x === EVENT)).toHaveLength(1);
  expect(MSG_IDS.map((id) => after.messageTimes?.[id])).toEqual(times);
  const bodies = await bubbleBodies(phone);
  expect(bodies.slice(-4)).toEqual(BODIES);
  expect(BODIES.map((b) => bodies.filter((x) => x === b).length)).toEqual([
    1, 1, 1, 1,
  ]);
});

// ─────────────────────────────── 验收 10：通知跳转

test("验收10｜WhatsApp 新消息通知点击后进入学姐私聊，不自动跳转、不打断播放", async ({
  page,
}) => {
  test.setTimeout(180000);
  const phone = await loadDouyin(page);
  await browseTo(page, phone, 7);
  await triggered(page);
  await expect(phone.locator(".whatsapp-ui")).toHaveCount(0);
  expect((await videoState(page, 8))?.paused).toBe(false);

  const banner = phone.locator(".device-banner");
  await expect(banner).toBeVisible({ timeout: 10000 });
  await expect(banner).toContainText(BODIES[0]);
  await banner.click();
  await expect(phone.locator(".whatsapp-ui")).toBeVisible({ timeout: 15000 });
  await expect(phone.locator(".wa-thread-profile")).toContainText("邝学姐");
  const early = await readState(page);
  expect((early.playback?.[EVENT]?.deliveredMessageIds ?? []).length).toBeLessThan(
    4,
  );
  await waitDelivered(page, 4);
  expect((await bubbleBodies(phone)).slice(-4)).toEqual(BODIES);
  // 四条全是学姐消息，不生成机主回复，也不改变关系状态。
  const s = await readState(page);
  expect(s.playback[EVENT].messageIds).toEqual(MSG_IDS);
  expect(s.variables?.WA_DOUYIN_001_TRIGGERED).toBe(true);
});

// ─────────────────────────────── 补充 1：视频加载失败不触发

test("补充1｜视频资源加载失败时不算成功显示，绝不触发事件", async ({
  page,
}) => {
  test.setTimeout(150000);
  const phone = await loadDouyin(page, { failVideo: "dy-02.mp4" });
  const root = phone.locator("[data-douyin-root]");
  await expect(phone.locator('[data-douyin-error="dy_02"]')).toBeVisible({
    timeout: 15000,
  });
  // 快速逐条走完 8 条，每条都给足 Skin 的观察窗口。
  for (let i = 1; i <= 7; i++) {
    await page.keyboard.press("ArrowDown");
    await expect(root).toHaveAttribute("data-douyin-index", String(i));
    await page.waitForTimeout(700);
  }
  const s = await readState(page);
  expect(s.variables?.WA_DOUYIN_001_TRIGGERED).toBe(false);
  expect(s.playback?.[EVENT]).toBeUndefined();
  expect(await noticesOf(page)).toHaveLength(0);
  expect((await progressOf(page)).viewedIds ?? []).not.toEqual(VIDEO_IDS);
  expect(await root.getAttribute("data-douyin-view-completed")).toBe("false");
});

// ─────────────────────────────── 补充 2：逐条播放、已显示保留 / 未显示继续

test("补充2｜四条不一次性写入历史，中途离开聊天后已显示保留、未显示继续", async ({
  page,
}) => {
  test.setTimeout(180000);
  const phone = await loadDouyin(page);
  await browseTo(page, phone, 7);
  await triggered(page);
  await openChat(phone);
  // 刚打开会话：四条绝不能一次性写进历史。
  const opened = await readState(page);
  expect((opened.playback[EVENT].deliveredMessageIds ?? []).length).toBeLessThan(4);
  expect(opened.unlocked.filter((id: string) => MSG_IDS.includes(id))).toHaveLength(
    4,
  );
  // 等至少 1 条送达后，尚未送达的台词不能提前出现。
  await expect
    .poll(
      async () =>
        (await readState(page)).playback?.[EVENT]?.deliveredMessageIds?.length ??
        0,
      { timeout: 90000, intervals: [100, 200, 300] },
    )
    .toBeGreaterThanOrEqual(1);
  const early = await readState(page);
  const delivered = early.playback[EVENT].deliveredMessageIds as string[];
  expect(delivered.length).toBeLessThan(4);
  expect(delivered[0]).toBe(MSG_IDS[0]);
  const earlyBodies = await bubbleBodies(phone);
  expect(earlyBodies).toContain(BODIES[0]);
  for (let i = delivered.length; i < 4; i++)
    expect(earlyBodies).not.toContain(BODIES[i]);

  // 离开会话再回来：已显示的保留，剩余从正确位置继续。
  const deliveredBeforeLeave = delivered.length;
  await phone.getByRole("button", { name: "返回桌面", exact: true }).click();
  await openChat(phone);
  const resumed = await readState(page);
  const resumedDelivered = resumed.playback[EVENT].deliveredMessageIds as string[];
  expect(resumedDelivered.length).toBeGreaterThanOrEqual(deliveredBeforeLeave);
  expect(resumedDelivered.slice(0, deliveredBeforeLeave)).toEqual(
    delivered.slice(0, deliveredBeforeLeave),
  );
  expect((await bubbleBodies(phone))).toContain(BODIES[0]);
  await waitDelivered(page, 4);
  const final = await readState(page);
  expect(final.playback[EVENT].deliveredMessageIds).toEqual(MSG_IDS);
  expect(final.playback[EVENT].playbackStatus).toBe("completed");
  expect((await bubbleBodies(phone)).slice(-4)).toEqual(BODIES);
});
