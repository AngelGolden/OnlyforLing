/**
 * Instagram｜学姐个人主页新增 10 条帖子（幂等导入）。
 *
 * 输入（逐字 / 只读）：
 *   data/instagram-posts/学姐主页新增帖子.txt   —— 用户原文规格副本
 *   data/instagram-posts/image-sources.json    —— 图号 ↔ 用户本地源文件映射
 * 输出：
 *   public/ig-media/ll-new-01..19.jpg          —— 原样二进制复制，不缩放/裁剪/调色
 *   src/skins/instagram-lingling-posts.ts      —— 固定帖子数据（由本脚本生成）
 *   public/ig-media/sources.json               —— 追加 19 条素材映射（其余条目零改动）
 *
 * 约定：
 * - 文案、点赞原文、评论 / 回复文本、图片顺序一律取自规格副本，不做创作或润色。
 * - 发布时间输入可能是「2026-09-17  18：23」这类全角冒号 / 双空格，统一归一为
 *   YYYY-MM-DD HH:mm；原始字符串单独留档，排序只使用归一值（Asia/Hong_Kong）。
 * - 只新增帖子，不改 accounts / 已有 posts / story.json / events / chats。
 * - 二次运行不产生任何文件改动。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SPEC = join(ROOT, "data/instagram-posts/学姐主页新增帖子.txt");
const MAP = join(ROOT, "data/instagram-posts/image-sources.json");
const MEDIA_DIR = join(ROOT, "public/ig-media");
const SOURCES = join(ROOT, "public/ig-media/sources.json");
const OUT_TS = join(ROOT, "src/skins/instagram-lingling-posts.ts");

const spec = readFileSync(SPEC, "utf8");
const imageMap = JSON.parse(readFileSync(MAP, "utf8")).files;

/** 全角冒号 / 多空格 → 单一 ASCII 空格 + 半角冒号；不改动日期数字。 */
export function normalizeTime(raw) {
  const s = raw.replace(/：/g, ":").replace(/\s+/g, " ").trim();
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s))
    throw new Error(`发布时间不符合 YYYY-MM-DD HH:mm: ${JSON.stringify(raw)}`);
  return s;
}

/** 20.8k / 23.4K / 20K → 20800 / 23400 / 20000；原文另存 likesLabel。 */
function parseLikes(raw) {
  const m = /^(\d+(?:\.\d+)?)\s*([kK]?)$/.exec(raw);
  if (!m) throw new Error(`点赞数无法解析: ${JSON.stringify(raw)}`);
  const n = Number(m[1]) * (m[2] ? 1000 : 1);
  if (!Number.isInteger(n)) throw new Error(`点赞数不是整数: ${raw}`);
  return n;
}

/** 规格里的 POST 区块：以「### POST NN｜」切分，取到「## 三、」之前。 */
function parseSpec() {
  const start = spec.indexOf("### POST 01｜");
  const end = spec.indexOf("## 三、");
  if (start < 0 || end < 0) throw new Error("规格里找不到 POST 区块或第三章");
  const blocks = spec
    .slice(start, end)
    .split(/(?=### POST \d{2}｜)/)
    .map((s) => s.trim())
    .filter(Boolean);

  const posts = [];
  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    const heading = /^### POST (\d{2})｜/.exec(lines[0]);
    if (!heading) throw new Error(`无法解析 POST 标题: ${lines[0]}`);
    const rec = {
      num: Number(heading[1]),
      postId: "",
      publishedAtRaw: "",
      imageRefs: [],
      caption: "",
      location: "",
      likesLabel: "",
      commentCount: 0,
      commentLines: [],
    };

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      const t = line.trim();
      if (!t || t === "---") continue;
      const inline = (label) => {
        const m = new RegExp(`^${label}(.*)$`).exec(t);
        return m ? m[1].trim() : "";
      };
      const next = () => {
        let j = i + 1;
        while (j < lines.length && !lines[j].trim()) j++;
        if (j >= lines.length) throw new Error(`POST ${heading[1]} 的 ${t} 后面没有内容`);
        i = j;
        return lines[j].trim();
      };

      if (t === "内部 ID：") rec.postId = next();
      else if (t === "发布时间：") rec.publishedAtRaw = next();
      else if (t === "图片：") {
        const imageLine = next().replace(/\r/g, "");
        rec.imageRefs = [...imageLine.matchAll(/@image#(\d+)/g)].map((m) =>
          Number(m[1]),
        );
      } else if (t.startsWith("文案：")) {
        rec.caption = inline("文案：") || next();
      } else if (t === "位置：") rec.location = next();
      else if (t === "点赞：") rec.likesLabel = next();
      else if (t === "评论：") {
        let j = i + 1;
        while (j < lines.length && !lines[j].trim()) j++;
        const upcoming = j < lines.length ? lines[j].trim() : "";
        if (/^\d+$/.test(upcoming)) {
          rec.commentCount = Number(upcoming);
          i = j;
        } else {
          for (let k = i + 1; k < lines.length; k++) {
            const c = lines[k].trim();
            if (!c || c === "---" || c.startsWith("### POST ")) break;
            if (!c.startsWith("- "))
              throw new Error(`POST ${heading[1]} 评论行格式异常: ${c}`);
            rec.commentLines.push(c.slice(2));
          }
          while (i + 1 < lines.length && lines[i + 1].trim().startsWith("- ")) i++;
        }
      }
    }

    if (!rec.postId || !rec.publishedAtRaw || !rec.caption || !rec.likesLabel)
      throw new Error(`POST ${heading[1]} 字段缺失`);
    if (!rec.imageRefs.length) throw new Error(`POST ${heading[1]} 没有图片`);
    rec.publishedAt = normalizeTime(rec.publishedAtRaw);
    rec.likes = parseLikes(rec.likesLabel);
    rec.comments = buildComments(rec);
    posts.push(rec);
  }
  if (posts.length !== 10)
    throw new Error(`应导入 10 条 POST，实际解析到 ${posts.length} 条`);
  const ids = new Set(posts.map((p) => p.postId));
  if (ids.size !== posts.length) throw new Error("POST 内部 ID 重复");
  return posts;
}

/** 回复关联到「最近一条由被回复用户名发表的评论」，同时保留用户名用于界面展示。 */
function buildComments(rec) {
  const out = rec.commentLines.map((line, k) => {
    const m = /^@\/\/([^/]+)\/(?:\s+回复\s+@\/\/([^/]+)\/)?：(.*)$/.exec(line);
    if (!m) throw new Error(`评论行无法解析: ${line}`);
    return {
      commentId: `${rec.postId}_c${String(k + 1).padStart(2, "0")}`,
      userId: m[1],
      text: m[3],
      replyTo: m[2] || undefined,
      replyToCommentId: undefined,
    };
  });
  for (let k = 0; k < out.length; k++) {
    if (!out[k].replyTo) continue;
    for (let j = k - 1; j >= 0; j--) {
      if (out[j].userId === out[k].replyTo) {
        out[k].replyToCommentId = out[j].commentId;
        break;
      }
    }
    if (!out[k].replyToCommentId)
      throw new Error(`找不到回复目标原评论: ${rec.postId} / ${out[k].text}`);
  }
  return out;
}

const q = (s) => JSON.stringify(s);
const mediaRef = (n) => {
  const m = imageMap.find((x) => x.index === n);
  if (!m) throw new Error(`图片映射缺少 @image#${n}`);
  return { ...m, src: `./ig-media/${m.file}` };
};

/** 生成可读、稳定的 TS 数据文件（字符串一律 JSON.stringify，保留 Emoji / 变体选择符）。 */
function renderTs(posts) {
  const lines = [
    "/**",
    " * 由 scripts/import-instagram-posts.mjs 从用户规格逐字生成，请勿手工编辑。",
    " * 数据来源：data/instagram-posts/学姐主页新增帖子.txt",
    " * 时间已归一为 YYYY-MM-DD HH:mm（香港当地时间 Asia/Hong_Kong）；原始输入见 LINGLING_NEW_RAW_TIMES。",
    " * 本文件只新增学姐主页帖子：不含 inFeed / eventHook，不改变 IG-001 的唯一目标。",
    " */",
    'import type { IgPost } from "./instagram-data";',
    "",
    "export const LINGLING_NEW_POSTS: IgPost[] = [",
  ];
  for (const p of posts) {
    lines.push("  {");
    lines.push(`    postId: ${q(p.postId)},`);
    lines.push(`    userId: "linglingkwong",`);
    lines.push(`    publishedAt: ${q(p.publishedAt)},`);
    if (p.location) lines.push(`    location: ${q(p.location)},`);
    lines.push(`    caption: ${q(p.caption)},`);
    lines.push("    media: [");
    for (const n of p.imageRefs) {
      const m = mediaRef(n);
      lines.push(
        `      { type: "image", src: ${q(m.src)}, alt: ${q(m.label)} },`,
      );
    }
    lines.push("    ],");
    lines.push(`    likes: ${p.likes},`);
    lines.push(`    likesLabel: ${q(p.likesLabel)},`);
    lines.push(`    commentCount: ${p.commentCount},`);
    if (!p.comments.length) lines.push("    comments: [],");
    else {
      lines.push("    comments: [");
      for (const c of p.comments) {
        lines.push("      {");
        lines.push(`        commentId: ${q(c.commentId)},`);
        lines.push(`        userId: ${q(c.userId)},`);
        lines.push(`        text: ${q(c.text)},`);
        if (c.replyTo) lines.push(`        replyTo: ${q(c.replyTo)},`);
        if (c.replyToCommentId)
          lines.push(`        replyToCommentId: ${q(c.replyToCommentId)},`);
        lines.push("      },");
      }
      lines.push("    ],");
    }
    lines.push("  },");
  }
  lines.push("];");
  lines.push("");
  lines.push("/** 用户填写的原始发布时间（含全角冒号 / 双空格），只作审计，不参与排序。 */");
  lines.push("export const LINGLING_NEW_RAW_TIMES: Record<string, string> = {");
  for (const p of posts)
    lines.push(`  ${q(p.postId)}: ${q(p.publishedAtRaw)},`);
  lines.push("};");
  lines.push("");
  return lines.join("\n");
}

function writeIfChanged(path, next) {
  if (existsSync(path) && readFileSync(path, "utf8") === next) return false;
  writeFileSync(path, next, "utf8");
  return true;
}

function copyImages() {
  mkdirSync(MEDIA_DIR, { recursive: true });
  let copied = 0;
  for (const m of imageMap) {
    const src = readFileSync(m.source);
    const dst = join(MEDIA_DIR, m.file);
    if (existsSync(dst) && readFileSync(dst).equals(src)) continue;
    writeFileSync(dst, src);
    copied++;
  }
  return copied;
}

/** 只在 sources.json 末尾追加 19 条映射，保持既有条目文本零改动。 */
function appendSources(posts) {
  const original = readFileSync(SOURCES, "utf8");
  if (original.includes('"ll-new-01.jpg"')) return false;
  const marker = "\n  ]\n}";
  const at = original.lastIndexOf(marker);
  if (at < 0) throw new Error("sources.json 结构异常，找不到 files 数组结尾");
  const entries = imageMap.map((m) => {
    const usedBy = posts
      .filter((p) => p.imageRefs.includes(m.index))
      .map((p) => `${p.postId} 图${m.index}`);
    return `    { "file": ${q(m.file)}, "source": ${q(m.label)}, "usedBy": ${q(usedBy.join(" / "))} }`;
  });
  writeFileSync(
    SOURCES,
    original.slice(0, at) + ",\n" + entries.join(",\n") + original.slice(at),
    "utf8",
  );
  return true;
}

const posts = parseSpec();
const copied = copyImages();
const tsChanged = writeIfChanged(OUT_TS, renderTs(posts));
const sourcesChanged = appendSources(posts);

const changed = copied + Number(tsChanged) + Number(sourcesChanged);
console.log(
  `Instagram 帖子导入：${posts.length} 条 POST | ${imageMap.length} 张图片（新复制 ${copied} 张） | ` +
    `TS ${tsChanged ? "已写入" : "无改动"} | sources.json ${sourcesChanged ? "已追加" : "无改动"} | ` +
    (changed ? "已写入" : "幂等（无改动）"),
);
for (const p of posts)
  console.log(
    `  ${p.postId}  ${p.publishedAt}  ${p.imageRefs.length} 图  ${p.likesLabel} 赞  ${p.commentCount} 评  ${p.comments.length} 条展示评论` +
      (p.location ? `  位置 ${p.location}` : ""),
  );
