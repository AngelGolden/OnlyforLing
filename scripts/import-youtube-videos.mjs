/**
 * YouTube｜幂等把用户提供的 7 个本地视频（3 常规 + 4 Shorts）接入
 * AFTER THE LAST SET。
 *
 * 数据源：data/youtube-media.json（由 prepare-youtube-media.mjs 从用户原始
 * mp4 复制 / 探测真实时长 / 抽取真实帧生成，不含任何 AI 生成内容）。
 *
 * 【字段映射：沿用现有架构，不改全局 schema】
 *   installedApps   → 追加 "youtube"（registry 里已注册 YouTubeSkin，需安装才可见）
 *   content.youtube → 7 条 Item；标题逐字照用户给定，不改写、不续写
 *   folder          → shorts:true 写 "Shorts"，只在 Shorts 标签出现；常规视频为 ""
 *   sender          → 上传者名，由用户给定标题中的主体得出，不虚构剧情内容
 *   meta.video      → ./yt-media/*.mp4（本地静态资源；safeMedia 只收 data: 内联，
 *                     因此与 Photos 的 meta.image 做法一致，走 meta 白名单）
 *   meta.poster     → ./yt-media/*.jpg（用户视频自身的真实帧）
 *   meta.duration   → 视频真实时长 M:SS
 *   meta.sourceName → 用户原始文件名，仅作溯源，界面不展示
 *   body / time     → 不编造简介与上传日期：body 留空，time 沿用编译器默认
 *
 * 用法：node scripts/import-youtube-videos.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STORY_PATH = path.join(ROOT, "stories/template/story.json");
const MEDIA_PATH = path.join(ROOT, "data/youtube-media.json");
const APP_ID = "youtube";

function clock(seconds) {
  const s = Math.max(0, Math.round(seconds || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function buildItems() {
  const media = JSON.parse(fs.readFileSync(MEDIA_PATH, "utf8"));
  if (media.length !== 7)
    throw new Error(`应有 7 个视频（3 常规 + 4 Shorts），实际 ${media.length}`);
  const ids = new Set();
  const items = media.map((m, i) => {
    for (const k of [
      "id",
      "file",
      "poster",
      "title",
      "sender",
      "sourceName",
      "duration",
    ])
      if (!m[k]) throw new Error(`data/youtube-media.json 第 ${i + 1} 项缺 ${k}`);
    if (!/^yt_[a-z0-9_]+$/.test(m.id))
      throw new Error(`非法条目 id：${m.id}`);
    if (ids.has(m.id)) throw new Error(`重复条目 id：${m.id}`);
    ids.add(m.id);
    for (const f of [m.file, m.poster])
      if (!/^[a-z0-9-]+\.(mp4|jpg)$/i.test(f))
        throw new Error(`非法静态资源文件名：${f}`);
    return {
      id: m.id,
      title: m.title,
      body: "",
      kind: "video",
      sender: m.sender,
      folder: m.shorts ? "Shorts" : "",
      favorite: false,
      meta: {
        video: `./yt-media/${m.file}`,
        poster: `./yt-media/${m.poster}`,
        duration: clock(m.duration),
        sourceName: m.sourceName,
      },
    };
  });
  const shorts = items.filter((i) => i.folder === "Shorts");
  if (shorts.length !== 4 || items.length - shorts.length !== 3)
    throw new Error(`YouTube 分组应为 3 常规 + 4 Shorts，实际 ${shorts.length} 条 Shorts`);
  return items;
}

/** 去掉本次新增的两处内容，用于校验 story.json 其它字段零改动。 */
function strip(s) {
  const copy = JSON.parse(JSON.stringify(s));
  copy.installedApps = copy.installedApps.filter((a) => a !== APP_ID);
  delete copy.content[APP_ID];
  return JSON.stringify(copy);
}

function main() {
  const beforeText = fs.readFileSync(STORY_PATH, "utf8");
  const story = JSON.parse(beforeText);
  const beforeOther = strip(story);

  if (!story.installedApps.includes(APP_ID))
    story.installedApps.push(APP_ID);
  const items = buildItems();
  const ids = new Set(items.map((i) => i.id));
  story.content[APP_ID] = [
    ...(story.content[APP_ID] ?? []).filter((i) => !ids.has(i.id)),
    ...items,
  ];

  if (strip(story) !== beforeOther)
    throw new Error("除 installedApps 与 content.youtube 外不得改动 story.json");

  const previous = (JSON.parse(beforeText).content[APP_ID] ?? []).filter((i) =>
    ids.has(i.id),
  );
  const unchanged = JSON.stringify(previous) === JSON.stringify(items);
  const text = JSON.stringify(story, null, 2) + "\n";
  if (text !== beforeText) fs.writeFileSync(STORY_PATH, text, "utf8");

  console.log(
    `YouTube imported: ${items.length} 条视频（3 常规 + 4 Shorts） | ` +
      items
        .map((i) => `${i.folder === "Shorts" ? "[Shorts] " : ""}${i.title} [${i.meta.duration}]`)
        .join(" / ") +
      ` | ${unchanged ? "幂等（无改动）" : "已写入 story.json"}`,
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main();
