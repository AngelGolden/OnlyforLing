/**
 * 抖音 App｜一次性把用户提供的 8 条本地短视频与发布者资料接入 AFTER THE LAST SET。
 *
 * 数据源：data/douyin/抖音App搭建指令.txt（用户指令逐字副本，不改写）。
 * 素材源：用户本次提供的 D:\ 本地 mp4 与「回温蛋治 头像.png」。
 *
 * 【复用现有机制，不改全局 schema / 播放器 / 消息系统】
 *   installedApps   → 追加 "douyin"（registry 里已注册，安装后主屏图标可见）
 *   content.douyin  → 8 条 Item；body 为逐字配文，不补写、不续写、不加话题
 *   meta.video      → ./dy-media/dy-NN.mp4（本地静态资源白名单，与 yt-media 一致）
 *   meta.sourceName → 用户原始文件名，仅作溯源，界面不展示
 *   public/dy-media → 8 个原始 mp4 + 1 张头像，二进制原样复制，不转码不裁剪
 *   douyin-data.ts  → 发布者信息只写一份（昵称 / 头像 / 原始主页链接），
 *                     所有视频共用，不需要每条重复填写
 *
 * 用法：node scripts/import-douyin.mjs（可重复执行，第二次为幂等无改动）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SPEC = path.join(ROOT, "data/douyin/抖音App搭建指令.txt");
const STORY = path.join(ROOT, "stories/template/story.json");
const DATA_TS = path.join(ROOT, "src/skins/douyin-data.ts");
const MEDIA_DIR = path.join(ROOT, "public/dy-media");
const AVATAR_SOURCE = "D:/workbuddy/检手机素材/回温蛋治 头像.png";
const APP_ID = "douyin";
const AVATAR_FILE = "dy-avatar.png";

const spec = fs.readFileSync(SPEC, "utf8");
const pick = (re, label) => {
  const m = re.exec(spec);
  if (!m) throw new Error(`规格副本缺少：${label}`);
  return m[1].trim();
};

const AUTHOR = pick(/^- 用户昵称：(.+)$/m, "用户昵称");
const AVATAR_LABEL = pick(/@image#1:"(.+?)"/, "用户头像文件名");
const PROFILE_URL = pick(/^- 真实抖音主页链接：(.+)$/m, "真实主页链接");
if (!/^https:\/\/v\.douyin\.com\/[A-Za-z0-9]+\/$/.test(PROFILE_URL))
  throw new Error(`主页链接不是用户给定的原始链接：${PROFILE_URL}`);
if (AVATAR_LABEL !== "回温蛋治 头像.png")
  throw new Error(`头像素材名与规格不一致：${AVATAR_LABEL}`);

/** 逐行解析「视频文件：@"..." 视频文案：...」，保持原文逐字，不 trim 文案内部空格。 */
const VIDEO_LINE = /^视频文件：@"(.+?)"\s+视频文案：(.*)$/;
const videos = spec.split(/\r?\n/).reduce((acc, line) => {
  const m = VIDEO_LINE.exec(line);
  if (!m) return acc;
  const source = m[1].replace(/\\/g, "/");
  const caption = m[2];
  if (!/^D:\/.+\.mp4$/.test(source))
    throw new Error(`视频源路径不是本地绝对路径：${source}`);
  acc.push({ source, caption, sourceName: path.basename(source) });
  return acc;
}, []);
if (videos.length !== 8)
  throw new Error(`应导入 8 条视频，规格副本解析到 ${videos.length} 条`);
if (new Set(videos.map((v) => v.source)).size !== videos.length)
  throw new Error("视频源文件重复");

/** 原始 mp4 二进制原样复制；内容一致时不重写，保证重复执行幂等。 */
function copyAsset(source, target, label) {
  if (!fs.existsSync(source)) throw new Error(`素材不存在：${source}（${label}）`);
  const data = fs.readFileSync(source);
  if (fs.existsSync(target) && fs.readFileSync(target).equals(data))
    return "unchanged";
  fs.writeFileSync(target, data);
  return "copied";
}

fs.mkdirSync(MEDIA_DIR, { recursive: true });
const assets = [];
videos.forEach((v, i) => {
  const file = `dy-${String(i + 1).padStart(2, "0")}.mp4`;
  const state = copyAsset(
    v.source,
    path.join(MEDIA_DIR, file),
    v.sourceName,
  );
  assets.push({ ...v, file, state });
});
const avatarState = copyAsset(
  AVATAR_SOURCE,
  path.join(MEDIA_DIR, AVATAR_FILE),
  AVATAR_LABEL,
);

/** 发布者只写一份；运行时 Skin 从这里读，视频条目不重复填写。 */
const dataTs = `/**
 * 由 scripts/import-douyin.mjs 从 data/douyin/抖音App搭建指令.txt 生成，请勿手工编辑。
 * 全部视频共用一个发布者：资料只在这里保存一份，视频条目只带文件与配文。
 */
export const DOUYIN_AUTHOR = ${JSON.stringify(AUTHOR)};
export const DOUYIN_AVATAR = "./dy-media/${AVATAR_FILE}";
export const DOUYIN_AVATAR_NAME = ${JSON.stringify(AVATAR_LABEL)};
export const DOUYIN_PROFILE_URL = ${JSON.stringify(PROFILE_URL)};

/** 本地静态资源白名单：只允许 ./dy-media/ 下的 ASCII 文件名，与 yt-media 做法一致。 */
export const DY_ASSET_RE = /^\\.\\/dy-media\\/[a-z0-9-]+\\.(mp4|png|jpg)$/i;
export function dyAsset(
  meta: Record<string, string> | undefined,
  key: string,
): string {
  const value = meta?.[key] ?? "";
  return DY_ASSET_RE.test(value) ? value : "";
}
`;
if (!fs.existsSync(DATA_TS) || fs.readFileSync(DATA_TS, "utf8") !== dataTs)
  fs.writeFileSync(DATA_TS, dataTs, "utf8");

const beforeText = fs.readFileSync(STORY, "utf8");
const story = JSON.parse(beforeText);

/** 去掉本次新增的两处内容，用于校验 story.json 其它字段零改动。 */
function strip(s) {
  const copy = JSON.parse(JSON.stringify(s));
  copy.installedApps = copy.installedApps.filter((a) => a !== APP_ID);
  delete copy.content[APP_ID];
  return JSON.stringify(copy);
}
const beforeOther = strip(story);

if (!story.installedApps.includes(APP_ID)) story.installedApps.push(APP_ID);
const items = assets.map((a, i) => ({
  id: `dy_${String(i + 1).padStart(2, "0")}`,
  title: "",
  body: a.caption,
  kind: "video",
  sender: AUTHOR,
  time: "",
  meta: {
    video: `./dy-media/${a.file}`,
    sourceName: a.sourceName,
  },
}));
story.content[APP_ID] = items;

if (strip(story) !== beforeOther)
  throw new Error("除 installedApps 与 content.douyin 外不得改动 story.json");

const previous = (JSON.parse(beforeText).content[APP_ID] ?? []);
const unchanged = JSON.stringify(previous) === JSON.stringify(items);
const text = JSON.stringify(story, null, 2) + "\n";
if (text !== beforeText) fs.writeFileSync(STORY, text, "utf8");

console.log(
  `抖音导入：${items.length} 条视频 | 发布者 ${AUTHOR} | 主页 ${PROFILE_URL} | ` +
    `素材 ${assets.filter((a) => a.state === "copied").length + (avatarState === "copied" ? 1 : 0)} 个新复制 | ` +
    (unchanged && text === beforeText ? "幂等（无改动）" : "已写入 story.json"),
);
assets.forEach((a, i) =>
  console.log(
    `  ${String(i + 1).padStart(2, "0")} ${a.file} ← ${a.sourceName} [${a.state}] ${a.caption}`,
  ),
);
