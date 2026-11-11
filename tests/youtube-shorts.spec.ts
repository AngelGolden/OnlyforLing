import { test, expect, type Locator, type Page } from "@playwright/test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { compileStory } from "../src/story-engine/compiler";

/**
 * YouTube Shorts｜4 个用户提供的本地短视频接入验收。
 * 标题、时长、字节数在测试里独立写死（不读 import 脚本的产物），避免「自己验证自己」。
 */
const SHORTS = [
  {
    id: "yt_xiaozhu_piano",
    title: "小猪弹琴",
    file: "yt-xiaozhu-piano.mp4",
    poster: "yt-xiaozhu-piano.jpg",
    duration: "0:30",
    seconds: 30,
    bytes: 3152566,
    sourceName: "小猪弹琴.mp4",
  },
  {
    id: "yt_xiaozhu_selfie",
    title: "小猪自拍",
    file: "yt-xiaozhu-selfie.mp4",
    poster: "yt-xiaozhu-selfie.jpg",
    duration: "0:23",
    seconds: 23,
    bytes: 3796678,
    sourceName: "小猪自拍.mp4",
  },
  {
    id: "yt_xiaozhu_cool",
    title: "小猪耍帅",
    file: "yt-xiaozhu-cool.mp4",
    poster: "yt-xiaozhu-cool.jpg",
    duration: "0:13",
    seconds: 13,
    bytes: 2768349,
    sourceName: "小猪耍帅.mp4",
  },
  {
    id: "yt_xiaozhu_cute",
    title: "小猪卖萌",
    file: "yt-xiaozhu-cute.mp4",
    poster: "yt-xiaozhu-cute.jpg",
    duration: "0:13",
    seconds: 13,
    bytes: 1696818,
    sourceName: "小猪卖萌.mp4",
  },
];
const ASSET_RE = /^\.\/yt-media\/[a-z0-9-]+\.(mp4|jpg)$/i;

let cachedRaw: any = null;
let cachedWork: any = null;
function story() {
  if (!cachedRaw)
    cachedRaw = JSON.parse(
      readFileSync("stories/template/story.json", "utf8"),
    );
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
  await page.route("**/work.json", (route) =>
    route.fulfill({ json: structuredClone(work) }),
  );
  await page.goto("/");
  const phone = page.locator(".phone-shell");
  await unlockPhone(phone);
  return phone;
}

async function openYouTube(phone: Locator) {
  await phone.getByRole("button", { name: "返回桌面", exact: true }).click();
  // 返回桌面 / 刷新后主屏会重排，图标节点可能被 React 换掉；整段重试避免偶发 detach。
  await expect(async () => {
    const icon = phone.locator('[data-home-key="youtube"]');
    await icon.scrollIntoViewIfNeeded();
    await icon.click();
  }).toPass({ timeout: 20000 });
  await expect(phone.locator(".youtube-ui .youtube-videos article")).toHaveCount(
    3,
    { timeout: 15000 },
  );
}

async function openShorts(phone: Locator) {
  await phone
    .locator(".catalog-tabs button")
    .filter({ hasText: "Shorts" })
    .click();
  await expect(phone.locator(".youtube-shorts article")).toHaveCount(4, {
    timeout: 15000,
  });
}

async function readState(page: Page): Promise<any> {
  return page.evaluate(async () => {
    const req = indexedDB.open("foundphone-studio");
    const db: IDBDatabase = await new Promise((res, rej) => {
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    const all: any[] = await new Promise((res, rej) => {
      const r = db
        .transaction("saves", "readonly")
        .objectStore("saves")
        .getAll();
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(req.error);
    });
    db.close();
    return all[0]?.state ?? {};
  });
}
function fingerprint(s: any) {
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

test("验收1｜4 条 Shorts 逐字一致，静态资源真实存在且分组独立", async ({
  request,
}) => {
  const { raw, work } = story();
  expect(raw.content.youtube).toHaveLength(7);
  const shorts = raw.content.youtube.filter((i: any) => i.folder === "Shorts");
  expect(shorts).toHaveLength(4);
  expect(
    raw.content.youtube.filter((i: any) => i.folder !== "Shorts"),
  ).toHaveLength(3);
  // 电话模块新增 content.phone（9 条：6 条历史通话 + 3 个联系人），
  // 抖音模块新增 content.douyin（8 条用户本地竖屏视频），
  // 其余 content.* 键与其它剧情数据保持原样。
  expect(Object.keys(raw.content).sort()).toEqual([
    "calendar",
    // 系统设置个性化新增 content.clock（5 个闹钟 + 2 个世界时钟）。
    "clock",
    "douyin",
    "instagram",
    "maps",
    "notes",
    "phone",
    "photos",
    "safari",
    "spotify",
    "youtube",
  ]);
  expect(raw.content.phone).toHaveLength(9);
  expect(work.data.phone).toHaveLength(9);
  expect(work.data.whatsapp).toHaveLength(768);
  expect(work.data.notes).toHaveLength(15);
  expect(work.data.photos).toHaveLength(42);
  expect(work.nodes).toHaveLength(14);

  const compiled = work.data.youtube.filter(
    (i: any) => i.folder === "Shorts",
  );
  expect(compiled).toHaveLength(4);
  for (let n = 0; n < SHORTS.length; n++) {
    const s = SHORTS[n];
    const i = compiled[n];
    expect(i.id).toBe(s.id);
    expect(i.title, "标题逐字照用户给定").toBe(s.title);
    expect(i.body, "不编造视频简介").toBe("");
    expect(i.kind).toBe("video");
    expect(i.sender).toBe("小猪");
    expect(i.folder).toBe("Shorts");
    expect(i.hidden).toBe(false);
    expect(i.unlock).toBe("");
    expect(i.meta.video).toBe(`./yt-media/${s.file}`);
    expect(i.meta.poster).toBe(`./yt-media/${s.poster}`);
    expect(i.meta.duration).toBe(s.duration);
    expect(i.meta.sourceName).toBe(s.sourceName);
    expect(ASSET_RE.test(i.meta.video)).toBe(true);
    expect(ASSET_RE.test(i.meta.poster)).toBe(true);
    const video = `public/yt-media/${s.file}`;
    const poster = `public/yt-media/${s.poster}`;
    expect(existsSync(video), video).toBe(true);
    expect(existsSync(poster), poster).toBe(true);
    expect(statSync(video).size, "必须使用用户原始 mp4 字节").toBe(s.bytes);
    expect(statSync(poster).size).toBeGreaterThan(3000);
    // 真实静态资源可通过预览服务访问。
    const mp4 = await request.get(`/yt-media/${s.file}`, {
      headers: { Range: "bytes=0-1023" },
    });
    expect([200, 206], s.file).toContain(mp4.status());
    const jpg = await request.get(`/yt-media/${s.poster}`);
    expect(jpg.status(), s.poster).toBe(200);
  }
});

test("验收2｜Shorts 只在 Shorts 标签出现，4 条真实封面与时长", async ({
  page,
}) => {
  test.setTimeout(120000);
  const phone = await loadPhone(page);
  await openYouTube(phone);
  // 首页仍是 3 条常规视频，Shorts 不串到首页，也不产生「Shorts」筛选 chip。
  await expect(phone.locator(".youtube-videos article")).toHaveCount(3);
  await expect(phone.locator(".youtube-videos")).not.toContainText("小猪弹琴");
  await expect(phone.locator(".youtube-chips button")).toHaveCount(1);
  await expect(phone.locator(".youtube-chips button")).toHaveText("全部");

  await openShorts(phone);
  await expect(phone.locator(".youtube-videos")).toHaveCount(0);
  const articles = phone.locator(".youtube-shorts article");
  await expect(articles).toHaveCount(4);
  for (let n = 0; n < SHORTS.length; n++) {
    const s = SHORTS[n];
    const a = articles.nth(n);
    await expect(a).toHaveAttribute("data-video-id", s.id);
    await expect(a.locator(".youtube-byline strong")).toHaveText(s.title);
    await expect(a.locator(".youtube-thumb time")).toHaveText(s.duration);
    const img = a.locator(".youtube-thumb img");
    await expect(img).toHaveAttribute("src", `./yt-media/${s.poster}`);
    await expect
      .poll(async () => img.evaluate((el: HTMLImageElement) => el.naturalWidth), {
        timeout: 15000,
      })
      .toBeGreaterThan(300);
  }
  await phone
    .locator(".phone-screen")
    .screenshot({ path: "outputs/youtube/youtube-shorts-list.png" });

  // 切回首页，常规视频仍在，Shorts 仍不出现。
  await phone
    .locator(".catalog-tabs button")
    .filter({ hasText: "首页" })
    .click();
  await expect(phone.locator(".youtube-videos article")).toHaveCount(3);
});

test("验收3｜点击 Shorts 进入竖屏播放器，加载用户原始 mp4 并可播放", async ({
  page,
}) => {
  test.setTimeout(180000);
  const phone = await loadPhone(page);
  await openYouTube(phone);
  await openShorts(phone);
  for (let n = 0; n < SHORTS.length; n++) {
    const s = SHORTS[n];
    await phone
      .locator(".youtube-shorts article")
      .nth(n)
      .locator(".youtube-thumb")
      .click();
    const player = phone.locator(".youtube-player");
    await expect(player).toHaveClass(/is-shorts/);
    const video = player.locator(".youtube-player-video");
    await expect(video).toBeVisible({ timeout: 10000 });
    await expect(video).toHaveAttribute("src", `./yt-media/${s.file}`);
    await expect(video).toHaveAttribute("data-video-title", s.title);
    await expect(video).toHaveAttribute("controls", "");
    await expect
      .poll(
        async () => video.evaluate((el: HTMLVideoElement) => el.readyState),
        { timeout: 30000 },
      )
      .toBeGreaterThanOrEqual(1);
    const info = await video.evaluate((el: HTMLVideoElement) => ({
      duration: el.duration,
      width: el.videoWidth,
      height: el.videoHeight,
    }));
    expect(Math.round(info.duration), s.file).toBe(s.seconds);
    expect(info.width, "用户原始竖屏视频").toBe(720);
    expect(info.height, "用户原始竖屏视频").toBe(1280);
    const playable = await video.evaluate(async (el: HTMLVideoElement) => {
      try {
        await el.play();
        return !el.paused;
      } catch {
        return false;
      }
    });
    expect(playable, `${s.file} 应可播放`).toBe(true);
    if (n === 0)
      await phone
        .locator(".phone-screen")
        .screenshot({ path: "outputs/youtube/youtube-shorts-player.png" });
    await player.locator(".catalog-nav button[aria-label='返回']").click();
    await expect(phone.locator(".youtube-shorts article")).toHaveCount(4);
  }
});

test("验收4｜看 Shorts 不产生剧情副作用，刷新 / 重进后条目与封面仍在", async ({
  page,
}) => {
  test.setTimeout(180000);
  const phone = await loadPhone(page);
  const before = fingerprint(await readState(page));
  await openYouTube(phone);
  await openShorts(phone);
  await phone
    .locator(".youtube-shorts article")
    .first()
    .locator(".youtube-thumb")
    .click();
  await expect(phone.locator(".youtube-player-video")).toBeVisible();
  await phone
    .locator(".youtube-player .catalog-nav button[aria-label='返回']")
    .click();
  expect(fingerprint(await readState(page))).toBe(before);

  await page.reload();
  await unlockPhone(phone);
  await openYouTube(phone);
  await openShorts(phone);
  await expect(phone.locator(".youtube-shorts article")).toHaveCount(4);
  await expect(
    phone
      .locator(".youtube-shorts article")
      .first()
      .locator(".youtube-byline strong"),
  ).toHaveText(SHORTS[0].title);
  await expect
    .poll(
      async () =>
        phone
          .locator(".youtube-shorts .youtube-thumb img")
          .first()
          .evaluate((el: HTMLImageElement) => el.naturalWidth),
      { timeout: 15000 },
    )
    .toBeGreaterThan(300);
  expect(fingerprint(await readState(page))).toBe(before);
});
