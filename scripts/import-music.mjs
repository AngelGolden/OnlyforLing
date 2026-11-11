/**
 * Music App｜幂等导入 4 首本地歌曲 + WA_MUSIC_001 学姐固定对话。
 *
 * 数据源：data/music-app/音乐模块搭建指令.txt（用户规格逐字副本，以最新一版为准：
 * 学姐首句「你最鍾意我唱過哪一首歌？」、第三条「好。」）。
 * 导入脚本与验收测试都从规格副本独立解析，禁止 AI 改写台词、顺序、发信人。
 *
 * 【字段映射：完全沿用现有系统，不新建音乐 App、不改其它 App】
 *   4 首歌曲      → content.spotify（现有已安装音乐 App 的歌曲数据，原先为空数组）
 *                   title=歌曲名 / sender=歌手名 / meta.audio=./music-media/*.mp3
 *                   safeMedia() 只接受 data URL，因此本地 mp3 走 meta.audio 静态白名单
 *   5 条对话      → chats[wa-lingling].messages 末尾的 hidden 事件消息（@now 占位）
 *   触发事件      → event:"variable" + target:"ui:music:firstPlayed"
 *                   由全局播放器在音频真正触发 playing 事件时派发；加载/播放失败不派发
 *   去重          → variables.WA_MUSIC_001_TRIGGERED != true + 节点 once
 *   播放完成态    → 沿用 Runtime.playback["WA_MUSIC_001"].playbackStatus == "completed"
 *                   （与 WA_LC_002 相同，不另建 PLAYBACK_COMPLETE 变量）
 *   通知          → 现有 @whatsapp|now|会话|摘要|>whatsapp:会话 结构化通知
 *
 * 用法：node scripts/import-music.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SPEC_PATH = path.join(ROOT, "data/music-app/音乐模块搭建指令.txt");
const STORY_PATH = path.join(ROOT, "stories/template/story.json");
const DATA_TS = path.join(ROOT, "src/skins/music-data.ts");
const MEDIA_DIR = path.join(ROOT, "public/music-media");

const APP_ID = "spotify";
const CHAT_ID = "wa-lingling";
const NODE_ID = "WA_MUSIC_001";
const MSG_PREFIX = "msg_music_001_";
const VAR_KEY = "WA_MUSIC_001_TRIGGERED";
const FIRST_PLAYED_TARGET = "ui:music:firstPlayed";
const PEER = "鄺學姐";
const OWNER = "机主";

const SPEC = fs.readFileSync(SPEC_PATH, "utf8").replace(/^\uFEFF/, "");
const LINES = SPEC.split(/\r?\n/);

/** **歌曲 01** / 音频文件：@"D:\\xxx.mpeg" 歌曲名：xxx / 歌手名：Lingling */
const SONG_HEAD = /^\*\*歌曲\s*(\d+)\*\*\s*$/;
const SONG_FILE = /^音频文件：@"(.+?)"\s+歌曲名：(.*)$/;
const SONG_ARTIST = /^歌手名：(.*)$/;

function parseSongs() {
  const songs = [];
  let pending = null;
  for (let i = 0; i < LINES.length; i++) {
    const line = LINES[i];
    const head = SONG_HEAD.exec(line);
    if (head) {
      pending = { no: Number(head[1]) };
      continue;
    }
    if (!pending) continue;
    const file = SONG_FILE.exec(line);
    if (file) {
      pending.source = file[1];
      pending.title = file[2];
      continue;
    }
    const artist = SONG_ARTIST.exec(line);
    if (artist) {
      pending.artist = artist[1];
      songs.push(pending);
      pending = null;
    }
  }
  if (songs.length !== 4)
    throw new Error(`规格应有 4 首歌曲，实际解析到 ${songs.length} 首`);
  songs.forEach((s, i) => {
    if (s.no !== i + 1) throw new Error(`歌曲顺序异常：第 ${i + 1} 首编号 ${s.no}`);
    if (!s.source || !s.title || !s.artist)
      throw new Error(`第 ${s.no} 首歌曲字段不完整`);
  });
  return songs;
}

/** 规格第五章 5.2 首句 + 5.3 五条固定对话，逐字照抄。 */
function parseDialogue() {
  const firstLine = LINES.find((l) => /^「.+」\s*$/.test(l));
  if (!firstLine) throw new Error("规格 5.2 缺少学姐第一条消息");
  const firstBody = firstLine.trim().slice(1, -1);

  const start = LINES.findIndex((l) => l.startsWith("### 5.3"));
  const end = LINES.findIndex((l, i) => i > start && l.startsWith("### 5.4"));
  if (start < 0 || end < 0) throw new Error("规格 5.3 / 5.4 定位失败");
  const rows = [];
  let role = "";
  for (const line of LINES.slice(start + 1, end)) {
    const head = /^\*\*第.+条：(学姐|机主)\*\*\s*$/.exec(line);
    if (head) {
      role = head[1];
      continue;
    }
    if (!role || !line.trim() || line.startsWith("**") || line.startsWith("学姐始终"))
      continue;
    rows.push({ role, body: line });
    role = "";
  }
  if (rows.length !== 5)
    throw new Error(`规格 5.3 应有 5 条固定对话，实际 ${rows.length} 条`);
  if (rows[0].body !== firstBody)
    throw new Error("5.2 首句与 5.3 第一条不一致");
  if (rows.filter((r) => r.role === "机主").length !== 1)
    throw new Error("机主固定回复应恰好 1 条");
  return rows;
}

function buildTracks(songs) {
  return songs.map((s, i) => {
    const sourceName = path.basename(s.source.replace(/\\+/g, "/"));
    const src = `./music-media/music-${String(i + 1).padStart(2, "0")}.mp3`;
    return {
      id: `music_${String(i + 1).padStart(2, "0")}`,
      title: s.title,
      body: "",
      kind: "audio",
      sender: s.artist,
      time: "",
      meta: { audio: src, sourceName },
    };
  });
}

function buildMessages(rows) {
  return rows.map((r, i) => ({
    id: `${MSG_PREFIX}${String(i + 1).padStart(2, "0")}`,
    body: r.body,
    time: "@now",
    senderId: r.role === OWNER ? "owner" : "lingling",
    ...(r.role === OWNER ? {} : { sender: PEER }),
    outgoing: r.role === OWNER,
    hidden: true,
  }));
}

function buildNode(messages, chatTitle) {
  return {
    id: NODE_ID,
    label: "学姐问你最喜欢她唱过的哪首歌",
    type: "event",
    event: "variable",
    target: FIRST_PLAYED_TARGET,
    conditions: [
      { key: FIRST_PLAYED_TARGET, op: "eq", value: true },
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

/** 幂等校验：把本脚本负责的字段剥离后，story.json 其余内容必须逐字节一致。 */
function strip(s) {
  const copy = JSON.parse(JSON.stringify(s));
  delete copy.content[APP_ID];
  const chat = copy.chats.find((c) => c.id === CHAT_ID);
  chat.messages = chat.messages.filter(
    (m) => !String(m.id).startsWith(MSG_PREFIX),
  );
  copy.events = copy.events.filter((e) => e.id !== NODE_ID);
  delete copy.variables[VAR_KEY];
  return JSON.stringify(copy);
}

/** 4 个素材实测都是 ID3v2.4 MP3；两个 .mpeg 只是扩展名，仅改扩展名不改一个字节。 */
function copyAsset(source, target, label) {
  const sourcePath = source.replace(/\\+/g, "/");
  if (!fs.existsSync(sourcePath))
    throw new Error(`素材不存在：${sourcePath}（${label}）`);
  const data = fs.readFileSync(sourcePath);
  const head = data.subarray(0, 3).toString("latin1");
  const mp3Frame = data[0] === 0xff && (data[1] & 0xe0) === 0xe0;
  if (head !== "ID3" && !mp3Frame)
    throw new Error(`${label} 不是 MP3 数据，需先确认格式：${sourcePath}`);
  if (fs.existsSync(target) && fs.readFileSync(target).equals(data)) return 0;
  fs.writeFileSync(target, data);
  return 1;
}

const DATA_TS_CONTENT = `/**
 * 由 scripts/import-music.mjs 生成：音乐 App 的静态资源白名单与剧情键。
 * 歌曲清单本身只存在 story.json 的 content.spotify，皮肤从 p.items 读取。
 */
export const MUSIC_APP_ID = "${APP_ID}";
export const MUSIC_EVENT_ID = "${NODE_ID}";
export const MUSIC_FIRST_PLAYED_TARGET = "${FIRST_PLAYED_TARGET}";
/** 只允许 ./music-media/ 下的 ASCII 音频文件名，与 dy-media / yt-media 做法一致。 */
export const MUSIC_ASSET_RE = /^\\.\\/music-media\\/[a-z0-9-]+\\.(mp3|m4a|aac|wav)$/i;
export function musicAsset(
  meta: Record<string, string> | undefined,
  key = "audio",
): string {
  const value = meta?.[key] ?? "";
  return MUSIC_ASSET_RE.test(value) ? value : "";
}
`;

function main() {
  const songs = parseSongs();
  const rows = parseDialogue();
  const tracks = buildTracks(songs);
  const messages = buildMessages(rows);

  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  let copied = 0;
  songs.forEach((s, i) => {
    const target = path.join(
      MEDIA_DIR,
      `music-${String(i + 1).padStart(2, "0")}.mp3`,
    );
    copied += copyAsset(s.source, target, `歌曲 ${i + 1} ${s.title}`);
  });

  const beforeText = fs.readFileSync(STORY_PATH, "utf8");
  const story = JSON.parse(beforeText);
  const beforeOther = strip(story);

  const chat = story.chats.find((c) => c.id === CHAT_ID);
  if (!chat) throw new Error(`沿用现有学姐私聊 ${CHAT_ID}，不得新建联系人`);
  if (!Array.isArray(story.content[APP_ID]) && story.content[APP_ID] !== undefined)
    throw new Error(`content.${APP_ID} 结构异常`);

  story.content[APP_ID] = tracks;
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
    throw new Error("除目标歌曲/消息/事件/变量外不得改动 story.json 的任何字段");

  const text = JSON.stringify(story, null, 2) + "\n";
  const changed = text !== beforeText;
  if (changed) fs.writeFileSync(STORY_PATH, text, "utf8");
  if (!fs.existsSync(DATA_TS) || fs.readFileSync(DATA_TS, "utf8") !== DATA_TS_CONTENT)
    fs.writeFileSync(DATA_TS, DATA_TS_CONTENT, "utf8");

  console.log(
    `音乐模块导入：${tracks.length} 首歌曲 | ${copied} 个素材新复制 | ` +
      `${messages.length} 条固定对话（机主 ${messages.filter((m) => m.outgoing).length} 条） | ` +
      `私聊 ${chat.messages.length} 条 | events ${story.events.length} | ` +
      (changed ? "已写入 story.json" : "幂等（无改动）"),
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main();
