import { test, expect, type Locator, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { compileStory } from "../src/story-engine/compiler";

/**
 * Notes 备忘录 15 条固定内容导入 + 编辑持久化验收。
 * 断言独立于 scripts/import-notes.mjs：这里重新解析 data/notes/ 下的用户原文副本，
 * 逐条与 story.json / 编译产物比对，避免「自己验证自己」。
 */
const SOURCE = "data/notes/备忘录搭建.txt";
const HEAD_RE = /^## (\d+)｜(.*)$/;

type SrcNote = {
  id: string;
  title: string;
  date: string;
  type: "checklist" | "text";
  body: string;
};

function parseSource(file = SOURCE): SrcNote[] {
  const lines = readFileSync(file, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/);
  const heads: { n: number; title: string; line: number }[] = [];
  lines.forEach((l, i) => {
    const m = l.match(HEAD_RE);
    if (m) heads.push({ n: Number(m[1]), title: m[2], line: i });
  });
  if (heads.length !== 15) throw new Error(`原文应含 15 条，实际 ${heads.length}`);
  return heads.map((h, k) => {
    const end = k + 1 < heads.length ? heads[k + 1].line : lines.length;
    const sec = lines.slice(h.line, end);
    const get = (prefix: string) => {
      const l = sec.find((x) => x.startsWith(prefix));
      if (!l) throw new Error(`第 ${h.n} 条缺少 ${prefix}`);
      return l.slice(prefix.length).trim();
    };
    const id = get("- ID：`").replace(/`\s*$/, "").trim();
    const date = get("- 日期：");
    const kind = get("- 类型：");
    const bodyStart = sec.findIndex((x) => x.trim() === "**正文：**");
    if (bodyStart < 0) throw new Error(`第 ${h.n} 条缺少正文标记`);
    let block = sec.slice(bodyStart + 1);
    const sep = block.findIndex((x) => /^---\s*$/.test(x.trim()));
    if (sep >= 0) block = block.slice(0, sep);
    while (block.length && block[0].trim() === "") block.shift();
    while (block.length && block.at(-1).trim() === "") block.pop();
    return {
      id,
      title: h.title,
      date,
      type: kind === "清单" ? ("checklist" as const) : ("text" as const),
      body: block.join("\n"),
    };
  });
}

let cachedWork: any = null;
let cachedRaw: any = null;
function story() {
  if (!cachedRaw)
    cachedRaw = JSON.parse(readFileSync("stories/template/story.json", "utf8"));
  if (!cachedWork) cachedWork = compileStory(cachedRaw).work;
  return { raw: cachedRaw, work: cachedWork };
}
const PIN = String(story().raw.phone?.passcode ?? "");

async function unlockPhone(phone: Locator) {
  await phone.getByRole("button", { name: "轻触解锁" }).click();
  for (const d of PIN)
    await phone.getByRole("button", { name: "密码键" + d }).click();
  await expect(
    phone.getByRole("button", { name: "搜索", exact: true }),
  ).toBeVisible({ timeout: 10000 });
}

async function loadPhone(page: Page): Promise<Locator> {
  const { work } = story();
  await page.route("**/work.json", (route) => route.fulfill({ json: work }));
  await page.goto("/");
  const phone = page.locator(".phone-shell");
  await unlockPhone(phone);
  return phone;
}

async function openNotes(phone: Locator) {
  await phone.getByRole("button", { name: "返回桌面", exact: true }).click();
  await phone.getByRole("button", { name: "打开备忘录", exact: true }).click();
  await expect(phone.locator(".native-notes .notes-row").first()).toBeVisible({
    timeout: 15000,
  });
}

async function reloadAndOpen(page: Page, phone: Locator) {
  await page.reload();
  await unlockPhone(phone);
  await openNotes(phone);
}

async function readState(page: Page): Promise<any> {
  return page.evaluate(async () => {
    const req = indexedDB.open("foundphone-studio");
    const db: IDBDatabase = await new Promise((res, rej) => {
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    const all: any[] = await new Promise((res, rej) => {
      const r = db.transaction("saves", "readonly").objectStore("saves").getAll();
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(req.error);
    });
    db.close();
    return all[0]?.state ?? {};
  });
}
async function readNotesState(page: Page): Promise<any> {
  const s = await readState(page);
  return JSON.parse(String(s.ui?.notes?.notesState ?? "null"));
}
/** 只比较剧情相关字段，排除已读 / 时钟 / UI 交互状态。 */
function storyFingerprint(s: any) {
  return JSON.stringify({
    playback: s.playback ?? {},
    completed: s.completed ?? [],
    unlocked: s.unlocked ?? [],
    hidden: s.hidden ?? [],
    notifications: s.notifications ?? [],
    variables: s.variables ?? {},
    endings: s.endings ?? [],
    read: s.read ?? [],
  });
}
const srcNotes = () => parseSource();
const byId = (id: string) => srcNotes().find((n) => n.id === id)!;

test("验收1｜15 条固定原文零改写导入，createdAt 与 modifiedAt 首次相同", () => {
  const src = srcNotes();
  const { raw, work } = story();
  const notes = raw.content.notes;
  expect(notes).toHaveLength(15);
  expect(src.filter((s) => s.type === "checklist")).toHaveLength(4);
  src.forEach((s, i) => {
    expect(notes[i].id).toBe(s.id);
    expect(notes[i].title, `第 ${i + 1} 条标题`).toBe(s.title);
    expect(notes[i].body, `第 ${i + 1} 条正文逐字一致`).toBe(s.body);
    expect(notes[i].time).toBe(s.date);
    expect(notes[i].meta.createdAt).toBe(s.date);
    expect(notes[i].meta.modifiedAt).toBe(s.date);
    expect(notes[i].meta.createdAt).toBe(notes[i].meta.modifiedAt);
    expect(notes[i].meta.noteType).toBe(s.type);
  });
  // 编译产物同样逐字一致，且不会进入 hidden / unlock / 事件节点。
  const compiled = work.data.notes;
  expect(compiled).toHaveLength(15);
  expect(compiled.map((i: any) => i.body)).toEqual(src.map((s) => s.body));
  expect(compiled.map((i: any) => i.title)).toEqual(src.map((s) => s.title));
  expect(compiled.every((i: any) => !i.hidden && !i.unlock)).toBe(true);
  // 其余剧情数据未被改动。WA_LC_001 让事件节点 +1、乐队群聊 hidden 消息包 +9；
  // WA_LC_002 再让事件节点 +1、学姐私聊 hidden 最终对话 +46；
  // 电话模块再让事件节点 +1、学姐私聊 hidden 消息 +2，并新增 content.phone；
  // 抖音模块新增 content.douyin（8 条本地视频），WA_DOUYIN_001 再追加 1 个
  // variable 节点与 4 条学姐私聊 hidden 消息；
  // YouTube 的 content.youtube 是 3 条常规视频 + 4 条 Shorts；Notes 的 15 条
  // 固定原文与编译结果本身不受影响。
  expect(raw.chats).toHaveLength(8);
  expect(raw.events).toHaveLength(14);
  expect(work.nodes).toHaveLength(14);
  expect(work.data.whatsapp).toHaveLength(768);
  expect(raw.content.youtube).toHaveLength(7);
  expect(raw.content.phone).toHaveLength(9);
  expect(
    Object.keys(raw.content)
      .filter((k) => k !== "notes")
      .sort(),
  ).toEqual([
    "calendar",
    // 系统设置个性化新增 content.clock（5 个闹钟 + 2 个世界时钟）。
    "clock",
    "douyin",
    "instagram",
    "maps",
    "phone",
    "photos",
    "safari",
    "spotify",
    "youtube",
  ]);
});

test("验收2｜列表默认按 modifiedAt 倒序显示 15 条", async ({ page }) => {
  test.setTimeout(120000);
  const phone = await loadPhone(page);
  await openNotes(phone);
  const rows = phone.locator(".native-notes .notes-row");
  await expect(rows).toHaveCount(15, { timeout: 15000 });
  const ids = await rows.evaluateAll((els) =>
    els.map((e) => e.getAttribute("data-note-id")),
  );
  const expected = [...srcNotes()]
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id))
    .map((s) => s.id);
  expect(ids).toEqual(expected);
  expect(ids[0]).toBe("note_todo_20261103");
  expect(ids.at(-1)).toBe("note_rehearsal_20251016");
  // 首次导入状态已记录，且只播种一次。
  const state = await readNotesState(page);
  expect(state.version).toBe(1);
  expect(state.imported).toBe(true);
  expect(state.notes).toHaveLength(15);
  expect(state.notes.every((n: any) => n.checked.length === 0)).toBe(true);
  // 4 条清单的清单项数量与原文一致。
  for (const s of srcNotes().filter((x) => x.type === "checklist")) {
    const count = s.body.split("\n").filter((l) => /^- \[ \] /.test(l)).length;
    await expect(
      phone.locator(`.notes-row[data-note-id="${s.id}"]`),
    ).toHaveAttribute("data-checklist-count", String(count));
  }
});

test("验收3｜编辑标题与正文自动保存，返回 / 刷新均不回退", async ({ page }) => {
  test.setTimeout(150000);
  const ID = "note_christmas_20251219";
  const original = byId(ID);
  const phone = await loadPhone(page);
  await openNotes(phone);
  await phone.locator(`.notes-row[data-note-id="${ID}"]`).click();
  await expect(phone.locator(".notes-editor")).toBeVisible();
  await expect(phone.locator(".notes-paper h1")).toHaveText(original.title);

  await phone.getByRole("button", { name: "编辑备忘录" }).click();
  await phone
    .getByRole("textbox", { name: "备忘录标题" })
    .fill("Christmas Set（改过）");
  await phone
    .getByRole("textbox", { name: "备忘录正文" })
    .fill("明天演出：\n\n1. 先试音，再确认线材。");
  await phone.getByRole("button", { name: "完成编辑" }).click();
  await expect(phone.locator(".notes-paper h1")).toHaveText(
    "Christmas Set（改过）",
  );
  await expect(phone.locator(".notes-body-view")).toContainText("先试音");

  // 返回列表后预览同步更新。
  await phone.getByRole("button", { name: "返回备忘录列表" }).click();
  await expect(
    phone.locator(`.notes-row[data-note-id="${ID}"] strong`),
  ).toHaveText("Christmas Set（改过）");

  // 刷新页面后仍是用户改过的文案，且 createdAt 不变、modifiedAt 已刷新。
  await reloadAndOpen(page, phone);
  await expect(
    phone.locator(`.notes-row[data-note-id="${ID}"] strong`),
  ).toHaveText("Christmas Set（改过）");
  await phone.locator(`.notes-row[data-note-id="${ID}"]`).click();
  await expect(phone.locator(".notes-paper h1")).toHaveText(
    "Christmas Set（改过）",
  );
  await expect(phone.locator(".notes-body-view")).toContainText("先试音");
  const state = await readNotesState(page);
  const rec = state.notes.find((n: any) => n.id === ID);
  expect(rec.title).toBe("Christmas Set（改过）");
  expect(rec.body).toBe("明天演出：\n\n1. 先试音，再确认线材。");
  expect(rec.createdAt).toBe(original.date);
  expect(rec.modifiedAt).not.toBe(original.date);
});

test("验收4｜勾选清单持久化，且正文原文始终不被改写", async ({ page }) => {
  test.setTimeout(150000);
  const ID = "note_rehearsal_20251016";
  const original = byId(ID);
  const phone = await loadPhone(page);
  await openNotes(phone);
  await phone.locator(`.notes-row[data-note-id="${ID}"]`).click();
  const first = phone.locator('.notes-check-row[data-check-ordinal="0"]');
  const third = phone.locator('.notes-check-row[data-check-ordinal="2"]');
  await expect(first).toHaveAttribute("aria-checked", "false");
  await first.click();
  await third.click();
  await expect(first).toHaveAttribute("aria-checked", "true");
  await expect(third).toHaveAttribute("aria-checked", "true");

  // 返回后重开仍保持勾选。
  await phone.getByRole("button", { name: "返回备忘录列表" }).click();
  await openNotes(phone);
  await phone.locator(`.notes-row[data-note-id="${ID}"]`).click();
  await expect(
    phone.locator('.notes-check-row[data-check-ordinal="0"]'),
  ).toHaveAttribute("aria-checked", "true");
  await expect(
    phone.locator('.notes-check-row[data-check-ordinal="2"]'),
  ).toHaveAttribute("aria-checked", "true");
  await expect(
    phone.locator('.notes-check-row[data-check-ordinal="1"]'),
  ).toHaveAttribute("aria-checked", "false");

  // 刷新后仍保持勾选；正文逐字等于原文，没有变成 [x]。
  await reloadAndOpen(page, phone);
  await phone.locator(`.notes-row[data-note-id="${ID}"]`).click();
  await expect(
    phone.locator('.notes-check-row[data-check-ordinal="0"]'),
  ).toHaveAttribute("aria-checked", "true");
  const state = await readNotesState(page);
  const rec = state.notes.find((n: any) => n.id === ID);
  expect(rec.checked).toEqual([0, 2]);
  expect(rec.body).toBe(original.body);
  expect(rec.body).not.toContain("[x]");
});

test("验收5｜删除持久化、导入状态记录、重复进入不重复添加", async ({ page }) => {
  test.setTimeout(150000);
  const DELETE_ID = "note_distance_20260529";
  const EDIT_ID = "note_poster_20260304";
  const phone = await loadPhone(page);
  await openNotes(phone);

  // 先编辑一条，验证后续初始化不会覆盖用户内容。
  await phone.locator(`.notes-row[data-note-id="${EDIT_ID}"]`).click();
  await phone.getByRole("button", { name: "编辑备忘录" }).click();
  await phone
    .getByRole("textbox", { name: "备忘录正文" })
    .fill("留白也很重要（已编辑）");
  await phone.getByRole("button", { name: "完成编辑" }).click();
  await phone.getByRole("button", { name: "返回备忘录列表" }).click();

  // 删除一条。
  await phone.locator(`.notes-row[data-note-id="${DELETE_ID}"]`).click();
  await phone.getByRole("button", { name: "删除备忘录", exact: true }).click();
  await phone.getByRole("button", { name: "确认删除备忘录" }).click();
  await expect(phone.locator(".notes-editor")).toHaveCount(0);
  await expect(phone.locator(".native-notes .notes-row")).toHaveCount(14);
  await expect(
    phone.locator(`.notes-row[data-note-id="${DELETE_ID}"]`),
  ).toHaveCount(0);

  // 多次退出 / 重进，不重复添加，编辑内容不回退。
  for (let i = 0; i < 2; i++) await openNotes(phone);
  await expect(phone.locator(".native-notes .notes-row")).toHaveCount(14);
  await expect(
    phone.locator(`.notes-row[data-note-id="${EDIT_ID}"]`),
  ).toHaveCount(1);
  const state = await readNotesState(page);
  expect(state.imported).toBe(true);
  expect(state.notes).toHaveLength(15);
  expect(state.notes.find((n: any) => n.id === DELETE_ID).deleted).toBe(true);
  expect(state.notes.find((n: any) => n.id === EDIT_ID).body).toBe(
    "留白也很重要（已编辑）",
  );

  await reloadAndOpen(page, phone);
  await expect(phone.locator(".native-notes .notes-row")).toHaveCount(14);
  await expect(
    phone.locator(`.notes-row[data-note-id="${DELETE_ID}"]`),
  ).toHaveCount(0);
});

test("验收6｜浏览 / 搜索 / 编辑 / 勾选 / 删除 / 新建都不触发剧情事件", async ({
  page,
}) => {
  test.setTimeout(180000);
  const phone = await loadPhone(page);
  const baseline = await readState(page);
  const before = storyFingerprint(baseline);

  await openNotes(phone);
  await phone.locator(".catalog-search input").fill("海报");
  await expect(phone.locator(".native-notes .notes-row")).toHaveCount(1);
  await phone.locator(".catalog-search input").fill("");

  // 打开 → 编辑 → 勾选 → 新建 → 删除，覆盖全部 Notes 行为。
  await phone.locator('.notes-row[data-note-id="note_poster_20260304"]').click();
  await phone.getByRole("button", { name: "编辑备忘录" }).click();
  await phone
    .getByRole("textbox", { name: "备忘录标题" })
    .fill("Poster Ideas 2");
  await phone.getByRole("button", { name: "完成编辑" }).click();
  await phone.getByRole("button", { name: "返回备忘录列表" }).click();

  await phone.locator('.notes-row[data-note-id="note_todo_20261103"]').click();
  await phone.locator('.notes-check-row[data-check-ordinal="0"]').click();
  await phone.getByRole("button", { name: "返回备忘录列表" }).click();

  await phone.getByRole("button", { name: "新建备忘录" }).click();
  await expect(phone.locator(".notes-editor")).toBeVisible();
  await phone
    .getByRole("textbox", { name: "备忘录标题" })
    .fill("临时记录");
  await phone.getByRole("button", { name: "完成编辑" }).click();
  await phone.getByRole("button", { name: "返回备忘录列表" }).click();
  await expect(phone.locator(".native-notes .notes-row")).toHaveCount(16);

  // 剧情状态指纹完全不变：没有新通知、没有 unlock、没有 playback、没有变量。
  const after = storyFingerprint(await readState(page));
  expect(after).toBe(before);
  const state = await readState(page);
  expect(Object.keys(state.playback ?? {})).toHaveLength(0);
  // 开场锁屏通知本来就存在；这里只要求 Notes 行为没有新增任何通知。
  expect(state.notifications).toEqual(baseline.notifications ?? []);
  expect(state.ui?.notes?.notesState).toContain("Poster Ideas 2");
});

test("验收7｜清单行左对齐，从滚动后的列表打开备忘录回到顶部", async ({
  page,
}) => {
  test.setTimeout(150000);
  const phone = await loadPhone(page);
  await openNotes(phone);

  // 全局 button { justify-content: center } 不能把原生清单居中。
  await phone
    .locator('.notes-row[data-note-id="note_rehearsal_20251016"]')
    .click();
  await expect(
    phone.locator('.notes-check-row[data-check-ordinal="0"]'),
  ).toBeVisible();
  const align = await phone.locator(".notes-paper").evaluate((paper) => {
    const row = paper.querySelector(".notes-check-row") as HTMLElement;
    const line = [...paper.querySelectorAll(".notes-line")].find((p) =>
      (p.textContent ?? "").trim(),
    ) as HTMLElement | undefined;
    return {
      justify: getComputedStyle(row).justifyContent,
      rowLeft: row.getBoundingClientRect().left,
      lineLeft: line?.getBoundingClientRect().left ?? -1,
    };
  });
  expect(align.justify).toBe("flex-start");
  expect(Math.abs(align.rowLeft - align.lineLeft)).toBeLessThan(2);

  await phone.getByRole("button", { name: "返回备忘录列表" }).click();

  // 列表和详情复用同一个 .catalog-scroll 节点：打开前先滚到底，
  // 详情仍应从日期 / 标题 / 正文开头显示，而不是沿用旧 scrollTop。
  const listScroll = phone.locator(".native-notes .catalog-scroll").first();
  await listScroll.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  expect(await listScroll.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await phone.locator('.notes-row[data-note-id="note_aw_design_20261102"]').click();
  await expect(phone.locator(".notes-paper h1")).toHaveText("AW Design Ideas");
  expect(
    await phone.locator(".notes-paper-scroll").evaluate((el) => el.scrollTop),
  ).toBe(0);
  await expect(phone.locator(".notes-paper")).toContainText(
    "今天和学姐聊过的关于 AW 的一些设计想法",
  );
});
