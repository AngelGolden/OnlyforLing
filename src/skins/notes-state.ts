import type { Item } from "../schema";

/**
 * Notes 备忘录的可编辑状态。
 *
 * story.json 的 content.notes 只提供 15 条「固定原文种子」，编译后是只读 Item；
 * 用户的标题 / 正文 / 勾选 / 删除全部落在 Runtime.ui.notes.notesState（JSON 字符串，
 * 因为 UiValue 只允许 string | number | boolean | string[]），随存档持久化。
 *
 * 这里不新增剧情状态结构：imported 只是初始化标记，playback / variables /
 * notifications 等一律不碰。浏览、搜索、编辑、删除 Notes 都不派发剧情事件。
 */
export const NOTES_UI_KEY = "notesState";

export type NoteType = "checklist" | "text";
export type NoteRecord = {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  modifiedAt: string;
  type: NoteType;
  folder: string;
  /** 已勾选的清单项序号（按 body 里 "- [ ] " 行的出现顺序，0 起），不改写 body */
  checked: number[];
  /** 删除也留在数组里，保证再次初始化不会把已删除的备忘录重新加回来 */
  deleted: boolean;
};
export type NotesState = {
  version: 1;
  /** 首次导入完成后置 true；后续初始化只读取，不再重复添加、不覆盖用户编辑 */
  imported: boolean;
  notes: NoteRecord[];
};

export const CHECKLIST_RE = /^- \[[ xX]\] (.*)$/;

export function parseNotesState(raw: string | undefined): NotesState | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as NotesState;
    if (
      !v ||
      v.version !== 1 ||
      v.imported !== true ||
      !Array.isArray(v.notes) ||
      !v.notes.every(
        (n) =>
          typeof n?.id === "string" &&
          typeof n?.title === "string" &&
          typeof n?.body === "string" &&
          typeof n?.createdAt === "string" &&
          typeof n?.modifiedAt === "string" &&
          Array.isArray(n?.checked),
      )
    )
      return null;
    return v;
  } catch {
    return null;
  }
}

/** 把编译后的只读 Item 转成可编辑记录；createdAt / modifiedAt 首次导入时相同。 */
export function seedNotes(items: Item[]): NotesState {
  return {
    version: 1,
    imported: true,
    notes: items.map((i) => {
      const stamp = i.meta?.createdAt || i.time;
      return {
        id: i.id,
        title: i.title,
        body: i.body,
        createdAt: stamp,
        modifiedAt: i.meta?.modifiedAt || stamp,
        type: i.meta?.noteType === "checklist" ? "checklist" : "text",
        folder: i.folder || "备忘录",
        checked: [],
        deleted: false,
      };
    }),
  };
}

/** 已有存档就用存档（绝不重新播种）；没有存档才从固定原文生成初始状态。 */
export function resolveNotes(items: Item[], raw: string | undefined): NotesState {
  return parseNotesState(raw) ?? seedNotes(items);
}

/** 列表默认按 modifiedAt 倒序，最新的在最前；同时间用 id 稳定排序。 */
export function sortNotes(notes: NoteRecord[]): NoteRecord[] {
  return notes
    .filter((n) => !n.deleted)
    .sort(
      (a, b) =>
        b.modifiedAt.localeCompare(a.modifiedAt) || a.id.localeCompare(b.id),
    );
}

export function checklistLines(body: string) {
  const out: { ordinal: number; lineIndex: number; text: string }[] = [];
  body.split("\n").forEach((line, lineIndex) => {
    const m = line.match(CHECKLIST_RE);
    if (m) out.push({ ordinal: out.length, lineIndex, text: m[1] });
  });
  return out;
}

/** 编辑发生的时间：沿用手机时钟口径（现实时间），格式与原文日期一致。 */
export function nowStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 更新一条备忘录并刷新 modifiedAt；返回新的完整状态（供写回 Runtime.ui）。 */
export function updateNote(
  state: NotesState,
  id: string,
  patch: Partial<Omit<NoteRecord, "id" | "createdAt" | "modifiedAt">>,
  stamp = nowStamp(),
): NotesState {
  return {
    ...state,
    notes: state.notes.map((n) =>
      n.id === id ? { ...n, ...patch, modifiedAt: stamp } : n,
    ),
  };
}

export function serializeNotes(state: NotesState): string {
  return JSON.stringify(state);
}
