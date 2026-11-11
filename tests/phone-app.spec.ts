/**
 * PHONE APP｜电话模块搭建规格 · 第十一章验收
 *
 * 台词不从实现文件「自证」：直接从规格逐字副本
 * data/phone-app/电话模块搭建规格.txt 解析，再与运行时气泡逐条比对。
 * 所有通话、回拨、刷新都走真实 UI / 真实存档，不伪造剧情结果。
 */
import { test, expect, type Locator, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { compileStory } from "../src/story-engine/compiler";
import {
  FIRST_CALL_WA,
  LINGLING_SCRIPT,
  MIMI_SCRIPT,
  MOM_SCRIPT,
  PHONE_CONTACTS,
  PHONE_HISTORY,
} from "../src/skins/phone-data";

const raw = JSON.parse(readFileSync("stories/template/story.json", "utf8"));
const work = compileStory(raw).work;
const PIN = String(raw.phone?.passcode ?? "");
const SPEC = readFileSync("data/phone-app/电话模块搭建规格.txt", "utf8");
const WA_IDS = ["msg_phone_lc1_01", "msg_phone_lc1_02"];
const LINGLING = "邝学姐 💙";

function specSection(start: string, end: string) {
  const a = SPEC.indexOf(start);
  const b = SPEC.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw new Error(`规格章节缺失: ${start} / ${end}`);
  return SPEC.slice(a, b);
}
/** 逐字解析规格里的 `**发言人：** 台词` 行。 */
function specLines(start: string, end: string) {
  return specSection(start, end)
    .split("\n")
    .map((l) => /^\*\*(.+?)：\*\*\s*(.+?)\s*$/.exec(l.trim()))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ speaker: m[1], text: m[2] }));
}
const MOM = specLines("## 4.2 固定对话", "## 4.3 显示规则");
const MIMI = specLines("## 5.2 固定对话", "## 5.3 显示规则");
const LL4 = specLines("### 第四次通话固定对话", "### 对话结束后的处理");
const WA2 = specLines(
  "### 第一次拨打结束后的 WhatsApp 消息",
  "注意：",
);
/** 繁体粤语专用字：学姐台词里出现，机主（简体）台词里一个都不该出现。 */
const TRAD = "啱陣連幾係咁唔話兩冇試喎點喺咗啲對搵揀邊畀咪咩學廳餐間";

async function unlockPhone(phone: Locator) {
  await phone.getByRole("button", { name: "轻触解锁" }).click();
  for (const d of PIN)
    await phone.getByRole("button", { name: "密码键" + d }).click();
  await expect(
    phone.getByRole("button", { name: "搜索", exact: true }),
  ).toBeVisible({ timeout: 10000 });
}
async function loadPhone(page: Page): Promise<Locator> {
  await page.route("**/work.json", (route) =>
    route.fulfill({ json: structuredClone(work) }),
  );
  await page.goto("/?fresh=1");
  const phone = page.locator(".phone-shell");
  await unlockPhone(phone);
  await openPhone(phone);
  return phone;
}
async function openApp(phone: Locator, homeKey: string, root: string) {
  await phone.getByRole("button", { name: "返回桌面", exact: true }).click();
  // 主屏重排会让图标节点偶发 detach，整段重试。
  await expect(async () => {
    const icon = phone.locator(`[data-home-key="${homeKey}"]`);
    await icon.scrollIntoViewIfNeeded();
    await icon.click();
  }).toPass({ timeout: 20000 });
  await expect(phone.locator(root)).toBeVisible({ timeout: 15000 });
}
/** 电话在 Dock，属性是 dock:phone。 */
const openPhone = (phone: Locator) =>
  openApp(phone, "dock:phone", ".phone-skin");
const openWhatsApp = (phone: Locator) =>
  openApp(phone, "whatsapp", ".whatsapp-ui");

async function readState(page: Page): Promise<any> {
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
const phoneUi = async (page: Page) => (await readState(page)).ui?.phone ?? {};
const callLog = async (page: Page) => JSON.parse((await phoneUi(page)).callLog ?? "[]");
const phoneState = async (page: Page) =>
  JSON.parse((await phoneUi(page)).phoneState ?? "{}");
const callSession = async (page: Page) => {
  const s = (await phoneUi(page)).callSession ?? "";
  return s ? JSON.parse(s) : null;
};

const tab = (phone: Locator, name: string) =>
  phone.locator(`[data-phone-tab="${name}"]`);
const rows = (phone: Locator) => phone.locator("[data-call-row]");
const bubbles = (phone: Locator) =>
  phone.locator(".phone-call-transcript .phone-bubble:not(.is-typing)");
const phase = (phone: Locator) =>
  phone.locator("[data-call-phase]").getAttribute("data-call-phase");
const status = (phone: Locator) => phone.locator("[data-call-status]").textContent();

/** 从通讯录打开联系人详情并呼叫。 */
async function callContact(phone: Locator, key: string) {
  await tab(phone, "通讯录").click();
  await phone.locator(`[data-contact-row="${key}"]`).click();
  await expect(phone.locator("[data-phone-detail]")).toBeVisible();
  await phone.locator("[data-phone-call-btn]").click();
}
/** 只打开最近通话详情（不发起呼叫，不增加拨打次数）。 */
async function openHistory(phone: Locator, id: string) {
  await tab(phone, "最近通话").click();
  await phone.locator(`[data-call-row="${id}"]`).click();
  await expect(phone.locator("[data-phone-detail]")).toBeVisible();
}
/** 从最近通话详情回拨一条历史记录。 */
async function callHistory(phone: Locator, id: string) {
  await openHistory(phone, id);
  await phone.locator("[data-phone-call-btn]").click();
}
/** 结束态后点「返回最近通话」，回到列表。 */
async function finishToRecents(phone: Locator) {
  await expect(phone.locator('[data-call-phase="ended"]')).toBeVisible({
    timeout: 60000,
  });
  await phone.locator("[data-phone-finish]").click();
  await expect(phone.locator("[data-phone-recents]")).toBeVisible();
}
/** 播完一整段固定对话：先断言「不是一次性出现」，再等全部气泡并逐字比对。 */
async function assertScript(
  phone: Locator,
  lines: { speaker: string; text: string }[],
  script: readonly { side: string; text: string }[],
) {
  await expect(phone.locator('[data-call-phase="connected"]')).toBeVisible({
    timeout: 15000,
  });
  // 逐条逐字：接通瞬间已完整出现的气泡必须少于总条数。
  const early = await bubbles(phone).count();
  expect(early, "不得一次性展示整段对话").toBeLessThan(lines.length);
  await expect(bubbles(phone)).toHaveCount(lines.length, { timeout: 60000 });
  const texts = await bubbles(phone).allTextContents();
  expect(texts).toEqual(lines.map((l) => l.text));
  const owner = script.filter((l) => l.side === "owner").length;
  const peer = script.filter((l) => l.side === "peer").length;
  await expect(phone.locator(".phone-bubble.owner:not(.is-typing)")).toHaveCount(owner);
  await expect(phone.locator(".phone-bubble.peer:not(.is-typing)")).toHaveCount(peer);
  await finishToRecents(phone);
}
// ── 静态数据基线 ───────────────────────────────────────────────────────────
test("验收0｜固定数据与规格逐字一致，事件节点只新增一次", async () => {
  expect(MOM).toHaveLength(10);
  expect(MIMI).toHaveLength(22);
  expect(LL4).toHaveLength(24);
  expect(WA2).toHaveLength(2);
  expect(MOM_SCRIPT.map((l) => l.text)).toEqual(MOM.map((l) => l.text));
  expect(MIMI_SCRIPT.map((l) => l.text)).toEqual(MIMI.map((l) => l.text));
  expect(LINGLING_SCRIPT.map((l) => l.text)).toEqual(LL4.map((l) => l.text));
  expect(FIRST_CALL_WA).toEqual(WA2.map((l) => l.text));
  // 学姐台词繁体粤语 / 机主台词简体中文。
  const peerText = LL4.filter((l) => l.speaker === "鄺學姐")
    .map((l) => l.text)
    .join("");
  const ownerText = LL4.filter((l) => l.speaker === "机主")
    .map((l) => l.text)
    .join("");
  expect([...TRAD].some((c) => peerText.includes(c))).toBe(true);
  expect([...TRAD].filter((c) => ownerText.includes(c))).toEqual([]);

  expect(PHONE_CONTACTS).toHaveLength(3);
  expect(PHONE_CONTACTS.map((c) => c.name)).toEqual([
    "鄺學姐 💙",
    "Mimi",
    "妈妈",
  ]);
  expect(PHONE_HISTORY).toHaveLength(6);
  expect(raw.content.phone).toHaveLength(9);
  expect(work.data.phone).toHaveLength(9);
  expect(raw.content.phone.filter((i: any) => i.meta.kind === "history")).toHaveLength(6);
  expect(raw.content.phone.filter((i: any) => i.meta.kind === "contact")).toHaveLength(3);
  // 历史时间固定，倒序，不合并不同日期。
  expect(PHONE_HISTORY.map((h) => h.time)).toEqual([
    "2026-11-10 20:26",
    "2026-11-10 18:43",
    "2026-11-10 16:17",
    "2026-11-09 22:31",
    "2026-11-09 12:18",
    "2026-11-08 15:26",
  ]);
  // 第一次学姐挂断后的两条消息：独立 ID、粤语繁体、hidden、@now 动态时间。
  const chat = raw.chats.find((c: any) => c.id === "wa-lingling");
  const wa = chat.messages.filter((m: any) => String(m.id).startsWith("msg_phone_lc1_"));
  expect(wa).toHaveLength(2);
  expect(wa.map((m: any) => m.id)).toEqual(WA_IDS);
  expect(wa.map((m: any) => m.body)).toEqual(WA2.map((l) => l.text));
  expect(wa.every((m: any) => m.hidden === true && m.time === "@now")).toBe(true);
  expect(wa.every((m: any) => m.outgoing === false)).toBe(true);
  const node = raw.events.find((e: any) => e.id === "PHONE_LC_001");
  expect(node.event).toBe("variable");
  expect(node.target).toBe("ui:phone:linglingFirstCallEnd");
  expect(node.once).toBe(true);
  expect(node.actions.filter((a: any) => a.type === "unlock").map((a: any) => a.key)).toEqual(WA_IDS);
  expect(node.actions.filter((a: any) => a.type === "variable")).toEqual([
    { type: "variable", key: "PHONE_LC1_SENT", value: true },
  ]);
  expect(raw.variables.PHONE_LC1_SENT).toBe(false);
  // 既有剧情数据未被改写：只 +1 节点、+2 学姐 hidden 消息、+1 content 键。
  expect(raw.events).toHaveLength(14);
  expect(work.nodes).toHaveLength(14);
  expect(work.data.whatsapp).toHaveLength(768);
  expect(Object.keys(raw.content)).toContain("phone");
  expect(raw.chats).toHaveLength(8);
});

// ── 验收 1-6：通讯录、最近通话、详情、回拨入口、新记录置顶、拨号键盘 ────────
test("验收A｜四个页面 / 6 条历史 / 红色未接 / 详情回拨 / 拨号识别", async ({ page }) => {
  test.setTimeout(180000);
  const phone = await loadPhone(page);

  // 1 默认「最近通话」，2 六条预置历史，3 未接来电红色。
  await expect(phone.locator(".phone-scroll > h1")).toHaveText("最近通话");
  await expect(rows(phone)).toHaveCount(6);
  expect(await rows(phone).evaluateAll((els) => els.map((e) => e.getAttribute("data-call-row")))).toEqual(
    PHONE_HISTORY.map((h) => h.id),
  );
  const missed = phone.locator('[data-call-row="call_hist_001"]');
  await expect(missed).toHaveClass(/is-missed/);
  const color = await missed
    .locator("strong")
    .evaluate((e) => getComputedStyle(e).color);
  const [r, g, b] = color.match(/\d+/g)!.map(Number);
  expect(r > g && r > b && r - g > 60, `未接来电应为红色，实际 ${color}`).toBe(true);

  // 1 通讯录 3 人、头像、号码、备注逐字。
  await tab(phone, "通讯录").click();
  await expect(phone.locator("[data-contact-row]")).toHaveCount(3);
  expect(await phone.locator("[data-contact-row] strong").allTextContents()).toEqual(
    PHONE_CONTACTS.map((c) => c.name),
  );
  expect(await phone.locator(".phone-row-number").allTextContents()).toEqual(
    PHONE_CONTACTS.map((c) => c.number),
  );
  // 无头像的联系人退回系统默认头像。
  await expect(phone.locator(".phone-avatar").first()).toBeVisible();

  // 4 点击通话记录进入详情；5 详情页有绿色呼叫按钮并可发起呼叫。
  await openHistory(phone, "call_hist_002");
  await expect(phone.locator("[data-phone-detail]")).toContainText("Mimi");
  await expect(phone.locator("[data-phone-call-btn]")).toBeVisible();
  await phone.locator("[data-phone-call-btn]").click();
  await expect(phone.locator('[data-call-phase="ringing"]')).toBeVisible({ timeout: 5000 });
  expect(await status(phone)).toBe("正在呼叫…");
  await expect(phone.locator("[data-call-timer]")).toHaveText("00:00");
  await expect(phone.locator("[data-call-mute]")).toBeVisible();
  await expect(phone.locator("[data-call-speaker]")).toBeVisible();
  await expect(phone.locator("[data-phone-hangup]")).toBeVisible();
  await phone.locator("[data-phone-hangup]").click();
  await finishToRecents(phone);

  // 6 新通话记录自动排在最上方；历史时间保持原样。
  await expect(rows(phone)).toHaveCount(7);
  const firstId = await rows(phone).first().getAttribute("data-call-row");
  expect(PHONE_HISTORY.some((h) => h.id === firstId)).toBe(false);
  expect(await rows(phone).nth(1).getAttribute("data-call-row")).toBe("call_hist_001");

  // 四个导航页面都存在且可切换。
  for (const t of ["收藏", "通讯录", "拨号键盘", "最近通话"]) {
    await tab(phone, t).click();
    await expect(phone.locator(".phone-scroll > h1")).toHaveText(t);
  }
  await tab(phone, "收藏").click();
  await expect(phone.locator(".phone-empty")).toContainText("暂无收藏联系人");

  // 1.4 拨号键盘 0-9 * # 共 12 键、拨打按钮；已保存号码识别、未保存显示未知号码。
  await tab(phone, "拨号键盘").click();
  await expect(phone.locator("[data-dial-key]")).toHaveCount(12);
  expect(await phone.locator("[data-dial-key]").evaluateAll((els) => els.map((e) => e.textContent?.trim()[0]))).toEqual(
    ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"],
  );
  await expect(phone.locator("[data-dial-display]")).toHaveText("输入号码");
  // 学姐脱敏号码：遮盖位用 * 补位也能识别为已保存联系人。
  for (const k of ["8", "5", "2", "6", "*", "*", "*", "0", "5", "1", "1"])
    await phone.locator(`[data-dial-key="${k}"]`).click();
  await expect(phone.locator("[data-dial-display]")).toHaveText("鄺學姐 💙");
  // 全部清空后换一个未保存号码 → 未知号码。
  for (let i = 0; i < 11; i++)
    await phone.locator("[data-phone-dial-delete]").click();
  for (const k of ["1", "2", "3", "4"]) await phone.locator(`[data-dial-key="${k}"]`).click();
  await expect(phone.locator("[data-dial-display]")).toHaveText("未知号码");
  await expect(phone.locator("[data-phone-dial-call]")).toBeEnabled();
  await expect(phone.locator("[data-phone-dial-call]")).toBeVisible();
});

// ── 验收 7-13：妈妈 / Mimi 固定剧本重复播放 ────────────────────────────────
test("验收B｜妈妈与 Mimi 每次拨打都完整重播同一段固定对话", async ({ page }) => {
  test.setTimeout(240000);
  const phone = await loadPhone(page);

  for (let round = 1; round <= 2; round++) {
    await callContact(phone, "mother");
    await assertScript(phone, MOM, MOM_SCRIPT);
    expect(await callLog(page)).toHaveLength(round);
    expect((await callLog(page))[0].status).toBe("已接听");
  }
  for (let round = 1; round <= 2; round++) {
    await callContact(phone, "mimi");
    await assertScript(phone, MIMI, MIMI_SCRIPT);
    expect(await callLog(page)).toHaveLength(round + 2);
    expect((await callLog(page))[0].status).toBe("已接听");
  }
  // 逐字效果：第三条通话再拨一次妈妈，接通瞬间确认存在正在逐字出现的气泡。
  await callContact(phone, "mother");
  await expect(phone.locator('[data-call-phase="connected"]')).toBeVisible({ timeout: 15000 });
  await expect(phone.locator("[data-call-typing]")).toBeVisible({ timeout: 15000 });
  await phone.locator("[data-phone-hangup]").click();
  await finishToRecents(phone);
  // 提前挂断只保留已经完整显示的内容，不补齐台词。
  const last = (await callLog(page))[0];
  expect(last.lines.length).toBeLessThan(MOM.length);
});

// ── 验收 14-17：陌生号码不接通、不生成对话 ─────────────────────────────────
test("验收C｜三个陌生号码回拨均无人接听且没有任何文字对话", async ({ page }) => {
  test.setTimeout(180000);
  const phone = await loadPhone(page);
  const ids = ["call_hist_003", "call_hist_006", "call_hist_008"];
  for (let i = 0; i < ids.length; i++) {
    const started = Date.now();
    await callHistory(phone, ids[i]);
    await expect(phone.locator('[data-call-phase="ringing"]')).toBeVisible({ timeout: 5000 });
    await expect(phone.locator('[data-call-phase="no_answer"]')).toBeVisible({ timeout: 15000 });
    expect(await status(phone)).toBe("对方暂时无法接通");
    await expect(bubbles(phone)).toHaveCount(0);
    await finishToRecents(phone);
    const elapsed = Date.now() - started;
    expect(elapsed, `第 ${i + 1} 个陌生号码应在 8-12 秒后无人接听`).toBeGreaterThanOrEqual(7900);
    expect(elapsed).toBeLessThan(13000);
    expect(await callLog(page)).toHaveLength(i + 1);
    expect((await callLog(page))[0].status).toBe("无人接听");
    expect((await callLog(page))[0].lines).toHaveLength(0);
  }
  await expect(rows(phone)).toHaveCount(9);
});

// ── 验收 18-29 + 30-34：学姐特殊拨号、WhatsApp、持久化与时间戳 ──────────────
test("验收D｜学姐四次特殊拨号 / WhatsApp 两条消息 / 刷新与续播持久化", async ({ page }) => {
  test.setTimeout(300000);
  const phone = await loadPhone(page);
  const before = (await readState(page)).variables ?? {};

  // 预置历史记录不计入次数：只打开详情、查看 WhatsApp 都不会 +1。
  await openHistory(phone, "call_hist_004");
  await phone.getByRole("button", { name: "返回", exact: true }).click();
  await openWhatsApp(phone);
  await expect(phone.locator(".wa-chat-row", { hasText: LINGLING }).first()).toBeVisible();
  await openPhone(phone);
  expect((await phoneState(page)).lingling_call_attempt_count ?? 0).toBe(0);
  expect((await callLog(page)).length ?? 0).toBe(0);

  // 18 第一次：响铃 → 接通约 5 秒 → 对方挂断，无任何文字对话。
  const firstStart = Date.now();
  await callContact(phone, "lingling");
  await expect(phone.locator('[data-call-phase="connected"]')).toBeVisible({ timeout: 15000 });
  await expect(phone.locator('[data-call-phase="ended"]')).toBeVisible({ timeout: 15000 });
  const connectedSpan = Date.now() - firstStart;
  expect(connectedSpan).toBeGreaterThanOrEqual(6900);
  expect(connectedSpan).toBeLessThan(9000);
  await expect(bubbles(phone)).toHaveCount(0);
  expect(await status(phone)).toContain("对方已挂断");
  const firstRecord = (await callLog(page))[0];
  expect(firstRecord.contactKey).toBe("lingling");
  expect(firstRecord.status).toBe("已接通后对方挂断");
  expect(firstRecord.duration).toMatch(/^00:0[45]$/);
  expect(firstRecord.lines).toHaveLength(0);
  expect((await phoneState(page)).lingling_call_attempt_count).toBe(1);
  await finishToRecents(phone);

  // 19/21/31 只投递一次：两条独立粤语繁体消息、真实投递时间、机主不自动回复。
  await expect
    .poll(async () => (await readState(page)).variables?.PHONE_LC1_SENT, {
      timeout: 15000,
    })
    .toBe(true);
  const s1 = await readState(page);
  expect(s1.completed.filter((x: string) => x === "PHONE_LC_001")).toHaveLength(1);
  expect(WA_IDS.every((id) => s1.unlocked.includes(id))).toBe(true);
  const pack = s1.playback?.PHONE_LC_001;
  expect(pack?.messageIds).toEqual(WA_IDS);
  expect(pack?.thread).toBe(LINGLING);
  expect(pack?.appId).toBe("whatsapp");
  expect(
    WA_IDS.every((id) =>
      work.data.whatsapp.some((i: any) => i.id === id && i.outgoing === false),
    ),
  ).toBe(true);
  const stamp = s1.messageTimes?.[WA_IDS[0]];
  expect(stamp).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  expect(s1.messageTimes?.[WA_IDS[1]]).toBe(stamp);
  expect(
    (s1.notifications ?? []).some(
      (n: string) => n.includes(WA2[0].text) && !n.includes("|now|") && n.startsWith("@whatsapp|"),
    ),
  ).toBe(true);

  // 20 打开 WhatsApp 能看到两条消息；机主没有自动回复。
  await openWhatsApp(phone);
  await phone.locator(".wa-chat-row", { hasText: LINGLING }).first().click();
  await expect
    .poll(
      async () =>
        (await readState(page)).playback?.PHONE_LC_001?.deliveredMessageIds?.length ?? 0,
      { timeout: 60000 },
    )
    .toBe(2);
  await expect(phone.locator(".skin-bubble", { hasText: WA2[0].text })).toBeVisible({ timeout: 15000 });
  await expect(phone.locator(".skin-bubble", { hasText: WA2[1].text })).toBeVisible({ timeout: 15000 });
  const delivered = (await readState(page)).playback.PHONE_LC_001.deliveredMessageIds;
  expect(delivered).toEqual(WA_IDS);

  // 33 刷新后不重复生成记录或消息，历史时间不变，拨打次数保持。
  const logLen = (await callLog(page)).length;
  await page.reload();
  let p2 = page.locator(".phone-shell");
  await unlockPhone(p2);
  await openWhatsApp(p2);
  await p2.locator(".wa-chat-row", { hasText: LINGLING }).first().click();
  await expect(
    p2.locator(".skin-bubble", { hasText: WA2[0].text }),
  ).toHaveCount(1, { timeout: 15000 });
  await expect(
    p2.locator(".skin-bubble", { hasText: WA2[1].text }),
  ).toHaveCount(1, { timeout: 15000 });
  const s2 = await readState(page);
  expect(s2.completed.filter((x: string) => x === "PHONE_LC_001")).toHaveLength(1);
  expect(s2.unlocked.filter((x: string) => x === WA_IDS[0])).toHaveLength(1);
  expect(s2.messageTimes?.[WA_IDS[0]]).toBe(stamp);
  expect((await callLog(page)).length).toBe(logLen);
  expect((await phoneState(page)).lingling_call_attempt_count).toBe(1);

  // 22/23 第二、三次忙线，不接通、不对话、不再发 WhatsApp 消息。
  await openPhone(p2);
  for (const n of [2, 3]) {
    await callContact(p2, "lingling");
    await expect(p2.locator('[data-call-phase="busy"]')).toBeVisible({ timeout: 8000 });
    expect(await status(p2)).toBe("线路忙线，请稍后再试");
    await expect(bubbles(p2)).toHaveCount(0);
    await finishToRecents(p2);
    expect((await phoneState(page)).lingling_call_attempt_count).toBe(n);
  }
  expect(await callLog(page)).toHaveLength(3);
  expect((await readState(page)).playback.PHONE_LC_001.messageIds).toEqual(WA_IDS);

  // 24/25/26 第四次接通并逐条逐字播放 24 条固定对话。
  await callContact(p2, "lingling");
  await expect(p2.locator('[data-call-phase="connected"]')).toBeVisible({ timeout: 15000 });
  expect((await phoneState(page)).lingling_call_attempt_count).toBe(4);
  // 29 中途退出：等到至少 4 条已完整显示，再离开 App / 刷新。
  await expect
    .poll(async () => Number((await callSession(page))?.lineIndex ?? 0), {
      timeout: 60000,
    })
    .toBeGreaterThanOrEqual(4);
  const saved = await callSession(page);
  const shownBefore = saved.lines.map((l: any) => l.text);
  // 通话中途走通话界面自己的返回入口离开 App（不是挂断，不补齐台词）。
  await p2.locator("[data-phone-call-back]").click();
  await expect(p2.locator(".phone-skin")).toHaveCount(0);
  await page.reload();
  p2 = page.locator(".phone-shell");
  await unlockPhone(p2);
  await openPhone(p2);
  await expect(p2.locator("[data-call-phase]")).toBeVisible({ timeout: 15000 });
  const restored = await callSession(page);
  expect(restored.id).toBe(saved.id);
  expect(restored.lineIndex).toBeGreaterThanOrEqual(saved.lineIndex);
  // 已显示内容不重播、不重复生成，前缀逐字保持。
  expect(restored.lines.slice(0, shownBefore.length).map((l: any) => l.text)).toEqual(shownBefore);
  await expect(bubbles(p2)).toHaveCount(24, { timeout: 90000 });
  expect(await bubbles(p2).allTextContents()).toEqual(LL4.map((l) => l.text));
  await finishToRecents(p2);
  const fourth = (await callLog(page)).find((r: any) => r.contactKey === "lingling" && r.lines.length === 24);
  expect(fourth).toBeTruthy();
  expect(fourth.status).toBe("已接听");
  expect(fourth.lines.map((l: any) => l.text)).toEqual(LL4.map((l) => l.text));
  expect((await phoneState(page)).fourthCompleted).toBe(true);

  // 28 第五次及以后：普通无人接听，不重播特殊对话、不重复 WhatsApp 消息。
  await callContact(p2, "lingling");
  await expect(p2.locator('[data-call-phase="no_answer"]')).toBeVisible({ timeout: 15000 });
  expect(await status(p2)).toBe("对方暂时无法接通");
  await expect(bubbles(p2)).toHaveCount(0);
  await finishToRecents(p2);
  expect((await phoneState(page)).lingling_call_attempt_count).toBe(5);

  // 30/32/34 新通话用真实本地时间、历史时间不变、刷新后状态不丢。
  const finalLog = await callLog(page);
  expect(finalLog).toHaveLength(5);
  const nowStamp = new Date();
  const local = `${nowStamp.getFullYear()}-${String(nowStamp.getMonth() + 1).padStart(2, "0")}-${String(nowStamp.getDate()).padStart(2, "0")}`;
  for (const r of finalLog) {
    expect(r.startAt.startsWith(local), `新通话时间应为今天：${r.startAt}`).toBe(true);
    expect(r.endedAt.startsWith(local)).toBe(true);
  }
  expect(await rows(p2)).toHaveCount(11); // 6 历史 + 5 新通话
  await page.reload();
  const p3 = page.locator(".phone-shell");
  await unlockPhone(p3);
  await openPhone(p3);
  expect(await rows(p3)).toHaveCount(11);
  expect((await phoneState(page)).lingling_call_attempt_count).toBe(5);
  expect((await phoneState(page)).fourthCompleted).toBe(true);
  expect((await callLog(page))[0].startAt).toBe(finalLog[0].startAt);
  expect(PHONE_HISTORY.map((h) => h.time)).toEqual([
    "2026-11-10 20:26",
    "2026-11-10 18:43",
    "2026-11-10 16:17",
    "2026-11-09 22:31",
    "2026-11-09 12:18",
    "2026-11-08 15:26",
  ]);
  const s3 = await readState(page);
  expect(s3.completed.filter((x: string) => x === "PHONE_LC_001")).toHaveLength(1);
  expect(s3.variables.PHONE_LC1_SENT).toBe(true);
  // 其它既有剧情变量没有被电话模块改写。
  for (const [k, v] of Object.entries(before)) {
    if (k === "PHONE_LC1_SENT") continue;
    expect(s3.variables[k], `既有变量 ${k} 不应被改动`).toBe(v);
  }
});
