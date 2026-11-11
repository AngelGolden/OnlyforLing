/**
 * WhatsApp 三组聊天固定数据导入（幂等，可重复执行）。
 *
 * 数据源是 data/wa-chats/ 下三份用户原文的字节级副本。脚本只做解析与字段映射，
 * 不创作、不续写、不润色、不删减、不合并、不拆分任何台词；发言人、日期、时间范围
 * 全部取自原文。原文里存在的前导 / 尾随空格会被逐字保留。
 *
 * 【内容分类约定，勿混用】
 * 本脚本只负责「已经存在的静态历史聊天」：导入后常驻聊天记录，带原文日期，打开即见，
 * 不绑定任何剧情事件、不产生通知。MIMI-001 那类由玩家行为触发、沿现实时间线逐条发生的
 * 对白属于「实时剧情对话」，不算历史聊天内容，不得用本脚本塞进 chats[].messages。
 * 往后新添加的聊天内容都应跟随现实时间流速发生，不作为静态历史导入；
 * 因此本脚本的源文件集合是冻结的，且会拒绝任何不早于 phone.date 的历史日期。
 *
 * 两个群组聊天另外带 kind:"group" 与 groupAvatar（/wa-media/ 下的本地静态图）。
 * 这两项是会话级技术字段，只影响列表/顶部头像与成员名字显示，不改动任何台词。
 *
 * 用法：node scripts/import-wa-chats.mjs
 * 也可 import { parseChatFile, buildMessages, SPECS } 供验收测试复用。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const STORY_PATH = path.join(ROOT, "stories/template/story.json");
const DATA_DIR = path.join(ROOT, "data/wa-chats");

/** 原文发言人 → 项目内已有联系人 ID / 群成员 ID。当前账号统一用 owner。 */
export const SPECS = [
  {
    tag: "mom",
    prefix: "mom",
    file: "mom.txt",
    chatId: "wa-mother",
    sourceId: "mom",
    group: false,
    expectedCount: 65,
    senders: { 妈妈: "mother", Angel: "owner" },
  },
  {
    tag: "lc",
    prefix: "lc",
    file: "late-checkout.txt",
    chatId: "wa-late-checkout",
    sourceId: "group_late_checkout",
    group: true,
    groupAvatar: "/wa-media/avatar-late-checkout.jpg",
    expectedCount: 86,
    senders: {
      鼓手: "drummer_a",
      键盘手: "keyboard_c",
      鄺學姐: "lingling",
      Angel: "owner",
    },
  },
  {
    tag: "design",
    prefix: "design",
    file: "design-studio.txt",
    chatId: "wa-design",
    sourceId: "group_design_studio_2526",
    group: true,
    groupAvatar: "/wa-media/avatar-design-studio.jpg",
    expectedCount: 47,
    senders: {
      Chloe: "design_chloe",
      Ethan: "design_ethan",
      Mimi: "mimi_friend",
      Jason: "design_jason",
      Ava: "design_ava",
      Angel: "owner",
    },
  },
];

/** 专业群成员表里明确列出的新同学，Mimi 必须复用既有的 mimi_friend。 */
export const NEW_CONTACTS = [
  { id: "design_chloe", name: "Chloe", phone: "", avatar: "", bio: "" },
  { id: "design_ethan", name: "Ethan", phone: "", avatar: "", bio: "" },
  { id: "design_jason", name: "Jason", phone: "", avatar: "", bio: "" },
  { id: "design_ava", name: "Ava", phone: "", avatar: "", bio: "" },
];

export const DESIGN_PARTICIPANTS = [
  "owner",
  "mimi_friend",
  "design_chloe",
  "design_ethan",
  "design_jason",
  "design_ava",
];
export const DESIGN_TITLE = "DESIGN STUDIO 25/26";

// 段落标题支持原文里的三种写法：全角竖线 / 半角空格、全角冒号、全 / 半角连接符。
const DATE_RE =
  /^\s*(\d{4}-\d{2}-\d{2})\s*[｜|\s]\s*(\d{1,2})[:：](\d{2})\s*[—\-–~～]\s*(\d{1,2})[:：](\d{2})/;
// 消息行 **发言人：** 正文。( ?) 只吃掉格式分隔符的一个空格，其余全部算原文。
const MSG_RE = /^\*\*(.+?)：\*\*( ?)(.*)$/;

function hhmm(minute) {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** 把原文解析成 { date, start, end, msgs:[{who, sep, body, rawLine, lineNo}] } 段落数组。 */
export function parseChatFile(file) {
  const text = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/);
  const sections = [];
  let cur = null;
  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i];
    const d = rawLine.match(DATE_RE);
    if (d) {
      cur = {
        date: d[1],
        start: Number(d[2]) * 60 + Number(d[3]),
        end: Number(d[4]) * 60 + Number(d[5]),
        msgs: [],
      };
      sections.push(cur);
      continue;
    }
    const m = rawLine.match(MSG_RE);
    if (!m) continue;
    if (!cur) throw new Error(`${file}:${i + 1} 消息出现在任何日期段落之前`);
    const [, who, sep, body] = m;
    if (rawLine !== `**${who}：**${sep}${body}`)
      throw new Error(`${file}:${i + 1} 原文回拼不一致，可能发生改写`);
    cur.msgs.push({ who, sep, body, rawLine, lineNo: i + 1 });
  }
  return sections;
}

/**
 * 生成可直接写入 story.json 的消息数组。
 * 每条消息的时间落在原文给出的时间范围内，按消息顺序非递减；原文只给段落级时间范围，
 * 因此同分钟内允许连续多条消息，不虚构范围之外的时刻。
 */
export function buildMessages(spec, sections) {
  const seqByDate = new Map();
  const out = [];
  for (const section of sections) {
    const n = section.msgs.length;
    if (!n) continue;
    if (section.end < section.start)
      throw new Error(`${spec.tag} ${section.date} 时间范围倒置`);
    section.msgs.forEach((m, i) => {
      const senderId = spec.senders[m.who];
      if (!senderId)
        throw new Error(`${spec.tag}:${m.lineNo} 未知发言人「${m.who}」`);
      const minute =
        n === 1
          ? section.start
          : section.start +
            Math.round((i * (section.end - section.start)) / (n - 1));
      if (minute < section.start || minute > section.end)
        throw new Error(`${spec.tag}:${m.lineNo} 时间越出原文范围`);
      const seq = (seqByDate.get(section.date) ?? 0) + 1;
      seqByDate.set(section.date, seq);
      const item = {
        id: `${spec.prefix}_${section.date}_${String(seq).padStart(2, "0")}`,
        body: m.body,
        time: `${section.date} ${hhmm(minute)}`,
        senderId,
        outgoing: senderId === "owner",
        meta: { sourceId: spec.sourceId },
      };
      // owner 的界面名称由编译器固定为 phone.owner（「我」），不写死「机主」或「Angel」。
      if (senderId !== "owner") item.sender = m.who;
      if (spec.group) item.folder = "群组";
      out.push(item);
    });
  }
  const ids = new Set(out.map((m) => m.id));
  if (ids.size !== out.length) throw new Error(`${spec.tag} messageId 重复`);
  for (let i = 1; i < out.length; i += 1)
    if (out[i].time < out[i - 1].time)
      throw new Error(`${spec.tag} 时间顺序错乱：${out[i - 1].time} → ${out[i].time}`);
  return out;
}

export function loadSections(spec) {
  return parseChatFile(path.join(DATA_DIR, spec.file));
}

/** 逐条核对生成结果与原文，任何差异都会抛错而不是静默修正。 */
export function verifyAgainstSource(spec, sections, messages) {
  const source = sections.flatMap((s) => s.msgs);
  if (source.length !== messages.length)
    throw new Error(`${spec.tag} 条数不符：原文 ${source.length} / 生成 ${messages.length}`);
  const known = new Set(Object.keys(spec.senders));
  source.forEach((s, i) => {
    if (!known.has(s.who))
      throw new Error(`${spec.tag} 出现未登记发言人「${s.who}」`);
    if (messages[i].body !== s.body)
      throw new Error(
        `${spec.tag}:${s.lineNo} 原文被改动：${JSON.stringify(s.body)} → ${JSON.stringify(messages[i].body)}`,
      );
    if (messages[i].time.slice(0, 10) !== sections.find((x) => x.msgs.includes(s)).date)
      throw new Error(`${spec.tag}:${s.lineNo} 日期与原文段落不符`);
  });
  return { count: messages.length, first: messages[0].id, last: messages.at(-1).id };
}

/** 幂等写入：替换目标聊天的 messages，绝不追加；其他聊天 / 事件 / 内容原样保留。 */
export function importChats({ write = true } = {}) {
  const raw = fs.readFileSync(STORY_PATH, "utf8");
  const story = JSON.parse(raw);
  // 静态历史源文件集合是冻结的：往后新添加的聊天内容应跟随现实时间流速发生，
  // 不得再往这里追加「未来时间线」的静态聊天记录。
  const FROZEN_SOURCES = ["mom.txt", "late-checkout.txt", "design-studio.txt"];
  if (
    SPECS.length !== FROZEN_SOURCES.length ||
    SPECS.some((s, i) => s.file !== FROZEN_SOURCES[i])
  )
    throw new Error("静态历史源文件集合已冻结；新增聊天内容应沿现实时间线由事件触发");
  for (const spec of SPECS.filter((s) => s.group)) {
    const asset = path.join(ROOT, "public", spec.groupAvatar.replace(/^\//, ""));
    if (!fs.existsSync(asset))
      throw new Error(`群头像文件缺失：${spec.groupAvatar}`);
  }
  const untouchedKeys = ["events", "variables", "content", "installedApps", "tests", "phone"];
  const frozen = untouchedKeys.map((k) => JSON.stringify(story[k]));
  const targetIds = new Set(SPECS.map((s) => s.chatId));
  const otherChatsBefore = story.chats
    .filter((c) => !targetIds.has(c.id))
    .map((c) => JSON.stringify(c));

  const existing = new Set(story.contacts.map((c) => c.id));
  for (const c of NEW_CONTACTS)
    if (!existing.has(c.id)) {
      story.contacts.push(c);
      existing.add(c.id);
    }

  const report = [];
  for (const spec of SPECS) {
    const chat = story.chats.find((c) => c.id === spec.chatId);
    if (!chat) throw new Error(`找不到目标聊天 ${spec.chatId}`);
    const sections = loadSections(spec);
    const messages = buildMessages(spec, sections);
    if (messages.length !== spec.expectedCount)
      throw new Error(
        `${spec.tag} 解析条数 ${messages.length} 与预期 ${spec.expectedCount} 不符`,
      );
    const checked = verifyAgainstSource(spec, sections, messages);
    // 历史消息必须严格早于故事当前日期；不允许预置当天 / 未来日期的静态聊天。
    const today = story.phone?.date;
    if (today && messages.some((m) => m.time.slice(0, 10) >= today))
      throw new Error(
        `${spec.tag} 含不早于当前日期的静态历史；新增内容应沿现实时间线触发`,
      );
    chat.messages = messages;
    if (spec.group) {
      chat.kind = "group";
      chat.groupAvatar = spec.groupAvatar;
    }
    if (spec.tag === "design") {
      chat.title = DESIGN_TITLE;
      chat.participants = [...DESIGN_PARTICIPANTS];
    }
    report.push({ tag: spec.tag, chatId: spec.chatId, ...checked });
  }

  untouchedKeys.forEach((k, i) => {
    if (JSON.stringify(story[k]) !== frozen[i])
      throw new Error(`${k} 被意外改动`);
  });
  const otherChatsAfter = story.chats
    .filter((c) => !targetIds.has(c.id))
    .map((c) => JSON.stringify(c));
  if (JSON.stringify(otherChatsAfter) !== JSON.stringify(otherChatsBefore))
    throw new Error("其他聊天的历史消息被意外改动");

  if (write) fs.writeFileSync(STORY_PATH, `${JSON.stringify(story, null, 2)}\n`, "utf8");
  return report;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const report = importChats();
  for (const r of report)
    console.log(`${r.tag}: ${r.count} 条 → ${r.chatId} (${r.first} … ${r.last})`);
  console.log(`总计 ${report.reduce((n, r) => n + r.count, 0)} 条，已写入 stories/template/story.json`);
}
