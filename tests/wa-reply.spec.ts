import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { compileStory } from "../src/story-engine/compiler";
import {
  driveThread,
  sendPresetReply,
  waitAwaitingReply,
  waitDraftReady,
  type PlaybackMap,
} from "./fixtures/wa-playback";

const PIN = "0511";
const WHATSAPP = "打开WhatsApp";
const MAPS = "打开地图";
const SAFARI = "打开浏览器";
const INSTAGRAM = "打开Instagram";
const LINGLING = "邝学姐 💙";
const MIMI = "Mimi 🧋";
const LAST_LINGLING = "只是覺得當面說會比較好。";

const MIMI_IDS = Array.from(
  { length: 14 },
  (_, i) => `msg_mimi001_${String(i + 1).padStart(2, "0")}`,
);
const MIMI_BODIES = [
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
const MAP_BODIES = [
  "你有冇特別想食咩？",
  "还没想好呢",
  "想找一家离学校近一点的",
  "紅磡附近都幾方便呀。",
];
const IG_BODIES = [
  "你啱啱 like 咗我嗰個 post？",
  "这么快就被学姐发现了",
  "那家日料店看起来不错，照片也拍得很好呢",
  "☺️呢間真係幾好食。",
  "而且有啲位要提早 book，週末會比較難訂。",
  "那我先把它放进备选名单，最近也在找合适的店",
  "好呀，等你慢慢揀。",
];

type Locator = ReturnType<Page["locator"]>;

async function unlockPhone(phone: Locator) {
  await phone.getByRole("button", { name: "轻触解锁" }).click();
  for (const d of PIN)
    await phone.getByRole("button", { name: "密码键" + d }).click();
  await expect(
    phone.getByRole("button", { name: "搜索", exact: true }),
  ).toBeVisible({ timeout: 15000 });
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

/** 从聊天列表重新进入 Mimi 会话（用于中途退出后的恢复检查）。 */
async function reopenMimi(phone: Locator) {
  await openWhatsApp(phone);
  await phone.locator(".wa-chat-row", { hasText: MIMI }).first().click();
}

async function readRuntime(page: Page): Promise<any> {
  return page.evaluate(async () => {
    const req = indexedDB.open("foundphone-studio");
    const db: IDBDatabase = await new Promise((res, rej) => {
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    const all: any[] = await new Promise((res, rej) => {
      const r = db.transaction("saves", "readonly").objectStore("saves").getAll();
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    db.close();
    return all[0]?.state ?? {};
  });
}

const playback = async (page: Page): Promise<PlaybackMap> =>
  (await readRuntime(page))?.playback ?? {};
const mimiDelivered = async (page: Page): Promise<string[]> =>
  (await playback(page))["MIMI-001"]?.deliveredMessageIds ?? [];
const isMimiDone = (pb: PlaybackMap) =>
  pb["MIMI-001"]?.playbackStatus === "completed";

/** MIMI-001 入队：走完学姐开场对话；之后打开 Mimi 私聊即进入待回复状态。 */
async function setupMimi(phone: Locator, page: Page) {
  await openWhatsApp(phone);
  await phone.locator(".wa-chat-row", { hasText: LINGLING }).first().click();
  await expect(
    phone.locator(".skin-bubble", { hasText: LAST_LINGLING }),
  ).toHaveCount(1, { timeout: 40000 });
  await expect
    .poll(async () => (await playback(page))["MIMI-001"]?.messageIds?.length ?? 0, {
      timeout: 20000,
    })
    .toBe(14);
}

async function openMimi(phone: Locator, page: Page) {
  await openWhatsApp(phone);
  await phone.locator(".wa-chat-row", { hasText: MIMI }).first().click();
  await expect(
    phone.locator(".skin-bubble", { hasText: MIMI_BODIES[0] }),
  ).toHaveCount(1, { timeout: 20000 });
  return page;
}

/** 只取事件包已送达的那几条气泡，避开历史聊天里恰好含相同单字的干扰。 */
async function packTail(phone: Locator, page: Page): Promise<string[]> {
  const n = (await mimiDelivered(page)).length;
  if (!n) return [];
  const all = await phone.locator(".skin-bubble").allTextContents();
  return all.slice(-n);
}

const composeField = (phone: Locator) => phone.locator(".native-compose-field");
const sendButton = (phone: Locator) =>
  phone.getByRole("button", { name: "发送消息" });
const awaiting = (phone: Locator) =>
  phone.locator(".skin-compose[data-awaiting-reply='1']");
const draftText = async (phone: Locator) =>
  ((await composeField(phone).textContent()) ?? "").trim();
const waitDelivered = async (page: Page, n: number, timeout = 25000) =>
  expect
    .poll(async () => (await mimiDelivered(page)).length, { timeout })
    .toBe(n);

// ---------------------------------------------------------------- 测试 A

test("测试A｜当前账号自动模拟打字：初始为空、逐字填入、光标、完成后才可发送", async ({
  page,
}) => {
  test.setTimeout(200000);
  const phone = await loadTemplatePlayer(page);
  await setupMimi(phone, page);
  await openMimi(phone, page);
  await waitAwaitingReply(phone);
  expect(await mimiDelivered(page)).toEqual([MIMI_IDS[0]]);

  // 1) 点输入框之前：输入框为空、没有发送按钮。
  expect(await draftText(phone)).toBe("");
  await expect(sendButton(phone)).toHaveCount(0);

  // 2) 点击输入框：键盘弹出、输入框获得焦点、初始不是完整预设文本。
  await composeField(phone).click();
  await expect(phone.locator(".device-keyboard")).toBeVisible({ timeout: 6000 });
  await expect(composeField(phone)).toHaveAttribute("data-focused", "1");
  expect(await draftText(phone)).not.toBe(MIMI_BODIES[1]);

  // 3) 真实 draftValue 逐字增长（不是一次性赋值，也不是 CSS 假动画）。
  const total = Array.from(MIMI_BODIES[1]).length;
  const samples: number[] = [];
  for (let i = 0; i < 8; i++) {
    samples.push(Array.from(await draftText(phone)).length);
    await page.waitForTimeout(55);
  }
  expect(new Set(samples).size, "文字应逐字增长").toBeGreaterThan(1);
  expect(Math.max(...samples)).toBeLessThanOrEqual(total);
  await expect(phone.locator(".wa-compose .wa-caret")).toHaveCount(1);

  // 4) 键盘只做视觉：没有可编辑草稿区，也不重复显示预设文字。
  await expect(phone.getByRole("textbox", { name: "消息草稿" })).toHaveCount(0);
  await expect(phone.locator(".device-keyboard")).not.toContainText(
    MIMI_BODIES[1],
  );

  // 5) 打字完成 → 完整草稿 + 发送按钮可用；但仍没有写进历史。
  await waitDraftReady(phone);
  expect(await draftText(phone)).toBe(MIMI_BODIES[1]);
  await expect(sendButton(phone)).toBeEnabled();
  // 键盘按键只做视觉：点 QWERTY 字母键、候选词都不会改写真实草稿。
  await phone
    .locator(".device-keyboard .keyboard-row")
    .first()
    .getByRole("button", { name: "q", exact: true })
    .click();
  await phone
    .locator(".keyboard-candidates")
    .getByRole("button", { name: "好的", exact: true })
    .click();
  expect(await draftText(phone), "按键不追加、不改动预设文字").toBe(
    MIMI_BODIES[1],
  );
  // 键盘不遮挡输入框与发送按钮；聊天区底部留白按键盘实测高度同步。
  const geometry = await page.evaluate(() => {
    const rect = (sel: string) =>
      document.querySelector(sel)?.getBoundingClientRect() ?? null;
    const compose = rect(".wa-compose");
    const keyboard = rect(".device-keyboard");
    const field = rect(".native-compose-field");
    const send = rect(".wa-send-button");
    const screen = document.querySelector<HTMLElement>(".phone-screen");
    const appScreen = document.querySelector<HTMLElement>(".app-screen");
    return {
      gap: compose && keyboard ? keyboard.top - compose.bottom : Number.NaN,
      fieldBottom: field?.bottom ?? Number.NaN,
      sendBottom: send?.bottom ?? Number.NaN,
      keyboardTop: keyboard?.top ?? Number.NaN,
      keyboardHeight:
        document.querySelector<HTMLElement>(".device-keyboard")?.offsetHeight ??
        0,
      varHeight: parseFloat(
        screen?.style.getPropertyValue("--keyboard-height") || "0",
      ),
      padding: parseFloat(
        appScreen ? getComputedStyle(appScreen).paddingBottom : "0",
      ),
    };
  });
  expect(Number.isFinite(geometry.gap)).toBe(true);
  expect(Math.abs(geometry.gap), "输入栏紧贴键盘上沿").toBeLessThanOrEqual(2);
  expect(geometry.fieldBottom).toBeLessThanOrEqual(geometry.keyboardTop + 2);
  expect(geometry.sendBottom).toBeLessThanOrEqual(geometry.keyboardTop + 2);
  expect(Math.abs(geometry.varHeight - geometry.keyboardHeight)).toBeLessThanOrEqual(
    2,
  );
  expect(Math.abs(geometry.padding - geometry.keyboardHeight)).toBeLessThanOrEqual(
    2,
  );
  await expect(awaiting(phone)).toHaveCount(1);
  expect(await mimiDelivered(page)).toEqual([MIMI_IDS[0]]);
  expect((await packTail(phone, page)).some((b) => b.includes(MIMI_BODIES[1]))).toBe(
    false,
  );
  await page.waitForTimeout(1200);
  expect(await mimiDelivered(page), "打字完成也不等于发送").toEqual([
    MIMI_IDS[0],
  ]);

  // 6) 玩家只需点击发送；随后清空草稿、收起键盘。
  await sendButton(phone).click();
  await expect
    .poll(async () => (await mimiDelivered(page)).length, { timeout: 15000 })
    .toBeGreaterThanOrEqual(2);
  expect(await mimiDelivered(page)).toContain(MIMI_IDS[1]);
  await expect(phone.locator(".device-keyboard")).toHaveCount(0);
  expect(await draftText(phone)).toBe("");
});

// ---------------------------------------------------------------- 测试 B

test("测试B｜对方回复：正在输入 → 气泡逐字完整显示 → 才进入下一轮", async ({
  page,
}) => {
  test.setTimeout(200000);
  const phone = await loadTemplatePlayer(page);
  await setupMimi(phone, page);

  // 打开会话时第一条对方消息先出现「正在输入」，此时尚未写入历史。
  await openWhatsApp(phone);
  await phone.locator(".wa-chat-row", { hasText: MIMI }).first().click();
  await expect(
    phone.locator("[data-incoming-phase='peer-typing']"),
  ).toBeVisible({ timeout: 15000 });
  expect(await mimiDelivered(page), "正在输入阶段尚未落盘").toEqual([]);

  // 气泡逐字显示，不是瞬间出现完整回复；显示期间仍未落盘。
  await expect(
    phone.locator("[data-incoming-phase='peer-revealing']"),
  ).toBeVisible({ timeout: 15000 });
  const partial = (
    (await phone
      .locator("[data-incoming-phase='peer-revealing'] .skin-bubble")
      .textContent()) ?? ""
  ).trim();
  expect(partial).not.toBe(MIMI_BODIES[0]);
  expect(await mimiDelivered(page), "逐字显示阶段尚未落盘").toEqual([]);

  // 完整显示后才写入历史并停在当前账号回复上。
  await waitDelivered(page, 1);
  expect(await mimiDelivered(page)).toEqual([MIMI_IDS[0]]);
  await waitAwaitingReply(phone);

  // 玩家发送后，下一条对方消息按同样顺序出现，不跳过、不提前落盘。
  await sendPresetReply(page, phone, () => playback(page), MIMI_BODIES[1]);
  const typing2 = phone.locator(
    `[data-incoming-phase='peer-typing'][data-incoming-id='${MIMI_IDS[2]}']`,
  );
  await expect(typing2).toBeVisible({ timeout: 20000 });
  expect(await mimiDelivered(page)).toEqual(MIMI_IDS.slice(0, 2));
  await expect(
    phone.locator(
      `[data-incoming-phase='peer-revealing'][data-incoming-id='${MIMI_IDS[2]}']`,
    ),
  ).toBeVisible({ timeout: 20000 });
  await waitDelivered(page, 3);
  expect(await mimiDelivered(page)).toEqual(MIMI_IDS.slice(0, 3));
  await waitAwaitingReply(phone);
});

// ---------------------------------------------------------------- 测试 C

test("测试C｜连续消息：两条当前账号回复逐条打字发送，对方连续消息逐条显示", async ({
  page,
}) => {
  test.setTimeout(300000);
  const phone = await loadTemplatePlayer(page);
  await setupMimi(phone, page);
  await openMimi(phone, page);

  // 先推进到第一条连续回复之前。
  await waitAwaitingReply(phone);
  await sendPresetReply(page, phone, () => playback(page), MIMI_BODIES[1]);
  await waitDelivered(page, 3);
  await waitAwaitingReply(phone);
  expect(await mimiDelivered(page)).toEqual(MIMI_IDS.slice(0, 3));

  // 连续两条当前账号回复之一：自动打字完成 → 手动发送。
  await composeField(phone).click();
  await waitDraftReady(phone);
  expect(await draftText(phone)).toBe(MIMI_BODIES[3]);
  await expect(sendButton(phone)).toBeEnabled();
  await sendButton(phone).click();
  await expect
    .poll(async () => (await mimiDelivered(page)).length, { timeout: 15000 })
    .toBeGreaterThanOrEqual(4);
  expect(await mimiDelivered(page)).toContain(MIMI_IDS[3]);

  // 第二条不得自动进入历史，必须重新打开输入框、重新自动逐字输入。
  await page.waitForTimeout(1500);
  expect(await mimiDelivered(page), "第二条连续回复不得自动发送").not.toContain(
    MIMI_IDS[4],
  );
  await expect(awaiting(phone)).toHaveCount(1);
  expect(await draftText(phone)).toBe("");
  await composeField(phone).click();
  expect(await draftText(phone)).not.toBe(MIMI_BODIES[4]);
  await waitDraftReady(phone);
  expect(await draftText(phone)).toBe(MIMI_BODIES[4]);
  await sendButton(phone).click();
  await expect
    .poll(async () => (await mimiDelivered(page)).length, { timeout: 15000 })
    .toBeGreaterThanOrEqual(5);

  // 对方连续两条：依次出现「正在输入/逐字显示」，不跳过、不重复。
  const seen: string[] = [];
  await expect
    .poll(
      async () => {
        const first = phone.locator("[data-incoming-phase]").first();
        if (await first.count()) {
          const id = await first.getAttribute("data-incoming-id");
          if (id && !seen.includes(id)) seen.push(id);
        }
        return (await mimiDelivered(page)).length;
      },
      { timeout: 40000, intervals: [80] },
    )
    .toBe(7);
  expect(seen).toEqual([MIMI_IDS[5], MIMI_IDS[6]]);
  expect(await mimiDelivered(page)).toEqual(MIMI_IDS.slice(0, 7));

  // 之后停在下一条当前账号回复，仍需要玩家操作。
  await waitAwaitingReply(phone);
  await composeField(phone).click();
  await waitDraftReady(phone);
  expect(await draftText(phone)).toBe(MIMI_BODIES[7]);
});

// ---------------------------------------------------------------- 测试 D

test("测试D｜中途退出与恢复：打字未完成 / 完成未发送 / 已发送", async ({
  page,
}) => {
  test.setTimeout(360000);
  const phone = await loadTemplatePlayer(page);
  await setupMimi(phone, page);
  await openMimi(phone, page);
  await waitAwaitingReply(phone);
  await sendPresetReply(page, phone, () => playback(page), MIMI_BODIES[1]);
  await waitDelivered(page, 3);
  await waitAwaitingReply(phone);

  // D1 打字动画未完成就离开聊天页面。
  await composeField(phone).click();
  await expect(phone.locator(".device-keyboard")).toBeVisible();
  await expect(
    phone.locator(".skin-compose[data-reply-phase='typing']"),
  ).toBeVisible({ timeout: 6000 });
  // 输入框初始为空，等真实 draftValue 出现第一个字符，此时动画远未结束。
  await expect
    .poll(async () => Array.from(await draftText(phone)).length, {
      timeout: 6000,
      intervals: [40],
    })
    .toBeGreaterThan(0);
  const partial = await draftText(phone);
  expect(partial).not.toBe(MIMI_BODIES[3]);
  await goHome(phone);
  await reopenMimi(phone);
  await expect(awaiting(phone)).toHaveCount(1);
  expect(await mimiDelivered(page), "退出不得自动发送").toEqual(
    MIMI_IDS.slice(0, 3),
  );
  const restored = await draftText(phone);
  expect(Array.from(restored).length).toBeGreaterThanOrEqual(
    Array.from(partial).length,
  );
  expect(restored.startsWith(partial), "从上次进度恢复，不从头重播").toBe(true);
  expect(restored, "打字未完成，退出不得补全整句").not.toBe(MIMI_BODIES[3]);
  await expect(
    phone.locator(".skin-compose[data-reply-phase='paused']"),
  ).toBeVisible();
  await expect(sendButton(phone)).toBeDisabled();
  await expect(phone.locator(".device-keyboard")).toHaveCount(0);

  // 再点输入框从进度继续，不从头重播、不自动发送。
  await composeField(phone).click();
  await waitDraftReady(phone);
  expect(await draftText(phone)).toBe(MIMI_BODIES[3]);
  await sendButton(phone).click();
  await expect
    .poll(async () => (await mimiDelivered(page)).length, { timeout: 15000 })
    .toBeGreaterThanOrEqual(4);

  // D2 打字完成但尚未点击发送就离开。
  await waitAwaitingReply(phone);
  await composeField(phone).click();
  await waitDraftReady(phone);
  const full = await draftText(phone);
  expect(full).toBe(MIMI_BODIES[4]);
  await goHome(phone);
  await reopenMimi(phone);
  await expect(awaiting(phone)).toHaveCount(1);
  expect(await mimiDelivered(page)).not.toContain(MIMI_IDS[4]);
  expect(await draftText(phone), "完整草稿直接恢复等待发送").toBe(full);
  await expect(
    phone.locator(".skin-compose[data-reply-phase='draft_ready']"),
  ).toBeVisible();
  await expect(sendButton(phone)).toBeEnabled();
  await sendButton(phone).click();
  await expect
    .poll(async () => (await mimiDelivered(page)).length, { timeout: 15000 })
    .toBeGreaterThanOrEqual(5);

  // D3 已发送后离开：不重复触发、不推进后续剧情、不重播。
  await waitDelivered(page, 7);
  await waitAwaitingReply(phone);
  await sendPresetReply(page, phone, () => playback(page), MIMI_BODIES[7]);
  const afterSend = await mimiDelivered(page);
  expect(afterSend).toContain(MIMI_IDS[7]);
  await goHome(phone);
  await reopenMimi(phone);
  await waitAwaitingReply(phone);
  const current = await mimiDelivered(page);
  // 已发送的消息顺序不变、只出现一次；之后对方消息按剧本继续送达属正常续播。
  expect(current.slice(0, afterSend.length), "已送达消息不重播").toEqual(
    afterSend,
  );
  expect(new Set(current).size).toBe(current.length);
  expect(current.filter((id) => id === MIMI_IDS[7])).toHaveLength(1);
  expect(await draftText(phone)).toBe("");
  await expect(
    phone.locator(".skin-compose[data-reply-phase='draft_ready']"),
  ).toHaveCount(0);
});

// ---------------------------------------------------------------- 测试 E

test("测试E｜MIMI-001 完整聊天：逐条手动发送、顺序、持久化、再打开不重播", async ({
  page,
}) => {
  test.setTimeout(420000);
  const phone = await loadTemplatePlayer(page);
  await setupMimi(phone, page);
  await openMimi(phone, page);

  // 完整走完 14 条：每条当前账号回复都等自动打字完成再由玩家点发送。
  await driveThread(page, phone, () => playback(page), isMimiDone);

  const done = await playback(page);
  expect(done["MIMI-001"].deliveredMessageIds).toEqual(MIMI_IDS);
  expect(new Set(done["MIMI-001"].deliveredMessageIds).size).toBe(14);
  expect(done["MIMI-001"].playbackStatus).toBe("completed");
  const tail = await packTail(phone, page);
  expect(tail).toHaveLength(14);
  MIMI_BODIES.forEach((body, i) =>
    expect(tail[i], `第 ${i + 1} 条顺序/内容`).toContain(body.trim()),
  );
  await expect(awaiting(phone)).toHaveCount(0);
  await expect(sendButton(phone)).toHaveCount(0);
  expect(await draftText(phone)).toBe("");

  // 完成后反复进入：不重播、不新增气泡、不再出现发送按钮。
  for (let round = 0; round < 2; round++) {
    await reopenMimi(phone);
    expect(await packTail(phone, page)).toHaveLength(14);
    await expect(awaiting(phone)).toHaveCount(0);
    await expect(sendButton(phone)).toHaveCount(0);
    expect((await playback(page))["MIMI-001"].deliveredMessageIds).toEqual(
      MIMI_IDS,
    );
  }

  // 刷新页面后历史与顺序保留，其他事件消息队列未被改动。
  await page.reload();
  await unlockPhone(phone);
  await reopenMimi(phone);
  expect(await packTail(phone, page)).toHaveLength(14);
  expect((await playback(page))["MIMI-001"].deliveredMessageIds).toEqual(
    MIMI_IDS,
  );
  expect(Object.keys(await playback(page))).toEqual(["MIMI-001"]);
});

// ---------------------------------------------------------------- 测试 F（回归抽查）

test("测试F｜回归抽查 MAP-001 / IG-001 / BR-001 与学姐原有聊天", async ({
  page,
}) => {
  test.setTimeout(480000);
  const phone = await loadTemplatePlayer(page);
  const linglingDone = (pb: PlaybackMap) =>
    Object.values(pb)
      .filter((pk: any) => pk?.thread === LINGLING)
      .every((pk: any) => pk.playbackStatus === "completed");

  // MAP-001：触发条件不变（打开「紅磡附近餐廳」结果页）。
  await openApp(phone, MAPS);
  await expect(phone.locator(".maps-ui")).toBeVisible();
  await phone.getByRole("button", { name: "搜索地点", exact: true }).click();
  await expect(phone.locator(".maps-recent-row").first()).toBeVisible();
  await phone
    .locator(".maps-recent-row", { hasText: "紅磡附近餐廳" })
    .first()
    .click();
  await expect(phone.locator(".maps-result-title")).toHaveText("紅磡附近餐廳");
  await expect
    .poll(
      async () =>
        Object.values(await playback(page)).some((pk: any) =>
          pk?.messageIds?.includes("msg_map001_01"),
        ),
      { timeout: 15000 },
    )
    .toBe(true);

  await openWhatsApp(phone);
  await phone.locator(".wa-chat-row", { hasText: LINGLING }).first().click();
  await expect(
    phone.locator(".skin-bubble", { hasText: MAP_BODIES[0] }),
  ).toHaveCount(1, { timeout: 30000 });
  await waitAwaitingReply(phone);
  await sendPresetReply(page, phone, () => playback(page), MAP_BODIES[1]);
  await waitAwaitingReply(phone);
  await sendPresetReply(page, phone, () => playback(page), MAP_BODIES[2]);
  await expect(
    phone.locator(".skin-bubble", { hasText: MAP_BODIES[3] }),
  ).toHaveCount(1, { timeout: 30000 });

  // BR-001：只有一条对方消息，仍按原设定自动展示，无需玩家回复。
  await openApp(phone, SAFARI);
  await phone
    .locator(".safari-hist-row", { hasText: "香港理工大学附近好吃的餐厅" })
    .click();
  await expect(phone.locator(".safari-page")).toContainText("附近餐厅");
  await expect
    .poll(
      async () =>
        Object.values(await playback(page)).some((pk: any) =>
          pk?.messageIds?.includes("wa-msg-308"),
        ),
      { timeout: 15000 },
    )
    .toBe(true);
  await openWhatsApp(phone);
  await phone.locator(".wa-chat-row", { hasText: LINGLING }).first().click();
  await expect(
    phone.locator(".skin-bubble", { hasText: "餐廳選好未呀☺️" }),
  ).toHaveCount(1, { timeout: 30000 });

  // IG-001：点赞触发条件不变，当前账号三条回复同样改为手动发送。
  await openApp(phone, INSTAGRAM);
  await expect(phone.locator(".igx-ui")).toBeVisible({ timeout: 15000 });
  await phone
    .locator('.igx-feed .igx-post[data-post-id="post_ll_20261106_omakase"]')
    .getByRole("button", { name: "点赞", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        Object.values(await playback(page)).some((pk: any) =>
          pk?.messageIds?.includes("msg_ig001_01"),
        ),
      { timeout: 15000 },
    )
    .toBe(true);
  await openWhatsApp(phone);
  await phone.locator(".wa-chat-row", { hasText: LINGLING }).first().click();
  await expect(
    phone.locator(".skin-bubble", { hasText: IG_BODIES[0] }),
  ).toHaveCount(1, { timeout: 30000 });
  await waitAwaitingReply(phone);
  await expect(
    phone.locator(".skin-bubble", { hasText: IG_BODIES[1] }),
  ).toHaveCount(0);
  await driveThread(page, phone, () => playback(page), linglingDone);

  // 原有台词、触发条件与历史都未改动；三个包各条只送达一次。
  for (const body of [...MAP_BODIES, "餐廳選好未呀☺️", ...IG_BODIES])
    await expect(
      phone.locator(".skin-bubble", { hasText: body }),
    ).toHaveCount(1);
  await expect(
    phone.locator(".skin-bubble", { hasText: LAST_LINGLING }),
  ).toHaveCount(1);
  const pb = await playback(page);
  for (const pk of (Object.values(pb) as any[]).filter(
    (x) => x?.thread === LINGLING,
  )) {
    expect(pk.playbackStatus).toBe("completed");
    expect(new Set(pk.deliveredMessageIds).size).toBe(pk.messageIds.length);
    expect(pk.deliveredMessageIds).toEqual(pk.messageIds);
  }
});
