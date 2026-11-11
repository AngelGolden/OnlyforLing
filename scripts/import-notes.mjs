/**
 * Notes 备忘录 15 条固定内容导入（幂等，可重复执行）。
 *
 * 数据源是 data/notes/备忘录搭建.txt —— 用户桌面原文的字节级副本。脚本只做解析与
 * 字段映射，不创作、不续写、不润色、不删减、不合并、不拆分任何标题或正文。
 *
 * 【零改写边界】每条正文取 `**正文：**` 之后、下一条 `## NN｜` 标题或 `---` 分隔线
 * 之前的文本；只裁掉首尾用于排版的空行，正文内部空行、标点、Emoji、`**`、`- [ ]`
 * 与每行文字全部原样保留。勾选状态不写回 body，而是单独存 Runtime.ui，因此
 * 初始正文与导入后的正文永远一致。
 *
 * 【私人记录，不参与剧情】这 15 条只是手机里的静态私人备忘录：不绑定事件节点、
 * 不产生通知、不写 playback / variables。浏览、搜索、编辑、删除都只改 Runtime.ui.notes。
 *
 * 用法：node scripts/import-notes.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const STORY_PATH = path.join(ROOT, "stories/template/story.json");
const SOURCE_PATH = path.join(ROOT, "data/notes/备忘录搭建.txt");

const HEADING_RE = /^## (\d+)｜(.*)$/;
const BODY_MARK = "**正文：**";
const SEPARATOR_RE = /^---\s*$/;
const CHECK_RE = /^- \[[ xX]\] /;
const DATE_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;

/** 解析用户原文，返回 15 条固定备忘录（不改动任何文字）。 */
export function parseNoteFile(file = SOURCE_PATH) {
  const lines = fs
    .readFileSync(file, "utf8")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/);
  const heads = [];
  lines.forEach((line, i) => {
    const m = line.match(HEADING_RE);
    if (m) heads.push({ n: Number(m[1]), title: m[2], line: i });
  });
  if (heads.length !== 15)
    throw new Error(`应恰好 15 条备忘录，实际解析到 ${heads.length} 条`);
  heads.forEach((h, i) => {
    if (h.n !== i + 1) throw new Error(`备忘录编号不连续：${h.n}`);
  });

  return heads.map((h, k) => {
    const end = k + 1 < heads.length ? heads[k + 1].line : lines.length;
    const section = lines.slice(h.line, end);
    const pick = (prefix, label) => {
      const line = section.find((x) => x.startsWith(prefix));
      if (!line) throw new Error(`第 ${h.n} 条缺少${label}`);
      return line.slice(prefix.length).trim();
    };
    const id = pick("- ID：`", "ID").replace(/`\s*$/, "").trim();
    const date = pick("- 日期：", "日期");
    const kind = pick("- 类型：", "类型");
    if (!DATE_RE.test(date))
      throw new Error(`第 ${h.n} 条日期格式不正确：${date}`);
    if (kind !== "清单" && kind !== "普通文本")
      throw new Error(`第 ${h.n} 条类型未知：${kind}`);
    const bodyStart = section.findIndex((x) => x.trim() === BODY_MARK);
    if (bodyStart < 0) throw new Error(`第 ${h.n} 条缺少正文标记`);
    let block = section.slice(bodyStart + 1);
    const sep = block.findIndex((x) => SEPARATOR_RE.test(x.trim()));
    if (sep >= 0) block = block.slice(0, sep);
    // 只裁剪首尾排版空行；正文内部空行与每行内容逐字保留。
    while (block.length && block[0].trim() === "") block.shift();
    while (block.length && block.at(-1).trim() === "") block.pop();
    const body = block.join("\n");
    if (!body) throw new Error(`第 ${h.n} 条正文为空`);
    const checklistCount = block.filter((x) => CHECK_RE.test(x)).length;
    if ((kind === "清单") !== (checklistCount > 0))
      throw new Error(`第 ${h.n} 条类型与清单行不一致（${checklistCount} 行）`);
    return {
      id,
      title: h.title,
      body,
      date,
      noteType: kind === "清单" ? "checklist" : "text",
      checklistCount,
    };
  });
}

/** 生成 story.json 的 content.notes 条目；createdAt / modifiedAt 首次导入时相同。 */
export function buildNotes() {
  const notes = parseNoteFile();
  const ids = new Set(notes.map((n) => n.id));
  if (ids.size !== notes.length) throw new Error("备忘录 ID 重复");
  return notes.map((n) => ({
    id: n.id,
    title: n.title,
    body: n.body,
    time: n.date,
    kind: "note",
    folder: "备忘录",
    meta: {
      createdAt: n.date,
      modifiedAt: n.date,
      noteType: n.noteType,
    },
  }));
}

function main() {
  const beforeText = fs.readFileSync(STORY_PATH, "utf8");
  const story = JSON.parse(beforeText);
  const items = buildNotes();
  const beforeOther = JSON.stringify({
    ...story,
    content: Object.fromEntries(
      Object.entries(story.content ?? {}).filter(([k]) => k !== "notes"),
    ),
  });
  const previous = story.content?.notes ?? [];

  story.content = { ...(story.content ?? {}), notes: items };
  const afterOther = JSON.stringify({
    ...story,
    content: Object.fromEntries(
      Object.entries(story.content).filter(([k]) => k !== "notes"),
    ),
  });
  if (beforeOther !== afterOther)
    throw new Error("除 content.notes 外不得改动 story.json 的任何字段");
  // 幂等：再次执行时除 content.notes 之外的字段，以及 notes 本身都不变。
  const text = JSON.stringify(story, null, 2) + "\n";
  if (text !== beforeText) fs.writeFileSync(STORY_PATH, text, "utf8");
  const unchanged = JSON.stringify(previous) === JSON.stringify(items);
  console.log(
    `notes imported: ${items.length} 条` +
      ` | 清单 ${items.filter((i) => i.meta.noteType === "checklist").length} 条` +
      ` | 文本 ${items.filter((i) => i.meta.noteType === "text").length} 条` +
      ` | ${unchanged ? "幂等（无改动）" : "已写入 story.json"}`,
  );
  return items;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main();
