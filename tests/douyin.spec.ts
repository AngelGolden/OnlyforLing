/**
 * 抖音 App｜竖屏短视频浏览界面 · 第七章验收（12 项）
 *
 * 配文、昵称、主页链接全部从规格逐字副本 data/douyin/抖音App搭建指令.txt
 * 独立解析，不从实现文件自证。视频源用 public/dy-media 的真实 mp4，
 * 所有滑动、播放、跳转、返回都走真实 UI 与真实存档。
 */
import { test, expect, type Locator, type Page } from "@playwright/test";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { compileStory } from "../src/story-engine/compiler";
import {
  DOUYIN_AUTHOR,
  DOUYIN_AVATAR,
  DOUYIN_PROFILE_URL,
} from "../src/skins/douyin-data";

const SPEC = readFileSync("data/douyin/抖音App搭建指令.txt", "utf8");
const raw = JSON.parse(readFileSync("stories/template/story.json", "utf8"));
const work = compileStory(raw).work;
const PIN = String(raw.phone?.passcode ?? "");

const pick = (re: RegExp, label: string) => {
  const m = re.exec(SPEC);
  if (!m) throw new Error(`规格副本缺少：${label}`);
  return m[1].trim();
};
const AUTHOR = pick(/^- 用户昵称：(.+)$/m, "用户昵称");
const AVATAR_LABEL = pick(/@image#1:"(.+?)"/, "用户头像文件名");
const PROFILE = pick(/^- 真实抖音主页链接：(.+)$/m, "真实主页链接");
const VIDEO_LINE = /^视频文件：@"(.+?)"\s+视频文案：(.*)$/;
const SOURCES = SPEC.split(/\r?\n/).reduce<
  { sourceName: string; caption: string; file: string }[]
>((acc, line) => {
  const m = VIDEO_LINE.exec(line);
  if (!m) return acc;
  acc.push({
    sourceName: path.basename(m[1].replace(/\\/g, "/")),
    caption: m[2],
    file: `dy-${String(acc.length + 1).padStart(2, "0")}.mp4`,
  });
  return acc;
}, []);

async function unlockPhone(phone: Locator) {
  await phone.getByRole("button", { name: "轻触解锁" }).click();
  for (const d of PIN)
    await phone.getByRole("button", { name: "密码键" + d }).click();
  await expect(
    phone.getByRole("button", { name: "搜索", exact: true }),
  ).toBeVisible({ timeout: 10000 });
}
async function openApp(phone: Locator, homeKey: string, root: string) {
  await phone.getByRole("button", { name: "返回桌面", exact: true }).click();
  await expect(async () => {
    const icon = phone.locator(`[data-home-key="${homeKey}"]`);
    await icon.scrollIntoViewIfNeeded();
    await icon.click();
  }).toPass({ timeout: 20000 });
  await expect(phone.locator(root)).toBeVisible({ timeout: 15000 });
}
async function openDouyin(phone: Locator) {
  await openApp(phone, "douyin", ".douyin-ui");
}
async function loadDouyin(page: Page, opts: { failVideo?: string } = {}) {
  await page.route("**/work.json", (route) =>
    route.fulfill({ json: structuredClone(work) }),
  );
  // 外链在新标签打开，page.route 管不到 popup；用 context 级拦截，
  // 只验证「点击头像/昵称会用原始链接打开外部标签」，不依赖外网与短链 302。
  await page.context().route("https://v.douyin.com/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<html><body>douyin profile</body></html>",
    }),
  );
  if (opts.failVideo)
    await page.route(`**/dy-media/${opts.failVideo}`, (route) =>
      route.fulfill({ status: 404, body: "not found" }),
    );
  await page.goto("/?fresh=1");
  const phone = page.locator(".phone-shell");
  await unlockPhone(phone);
  await openDouyin(phone);
  return phone;
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
      r.onerror = () => rej(r.error);
    });
    db.close();
    return all[0]?.state ?? {};
  });
}
const douyinUi = async (page: Page) =>
  (await readState(page)).ui?.douyin ?? {};

type VideoState = {
  paused: boolean;
  muted: boolean;
  loop: boolean;
  currentTime: number;
  duration: number;
  src: string | null;
  videoWidth: number;
  videoHeight: number;
  readyState: number;
};
async function videoState(page: Page, position: number): Promise<VideoState | null> {
  return page.evaluate((pos) => {
    const v = document.querySelectorAll<HTMLVideoElement>(
      ".douyin-video",
    )[pos - 1];
    if (!v) return null;
    return {
      paused: v.paused,
      muted: v.muted,
      loop: v.loop,
      currentTime: v.currentTime,
      duration: v.duration,
      src: v.getAttribute("src"),
      videoWidth: v.videoWidth,
      videoHeight: v.videoHeight,
      readyState: v.readyState,
    };
  }, position);
}
const indexOf = (phone: Locator) =>
  phone.locator("[data-douyin-root]").getAttribute("data-douyin-index");

/** 真实指针拖动：手指上滑 delta<0 → 下一条；下滑 delta>0 → 上一条。 */
async function swipe(page: Page, phone: Locator, delta: number) {
  const box = await phone.locator(".douyin-ui").boundingBox();
  const x = box!.x + box!.width / 2;
  const y = box!.y + box!.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + delta, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(420);
}
async function keyTo(page: Page, phone: Locator, target: number) {
  const now = Number(await indexOf(phone));
  for (let i = now; i < target; i++) {
    await page.keyboard.press("ArrowDown");
    await expect(phone.locator("[data-douyin-root]")).toHaveAttribute(
      "data-douyin-index",
      String(i + 1),
    );
  }
  for (let i = now; i > target; i--) {
    await page.keyboard.press("ArrowUp");
    await expect(phone.locator("[data-douyin-root]")).toHaveAttribute(
      "data-douyin-index",
      String(i - 1),
    );
  }
}

test("验收0｜8 条视频逐字导入，发布者只配置一份，素材为真实本地文件", () => {
  expect(SOURCES).toHaveLength(8);
  expect(AUTHOR).toBe("回温蛋治");
  expect(AVATAR_LABEL).toBe("回温蛋治 头像.png");
  expect(PROFILE).toBe("https://v.douyin.com/6LIf7vWFaKA/");
  expect(DOUYIN_AUTHOR).toBe(AUTHOR);
  expect(DOUYIN_PROFILE_URL).toBe(PROFILE);
  expect(DOUYIN_AVATAR).toBe("./dy-media/dy-avatar.png");
  expect(raw.installedApps).toContain("douyin");
  expect(raw.content.douyin).toHaveLength(8);
  expect(work.data.douyin).toHaveLength(8);
  SOURCES.forEach((s, i) => {
    const item = raw.content.douyin[i];
    expect(item.id).toBe(`dy_${String(i + 1).padStart(2, "0")}`);
    expect(item.body, `第 ${i + 1} 条配文逐字一致`).toBe(s.caption);
    expect(item.kind).toBe("video");
    expect(item.sender, "所有视频属于同一个发布者").toBe(AUTHOR);
    expect(item.meta.video).toBe(`./dy-media/${s.file}`);
    expect(item.meta.sourceName).toBe(s.sourceName);
    expect(item.comments ?? []).toEqual([]);
    expect(existsSync(`public/dy-media/${s.file}`)).toBe(true);
    expect(statSync(`public/dy-media/${s.file}`).size).toBeGreaterThan(0);
  });
  expect(existsSync("public/dy-media/dy-avatar.png")).toBe(true);
  expect(statSync("public/dy-media/dy-avatar.png").size).toBeGreaterThan(0);
  // 抖音视频本身不新增静态历史；WA_DOUYIN_001 追加 1 个 variable 节点与
  // 4 条学姐私聊 hidden 事件消息，8 条视频数据 / 顺序 / 内容均不变。
  expect(raw.events).toHaveLength(14);
  expect(work.nodes).toHaveLength(14);
  expect(work.data.whatsapp).toHaveLength(768);
});

test("验收1/2/6/7/9/10/11｜首条自动播放、竖屏、统一发布者、逐字配文、顺序、循环、无评论", async ({
  page,
}) => {
  const phone = await loadDouyin(page);
  const root = phone.locator("[data-douyin-root]");
  await expect(root).toHaveAttribute("data-douyin-count", "8");
  await expect(root).toHaveAttribute("data-douyin-index", "0");
  await expect(root).toHaveAttribute("data-aspect", "9:16");

  // 2｜9:16 沉浸式竖屏舞台：前景 contain 完整不拉伸，同一真实视频模糊铺底占满屏幕。
  // 用户素材 8 条里 7 条本身是 4:3 横屏字幕画面，按「不拉伸变形、不裁掉字幕」
  // 完整显示，不强制把素材本身改成竖屏。
  const stage = await phone.locator(".douyin-slide").first().boundingBox();
  expect(stage!.height).toBeGreaterThan(stage!.width);
  await expect(phone.locator(".douyin-video").first()).toHaveCSS(
    "object-fit",
    "contain",
  );
  const videoBox = await phone.locator(".douyin-video").first().boundingBox();
  expect(videoBox!.height).toBeGreaterThan(videoBox!.width);
  await expect(
    phone.locator('.douyin-backdrop[data-douyin-backdrop="dy_01"]'),
  ).toHaveCount(1);
  await expect(phone.locator(".douyin-backdrop").first()).toHaveCSS(
    "object-fit",
    "cover",
  );
  await expect
    .poll(async () => (await videoState(page, 1))?.videoWidth, {
      timeout: 15000,
    })
    .toBeGreaterThan(0);
  const firstVideo = (await videoState(page, 1))!;
  expect(firstVideo.videoHeight).toBeGreaterThan(0);

  // 1｜打开即自动播放第一条
  await expect
    .poll(async () => (await videoState(page, 1))?.paused, { timeout: 15000 })
    .toBe(false);
  // 同一时间只有一条在播放
  const playing = await page.evaluate(
    () =>
      [...document.querySelectorAll<HTMLVideoElement>(".douyin-video")]
        .filter((v) => !v.paused).length,
  );
  expect(playing).toBe(1);
  // 6｜循环播放属性
  expect(firstVideo.loop).toBe(true);
  const loops = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLVideoElement>(".douyin-video")].map(
      (v) => v.loop,
    ),
  );
  expect(loops).toEqual(new Array(8).fill(true));

  // 9/11｜配文逐字 + 严格按提供顺序
  const ids = await phone
    .locator("[data-douyin-id]")
    .evaluateAll((es) => es.map((e) => e.getAttribute("data-douyin-id")));
  expect(ids).toEqual(SOURCES.map((_, i) => `dy_${String(i + 1).padStart(2, "0")}`));
  const captions = await phone
    .locator("[data-douyin-caption]")
    .evaluateAll((es) => es.map((e) => e.getAttribute("data-douyin-caption")));
  const captionTexts = await phone.locator(".douyin-caption").allTextContents();
  expect(captions).toEqual(ids);
  expect(captionTexts).toEqual(SOURCES.map((s) => s.caption));
  const srcs = await phone
    .locator(".douyin-video")
    .evaluateAll((es) => es.map((e) => e.getAttribute("src")));
  expect(srcs).toEqual(SOURCES.map((s) => `./dy-media/${s.file}`));

  // 7｜统一昵称 / 头像；8｜每条的头像与昵称都指向同一个原始链接
  const authors = await phone.locator(".douyin-author").allTextContents();
  expect(authors).toEqual(new Array(8).fill(AUTHOR));
  const links = await phone
    .locator("a[data-douyin-profile]")
    .evaluateAll((es) =>
      es.map((e) => ({
        href: e.getAttribute("href"),
        target: e.getAttribute("target"),
        rel: e.getAttribute("rel"),
      })),
    );
  expect(links).toHaveLength(16);
  for (const l of links) {
    expect(l.href).toBe(PROFILE);
    expect(l.target).toBe("_blank");
    expect(l.rel).toContain("noopener");
  }
  const avatars = await phone
    .locator(".douyin-avatar img")
    .evaluateAll((es) => es.map((e) => e.getAttribute("src")));
  expect(avatars).toEqual(new Array(8).fill("./dy-media/dy-avatar.png"));
  await expect
    .poll(
      async () =>
        phone
          .locator(".douyin-avatar img")
          .first()
          .evaluate((e) => (e as HTMLImageElement).naturalWidth),
      { timeout: 10000 },
    )
    .toBeGreaterThan(0);

  // 10｜不显示评论/评论数量，也不显示点赞数量
  const uiText = await root.textContent();
  expect(uiText).not.toContain("评论");
  expect(await phone.locator(".douyin-comment").count()).toBe(0);
  const likeTexts = await phone.locator(".douyin-like").allTextContents();
  expect(likeTexts.every((t) => t.trim() === "")).toBe(true);

  // 8｜点击当前视频的头像与昵称都打开同一个真实主页链接（外部新标签）
  for (const selector of [
    '[data-douyin-position="1"] .douyin-avatar[data-douyin-profile]',
    '[data-douyin-position="1"] .douyin-author[data-douyin-profile]',
  ]) {
    const popupPromise = page.waitForEvent("popup");
    await phone.locator(selector).click();
    const popup = await popupPromise;
    await popup.waitForURL(PROFILE, { timeout: 10000 });
    expect(popup.url()).toBe(PROFILE);
    await popup.close();
  }
  // 非首条视频同样使用该链接（切到第 4 条后点昵称）
  await keyTo(page, phone, 3);
  const popup2Promise = page.waitForEvent("popup");
  await phone
    .locator('[data-douyin-position="4"] .douyin-author[data-douyin-profile]')
    .click();
  const popup2 = await popup2Promise;
  await popup2.waitForURL(PROFILE, { timeout: 10000 });
  expect(popup2.url()).toBe(PROFILE);
  await popup2.close();

  // 6｜真实循环：把首条视频拖到接近结尾，观察回绕且仍在播放
  await keyTo(page, phone, 0);
  await page.evaluate(() => {
    const v = document.querySelector<HTMLVideoElement>(".douyin-video")!;
    if (Number.isFinite(v.duration) && v.duration > 1)
      v.currentTime = v.duration - 0.06;
  });
  await expect
    .poll(async () => (await videoState(page, 1))?.currentTime, {
      timeout: 12000,
    })
    .toBeLessThan(1);
  expect((await videoState(page, 1))!.paused).toBe(false);
});

test("验收3/4/5｜上下滑动切换、衔接自然、切换后上一条暂停、边界不越界", async ({
  page,
}) => {
  const phone = await loadDouyin(page);
  const root = phone.locator("[data-douyin-root]");
  const transition = await phone
    .locator(".douyin-track")
    .evaluate((e) => getComputedStyle(e).transitionDuration);
  expect(parseFloat(transition)).toBeGreaterThan(0);

  // 3｜上滑 → 下一条
  await swipe(page, phone, -110);
  await expect(root).toHaveAttribute("data-douyin-index", "1");
  await expect
    .poll(async () => (await videoState(page, 2))?.paused, { timeout: 15000 })
    .toBe(false);
  // 5｜上一条暂停且静音
  const previous = (await videoState(page, 1))!;
  expect(previous.paused).toBe(true);
  expect(previous.muted).toBe(true);
  const nowPlaying = await page.evaluate(
    () =>
      [...document.querySelectorAll<HTMLVideoElement>(".douyin-video")]
        .filter((v) => !v.paused).length,
  );
  expect(nowPlaying).toBe(1);

  // 4｜下滑 → 上一条
  await swipe(page, phone, 110);
  await expect(root).toHaveAttribute("data-douyin-index", "0");
  expect((await videoState(page, 2))!.paused).toBe(true);

  // 滚轮输入走同一条切换链
  await phone.locator(".douyin-ui").hover();
  await page.mouse.wheel(0, 130);
  await expect(root).toHaveAttribute("data-douyin-index", "1");
  await page.waitForTimeout(400);
  await page.mouse.wheel(0, -130);
  await expect(root).toHaveAttribute("data-douyin-index", "0");

  // 3/4｜边界：第一条继续下滑、最后一条继续上滑都不生成不存在的视频
  await swipe(page, phone, 110);
  await swipe(page, phone, 110);
  await expect(root).toHaveAttribute("data-douyin-index", "0");
  await keyTo(page, phone, 7);
  await swipe(page, phone, -110);
  await expect(root).toHaveAttribute("data-douyin-index", "7");
  await expect(phone.locator("[data-douyin-id]")).toHaveCount(8);
});

test("验收1/5/7｜离开 App 暂停、观看位置与播放进度持久化、返回后恢复", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).__pauseCalls = [];
    const orig = HTMLMediaElement.prototype.pause;
    HTMLMediaElement.prototype.pause = function (this: HTMLMediaElement) {
      (window as any).__pauseCalls.push(
        this.getAttribute("src") ?? this.currentSrc,
      );
      return orig.call(this);
    };
  });
  const phone = await loadDouyin(page);
  await keyTo(page, phone, 2);
  // 等一次 timeupdate 写存档
  await expect
    .poll(async () => Number((await douyinUi(page)).time ?? 0), {
      timeout: 15000,
    })
    .toBeGreaterThan(0);
  const saved = await douyinUi(page);
  expect(Number(saved.index)).toBe(2);
  const savedTime = Number(saved.time);

  // 5｜离开 App：所有视频暂停且页面卸载（无后台播放）
  await phone.locator("[data-douyin-back]").click();
  await expect(phone.locator(".douyin-ui")).toHaveCount(0);
  const calls: string[] = await page.evaluate(
    () => (window as any).__pauseCalls ?? [],
  );
  expect(calls.some((s) => s.includes("dy-03.mp4"))).toBe(true);
  expect(
    await page.evaluate(
      () => document.querySelectorAll(".douyin-video").length,
    ),
  ).toBe(0);

  // 重新进入：恢复第 3 条与该条播放进度
  await openDouyin(phone);
  await expect(phone.locator("[data-douyin-root]")).toHaveAttribute(
    "data-douyin-index",
    "2",
  );
  await expect
    .poll(async () => (await videoState(page, 3))?.currentTime, {
      timeout: 15000,
    })
    .toBeGreaterThan(0);
  const restored = (await videoState(page, 3))!;
  expect(restored.currentTime).toBeLessThan(savedTime + 4);
  expect(restored.paused).toBe(false);

  // 刷新后回到锁屏，重新解锁后仍从同一条继续，不回到第一条
  await page.reload();
  await unlockPhone(phone);
  await openDouyin(phone);
  await expect(phone.locator("[data-douyin-root]")).toHaveAttribute(
    "data-douyin-index",
    "2",
  );
});

test("验收12｜单个视频资源 404 只显示失败提示，不导致 App 崩溃", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const phone = await loadDouyin(page, { failVideo: "dy-02.mp4" });
  await expect(phone.locator('[data-douyin-error="dy_02"]')).toBeVisible({
    timeout: 15000,
  });
  await expect(phone.locator("[data-douyin-root]")).toBeVisible();
  await expect(phone.locator("[data-douyin-id]")).toHaveCount(8);
  // 其它视频仍可切换与显示，配文未丢失
  await keyTo(page, phone, 2);
  await expect(
    phone.locator('[data-douyin-caption="dy_03"]'),
  ).toHaveText(SOURCES[2].caption);
  await expect(phone.locator('[data-douyin-error="dy_03"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});
