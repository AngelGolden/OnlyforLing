/**
 * 幂等导入「PHONE APP｜电话模块搭建规格」。
 *
 * 唯一数据源：data/phone-app/电话模块搭建规格.txt（用户原文逐字副本）。
 * 本脚本从原文解析联系人 / 历史通话 / 三段固定对话 / 第一次挂断后的两条
 * WhatsApp 消息，绝不自行创作、改写、删减或调换顺序。
 *
 * 落地位置：
 *   1. story.json 的 content.phone —— 6 条固定历史通话 + 3 个通讯录联系人
 *   2. story.json 的 chats[wa-lingling].messages 末尾 —— 2 条 hidden 事件消息
 *   3. story.json 的 events —— PHONE_LC_001 节点（由 ui 变化派发的 variable 事件触发）
 *   4. story.json 的 variables —— PHONE_LC1_SENT
 *   5. src/skins/phone-data.ts —— 三段固定通话剧本（运行时唯一台词来源）
 *
 * 第一章写「47 条」之类的笔误与本规格无关；本规格以逐条列表为准。
 * 学姐特殊拨号历史记录 call_hist_004 只是静态历史，不参与运行时计数。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SPEC = resolve(ROOT, "data/phone-app/电话模块搭建规格.txt");
const STORY = resolve(ROOT, "stories/template/story.json");
const DATA_TS = resolve(ROOT, "src/skins/phone-data.ts");

const text = readFileSync(SPEC, "utf8").replace(/\r\n/g, "\n");

function section(start, end) {
  const a = text.indexOf(start);
  if (a < 0) throw new Error(`规格缺少章节：${start}`);
  const from = a + start.length;
  const b = end ? text.indexOf(end, from) : -1;
  if (end && b < 0) throw new Error(`规格缺少章节结束标记：${end}`);
  return text.slice(from, end ? b : text.length);
}
function rows(src) {
  return src
    .split("\n")
    .filter((l) => l.startsWith("|"))
    .map((l) => l.slice(1, -1).split("|").map((s) => s.trim()))
    .filter((c) => c.length >= 2 && !c.every((s) => /^:?-{2,}:?$/.test(s)));
}
/** `**妈妈：** 台词` → { speaker, body }，全角冒号与空格原样处理。 */
const LINE_RE = /^\*\*(.+?)：\*\*\s*(.+?)\s*$/;
function lines(src, label) {
  const out = src
    .split("\n")
    .map((l) => LINE_RE.exec(l.trim()))
    .filter(Boolean)
    .map((m) => ({ speaker: m[1], body: m[2] }));
  if (!out.length) throw new Error(`${label} 没有解析到任何固定台词`);
  return out;
}

// ---- 1.2 通讯录 ------------------------------------------------------------
const CONTACT_ROWS = rows(section("## 1.2 通讯录页面", "## 1.3 收藏页面"))
  .filter((c) => c[0] !== "联系人名称" && c.length >= 3);
if (CONTACT_ROWS.length !== 3)
  throw new Error(`通讯录应为 3 个联系人，实际 ${CONTACT_ROWS.length}`);
const CONTACT_KEYS = ["lingling", "mimi", "mother"];
const CONTACTS = CONTACT_ROWS.map((c, i) => ({
  key: CONTACT_KEYS[i],
  name: c[0],
  number: c[1],
  note: c[2],
}));

// ---- 二、预置最近通话 ------------------------------------------------------
const HISTORY_ROWS = rows(section("# 二、预置最近通话记录", "### 历史记录的说明"))
  .filter((c) => c[0] !== "ID" && c.length >= 6 && /^`?call_hist_/.test(c[0]));
if (HISTORY_ROWS.length !== 6)
  throw new Error(`历史通话应为 6 条，实际 ${HISTORY_ROWS.length}`);
const HISTORY = HISTORY_ROWS.map((c) => ({
  id: c[0].replace(/`/g, ""),
  time: c[1],
  name: c[2],
  direction: c[3],
  status: c[4],
  duration: c[5] === "—" ? "" : c[5],
}));

// ---- 三段固定通话 ----------------------------------------------------------
const MOM_LINES = lines(section("## 4.2 固定对话", "## 4.3 显示规则"), "妈妈对话");
const MIMI_LINES = lines(section("## 5.2 固定对话", "## 5.3 显示规则"), "Mimi 对话");
const LINGLING_LINES = lines(
  section("### 第四次通话固定对话", "### 对话结束后的处理"),
  "学姐第四次通话",
);
// 数量按规格第四章「逐条列表」核对：妈妈 10 / Mimi 22 / 学姐第四次 24。
if (MOM_LINES.length !== 10) throw new Error(`妈妈对话应为 10 条，实际 ${MOM_LINES.length}`);
if (MIMI_LINES.length !== 22) throw new Error(`Mimi 对话应为 22 条，实际 ${MIMI_LINES.length}`);
if (LINGLING_LINES.length !== 24)
  throw new Error(`学姐第四次对话应为 24 条，实际 ${LINGLING_LINES.length}`);

// ---- 7.1 第一次挂断后的两条 WhatsApp 消息 --------------------------------
const WA_LINES = lines(
  section("### 第一次拨打结束后的 WhatsApp 消息", "注意："),
  "第一次挂断后的 WhatsApp 消息",
);
if (WA_LINES.length !== 2)
  throw new Error(`第一次挂断应发送 2 条 WhatsApp 消息，实际 ${WA_LINES.length}`);
if (WA_LINES.some((l) => l.speaker !== "鄺學姐"))
  throw new Error("第一次挂断的两条消息必须都来自鄺學姐");

const OWNER = "机主";
const PEERS = { mom: "妈妈", mimi: "Mimi", lingling: "鄺學姐" };
function toScript(src, peer) {
  return src.map((l) => ({
    side: l.speaker === OWNER ? "owner" : "peer",
    text: l.body,
    ...(l.speaker === OWNER ? {} : { speaker: l.speaker }),
  }));
}
function assertScript(script, peer, label) {
  for (const l of script)
    if (l.side === "peer" && l.speaker !== peer)
      throw new Error(`${label} 出现非 ${peer} 的对方台词：${l.speaker}`);
}
const MOM_SCRIPT = toScript(MOM_LINES);
const MIMI_SCRIPT = toScript(MIMI_LINES);
const LINGLING_SCRIPT = toScript(LINGLING_LINES);
assertScript(MOM_SCRIPT, PEERS.mom, "妈妈对话");
assertScript(MIMI_SCRIPT, PEERS.mimi, "Mimi 对话");
assertScript(LINGLING_SCRIPT, PEERS.lingling, "学姐第四次对话");

const UNKNOWN_NUMBERS = HISTORY.filter(
  (h) => !CONTACTS.some((c) => c.name === h.name),
).map((h) => h.name);
if (UNKNOWN_NUMBERS.length !== 3)
  throw new Error(`应有 3 个陌生号码，实际 ${UNKNOWN_NUMBERS.length}`);

// ---- 生成运行台词数据（唯一台词来源） -------------------------------------
const q = JSON.stringify;
const dataTs = `/**
 * 由 scripts/import-phone.mjs 从 data/phone-app/电话模块搭建规格.txt 逐字生成。
 * 请勿手工改写台词、顺序或发言人；重新运行导入脚本即可再生成。
 * 通话剧本是固定内容：运行时只按索引读取，不允许临场生成对话。
 */
export type CallLine = {
  side: "peer" | "owner";
  text: string;
  speaker?: string;
};

export const PHONE_CONTACTS = ${q(CONTACTS)} as ReadonlyArray<{
  key: string;
  name: string;
  number: string;
  note: string;
}>;

export const PHONE_HISTORY = ${q(HISTORY)} as ReadonlyArray<{
  id: string;
  time: string;
  name: string;
  direction: string;
  status: string;
  duration: string;
}>;

export const UNKNOWN_NUMBERS: readonly string[] = ${q(UNKNOWN_NUMBERS)};

export const MOM_SCRIPT: readonly CallLine[] = ${q(MOM_SCRIPT)};
export const MIMI_SCRIPT: readonly CallLine[] = ${q(MIMI_SCRIPT)};
export const LINGLING_SCRIPT: readonly CallLine[] = ${q(LINGLING_SCRIPT)};

export const FIRST_CALL_WA: readonly string[] = ${q(WA_LINES.map((l) => l.body))};

/** 响铃 / 忙音 / 无人接听时长（毫秒），取规格允许区间的下界，便于验收。 */
export const RING_MS = 2400;
export const BUSY_MS = 3500;
export const NO_ANSWER_MS = 8000;
export const FIRST_LINGLING_CONNECTED_MS = 5000;
/** 逐字出现速度，与 WhatsApp v1.2 固定回复保持同一手感。 */
export const CHAR_MS = 28;
export const LINE_GAP_MS = 260;
`;

// ---- 组装 story.json 改动 --------------------------------------------------
const WA_PREFIX = "msg_phone_lc1_";
const NODE_ID = "PHONE_LC_001";
const TRIGGER_KEY = "linglingFirstCallEnd";
const CHAT_ID = "wa-lingling";
const LINGLING_TITLE = "邝学姐 💙";
const NOTIFICATION =
  `@whatsapp|now|${LINGLING_TITLE}|${WA_LINES[0].body}|>whatsapp:${LINGLING_TITLE}`;

const raw = JSON.parse(readFileSync(STORY, "utf8"));
const original = JSON.parse(readFileSync(STORY, "utf8"));
const avatars = {
  lingling: raw.contacts.find((c) => c.id === "lingling")?.avatar ?? "",
  // Mimi 的 WhatsApp 头像是 mimi_friend（唯一），通讯录显示名按规格为「Mimi」。
  mimi: raw.contacts.find((c) => c.id === "mimi_friend")?.avatar ?? "",
  mother: raw.contacts.find((c) => c.id === "mother")?.avatar ?? "",
};

const historyItems = HISTORY.map((h) => {
  const contact = CONTACTS.find((c) => c.name === h.name);
  return {
    id: h.id,
    title: h.name,
    body: "",
    time: h.time,
    sender: "",
    kind: "call",
    folder: "history",
    meta: {
      kind: "history",
      number: contact ? contact.number : h.name,
      direction: h.direction,
      status: h.status,
      duration: h.duration,
      contactKey: contact ? contact.key : "",
    },
  };
});
const contactItems = CONTACTS.map((c) => ({
  id: `phone_contact_${c.key}`,
  title: c.name,
  body: c.note,
  time: "",
  sender: "",
  folder: "contacts",
  meta: { kind: "contact", number: c.number, note: c.note, contactKey: c.key },
  ...(avatars[c.key] ? { avatar: avatars[c.key] } : {}),
}));
const contentPhone = [...historyItems, ...contactItems];

const waMessages = WA_LINES.map((l, i) => ({
  id: `${WA_PREFIX}${String(i + 1).padStart(2, "0")}`,
  body: l.body,
  time: "@now",
  senderId: "lingling",
  sender: "鄺學姐",
  outgoing: false,
  hidden: true,
}));

const node = {
  id: NODE_ID,
  label: "第一次撥打學姐掛斷後的兩條 WhatsApp 訊息",
  type: "event",
  event: "variable",
  target: `ui:phone:${TRIGGER_KEY}`,
  conditions: [
    { key: `ui:phone:${TRIGGER_KEY}`, op: "eq", value: true },
    { key: "PHONE_LC1_SENT", op: "neq", value: true },
  ],
  logic: "and",
  once: true,
  actions: [
    ...waMessages.map((m) => ({ type: "unlock", key: m.id, value: "" })),
    { type: "variable", key: "PHONE_LC1_SENT", value: true },
    { type: "notification", key: "whatsapp", value: NOTIFICATION },
  ],
};

// 幂等写入：只替换本脚本负责的 5 个位置。
raw.content.phone = contentPhone;
const chat = raw.chats.find((c) => c.id === CHAT_ID);
if (!chat) throw new Error(`找不到会话 ${CHAT_ID}`);
chat.messages = [
  ...chat.messages.filter((m) => !String(m.id).startsWith(WA_PREFIX)),
  ...waMessages,
];
raw.events = [
  ...raw.events.filter((e) => e.id !== NODE_ID),
  node,
];
raw.variables.PHONE_LC1_SENT = raw.variables.PHONE_LC1_SENT ?? false;

// strip()：除本脚本负责的字段外，story.json 其余内容必须逐字不变。
function stripped(w) {
  const c = JSON.parse(JSON.stringify(w));
  delete c.content.phone;
  c.chats = c.chats.map((x) =>
    x.id !== CHAT_ID
      ? x
      : {
          ...x,
          messages: x.messages.filter(
            (m) => !String(m.id).startsWith(WA_PREFIX),
          ),
        },
  );
  c.events = c.events.filter((e) => e.id !== NODE_ID);
  delete c.variables.PHONE_LC1_SENT;
  return c;
}
if (JSON.stringify(stripped(raw)) !== JSON.stringify(stripped(original)))
  throw new Error("story.json 出现了本脚本范围之外的改动，已中止");

const changed = JSON.stringify(raw) !== JSON.stringify(original);
if (changed) writeFileSync(STORY, JSON.stringify(raw, null, 2) + "\n", "utf8");
writeFileSync(DATA_TS, dataTs, "utf8");

console.log(
  `电话模块导入：${CONTACTS.length} 联系人 / ${HISTORY.length} 条历史通话 / ` +
    `${MOM_SCRIPT.length}+${MIMI_SCRIPT.length}+${LINGLING_SCRIPT.length} 条固定台词 / ` +
    `${waMessages.length} 条 WhatsApp 事件消息 / 1 个事件节点`,
);
console.log(changed ? "已写入 story.json" : "幂等（无改动）");
