import { test, expect, type Locator, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { compileStory } from "../src/story-engine/compiler";

/**
 * Photos 相册 42 张固定照片 + 详情元数据 + 说明编辑持久化验收。
 * 断言独立于 scripts/import-photos.mjs：这里重新解析 data/photos/照片清单.txt
 * 的用户原文副本，逐条与 story.json / 编译产物比对，避免「自己验证自己」。
 */
const SOURCE = "data/photos/照片清单.txt";
const BLOCK_RE = /^【照片\s*(\d{2})】[ \t]*$/;
const IMAGE_LINE_RE = /^图片：(.*?)\s+拍摄时间：(.*)$/;
const IMAGE_NAME_RE = /@image#\d+:(?:"([^"]+)"|([^\s]+))\s*$/;

type SrcPhoto = {
  no: number;
  sourceName: string;
  capturedAtRaw: string;
  time: string;
  location: string;
  caption: string;
  favorite: boolean;
};

function parseSource(): SrcPhoto[] {
  const lines = readFileSync(SOURCE, "utf8")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/);
  const heads: { no: number; line: number }[] = [];
  lines.forEach((l, i) => {
    const m = l.match(BLOCK_RE);
    if (m) heads.push({ no: Number(m[1]), line: i });
  });
  if (heads.length !== 42)
    throw new Error(`原文应含 42 张照片，实际 ${heads.length} 张`);
  return heads.map((h, k) => {
    const end = k + 1 < heads.length ? heads[k + 1].line : lines.length;
    const sec = lines.slice(h.line, end);
    const imageLine = sec.find((x) => x.startsWith("图片："));
    if (!imageLine) throw new Error(`【照片 ${h.no}】缺少图片行`);
    const im = imageLine.match(IMAGE_LINE_RE);
    if (!im) throw new Error(`【照片 ${h.no}】图片行格式异常`);
    const nameMatch = im[1].match(IMAGE_NAME_RE);
    if (!nameMatch) throw new Error(`【照片 ${h.no}】缺少 @image# 文件名`);
    const capturedAtRaw = im[2];
    const normalized = capturedAtRaw
      .replace(/：/g, ":")
      .replace(/\s+/g, " ")
      .trim();
    const t = normalized.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
    if (!t) throw new Error(`【照片 ${h.no}】拍摄时间格式异常`);
    const locLine = sec.find((x) => x.startsWith("拍摄地点："));
    const capLine = sec.find((x) => x.startsWith("照片说明："));
    const favLine = sec.find((x) => x.startsWith("是否收藏："));
    if (!favLine) throw new Error(`【照片 ${h.no}】缺少是否收藏`);
    return {
      no: h.no,
      sourceName: nameMatch[1] ?? nameMatch[2],
      capturedAtRaw,
      time: `${t[1]}-${t[2]}-${t[3]} ${t[4]}:${t[5]}`,
      location: locLine ? locLine.slice("拍摄地点：".length) : "",
      caption: capLine ? capLine.slice("照片说明：".length) : "",
      favorite: favLine.slice("是否收藏：".length) === "是",
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

/** extraPhotos 模拟用户在 Studio 里新增的照片条目（图片仍来自用户已添加的素材）。 */
async function loadPhone(page: Page, extraPhotos: any[] = []): Promise<Locator> {
  const { work } = story();
  const copy = structuredClone(work);
  if (extraPhotos.length) copy.data.photos.push(...extraPhotos);
  await page.route("**/work.json", (route) => route.fulfill({ json: copy }));
  await page.goto("/");
  const phone = page.locator(".phone-shell");
  await unlockPhone(phone);
  return phone;
}

async function openPhotos(phone: Locator) {
  await phone.getByRole("button", { name: "返回桌面", exact: true }).click();
  await phone.getByRole("button", { name: "打开相册", exact: true }).click();
  await expect(
    phone.locator(".native-photos .photo-mosaic button").first(),
  ).toBeVisible({ timeout: 15000 });
}

async function reloadAndOpen(page: Page, phone: Locator) {
  await page.reload();
  await unlockPhone(phone);
  await openPhotos(phone);
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
async function readPhotosState(page: Page): Promise<any> {
  const s = await readState(page);
  return JSON.parse(String(s.ui?.photos?.photosState ?? "null"));
}
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

const src = () => parseSource();
const no = (n: number) => String(n).padStart(2, "0");
const srcOf = (n: number) => src().find((p) => p.no === n)!;
const idOf = (n: number) => `photo_${no(n)}`;

test("验收0｜42 条照片元数据零改写导入，字段映射与静态资源一一对应", () => {
  const list = src();
  const { raw, work } = story();
  const photos = raw.content.photos;
  expect(photos).toHaveLength(42);
  expect(list.filter((p) => p.favorite)).toHaveLength(4);
  expect(list.filter((p) => p.caption)).toHaveLength(40);
  expect(list.filter((p) => p.location)).toHaveLength(1);

  list.forEach((p, i) => {
    const it = photos[i];
    expect(it.id, `第 ${p.no} 张 id`).toBe(idOf(p.no));
    expect(it.title).toBe(`照片 ${no(p.no)}`);
    // caption / 拍摄时间 / 地点 / 收藏全部按原文取值，不创作、不润色。
    expect(it.body, `第 ${p.no} 张说明逐字一致`).toBe(p.caption);
    expect(it.time, `第 ${p.no} 张规范化拍摄时间`).toBe(p.time);
    expect(it.meta.capturedAtRaw, `第 ${p.no} 张原文时间（含全角冒号/双空格）`).toBe(
      p.capturedAtRaw,
    );
    expect(it.meta.location ?? "", `第 ${p.no} 张地点`).toBe(p.location);
    expect(it.favorite, `第 ${p.no} 张收藏`).toBe(p.favorite);
    expect(it.meta.sourceName).toBe(p.sourceName);
    expect(it.meta.image).toBe(`./photo-media/photo-${no(p.no)}.jpg`);
    expect(existsSync(`public/photo-media/photo-${no(p.no)}.jpg`)).toBe(true);
    // story.json 源文件不写 media（编译器默认补空串），不得把大图内联进剧情数据。
    expect(it.media ?? "", `第 ${p.no} 张不得内联大图`).toBe("");
  });

  // 编译产物同样逐字一致；本地静态路径走 meta.image 白名单，不进 safeMedia 的 media 字段。
  const compiled = work.data.photos;
  expect(compiled).toHaveLength(42);
  expect(compiled.map((i: any) => i.body)).toEqual(list.map((p) => p.caption));
  expect(compiled.map((i: any) => i.meta.image)).toEqual(
    list.map((p) => `./photo-media/photo-${no(p.no)}.jpg`),
  );
  expect(compiled.every((i: any) => !i.hidden && !i.unlock && !i.media)).toBe(true);

  const sources = JSON.parse(readFileSync("data/photos/sources.json", "utf8"));
  expect(sources.files).toHaveLength(42);
  // 其余剧情数据未被改动。WA_LC_001 让事件节点 +1、乐队群聊 hidden 消息包 +9；
  // WA_LC_002 再让事件节点 +1、学姐私聊 hidden 最终对话 +46；
  // 电话模块再让事件节点 +1、学姐私聊 hidden 消息 +2，并新增 content.phone；
  // WA_DOUYIN_001 再让事件节点 +1、学姐私聊 hidden 消息 +4；
  // Photos 的 42 条固定元数据与 Notes 的 15 条原文本身不受影响。
  expect(raw.chats).toHaveLength(8);
  expect(raw.events).toHaveLength(14);
  expect(work.nodes).toHaveLength(14);
  expect(work.data.whatsapp).toHaveLength(768);
  expect(raw.content.phone).toHaveLength(9);
  expect(work.data.notes).toHaveLength(15);
});

test("验收1｜三列网格按拍摄时间倒序显示，新增照片也能显示真实缩略图", async ({
  page,
}) => {
  test.setTimeout(150000);
  const extra = {
    id: "photo_user_001",
    title: "用户新增照片",
    body: "后来加进来的一张。",
    richText: "",
    time: "2026-11-05 09:30",
    sender: "我",
    avatar: "",
    kind: "image",
    media: "",
    hidden: false,
    unlock: "",
    password: "",
    folder: "最近项目",
    favorite: false,
    outgoing: false,
    read: false,
    likes: 0,
    comments: [],
    meta: {
      image: "./photo-media/photo-11.jpg",
      capturedAt: "2026-11-05T09:30:00",
    },
  };
  const phone = await loadPhone(page, [extra]);
  await openPhotos(phone);
  const tiles = phone.locator(".native-photos .photo-mosaic button");
  await expect(tiles).toHaveCount(43, { timeout: 15000 });

  const ids = await tiles.evaluateAll((els) =>
    els.map((e) => e.getAttribute("data-photo-id")),
  );
  // 倒序：用清单原文的拍摄时间独立计算期望顺序（不复用组件的 sortPhotos）。
  const chronological = src()
    .map((p) => ({ id: idOf(p.no), key: p.time }))
    .sort((a, b) => b.key.localeCompare(a.key) || a.id.localeCompare(b.id))
    .map((x) => x.id);
  expect(ids).toEqual(["photo_user_001", ...chronological]);
  expect(ids[0]).toBe("photo_user_001");
  expect(ids[1]).toBe(idOf(42));
  expect(ids.at(-1)).toBe(idOf(1));
  // 29 / 30 同为 2026-08-27，但 21:39 晚于 17:30：倒序时 29 必须在 30 之前。
  expect(ids.indexOf(idOf(29))).toBeLessThan(ids.indexOf(idOf(30)));

  // 三列 + 统一尺寸，且每张缩略图都是真实加载出来的本地静态图。
  const columns = await phone.locator(".photo-mosaic").evaluate(
    (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length,
  );
  expect(columns).toBe(3);
  await expect(tiles.first()).toHaveAttribute("data-has-image", "1");
  const thumbs = await tiles.evaluateAll((els) =>
    els.map((e) => ({
      tag: e.querySelector("img")?.tagName ?? "",
      src: e.querySelector("img")?.getAttribute("src") ?? "",
      w: Math.round(e.getBoundingClientRect().width),
      h: Math.round(e.getBoundingClientRect().height),
    })),
  );
  expect(thumbs.every((t) => t.tag === "IMG" && t.src.startsWith("./photo-media/"))).toBe(
    true,
  );
  expect(thumbs[0].w).toBeGreaterThan(0);
  expect(Math.abs(thumbs[0].w - thumbs[0].h)).toBeLessThan(2);
  const firstImg = tiles.first().locator("img");
  await expect
    .poll(async () => firstImg.evaluate((el: any) => el.naturalWidth), {
      timeout: 15000,
    })
    .toBeGreaterThan(0);
});

test("验收2/3｜点击显示对应大图，日期、时间、地点、说明都属于该照片", async ({
  page,
}) => {
  test.setTimeout(150000);
  const phone = await loadPhone(page);
  await openPhotos(phone);

  // 有地点 + 有说明的照片 01。
  await phone.locator(`.photo-mosaic button[data-photo-id="${idOf(1)}"]`).click();
  let detail = phone.locator(`.photos-detail[data-photo-id="${idOf(1)}"]`);
  await expect(detail).toBeVisible();
  const p1 = srcOf(1);
  await expect(detail.locator(".photos-detail-meta h1")).toHaveText("2025年9月11日");
  await expect(detail.locator(".photos-detail-subtime")).toContainText("18:42");
  await expect(detail.locator(".photos-detail-location")).toHaveText("香港理工大学");
  await expect(detail.locator(".photos-caption")).toHaveText(p1.caption);
  const big = detail.locator(".photos-detail-stage img");
  await expect(big).toHaveAttribute("src", "./photo-media/photo-01.jpg");
  await expect
    .poll(async () => big.evaluate((el: any) => el.naturalWidth), {
      timeout: 15000,
    })
    .toBeGreaterThan(0);

  // 返回后打开照片 04：不得共用 01 的地点 / 说明，且大图是自己的。
  await phone.getByRole("button", { name: "返回照片网格" }).click();
  await phone.locator(`.photo-mosaic button[data-photo-id="${idOf(4)}"]`).click();
  detail = phone.locator(`.photos-detail[data-photo-id="${idOf(4)}"]`);
  await expect(detail).toBeVisible();
  const p4 = srcOf(4);
  await expect(detail.locator(".photos-detail-meta h1")).toHaveText("2025年10月1日");
  await expect(detail.locator(".photos-detail-subtime")).toContainText("16:22");
  await expect(detail.locator(".photos-detail-location")).toHaveCount(0);
  await expect(detail.locator(".photos-caption")).toHaveText(p4.caption);
  await expect(detail.locator(".photos-caption")).not.toContainText(p1.caption);
  await expect(detail.locator(".photos-detail-stage img")).toHaveAttribute(
    "src",
    "./photo-media/photo-04.jpg",
  );
});

test("验收4｜点击说明编辑后自动保存，返回 / 重开 / 刷新 / 关闭 App 都保留", async ({
  page,
}) => {
  test.setTimeout(180000);
  const phone = await loadPhone(page);
  await openPhotos(phone);
  const open04 = async () => {
    await phone.locator(`.photo-mosaic button[data-photo-id="${idOf(4)}"]`).click();
    await expect(phone.locator(".photos-detail")).toBeVisible();
  };

  await open04();
  await expect(phone.locator(".photos-caption")).toHaveText(srcOf(4).caption);
  // 规格：点击说明区域进入编辑。
  await phone.locator(".photos-caption").click();
  await phone
    .getByRole("textbox", { name: "照片说明" })
    .fill("第一次正式排练（改过）：大家都挺好相处的。");
  await phone.getByRole("button", { name: "完成编辑照片说明" }).click();
  await expect(phone.locator(".photos-caption")).toHaveText(
    "第一次正式排练（改过）：大家都挺好相处的。",
  );
  // 编辑即时落到 Runtime.ui.photos.photosState，不是组件临时 state。
  const saved = await readPhotosState(page);
  expect(saved.version).toBe(1);
  expect(saved.captions[idOf(4)]).toBe(
    "第一次正式排练（改过）：大家都挺好相处的。",
  );
  expect(saved.captions[idOf(1)]).toBeUndefined();

  // 退出再进入。
  await phone.getByRole("button", { name: "返回照片网格" }).click();
  await open04();
  await expect(phone.locator(".photos-caption")).toHaveText(
    "第一次正式排练（改过）：大家都挺好相处的。",
  );

  // 刷新页面后仍保留，且其它照片的说明没有被覆盖。
  await reloadAndOpen(page, phone);
  await open04();
  await expect(phone.locator(".photos-caption")).toHaveText(
    "第一次正式排练（改过）：大家都挺好相处的。",
  );
  await phone.getByRole("button", { name: "返回照片网格" }).click();
  await phone.locator(`.photo-mosaic button[data-photo-id="${idOf(1)}"]`).click();
  await expect(phone.locator(".photos-caption")).toHaveText(srcOf(1).caption);

  // 关闭 App 再打开（回桌面 → 重新进相册）同样保留。
  await phone.getByRole("button", { name: "返回照片网格" }).click();
  await openPhotos(phone);
  await open04();
  await expect(phone.locator(".photos-caption")).toHaveText(
    "第一次正式排练（改过）：大家都挺好相处的。",
  );
});

test("验收5｜无说明照片仍可打开，且不出现空白说明区域；也可补写说明", async ({
  page,
}) => {
  test.setTimeout(150000);
  const phone = await loadPhone(page);
  await openPhotos(phone);
  for (const n of [8, 24]) {
    await phone
      .locator(`.photo-mosaic button[data-photo-id="${idOf(n)}"]`)
      .click();
    const detail = phone.locator(`.photos-detail[data-photo-id="${idOf(n)}"]`);
    await expect(detail).toBeVisible();
    await expect(detail).toHaveAttribute("data-has-caption", "0");
    await expect(detail.locator(".photos-caption")).toHaveCount(0);
    await expect(detail.locator(".photos-caption-input")).toHaveCount(0);
    await expect(detail.locator(".photos-detail-stage img")).toHaveAttribute(
      "src",
      `./photo-media/photo-${no(n)}.jpg`,
    );
    await phone.getByRole("button", { name: "返回照片网格" }).click();
  }

  // 无说明照片也能通过顶部「编辑」补写，且不影响其它照片。
  await phone.locator(`.photo-mosaic button[data-photo-id="${idOf(8)}"]`).click();
  await phone.getByRole("button", { name: "编辑照片说明" }).click();
  await phone.getByRole("textbox", { name: "照片说明" }).fill("后来补上的说明。");
  await phone.getByRole("button", { name: "完成编辑照片说明" }).click();
  await expect(phone.locator(".photos-caption")).toHaveText("后来补上的说明。");
  const saved = await readPhotosState(page);
  expect(saved.captions[idOf(8)]).toBe("后来补上的说明。");
  expect(saved.captions[idOf(24)]).toBeUndefined();
});

test("验收6｜返回网格后滚动位置不丢失", async ({ page }) => {
  test.setTimeout(150000);
  const phone = await loadPhone(page);
  await openPhotos(phone);
  const gridScroll = phone.locator(".native-photos .catalog-scroll");
  await gridScroll.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  // 先让目标照片进入视口（真实用户也是先滚到可见再点），再取基准值；
  // 否则自动化工具的 scrollIntoView 会在点击瞬间改动 scrollTop。
  const target = phone.locator(
    `.photo-mosaic button[data-photo-id="${idOf(1)}"]`,
  );
  await target.scrollIntoViewIfNeeded();
  const before = await gridScroll.evaluate((el) => el.scrollTop);
  expect(before).toBeGreaterThan(0);

  // 滚到底后最后一张是 photo_01，点它进详情再返回。
  await target.click();
  await expect(phone.locator(".photos-detail")).toBeVisible();
  await phone.getByRole("button", { name: "返回照片网格" }).click();
  await expect(phone.locator(".native-photos .photo-mosaic")).toBeVisible();
  const after = await gridScroll.evaluate((el) => el.scrollTop);
  expect(Math.abs(after - before)).toBeLessThan(2);
});

test("验收7｜相簿 / 收藏 / 搜索等原有功能不损坏，且浏览不触发剧情", async ({
  page,
}) => {
  test.setTimeout(180000);
  const phone = await loadPhone(page);
  const baseline = await readState(page);
  const before = storyFingerprint(baseline);

  await openPhotos(phone);
  // 收藏标签页：只有 4 张原文标「是」的照片。
  await phone.getByRole("button", { name: "收藏", exact: true }).click();
  const favs = phone.locator(".native-photos .photo-mosaic button");
  await expect(favs).toHaveCount(4);
  const favIds = await favs.evaluateAll((els) =>
    els.map((e) => e.getAttribute("data-photo-id")),
  );
  expect(favIds.sort()).toEqual([10, 22, 25, 36].map(idOf).sort());

  // 相簿标签页：按 folder 分组，进入后仍是完整网格。
  await phone.getByRole("button", { name: "相簿", exact: true }).click();
  await expect(phone.locator(".album-grid button")).toHaveCount(1);
  await phone.locator(".album-grid button").first().click();
  await expect(phone.locator(".native-photos .photo-mosaic button")).toHaveCount(42);

  // 图库搜索沿用 useContent：按原文说明 / 元数据过滤。
  await phone.getByRole("button", { name: "图库", exact: true }).click();
  await phone.locator(".native-photos .catalog-search input").fill("香港理工大学");
  await expect(phone.locator(".native-photos .photo-mosaic button")).toHaveCount(1);
  await expect(
    phone.locator(`.photo-mosaic button[data-photo-id="${idOf(1)}"]`),
  ).toHaveCount(1);
  await phone.locator(".native-photos .catalog-search input").fill("");

  // 打开 / 编辑 / 收藏都不写剧情状态。
  await phone.locator(`.photo-mosaic button[data-photo-id="${idOf(3)}"]`).click();
  await phone.getByRole("button", { name: "收藏照片" }).click();
  await phone.getByRole("button", { name: "返回照片网格" }).click();
  const after = storyFingerprint(await readState(page));
  expect(after).toBe(before);
  const s = await readState(page);
  expect(Object.keys(s.playback ?? {})).toHaveLength(0);
  expect(s.notifications).toEqual(baseline.notifications ?? []);
  const photoState = await readPhotosState(page);
  expect(photoState.favorites[idOf(3)]).toBe(true);
  await phone.getByRole("button", { name: "收藏", exact: true }).click();
  await expect(
    phone.locator(`.photo-mosaic button[data-photo-id="${idOf(3)}"]`),
  ).toHaveCount(1);
});
