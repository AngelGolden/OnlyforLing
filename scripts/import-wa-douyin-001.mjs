/**
 * 抖音浏览完成事件｜WA_DOUYIN_001 幂等导入。
 *
 * 数据源：data/douyin-wadouyin001/抖音浏览完成事件｜学姐发送 WhatsApp 消息.txt
 * （桌面规格的逐字副本，导入脚本与验收测试都从它独立解析，禁止 AI 改写台词 / 顺序 / 发信人）。
 *
 * 【复用既有机制，不新建结构】
 *   4 条消息   → chats[wa-lingling].messages 末尾的 hidden 事件消息（time:"@now"）
 *   触发事件   → event:"variable" + target:"ui:douyin:viewCompleted"
 *               由抖音 Skin 在「从第 1 条起依次浏览、第 8 条成功显示」时 onUi 派发；
 *               加载失败 / 跳转 / 只看部分 / 重复浏览都不派发。
 *   去重       → variables.WA_DOUYIN_001_TRIGGERED != true + 节点 once
 *   播放完成态 → 沿用 Runtime.playback["WA_DOUYIN_001"].playbackStatus == "completed"
 *               （与 WA_MUSIC_001 / WA_LC_002 相同，不另建 PLAYBACK_COMPLETE 变量）
 *   通知       → 既有 @whatsapp|now|会话|摘要|>whatsapp:会话 结构化通知
 *   时间戳     → @now 占位 + withEventTimes 在消息包首次入队时写真实设备本地时间并持久化
 *
 * 用法：node scripts/import-wa-douyin-001.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SPEC_PATH = path.join(
  ROOT,
  "data/douyin-wadouyin001/抖音浏览完成事件｜学姐发送 WhatsApp 消息.txt",
);
const STORY_PATH = path.join(ROOT, "stories/template/story.json");

const CHAT_ID = "wa-lingling";
const NODE_ID = "WA_DOUYIN_001";
const MSG_PREFIX = "msg_wa_douyin_001_";
const VAR_KEY = "WA_DOUYIN_001_TRIGGERED";
const UI_TARGET = "ui:douyin:viewCompleted";
/** 隐藏消息的发信人沿用学姐既有隐藏包，不新建联系人、不改会话标题。 */
const PEER = "鄺學姐";

const SPEC = fs.readFileSync(SPEC_PATH, "utf8").replace(/^\uFEFF/, "");
const LINES = SPEC.split(/\r?\n/);

const pick = (re, label) => {
  const m = re.exec(SPEC);
  if (!m) throw new Error(`规格里找不到「${label}」，请检查逐字副本`);
  return m[1].trim();
};

/** 第二章：事件 ID / 事件名称。 */
const eventId = pick(/^`([A-Z_0-9]+)`\s*$/m, "事件 ID");
if (eventId !== NODE_ID)
  throw new Error(`事件 ID 与规格不一致：${eventId} / ${NODE_ID}`);
const LABEL = pick(
  /^(浏览完抖音八条视频后，.+?。)\s*$/m,
  "事件名称",
);

/**
 * 第四章：四条固定消息。`**第N条：**` 之后第一个非空行即台词正文，
 * 逐字照抄（含「你呢 你鍾意香港嗎」中间的空格），不做繁简转换以外的任何改写。
 */
function parseBodies() {
  const start = LINES.findIndex((l) => l.startsWith("## 四、"));
  const end = LINES.findIndex((l) => l.startsWith("## 五、"));
  if (start < 0 || end < 0) throw new Error("规格第四 / 五章定位失败");
  const bodies = [];
  for (let i = start + 1; i < end; i++) {
    if (!/^\*\*第.+条：\*\*\s*$/.test(LINES[i])) continue;
    let body = "";
    for (let j = i + 1; j < end; j++) {
      if (LINES[j].trim()) {
        body = LINES[j];
        break;
      }
    }
    bodies.push(body);
  }
  if (bodies.length !== 4)
    throw new Error(`规格第四章应有 4 条消息，实际解析到 ${bodies.length} 条`);
  bodies.forEach((b, i) => {
    if (!b.trim()) throw new Error(`第 ${i + 1} 条台词为空`);
    if (b !== b.trim())
      throw new Error(`第 ${i + 1} 条台词带前后空白，需确认是否逐字保留`);
  });
  return bodies;
}

function buildMessages(bodies) {
  return bodies.map((body, i) => ({
    id: `${MSG_PREFIX}${String(i + 1).padStart(2, "0")}`,
    body,
    time: "@now",
    senderId: "lingling",
    sender: PEER,
    outgoing: false,
    hidden: true,
  }));
}

function buildNode(messages, chatTitle) {
  return {
    id: NODE_ID,
    label: LABEL,
    type: "event",
    event: "variable",
    target: UI_TARGET,
    conditions: [
      { key: UI_TARGET, op: "eq", value: true },
      { key: VAR_KEY, op: "neq", value: true },
    ],
    logic: "and",
    once: true,
    actions: [
      ...messages.map((m) => ({ type: "unlock", key: m.id, value: "" })),
      { type: "variable", key: VAR_KEY, value: true },
      {
        type: "notification",
        key: "whatsapp",
        value:
          `@whatsapp|now|${chatTitle}|` +
          messages[0].body +
          `|>whatsapp:${chatTitle}`,
      },
    ],
  };
}

/** 幂等校验：剥离本脚本负责的字段后，story.json 其余内容必须逐字节一致。 */
function strip(s) {
  const copy = JSON.parse(JSON.stringify(s));
  const chat = copy.chats.find((c) => c.id === CHAT_ID);
  chat.messages = chat.messages.filter(
    (m) => !String(m.id).startsWith(MSG_PREFIX),
  );
  copy.events = copy.events.filter((e) => e.id !== NODE_ID);
  delete copy.variables[VAR_KEY];
  return JSON.stringify(copy);
}

function main() {
  const bodies = parseBodies();
  const messages = buildMessages(bodies);

  const beforeText = fs.readFileSync(STORY_PATH, "utf8");
  const story = JSON.parse(beforeText);
  const beforeOther = strip(story);

  const chat = story.chats.find((c) => c.id === CHAT_ID);
  if (!chat) throw new Error(`沿用现有学姐私聊 ${CHAT_ID}，不得新建联系人`);

  chat.messages = [
    ...chat.messages.filter((m) => !String(m.id).startsWith(MSG_PREFIX)),
    ...messages,
  ];
  story.events = [
    ...story.events.filter((e) => e.id !== NODE_ID),
    buildNode(messages, chat.title),
  ];
  story.variables = { ...story.variables, [VAR_KEY]: false };

  if (strip(story) !== beforeOther)
    throw new Error("除目标消息 / 事件 / 变量外不得改动 story.json 的任何字段");

  const text = JSON.stringify(story, null, 2) + "\n";
  const changed = text !== beforeText;
  if (changed) fs.writeFileSync(STORY_PATH, text, "utf8");

  console.log(
    `WA_DOUYIN_001 导入：${messages.length} 条消息 | ` +
      `私聊 ${chat.messages.length} 条 | events ${story.events.length} | ` +
      `节点 target ${UI_TARGET} | ` +
      (changed ? "已写入 story.json" : "幂等（无改动）"),
  );
  bodies.forEach((b, i) =>
    console.log(`  ${messages[i].id}  ${JSON.stringify(b)}`),
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main();
