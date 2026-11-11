/**
 * WA_LC_001｜明年的主唱：幂等把固定消息包与事件节点写入 story.json。
 *
 * 数据源：data/wa-lc001/乐队群聊触发事件.txt（用户桌面规格的字节一致副本）。
 * 第三章表格的 9 条消息逐字照抄：不创作、不续写、不润色、不删减、不改顺序、
 * 不改发信人；发送者复用现有群聊成员身份与头像（senderId → 现有联系人）。
 *
 * 【字段映射：以兼容现有系统为优先】
 *   规格概念            → 现有结构
 *   WA_EP00_COMPLETE    → completed:WA_EP00_COMPLETE（开场节点）+ 变量
 *                          WA_EP00_DIALOGUE_COMPLETE（学姐指定私聊「完整结束」）
 *   MIMI_001_COMPLETE   → playback:MIMI-001 == completed（现有 EventPlayback 完成态）
 *   notes_reviewed      → variables.notes_reviewed（离开 App 时才写入）
 *   photos_reviewed     → variables.photos_reviewed（离开 App 时才写入）
 *   WA_LC_001 未触发    → variables.WA_LC_001_TRIGGERED != true + 节点 once
 *   9 条消息            → chats[wa-late-checkout].messages 末尾的 hidden 事件消息
 *                          （time 用 @now 占位，真实时间由运行时在触发时持久化）
 *
 * 用法：node scripts/import-wa-lc001.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STORY_PATH = path.join(ROOT, "stories/template/story.json");
const SPEC_PATH = path.join(ROOT, "data/wa-lc001/乐队群聊触发事件.txt");

const CHAT_ID = "wa-late-checkout";
const NODE_ID = "WA_LC_001";
const PREFIX = "msg_lc001_";
/** 规格表格里的发送者 → 现有群聊成员（contacts 里的稳定 id）。 */
const SENDERS = {
  键盘手: "keyboard_c",
  鼓手: "drummer_a",
  鄺學姐: "lingling",
};
const ROW_RE = /^\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|\s*(.*?)\s*\|\s*$/;

/** 从规格第三章表格逐行解析，保留消息原文。 */
export function parseSpec(text = fs.readFileSync(SPEC_PATH, "utf8")) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l.includes("## 三、群聊固定消息内容"));
  const end = lines.findIndex(
    (l, i) => i > start && l.startsWith("## 四、"),
  );
  if (start < 0 || end < 0) throw new Error("规格第三章/第四章定位失败");
  const rows = [];
  for (const line of lines.slice(start, end)) {
    const m = ROW_RE.exec(line);
    if (!m) continue;
    const no = Number(m[1]);
    const sender = m[2];
    if (!(sender in SENDERS))
      throw new Error(`第 ${no} 条发送者「${sender}」不是现有群聊成员`);
    rows.push({ no, sender, senderId: SENDERS[sender], body: m[3] });
  }
  if (rows.length !== 9) throw new Error(`应解析出 9 条消息，实际 ${rows.length}`);
  for (let i = 0; i < 9; i++)
    if (rows[i].no !== i + 1) throw new Error(`消息顺序异常：第 ${i + 1} 行`);
  return rows;
}

export function buildMessages() {
  return parseSpec().map((r) => ({
    id: `${PREFIX}${String(r.no).padStart(2, "0")}`,
    body: r.body,
    time: "@now",
    senderId: r.senderId,
    outgoing: false,
    hidden: true,
    meta: { sourceId: "group_late_checkout" },
    sender: r.sender,
    folder: "群组",
  }));
}

export function buildNode() {
  const messages = buildMessages();
  return {
    id: NODE_ID,
    label: "明年的主唱 · 乐队群聊新消息",
    type: "event",
    event: "home",
    target: "",
    conditions: [
      { key: "completed:WA_EP00_COMPLETE", op: "eq", value: true },
      { key: "WA_EP00_DIALOGUE_COMPLETE", op: "eq", value: true },
      { key: "playback:MIMI-001", op: "eq", value: "completed" },
      { key: "notes_reviewed", op: "eq", value: true },
      { key: "photos_reviewed", op: "eq", value: true },
      { key: "WA_LC_001_TRIGGERED", op: "neq", value: true },
    ],
    logic: "and",
    once: true,
    actions: [
      ...messages.map((m) => ({ type: "unlock", key: m.id, value: "" })),
      { type: "variable", key: "WA_LC_001_TRIGGERED", value: true },
      {
        type: "notification",
        key: "whatsapp",
        value:
          "@whatsapp|now|Late Checkout 🎸|" +
          messages[0].body +
          "|>whatsapp:Late Checkout 🎸",
      },
    ],
  };
}

function strip(s) {
  const copy = JSON.parse(JSON.stringify(s));
  const chat = copy.chats.find((c) => c.id === CHAT_ID);
  chat.messages = chat.messages.filter((m) => !m.id.startsWith(PREFIX));
  copy.events = copy.events.filter((e) => e.id !== NODE_ID);
  for (const k of ["notes_reviewed", "photos_reviewed", "WA_LC_001_TRIGGERED"])
    delete copy.variables[k];
  return JSON.stringify(copy);
}

function main() {
  const beforeText = fs.readFileSync(STORY_PATH, "utf8");
  const story = JSON.parse(beforeText);
  const beforeOther = strip(story);

  const chat = story.chats.find((c) => c.id === CHAT_ID);
  if (!chat) throw new Error(`群聊 ${CHAT_ID} 不存在`);
  if (chat.kind !== "group" || !chat.groupAvatar)
    throw new Error("群聊缺少 kind/groupAvatar，不得新建重复会话");

  const messages = buildMessages();
  chat.messages = [
    ...chat.messages.filter((m) => !m.id.startsWith(PREFIX)),
    ...messages,
  ];
  story.events = [...story.events.filter((e) => e.id !== NODE_ID), buildNode()];
  story.variables = {
    ...story.variables,
    notes_reviewed: false,
    photos_reviewed: false,
    WA_LC_001_TRIGGERED: false,
  };

  if (strip(story) !== beforeOther)
    throw new Error("除目标消息/事件/变量外不得改动 story.json 的任何字段");

  const previous = JSON.parse(beforeText).chats.find(
    (c) => c.id === CHAT_ID,
  ).messages.filter((m) => m.id.startsWith(PREFIX));
  const unchanged = JSON.stringify(previous) === JSON.stringify(messages);
  const text = JSON.stringify(story, null, 2) + "\n";
  if (text !== beforeText) fs.writeFileSync(STORY_PATH, text, "utf8");

  console.log(
    `WA_LC_001 imported: ${messages.length} 条固定消息` +
      ` | 发信人 ${[...new Set(messages.map((m) => m.sender))].join("/")}` +
      ` | 群聊 ${CHAT_ID} 共 ${chat.messages.length} 条` +
      ` | ${unchanged ? "幂等（无改动）" : "已写入 story.json"}`,
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main();
