/**
 * WA_LC_002｜想當面說的話：幂等把最终私聊的 46 条固定消息与事件节点写入 story.json。
 *
 * 数据源：data/wa-lc002/想當面說的話.txt（用户规格逐字副本）。
 * 第四章 1..46 条逐字照抄：不创作、不续写、不润色、不删减、不改顺序、不改发信人。
 * 规格开头写「47 条」、第四章写「46条消息」，实际编号列表 1..46 共 46 条，
 * 以逐条列表为准（脚本会强校验 46 条且编号连续）。
 *
 * 【字段映射：完全沿用现有系统，不新增全局状态结构】
 *   46 条消息        → chats[wa-lingling].messages 末尾的 hidden 事件消息
 *                      （沿用现有学姐私聊会话，不新建重复联系人；time 用 @now 占位）
 *   触发事件          → event:"wa_lc001_read"（Phone.goHome 从 WhatsApp 返回主屏时派发）
 *   WA_LC_001 已触发  → completed:WA_LC_001
 *   已打开 WhatsApp   → visited:whatsapp（现有 openApp 导航状态）
 *   打开群聊且看完 9 条 → playback:WA_LC_001 == completed
 *                      （现有 EventPlayback 完成态：消息包只在玩家打开该会话时逐条播放，
 *                       因此「completed」同时保证已打开群聊且 9 条全部看完）
 *   阅读完成标记      → variables.WA_LC_001_READ_COMPLETE（触发时落盘，便于观察 / 测试）
 *   未触发            → variables.WA_LC_002_TRIGGERED != true + 节点 once
 *   播放完成态        → 沿用 Runtime.playback["WA_LC_002"].playbackStatus == "completed"
 *                      （不另建 WA_LC_002_PLAYBACK_COMPLETE 变量，优先复用统一结构）
 *   通知              → 现有 @whatsapp|now|会话|摘要|>whatsapp:会话 结构化通知
 *
 * 用法：node scripts/import-wa-lc002.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STORY_PATH = path.join(ROOT, "stories/template/story.json");
const SPEC_PATH = path.join(ROOT, "data/wa-lc002/想當面說的話.txt");

const CHAT_ID = "wa-lingling";
const GROUP_CHAT_ID = "wa-late-checkout";
const NODE_ID = "WA_LC_002";
const PREFIX = "msg_lc002_";
const PEER = "鄺學姐";
const OWNER = "机主";
/** 规格第四章逐条列表： `1. **鄺學姐：** 第一次見你喺群組入面咁安靜。` */
const ROW_RE = /^(\d+)\.\s+\*\*(.+?)：\*\*\s*(.+?)\s*$/;

/** 从规格第四章逐行解析，保留消息原文（含前导 / 尾随空格、繁简混用、Emoji）。 */
export function parseSpec(text = fs.readFileSync(SPEC_PATH, "utf8")) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith("## 四、固定对话内容"));
  const end = lines.findIndex(
    (l, i) => i > start && l.startsWith("## 五、"),
  );
  if (start < 0 || end < 0) throw new Error("规格第四章/第五章定位失败");
  const rows = [];
  for (const line of lines.slice(start, end)) {
    const m = ROW_RE.exec(line);
    if (!m) continue;
    const no = Number(m[1]);
    const sender = m[2];
    if (sender !== PEER && sender !== OWNER)
      throw new Error(`第 ${no} 条发送者「${sender}」不在规格允许的两种身份内`);
    rows.push({ no, sender, body: m[3] });
  }
  if (rows.length !== 46)
    throw new Error(`规格第四章应有 46 条固定消息，实际 ${rows.length} 条`);
  for (let i = 0; i < 46; i++)
    if (rows[i].no !== i + 1)
      throw new Error(`消息顺序异常：第 ${i + 1} 行编号 ${rows[i].no}`);
  return rows;
}

export function buildMessages() {
  return parseSpec().map((r) => ({
    id: `${PREFIX}${String(r.no).padStart(2, "0")}`,
    body: r.body,
    time: "@now",
    senderId: r.sender === OWNER ? "owner" : "lingling",
    ...(r.sender === OWNER ? {} : { sender: PEER }),
    outgoing: r.sender === OWNER,
    hidden: true,
  }));
}

export function buildNode(linglingTitle) {
  const messages = buildMessages();
  return {
    id: NODE_ID,
    label: "想當面說的話 · 最終私聊",
    type: "event",
    event: "wa_lc001_read",
    target: "whatsapp",
    conditions: [
      { key: "completed:WA_LC_001", op: "eq", value: true },
      { key: "visited:whatsapp", op: "eq", value: true },
      { key: "playback:WA_LC_001", op: "eq", value: "completed" },
      { key: "WA_LC_002_TRIGGERED", op: "neq", value: true },
    ],
    logic: "and",
    once: true,
    actions: [
      ...messages.map((m) => ({ type: "unlock", key: m.id, value: "" })),
      { type: "variable", key: "WA_LC_001_READ_COMPLETE", value: true },
      { type: "variable", key: "WA_LC_002_TRIGGERED", value: true },
      {
        type: "notification",
        key: "whatsapp",
        value:
          `@whatsapp|now|${linglingTitle}|` +
          messages[0].body +
          `|>whatsapp:${linglingTitle}`,
      },
    ],
  };
}

/** 幂等校验：把本脚本负责的字段剥离后，story.json 其余内容必须逐字节一致。 */
function strip(s) {
  const copy = JSON.parse(JSON.stringify(s));
  const chat = copy.chats.find((c) => c.id === CHAT_ID);
  chat.messages = chat.messages.filter((m) => !m.id.startsWith(PREFIX));
  copy.events = copy.events.filter((e) => e.id !== NODE_ID);
  for (const k of ["WA_LC_001_READ_COMPLETE", "WA_LC_002_TRIGGERED"])
    delete copy.variables[k];
  return JSON.stringify(copy);
}

function main() {
  const beforeText = fs.readFileSync(STORY_PATH, "utf8");
  const story = JSON.parse(beforeText);
  const beforeOther = strip(story);

  const chat = story.chats.find((c) => c.id === CHAT_ID);
  const group = story.chats.find((c) => c.id === GROUP_CHAT_ID);
  if (!chat || !group) throw new Error("学姐私聊或乐队群聊不存在");
  if (chat.title !== "邝学姐 💙")
    throw new Error("沿用现有学姐私聊会话，不得新建或改名");
  if (group.kind !== "group")
    throw new Error("Late Checkout 必须是现有群聊");

  const messages = buildMessages();
  chat.messages = [
    ...chat.messages.filter((m) => !m.id.startsWith(PREFIX)),
    ...messages,
  ];
  story.events = [
    ...story.events.filter((e) => e.id !== NODE_ID),
    buildNode(chat.title),
  ];
  story.variables = {
    ...story.variables,
    WA_LC_001_READ_COMPLETE: false,
    WA_LC_002_TRIGGERED: false,
  };

  if (strip(story) !== beforeOther)
    throw new Error("除目标消息/事件/变量外不得改动 story.json 的任何字段");

  const previous = JSON.parse(beforeText).chats
    .find((c) => c.id === CHAT_ID)
    .messages.filter((m) => m.id.startsWith(PREFIX));
  const unchanged = JSON.stringify(previous) === JSON.stringify(messages);
  const text = JSON.stringify(story, null, 2) + "\n";
  if (text !== beforeText) fs.writeFileSync(STORY_PATH, text, "utf8");

  console.log(
    `WA_LC_002 imported: ${messages.length} 条固定消息` +
      ` | 发信人 ${[...new Set(messages.map((m) => m.senderId))].join("/")}` +
      ` | 私聊 ${CHAT_ID} 共 ${chat.messages.length} 条` +
      ` | 机主 ${messages.filter((m) => m.outgoing).length} 条` +
      ` | ${unchanged ? "幂等（无改动）" : "已写入 story.json"}`,
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main();
