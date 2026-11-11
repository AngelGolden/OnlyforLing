/**
 * Photos 相册 42 张固定照片导入（幂等，可重复执行）。
 *
 * 数据源：
 *   - data/photos/照片清单.txt —— 用户在对话里给出的 42 条照片元数据原文（零改写副本）
 *   - data/photos/sources.json —— 图号 ↔ 用户自行添加的图片文件，顺序一一对应
 *   - public/photo-media/photo-NN.jpg —— scripts/prepare-photo-media.py 生成的静态资源
 *
 * 【零改写边界】拍摄时间、拍摄地点、照片说明、是否收藏全部按清单原文取值：
 *   不创作、不续写、不润色、不删减、不合并，不改日期 / 时间 / 地点 / 说明 / 收藏。
 *   原文里的全角冒号「：」、日期与时间之间的双空格，一律原样保存在
 *   meta.capturedAtRaw；time / meta.capturedAt 只是用于排序与展示的规范化副本。
 *
 * 【字段映射：以兼容现有系统为优先】
 *   规格建议字段        → 现有 Item 字段
 *   id                  → id（photo_01 … photo_42）
 *   image               → meta.image（./photo-media/photo-NN.jpg 本地静态路径）
 *                         item.media 只接受 base64 内嵌媒体（safeMedia 校验），
 *                         42 张大图内联会撑爆 work.json / PWA 单文件上限，
 *                         因此沿用「群头像」的本地静态资源白名单方案。
 *   capturedAt          → time（YYYY-MM-DD HH:MM）+ meta.capturedAt（ISO 风格）
 *   location            → meta.location（无地点时不写该键）
 *   caption             → body（无说明时为空串）
 *   favorite            → favorite（现有「收藏」标签页直接复用）
 *   album               → folder（统一「最近项目」）+ meta.album（recent）
 *
 * 这 42 张是手机里的静态照片，不绑定剧情节点、不产生通知、不写 playback / variables。
 *
 * 用法：node scripts/import-photos.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const STORY_PATH = path.join(ROOT, "stories/template/story.json");
const LIST_PATH = path.join(ROOT, "data/photos/照片清单.txt");
const SOURCES_PATH = path.join(ROOT, "data/photos/sources.json");
const MEDIA_DIR = path.join(ROOT, "public/photo-media");

const BLOCK_RE = /^【照片\s*(\d{2})】[ \t]*$/;
const IMAGE_LINE_RE = /^图片：(.*?)\s+拍摄时间：(.*)$/;
const IMAGE_NAME_RE = /@image#\d+:(?:"([^"]+)"|([^\s]+))\s*$/;
const LOCAL_MEDIA_RE = /^\.\/photo-media\/[a-z0-9-]+\.(jpe?g|png|webp)$/i;
const NORMALIZED_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/;

/** 解析清单原文；所有文字字段保留原样（含全角冒号、双空格、缺项）。 */
export function parsePhotoList(file = LIST_PATH) {
  const lines = fs
    .readFileSync(file, "utf8")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/);

  const blocks = [];
  let current = null;
  for (const line of lines) {
    const head = line.match(BLOCK_RE);
    if (head) {
      current = { no: Number(head[1]), lines: [] };
      blocks.push(current);
      continue;
    }
    if (current && line !== "") current.lines.push(line);
  }
  if (blocks.length !== 42)
    throw new Error(`应恰好 42 张照片，实际解析到 ${blocks.length} 张`);
  blocks.forEach((b, i) => {
    if (b.no !== i + 1) throw new Error(`照片编号不连续：${b.no}`);
  });

  return blocks.map((b) => {
    const find = (prefix) => b.lines.find((l) => l.startsWith(prefix));
    const imageLine = find("图片：");
    if (!imageLine) throw new Error(`【照片 ${b.no}】缺少图片行`);
    const im = imageLine.match(IMAGE_LINE_RE);
    if (!im) throw new Error(`【照片 ${b.no}】图片行格式异常`);
    const nameMatch = im[1].match(IMAGE_NAME_RE);
    if (!nameMatch) throw new Error(`【照片 ${b.no}】缺少 @image# 文件名`);
    const sourceName = nameMatch[1] ?? nameMatch[2];
    const capturedAtRaw = im[2];

    const locationLine = find("拍摄地点：");
    const captionLine = find("照片说明：");
    const favoriteLine = find("是否收藏：");
    if (!favoriteLine) throw new Error(`【照片 ${b.no}】缺少是否收藏`);
    const favoriteRaw = favoriteLine.slice("是否收藏：".length);
    if (favoriteRaw !== "是" && favoriteRaw !== "否")
      throw new Error(`【照片 ${b.no}】收藏值异常：${favoriteRaw}`);

    const capturedAt = capturedAtRaw
      .replace(/：/g, ":")
      .replace(/\s+/g, " ")
      .trim();
    const t = capturedAt.match(NORMALIZED_TIME_RE);
    if (!t)
      throw new Error(`【照片 ${b.no}】拍摄时间格式异常：${capturedAtRaw}`);

    return {
      no: b.no,
      sourceName,
      capturedAtRaw,
      time: `${t[1]}-${t[2]}-${t[3]} ${t[4]}:${t[5]}`,
      capturedAtISO: `${t[1]}-${t[2]}-${t[3]}T${t[4]}:${t[5]}:00`,
      location: locationLine
        ? locationLine.slice("拍摄地点：".length)
        : "",
      caption: captionLine ? captionLine.slice("照片说明：".length) : "",
      favorite: favoriteRaw === "是",
    };
  });
}

export function buildPhotos() {
  const list = parsePhotoList();
  const sources = JSON.parse(fs.readFileSync(SOURCES_PATH, "utf8"));
  if (sources.files.length !== list.length)
    throw new Error(
      `素材映射 ${sources.files.length} 张与清单 ${list.length} 张不一致`,
    );

  return list.map((p, index) => {
    const entry = sources.files[index];
    const no = String(p.no).padStart(2, "0");
    if (entry.file !== `photo-${no}.jpg`)
      throw new Error(`【照片 ${no}】素材文件名不对应：${entry.file}`);
    if (!fs.existsSync(path.resolve(ROOT, entry.source)))
      throw new Error(`【照片 ${no}】原始素材不存在：${entry.source}`);
    if (!fs.existsSync(path.join(MEDIA_DIR, entry.file)))
      throw new Error(
        `【照片 ${no}】静态资源不存在：public/photo-media/${entry.file}，请先运行 scripts/prepare-photo-media.py`,
      );
    const image = `./photo-media/${entry.file}`;
    if (!LOCAL_MEDIA_RE.test(image))
      throw new Error(`【照片 ${no}】图片路径不在白名单内：${image}`);

    const meta = {
      photoNo: no,
      image,
      sourceName: p.sourceName,
      capturedAt: p.capturedAtISO,
      capturedAtRaw: p.capturedAtRaw,
      album: "recent",
    };
    if (p.location) meta.location = p.location;

    return {
      id: `photo_${no}`,
      title: `照片 ${no}`,
      body: p.caption,
      time: p.time,
      kind: "image",
      folder: "最近项目",
      favorite: p.favorite,
      meta,
    };
  });
}

function main() {
  const beforeText = fs.readFileSync(STORY_PATH, "utf8");
  const story = JSON.parse(beforeText);
  const items = buildPhotos();
  const stripPhotos = (s) =>
    JSON.stringify({
      ...s,
      content: Object.fromEntries(
        Object.entries(s.content ?? {}).filter(([k]) => k !== "photos"),
      ),
    });
  const beforeOther = stripPhotos(story);
  const previous = story.content?.photos ?? [];

  story.content = { ...(story.content ?? {}), photos: items };
  if (stripPhotos(story) !== beforeOther)
    throw new Error("除 content.photos 外不得改动 story.json 的任何字段");

  const text = JSON.stringify(story, null, 2) + "\n";
  const unchanged = JSON.stringify(previous) === JSON.stringify(items);
  if (text !== beforeText) fs.writeFileSync(STORY_PATH, text, "utf8");

  console.log(
    `photos imported: ${items.length} 张` +
      ` | 收藏 ${items.filter((i) => i.favorite).length} 张` +
      ` | 有说明 ${items.filter((i) => i.body).length} 张` +
      ` | 有地点 ${items.filter((i) => i.meta.location).length} 张` +
      ` | ${unchanged ? "幂等（无改动）" : "已写入 story.json"}`,
  );
  return items;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main();
