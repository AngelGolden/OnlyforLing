import { test, expect, type Locator, type Page } from "@playwright/test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { compileStory } from "../src/story-engine/compiler";

/**
 * YouTube｜3 个用户提供的常规本地视频接入验收。
 * 4 条 Shorts 由 tests/youtube-shorts.spec.ts 独立验收。
 * 标题在测试里独立写死（不读 import 脚本的产物），避免「自己验证自己」。
 */
const TITLES = [
  "邝玲玲 cover 《只是太爱你》",
  "邝玲玲 cover 《海阔天空》",
  "邝玲玲 cover 《Until I found You》",
];
const MEDIA = [
  {
    file: "yt-just-love-you.mp4",
    poster: "yt-just-love-you.jpg",
    duration: "4:14",
    seconds: 254,
    sourceName: "หลิงหลิงคอง南寧見面會 cover 只是太愛你 4K (張敬軒).mp4",
    bytes: 76919713,
  },
  {
    file: "yt-hai-kuo-tian-kong.mp4",
    poster: "yt-hai-kuo-tian-kong.jpg",
    duration: "5:55",
    seconds: 355,
    sourceName:
      "250111 LO Fanmeeting  in Hong Kong  鄺玲玲—海闊天空 cover.mp4",
    bytes: 56017714,
  },
  {
    file: "yt-until-i-found-you.mp4",
    poster: "yt-until-i-found-you.jpg",
    duration: "2:48",
    seconds: 168,
    sourceName:
      "[4k Fancam] Lingling Kwong - Until I found You _ 261017 LingOrm Between Us concert.mp4",
    bytes: 29560105,
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

test("验收1｜story.json 与编译产物中 3 条常规视频逐字一致，静态资源真实存在", ({
  request,
}) => {
  const { raw, work } = story();
  expect(raw.installedApps).toContain("youtube");
  expect(raw.content.youtube).toHaveLength(7);
  expect(work.apps.find((a: any) => a.id === "youtube")?.installed).toBe(true);
  const all = work.data.youtube;
  expect(all).toHaveLength(7);
  // 常规视频 folder 为空；Shorts 用 folder="Shorts" 分组，另由专项用例验收。
  const items = all.filter((i: any) => i.folder !== "Shorts");
  expect(items).toHaveLength(3);
  items.forEach((i: any, n: number) => {
    expect(i.title).toBe(TITLES[n]);
    expect(i.body, "不编造视频简介").toBe("");
    expect(i.kind).toBe("video");
    expect(i.hidden).toBe(false);
    expect(i.unlock).toBe("");
    expect(i.meta.video).toBe(`./yt-media/${MEDIA[n].file}`);
    expect(i.meta.poster).toBe(`./yt-media/${MEDIA[n].poster}`);
    expect(i.meta.duration).toBe(MEDIA[n].duration);
    expect(i.meta.sourceName).toBe(MEDIA[n].sourceName);
    expect(ASSET_RE.test(i.meta.video)).toBe(true);
    expect(ASSET_RE.test(i.meta.poster)).toBe(true);
    const video = `public/yt-media/${MEDIA[n].file}`;
    const poster = `public/yt-media/${MEDIA[n].poster}`;
    expect(existsSync(video), video).toBe(true);
    expect(existsSync(poster), poster).toBe(true);
    expect(statSync(video).size).toBe(MEDIA[n].bytes);
    expect(statSync(poster).size).toBeGreaterThan(3000);
  });
  // 其它 App 与剧情数据保持原样（电话模块 +1 节点 / +2 hidden 消息，
  // WA_DOUYIN_001 再 +1 节点 / +4 hidden 消息）。
  expect(work.data.whatsapp).toHaveLength(768);
  expect(raw.content.phone).toHaveLength(9);
  expect(work.data.notes).toHaveLength(15);
  expect(work.data.photos).toHaveLength(42);
  expect(work.nodes).toHaveLength(14);
  expect(work.data.safari).toHaveLength(25);
  expect(work.data.maps).toHaveLength(6);
  return Promise.all([
    request
      .get("/yt-media/yt-just-love-you.mp4", {
        headers: { Range: "bytes=0-1023" },
      })
      .then((r) => expect([200, 206]).toContain(r.status())),
    request
      .get("/yt-media/yt-just-love-you.jpg")
      .then((r) => expect(r.status()).toBe(200)),
  ]);
});

test("验收2｜YouTube 首页显示 3 条视频、真实封面与真实时长", async ({
  page,
}) => {
  test.setTimeout(120000);
  const phone = await loadPhone(page);
  await openYouTube(phone);
  const articles = phone.locator(".youtube-videos article");
  await expect(articles).toHaveCount(3);
  for (let n = 0; n < 3; n++) {
    const a = articles.nth(n);
    await expect(a.locator(".youtube-byline strong")).toHaveText(TITLES[n]);
    await expect(a.locator(".youtube-thumb time")).toHaveText(MEDIA[n].duration);
    const img = a.locator(".youtube-thumb img");
    await expect(img).toHaveAttribute(
      "src",
      `./yt-media/${MEDIA[n].poster}`,
    );
    await expect
      .poll(async () => img.evaluate((el: HTMLImageElement) => el.naturalWidth), {
        timeout: 15000,
      })
      .toBeGreaterThan(300);
  }
  await phone
    .locator(".phone-screen")
    .screenshot({ path: "outputs/youtube/youtube-list.png" });
});

test("验收3｜点击视频进入播放器，加载用户原始 mp4 并可播放", async ({
  page,
}) => {
  test.setTimeout(180000);
  const phone = await loadPhone(page);
  await openYouTube(phone);
  for (let n = 0; n < 3; n++) {
    const a = phone.locator(".youtube-videos article").nth(n);
    await a.locator(".youtube-thumb").click();
    const video = phone.locator(".youtube-player-video");
    await expect(video).toBeVisible({ timeout: 10000 });
    await expect(video).toHaveAttribute("src", `./yt-media/${MEDIA[n].file}`);
    await expect(video).toHaveAttribute("data-video-title", TITLES[n]);
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
    expect(Math.round(info.duration)).toBe(MEDIA[n].seconds);
    expect(info.width).toBeGreaterThan(0);
    expect(info.height).toBeGreaterThan(0);
    // 播放器由真实点击打开，具备用户激活，直接调用 play() 验证可播放。
    const playable = await video.evaluate(async (el: HTMLVideoElement) => {
      try {
        await el.play();
        return !el.paused;
      } catch {
        return false;
      }
    });
    expect(playable, `${MEDIA[n].file} 应可播放`).toBe(true);
    if (n === 0)
      await phone
        .locator(".phone-screen")
        .screenshot({ path: "outputs/youtube/youtube-player.png" });
    await phone.locator(".youtube-player .catalog-nav button[aria-label='返回']").click();
    await expect(phone.locator(".youtube-videos article")).toHaveCount(3);
  }
});

test("验收4｜看视频不产生剧情副作用，刷新 / 重进后条目与封面仍在", async ({
  page,
}) => {
  test.setTimeout(180000);
  const phone = await loadPhone(page);
  const before = fingerprint(await readState(page));
  await openYouTube(phone);
  await phone.locator(".youtube-videos article").first().locator(".youtube-thumb").click();
  await expect(phone.locator(".youtube-player-video")).toBeVisible();
  await phone.locator(".youtube-player .catalog-nav button[aria-label='返回']").click();
  expect(fingerprint(await readState(page))).toBe(before);

  await page.reload();
  await unlockPhone(phone);
  await openYouTube(phone);
  await expect(phone.locator(".youtube-videos article")).toHaveCount(3);
  await expect(
    phone.locator(".youtube-videos article").first().locator(".youtube-byline strong"),
  ).toHaveText(TITLES[0]);
  await expect
    .poll(
      async () =>
        phone
          .locator(".youtube-thumb img")
          .first()
          .evaluate((el: HTMLImageElement) => el.naturalWidth),
      { timeout: 15000 },
    )
    .toBeGreaterThan(300);
  expect(fingerprint(await readState(page))).toBe(before);
});
