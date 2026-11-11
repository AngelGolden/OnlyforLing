/**
 * 手机系统｜页面返回、状态恢复与事件防重复机制完善 · 专项回归
 *
 * 规格逐字副本：data/system-state-restore/手机系统｜页面返回、状态恢复与事件防重复机制完善.txt
 * 全部走真实 UI + 真实 IndexedDB 存档；不直接改 Runtime 来「制造」通过
 * （唯一例外是验收8，用存档注入构造「事件已完成」前置，与既有 wa-lc001.spec.ts 同口径）。
 *
 * 覆盖本轮最小修复引入的三个能力：Runtime.viewState、内容 ID 辅助滚动恢复、
 * Runtime.deliveredNotices 通知 / 来电一次投递。
 */
import { test, expect, type Locator, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { compileStory } from "../src/story-engine/compiler";

const raw = JSON.parse(readFileSync("stories/template/story.json", "utf8"));
const work = compileStory(raw).work;
const PIN = String(raw.phone?.passcode ?? "");

async function unlockPhone(phone: Locator) {
  await phone.getByRole("button", { name: "轻触解锁" }).click();
  for (const d of PIN)
    await phone.getByRole("button", { name: "密码键" + d }).click();
  await expect(
    phone.getByRole("button", { name: "搜索", exact: true }),
  ).toBeVisible({ timeout: 10000 });
}

async function loadPhone(page: Page): Promise<Locator> {
  await page.route("**/work.json", (route) =>
    route.fulfill({ json: structuredClone(work) }),
  );
  await page.goto("/?fresh=1");
  const phone = page.locator(".phone-shell");
  await unlockPhone(phone);
  return phone;
}

/** ?fresh=1 在启动时会从 URL 中移除，所以 goto("/") 是纯刷新，不清存档。 */
async function reloadPhone(page: Page): Promise<Locator> {
  await page.goto("/");
  const phone = page.locator(".phone-shell");
  await unlockPhone(phone);
  return phone;
}

async function openApp(phone: Locator, homeKey: string, root: string) {
  const home = phone.getByRole("button", { name: "返回桌面", exact: true });
  if (await home.count()) await home.click();
  // 主屏 React 重排会让图标节点偶发 detach，整段重试。
  await expect(async () => {
    const icon = phone.locator(`[data-home-key="${homeKey}"]`);
    await icon.scrollIntoViewIfNeeded();
    await icon.click();
  }).toPass({ timeout: 20000 });
  await expect(phone.locator(root)).toBeVisible({ timeout: 15000 });
}

const openNotes = (phone: Locator) => openApp(phone, "notes", ".native-notes");
const openForum = (phone: Locator) => openApp(phone, "forum", ".forum-v1");
const openInstagram = (phone: Locator) =>
  openApp(phone, "instagram", ".igx-ui");
const openPhoneApp = (phone: Locator) =>
  openApp(phone, "dock:phone", ".phone-skin");
const openWhatsApp = (phone: Locator) =>
  openApp(phone, "whatsapp", ".whatsapp-ui");
const openPhotos = (phone: Locator) =>
  openApp(phone, "photos", ".native-photos");

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

async function writeState(page: Page, state: any) {
  await page.evaluate(async (next: any) => {
    const req = indexedDB.open("foundphone-studio");
    const db: IDBDatabase = await new Promise((res, rej) => {
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    const tx = db.transaction("saves", "readwrite");
    const store = tx.objectStore("saves");
    const all: any[] = await new Promise((res, rej) => {
      const r = store.getAll();
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    await new Promise((res, rej) => {
      const r = store.put({ ...all[0], state: next });
      r.onsuccess = () => res(null);
      r.onerror = () => rej(r.error);
    });
    await new Promise((res) => (tx.oncomplete = () => res(null)));
    db.close();
  }, state);
}

/** 只比较剧情相关字段：viewState / visited / 时钟都不该影响事件判定。 */
function storyFingerprint(s: any) {
  return JSON.stringify({
    completed: s.completed ?? [],
    unlocked: s.unlocked ?? [],
    playback: s.playback ?? {},
    variables: s.variables ?? {},
    messages: s.messages ?? {},
    ui: s.ui ?? {},
    clues: s.clues ?? [],
    endings: s.endings ?? [],
    notifications: s.notifications ?? [],
    read: s.read ?? [],
  });
}

/** 重复进出 App 时只比较事件副作用；ui 里的草稿 / 播放态不算事件重触发。 */
function eventFingerprint(s: any) {
  return JSON.stringify({
    completed: s.completed ?? [],
    unlocked: s.unlocked ?? [],
    playback: s.playback ?? {},
    variables: s.variables ?? {},
    messages: s.messages ?? {},
    clues: s.clues ?? [],
    endings: s.endings ?? [],
    notifications: s.notifications ?? [],
    read: s.read ?? [],
  });
}

/** 滚动 / 输入是防抖写入，轮询等存档追上 UI。 */
async function waitView(
  page: Page,
  app: string,
  key: string,
  contains: string,
) {
  await expect(async () => {
    const s = await readState(page);
    const value = String(s.viewState?.[app]?.[key] ?? "");
    expect(value).toContain(contains);
  }).toPass({ timeout: 12000 });
}

async function setScroll(locator: Locator): Promise<number> {
  const max = await locator.evaluate(
    (el) => el.scrollHeight - el.clientHeight,
  );
  expect(max, "列表本身需要可滚动才能验证位置恢复").toBeGreaterThan(40);
  const target = Math.min(160, Math.floor(max * 0.6));
  await locator.evaluate((el, t) => {
    el.scrollTop = t;
    el.dispatchEvent(new Event("scroll", { bubbles: true }));
  }, target);
  await locator.evaluate(() => new Promise((r) => setTimeout(r, 400)));
  return target;
}

async function waitScroll(locator: Locator, target: number) {
  await expect(async () => {
    const top = await locator.evaluate((el) => el.scrollTop);
    expect(Math.abs(top - target)).toBeLessThan(70);
  }).toPass({ timeout: 12000 });
}

test("验收1｜Notes 搜索词 / 文件夹跨 App 切换与刷新恢复，用户编辑内容不回退，且不写入 ui", async ({
  page,
}) => {
  let phone = await loadPhone(page);
  await openNotes(phone);
  await expect(phone.locator(".native-notes .notes-row")).toHaveCount(15, {
    timeout: 15000,
  });
  const before = storyFingerprint(await readState(page));
  const search = phone.locator(".native-notes .catalog-search input");
  const firstTitle = await phone
    .locator(".native-notes .notes-row strong")
    .first()
    .innerText();
  const keyword = firstTitle.slice(0, 2);

  // 搜索词进 Runtime.viewState.notes，而不是 Runtime.ui.notes。
  await search.fill(keyword);
  await waitView(page, "notes", "viewState", keyword);
  const filtered = await phone.locator(".native-notes .notes-row").count();
  expect(filtered).toBeGreaterThan(0);

  await openForum(phone);
  await openNotes(phone);
  await expect(search).toHaveValue(keyword);
  await expect(phone.locator(".native-notes .notes-row")).toHaveCount(filtered);

  const state = await readState(page);
  expect(Object.keys(state.ui?.notes ?? {})).not.toContain("viewState");
  expect(Object.keys(state.ui?.notes ?? {})).not.toContain("scrollState");
  expect(storyFingerprint(state)).toBe(before);

  // 文件夹同样持久化，刷新后从存档恢复。
  await search.fill("");
  await phone.locator(".note-folders button").first().click();
  const folder = await phone.locator(".native-notes h1").innerText();
  await waitView(page, "notes", "viewState", folder);
  await openForum(phone);
  await openNotes(phone);
  await expect(phone.locator(".native-notes h1")).toHaveText(folder);

  phone = await reloadPhone(page);
  await openNotes(phone);
  await expect(phone.locator(".native-notes h1")).toHaveText(folder);

  // 用户编辑内容走原有 notesState，刷新后不被固定种子覆盖。
  await phone.locator(".notes-back").click();
  const edited = `状态恢复验收-${Date.now()}`;
  await phone.locator(".native-notes .notes-row").first().click();
  await phone.getByRole("button", { name: "编辑备忘录" }).click();
  await phone
    .getByRole("textbox", { name: "备忘录标题" })
    .fill(edited);
  await phone.getByRole("button", { name: "完成编辑" }).click();
  await phone.getByRole("button", { name: "返回备忘录列表" }).click();
  phone = await reloadPhone(page);
  await openNotes(phone);
  await expect(
    phone.locator(".native-notes .notes-row strong", { hasText: edited }),
  ).toHaveCount(1);
});

test("验收2｜Notes 列表滚动位置按内容 ID 跨切换 / 刷新恢复", async ({
  page,
}) => {
  let phone = await loadPhone(page);
  await openNotes(phone);
  await expect(phone.locator(".native-notes .notes-row")).toHaveCount(15, {
    timeout: 15000,
  });
  const list = phone.locator(".native-notes .catalog-scroll");
  const target = await setScroll(list);
  const saved = await readState(page);
  const entry = JSON.parse(
    String(saved.viewState?.notes?.scrollState ?? "{}"),
  )["notes:list:all"];
  expect(entry?.top).toBeGreaterThan(0);
  expect(String(entry?.anchor ?? "")).not.toBe("");

  await openForum(phone);
  await openNotes(phone);
  await waitScroll(phone.locator(".native-notes .catalog-scroll"), target);

  phone = await reloadPhone(page);
  await openNotes(phone);
  await waitScroll(phone.locator(".native-notes .catalog-scroll"), target);
});

test("验收3｜Forum 搜索词 / 排序 / 板块跨切换与刷新恢复，且不产生剧情状态", async ({
  page,
}) => {
  let phone = await loadPhone(page);
  await openForum(phone);
  // 后续会打开 Notes（它会播种 ui.notes.notesState），所以这里只比较事件副作用。
  const before = eventFingerprint(await readState(page));
  const postSearch = phone.locator(".fm-posts .catalog-search input");
  const firstTitle = await phone.locator(".fm-topic strong").first().innerText();
  const keyword = firstTitle.replace(/[🔥\s]/g, "").slice(0, 2);
  await postSearch.fill(keyword);
  await phone.getByRole("button", { name: "按热门排序" }).click();
  await phone.locator(".fm-board").first().click();
  await waitView(page, "forum", "viewState", keyword);
  const state = await readState(page);
  const view = JSON.parse(String(state.viewState?.forum?.viewState ?? "{}"));
  expect(view.sort).toBe("hot");
  expect(String(view.boardId)).not.toBe("");
  expect(state.ui?.forum ?? {}).toEqual({});
  expect(eventFingerprint(state)).toBe(before);

  const check = async (p: Locator) => {
    await expect(p.locator(".fm-posts .catalog-search input")).toHaveValue(
      keyword,
    );
    await expect(
      p.getByRole("button", { name: "按热门排序" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(p.locator(".fm-board.selected")).toHaveCount(1);
  };
  await openNotes(phone);
  await openForum(phone);
  await check(phone);

  phone = await reloadPhone(page);
  await openForum(phone);
  await check(phone);
  expect(eventFingerprint(await readState(page))).toBe(before);
});

test("验收4｜Forum 帖子列表滚动位置在进详情返回与刷新后恢复", async ({
  page,
}) => {
  let phone = await loadPhone(page);
  await openForum(phone);
  const list = phone.locator(".fm-list");
  const target = await setScroll(list);
  const saved = await readState(page);
  const entry = JSON.parse(
    String(saved.viewState?.forum?.["scrollState:posts"] ?? "{}"),
  )["forum:posts:all:newest"];
  expect(entry?.top).toBeGreaterThan(0);
  expect(String(entry?.anchor ?? "")).not.toBe("");

  await phone.locator(".fm-topic").first().click();
  await expect(phone.locator(".fm-detail")).toBeVisible();
  await phone.getByRole("button", { name: "返回帖子列表" }).click();
  await waitScroll(phone.locator(".fm-list"), target);

  phone = await reloadPhone(page);
  await openForum(phone);
  await waitScroll(phone.locator(".fm-list"), target);
});

test("验收5｜Instagram Tab 与搜索词跨 App 切换 / 刷新恢复", async ({
  page,
}) => {
  let phone = await loadPhone(page);
  await openInstagram(phone);
  await phone
    .locator(".igx-bottom")
    .getByRole("button", { name: "搜索", exact: true })
    .click();
  const search = phone.getByRole("textbox", { name: "搜索账号" });
  await search.fill("hk");
  await waitView(page, "instagram", "viewState", "hk");
  const view = JSON.parse(
    String((await readState(page)).viewState?.instagram?.viewState ?? "{}"),
  );
  expect(view.tab).toBe("search");
  expect(view.query).toBe("hk");

  const check = async (p: Locator) => {
    await expect(
      p.locator(".igx-bottom").getByRole("button", { name: "搜索", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(p.getByRole("textbox", { name: "搜索账号" })).toHaveValue(
      "hk",
    );
  };
  await openNotes(phone);
  await openInstagram(phone);
  await check(phone);
  phone = await reloadPhone(page);
  await openInstagram(phone);
  await check(phone);
});

test("验收6｜电话 App Tab 跨 App 切换恢复", async ({ page }) => {
  const phone = await loadPhone(page);
  await openPhoneApp(phone);
  await phone.locator('[data-phone-tab="通讯录"]').click();
  await waitView(page, "phone", "viewState", "通讯录");
  await openForum(phone);
  await openPhoneApp(phone);
  await expect(phone.locator('[data-phone-tab="通讯录"]')).toHaveClass(
    /selected/,
  );
  await expect(phone.locator(".phone-skin h1")).toHaveText("通讯录");
});

test("验收7｜开屏通知幂等：多次刷新不重复投递，幂等键随存档保存", async ({
  page,
}) => {
  await loadPhone(page);
  const first = await readState(page);
  expect(first.deliveredNotices).toContain("start-lock-notice:0");
  const count = (first.notifications ?? []).length;
  expect(count).toBeGreaterThan(0);

  for (let i = 0; i < 2; i++) {
    await reloadPhone(page);
    const s = await readState(page);
    expect(s.notifications ?? []).toHaveLength(count);
    expect(
      (s.deliveredNotices ?? []).filter(
        (k: string) => k === "start-lock-notice:0",
      ),
    ).toHaveLength(1);
  }
});

test("验收8｜已完成的事件重复进入所属 App，不重复触发 / 不重复写消息", async ({
  page,
}) => {
  let phone = await loadPhone(page);
  const base = await readState(page);
  // 构造「IG-001 已完成」前置（与既有 wa-lc001.spec.ts 的存档注入同口径）。
  await writeState(page, {
    ...base,
    completed: [...new Set([...(base.completed ?? []), "IG-001"])],
    variables: { ...(base.variables ?? {}), IG_001_TRIGGERED: true },
  });
  phone = await reloadPhone(page);
  await openInstagram(phone);
  const first = eventFingerprint(await readState(page));

  for (let i = 0; i < 2; i++) {
    await openWhatsApp(phone);
    await openInstagram(phone);
  }
  await openPhotos(phone);
  await openForum(phone);
  await openInstagram(phone);

  const after = await readState(page);
  expect(eventFingerprint(after)).toBe(first);
  expect(
    (after.completed ?? []).filter((x: string) => x === "IG-001"),
  ).toHaveLength(1);
  const packs = Object.values(after.playback ?? {}) as any[];
  for (const pack of packs) {
    const ids: string[] = pack.deliveredMessageIds ?? [];
    expect(new Set(ids).size).toBe(ids.length);
  }
});
