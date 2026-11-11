/**
 * Music App｜本地音乐播放器及 WA_MUSIC_001 · 第八章验收（17 项）
 *
 * 4 首歌曲与 5 条固定对话全部从规格逐字副本
 * data/music-app/音乐模块搭建指令.txt 独立解析，不从实现文件自证。
 * 播放、切 App、刷新、固定对话均走真实 UI / 真实 <audio> / 真实 IndexedDB 存档。
 */
import { test, expect, type Locator, type Page } from "@playwright/test";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { compileStory } from "../src/story-engine/compiler";
import { sendPresetReply } from "./fixtures/wa-playback";

const SPEC = readFileSync("data/music-app/音乐模块搭建指令.txt", "utf8");
const LINES = SPEC.split(/\r?\n/);

function section(start: string, end: string) {
  const a = SPEC.indexOf(start);
  const b = SPEC.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw new Error(`规格章节缺失：${start} / ${end}`);
  return SPEC.slice(a, b);
}

/** 三、歌曲填写格式：逐行解析音频文件 / 歌曲名 / 歌手名，顺序即用户给定顺序。 */
const SONG_FILE = /^音频文件：@"(.+?)"\s+歌曲名：(.*)$/;
const SONG_ARTIST = /^歌手名：(.*)$/;
type Song = { sourceName: string; title: string; artist: string; file: string };
const SONGS: Song[] = LINES.reduce<Song[]>((acc, line, i) => {
  const m = SONG_FILE.exec(line.trim());
  if (!m) return acc;
  const artist = SONG_ARTIST.exec((LINES[i + 1] ?? "").trim());
  if (!artist) throw new Error(`歌曲 ${acc.length + 1} 缺少歌手名`);
  acc.push({
    sourceName: path.basename(m[1].replace(/\\/g, "/")),
    title: m[2].trim(),
    artist: artist[1].trim(),
    file: `music-${String(acc.length + 1).padStart(2, "0")}.mp3`,
  });
  return acc;
}, []);

/** 5.2 首条消息（书名号内逐字）。 */
const FIRST_BODY = /「(.+?)」/.exec(section("### 5.2", "### 5.3"))?.[1] ?? "";
/** 5.3 固定对话：`**第N条：发言人**` 的下一行是台词正文。 */
type Line = { speaker: string; body: string };
const DIALOGUE: Line[] = [];
{
  let pending = "";
  for (const line of section("### 5.3", "### 5.4").split(/\r?\n/)) {
    const head = /^\*\*第.+?条：(.+?)\*\*\s*$/.exec(line.trim());
    if (head) {
      pending = head[1];
      continue;
    }
    const body = line.trim();
    if (pending && body && !body.startsWith("#")) {
      DIALOGUE.push({ speaker: pending, body });
      pending = "";
    }
  }
}
if (SONGS.length !== 4) throw new Error(`规格应有 4 首歌曲，实际 ${SONGS.length}`);
if (DIALOGUE.length !== 5) throw new Error(`规格应有 5 条固定对话，实际 ${DIALOGUE.length}`);
if (DIALOGUE[0].body !== FIRST_BODY)
  throw new Error("5.2 首条消息与 5.3 第一条不一致");

const MUSIC_IDS = Array.from(
  { length: 5 },
  (_, i) => `msg_music_001_${String(i + 1).padStart(2, "0")}`,
);
const LINGLING = "邝学姐 💙";
const EVENT = "WA_MUSIC_001";
const OWNER_ID = MUSIC_IDS[1];

let cachedWork: any = null;
let cachedRaw: any = null;
function story() {
  if (!cachedRaw)
    cachedRaw = JSON.parse(readFileSync("stories/template/story.json", "utf8"));
  if (!cachedWork) cachedWork = compileStory(cachedRaw).work;
  return { raw: cachedRaw, work: cachedWork };
}
const PIN = String(story().raw.phone?.passcode ?? "");

const localStamp = (d = new Date()) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

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
    route.fulfill({ json: structuredClone(story().work) }),
  );
  await page.goto("/?fresh=1");
  const phone = page.locator(".phone-shell");
  await unlockPhone(phone);
  return phone;
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
const openMusic = (phone: Locator) =>
  openApp(phone, "spotify", ".music-ui");
const openWhatsApp = (phone: Locator) =>
  openApp(phone, "whatsapp", ".whatsapp-ui");
const openDouyin = (phone: Locator) =>
  openApp(phone, "douyin", ".douyin-ui");
const openYouTube = (phone: Locator) =>
  openApp(phone, "youtube", ".youtube-ui");
const goHome = (phone: Locator) =>
  phone.getByRole("button", { name: "返回桌面", exact: true }).click();

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
      r.onerror = () => rej(r.error);
    });
    db.close();
    return all[0]?.state ?? {};
  });
}
const readPlayback = async (page: Page) =>
  (await readState(page)).playback ?? {};

/** 全局 <audio> 挂在 document.body，皮肤卸载也不会停。 */
type AudioInfo = { src: string; paused: boolean; time: number; duration: number };
const audioInfo = (page: Page): Promise<AudioInfo> =>
  page.locator("#global-music-audio").evaluate((a: HTMLAudioElement) => ({
    src: a.getAttribute("src") ?? "",
    paused: a.paused,
    time: a.currentTime,
    duration: Number.isFinite(a.duration) ? a.duration : 0,
  }));

async function waitPlaying(page: Page) {
  await expect
    .poll(async () => {
      const a = await audioInfo(page);
      return !a.paused && a.time > 0;
    }, { timeout: 25000, intervals: [200, 300, 500] })
    .toBe(true);
}
const triggered = (page: Page) =>
  expect
    .poll(async () => (await readState(page))?.variables?.WA_MUSIC_001_TRIGGERED, {
      timeout: 15000,
    })
    .toBe(true);

// ───────────────────────────────── 验收1 / 静态：4 首歌曲、5 条对话、事件节点

test("验收S｜4 首本地歌曲与 5 条固定对话逐字导入，事件沿用既有消息机制", async () => {
  const { raw, work } = story();
  expect(SONGS.map((s) => s.title)).toEqual([
    "最后我还是受伤了",
    "Moonlight",
    "Until I Found You",
    "Fly Me to the moon",
  ]);
  expect(SONGS.every((s) => s.artist === "Lingling")).toBe(true);
  expect(DIALOGUE.map((d) => d.speaker)).toEqual([
    "学姐", "机主", "学姐", "学姐", "学姐",
  ]);
  // 改动只落在现有的音乐 App（spotify），不新建第二个音乐 App。
  expect(raw.installedApps).toContain("spotify");
  expect(raw.installedApps).not.toContain("music");
  expect(raw.installedApps.filter((x: string) => x === "spotify")).toHaveLength(1);
  const tracks = raw.content.spotify;
  expect(tracks).toHaveLength(4);
  tracks.forEach((t: any, i: number) => {
    const s = SONGS[i];
    expect(t.title).toBe(s.title);
    expect(t.sender).toBe(s.artist);
    expect(t.kind).toBe("audio");
    expect(t.body).toBe("");
    expect(t.meta.audio).toBe(`./music-media/${s.file}`);
    expect(t.meta.sourceName).toBe(s.sourceName);
    // 不允许电脑绝对路径进运行时数据；不允许内联 base64 音频。
    expect(t.media ?? "").toBe("");
    expect(JSON.stringify(t)).not.toContain("D:\\");
    const file = `public/music-media/${s.file}`;
    expect(existsSync(file), file).toBe(true);
    expect(statSync(file).size).toBeGreaterThan(100000);
    // 真实 MP3 数据：ID3 标签或 MPEG frame sync（0xFF Ex）。
    const head = readFileSync(file).subarray(0, 3);
    const isMp3 =
      head.toString("latin1") === "ID3" ||
      (head[0] === 0xff && (head[1] & 0xe0) === 0xe0);
    expect(isMp3, `${file} 必须是真实 MP3 音频`).toBe(true);
  });
  expect(work.data.spotify).toHaveLength(4);
  expect(work.data.spotify.map((i: any) => i.title)).toEqual(
    SONGS.map((s) => s.title),
  );

  // 5 条 hidden 消息只追加在学姐私聊末尾，沿用唯一 lingling 联系人。
  // 末尾另含 WA_DOUYIN_001 的 4 条 hidden 事件消息，总数 376。
  const chat = raw.chats.find((c: any) => c.id === "wa-lingling");
  expect(chat.title).toBe(LINGLING);
  expect(chat.messages).toHaveLength(376);
  const pack = chat.messages.filter((m: any) =>
    String(m.id).startsWith("msg_music_001_"),
  );
  expect(pack.map((m: any) => m.id)).toEqual(MUSIC_IDS);
  expect(pack.map((m: any) => m.body)).toEqual(DIALOGUE.map((d) => d.body));
  expect(pack.map((m: any) => m.time)).toEqual(Array(5).fill("@now"));
  expect(pack.every((m: any) => m.hidden === true)).toBe(true);
  expect(pack.map((m: any) => m.outgoing)).toEqual([
    false, true, false, false, false,
  ]);
  expect(pack[1].senderId).toBe("owner");
  expect(new Set(work.data.whatsapp.filter((i: any) => MUSIC_IDS.includes(i.id))
    .map((i: any) => i.meta.conversationId)).size).toBe(1);

  // 事件节点：首次成功播放后只触发一次，不自动跳转、不打断音乐。
  const node = raw.events.find((e: any) => e.id === EVENT);
  expect(node.event).toBe("variable");
  expect(node.target).toBe("ui:music:firstPlayed");
  expect(node.once).toBe(true);
  expect(node.conditions).toEqual([
    { key: "ui:music:firstPlayed", op: "eq", value: true },
    { key: "WA_MUSIC_001_TRIGGERED", op: "neq", value: true },
  ]);
  expect(node.actions.filter((a: any) => a.type === "unlock")
    .map((a: any) => a.key)).toEqual(MUSIC_IDS);
  expect(node.actions.filter((a: any) => a.type === "variable")).toEqual([
    { type: "variable", key: "WA_MUSIC_001_TRIGGERED", value: true },
  ]);
  expect(node.actions.find((a: any) => a.type === "notification").value).toBe(
    `@whatsapp|now|${LINGLING}|${FIRST_BODY}|>whatsapp:${LINGLING}`,
  );
  expect(raw.events).toHaveLength(14);
  expect(work.nodes).toHaveLength(14);
  expect(work.data.whatsapp).toHaveLength(768);
  expect(raw.variables.WA_MUSIC_001_TRIGGERED).toBe(false);
});

// ─────────────── 验收1/2/3/4/5/12/14｜列表、播放控制、首次手动播放触发

test("验收1/2/3/4/5/12/14｜4 首歌曲只显示歌名与歌手、控制正常、首次播放投递消息", async ({
  page,
}) => {
  test.setTimeout(180000);
  const phone = await loadPhone(page);
  await openMusic(phone);

  const rows = phone.locator(".music-row");
  await expect(rows).toHaveCount(4);
  for (let i = 0; i < SONGS.length; i++) {
    await expect(rows.nth(i).locator("strong")).toHaveText(SONGS[i].title);
    await expect(rows.nth(i).locator("small")).toHaveText(SONGS[i].artist);
  }
  // 列表不含封面、歌词、专辑、评论、点赞数等无关信息。
  const listText = await phone.locator("[data-music-list]").innerText();
  for (const s of SONGS) expect(listText).toContain(s.title);
  expect(await phone.locator("[data-music-list] img").count()).toBe(0);
  expect(await phone.locator("[data-music-list] [data-lyrics]").count()).toBe(0);
  expect(await phone.locator("[data-music-list] .like-count").count()).toBe(0);
  await expect(phone.locator("[data-music-mini]")).toBeVisible();
  await expect(phone.locator("[data-music-mini] [data-music-current-title]"))
    .toHaveText(SONGS[0].title);

  // 验收14：只打开 App、没有播放，绝不触发事件。
  const before = await readState(page);
  expect(before.variables?.WA_MUSIC_001_TRIGGERED).toBe(false);
  expect(before.playback?.[EVENT]).toBeUndefined();
  expect((before.notifications ?? []).filter((n: string) => n.includes(FIRST_BODY)))
    .toHaveLength(0);
  expect((await audioInfo(page)).paused).toBe(true);

  // 验收1/3/12：点击第一首，真实音频开始播放，学姐消息到达。
  await rows.nth(0).click();
  await waitPlaying(page);
  let a = await audioInfo(page);
  expect(a.src).toContain("music-01.mp3");
  expect(a.duration).toBeGreaterThan(0);
  await triggered(page);
  const after = await readState(page);
  const notices = (after.notifications ?? []).filter((n: string) =>
    n.includes(FIRST_BODY),
  );
  expect(notices).toHaveLength(1);
  expect(notices[0]).toContain(`@whatsapp|`);
  expect(notices[0]).toContain(`|>whatsapp:${LINGLING}`);
  // |now| 已被 alignNow 替换为真实本地 HH:MM。
  expect(notices[0].split("|")[1]).toMatch(/^\d{2}:\d{2}$/);
  expect(after.playback[EVENT].messageIds).toEqual(MUSIC_IDS);
  expect(after.playback[EVENT].playbackStatus).toBe("pending");
  expect(after.unlocked.filter((id: string) => MUSIC_IDS.includes(id)))
    .toHaveLength(5);
  // 不自动切换到 WhatsApp，音乐也没有被打断。
  await expect(phone.locator(".whatsapp-ui")).toHaveCount(0);
  expect((await audioInfo(page)).paused).toBe(false);

  // 验收4/5：暂停 / 恢复、下一首、上一首、随机播放。
  await phone.locator('[data-music-control="play"]').click();
  await expect.poll(async () => (await audioInfo(page)).paused).toBe(true);
  const pausedAt = (await audioInfo(page)).time;
  await phone.locator('[data-music-mini-play]').click();
  await expect.poll(async () => (await audioInfo(page)).paused).toBe(false);
  expect((await audioInfo(page)).time).toBeGreaterThanOrEqual(pausedAt);

  await phone.locator('[data-music-control="next"]').click();
  await waitPlaying(page);
  expect((await audioInfo(page)).src).toContain("music-02.mp3");
  await expect(phone.locator("[data-music-current-title]")).toHaveText(SONGS[1].title);
  await expect(rows.nth(1)).toHaveClass(/is-current/);

  await phone.locator('[data-music-control="prev"]').click();
  await waitPlaying(page);
  expect((await audioInfo(page)).src).toContain("music-01.mp3");

  await phone.locator('[data-music-control="shuffle"]').click();
  await waitPlaying(page);
  a = await audioInfo(page);
  expect(SONGS.some((s) => a.src.includes(s.file))).toBe(true);
  await expect(phone.locator('[data-music-control="shuffle"]')).toHaveClass(/is-on/);
});

// ─────── 验收6/7/8/9/10/11｜后台播放、抖音/YouTube 自动暂停、手动恢复

test("验收6/7/8/9/10/11｜返回桌面与普通 App 继续播放，抖音/YouTube 自动暂停且不自动恢复", async ({
  page,
}) => {
  test.setTimeout(240000);
  const phone = await loadPhone(page);
  await openMusic(phone);
  await phone.locator(".music-row").nth(0).click();
  await waitPlaying(page);

  // 验收6：返回桌面，音频元素仍在且不暂停、进度继续走。
  await goHome(phone);
  let info = await audioInfo(page);
  expect(info.paused).toBe(false);
  const t0 = info.time;
  await page.waitForTimeout(1200);
  info = await audioInfo(page);
  expect(info.paused).toBe(false);
  expect(info.time).toBeGreaterThan(t0);

  // 验收7：打开 WhatsApp 后继续播放；Notes / Photos 等普通 App 也不暂停。
  await openWhatsApp(phone);
  expect((await audioInfo(page)).paused).toBe(false);
  await openApp(phone, "notes", ".native-notes");
  expect((await audioInfo(page)).paused).toBe(false);

  // 验收8：打开抖音立即暂停，并保存当前歌曲与进度。
  await openDouyin(phone);
  await expect.poll(async () => (await audioInfo(page)).paused).toBe(true);
  const saved = await audioInfo(page);
  expect(saved.src).toContain("music-01.mp3");
  expect(saved.time).toBeGreaterThan(0);
  const state = await readState(page);
  const musicUi = JSON.parse(state.ui?.music?.player ?? "{}");
  expect(musicUi.playing).toBe(false);
  expect(musicUi.time).toBeGreaterThan(0);

  // 验收10：离开抖音回桌面 / 其它普通 App 不擅自自动恢复。
  await goHome(phone);
  expect((await audioInfo(page)).paused).toBe(true);
  await openWhatsApp(phone);
  expect((await audioInfo(page)).paused).toBe(true);

  // 验收9：打开 YouTube 同样保持暂停（已经暂停时也不得自动续播）。
  await openYouTube(phone);
  expect((await audioInfo(page)).paused).toBe(true);
  await goHome(phone);
  expect((await audioInfo(page)).paused).toBe(true);

  // 验收11：回到音乐 App 仍是原来的歌与进度，主动点播放才继续。
  await openMusic(phone);
  const restored = await audioInfo(page);
  expect(restored.src).toContain("music-01.mp3");
  expect(restored.time).toBeGreaterThan(0);
  expect(restored.paused).toBe(true);
  await phone.locator('[data-music-mini-play]').click();
  await expect.poll(async () => (await audioInfo(page)).paused).toBe(false);
});

// ───────────── 验收13/15｜随机播放首次触发、后续播放不重复触发、刷新不丢

test("验收13/15｜首次随机播放同样触发，之后切歌/随机不再重复，刷新后状态保持", async ({
  page,
}) => {
  test.setTimeout(240000);
  const phone = await loadPhone(page);
  await openMusic(phone);
  // 验收13：先随机播放，事件也应该只投递一次。
  await phone.locator('[data-music-control="shuffle"]').click();
  await waitPlaying(page);
  await triggered(page);
  let s = await readState(page);
  expect((s.notifications ?? []).filter((n: string) => n.includes(FIRST_BODY)))
    .toHaveLength(1);
  expect(s.completed.filter((x: string) => x === EVENT)).toHaveLength(1);

  // 验收15：继续播放其它歌曲、再次随机、暂停恢复，都不重复触发。
  await phone.locator(".music-row").nth(2).click();
  await waitPlaying(page);
  await phone.locator('[data-music-control="shuffle"]').click();
  await waitPlaying(page);
  await phone.locator('[data-music-control="play"]').click();
  await expect.poll(async () => (await audioInfo(page)).paused).toBe(true);
  await phone.locator('[data-music-control="play"]').click();
  await expect.poll(async () => (await audioInfo(page)).paused).toBe(false);
  s = await readState(page);
  expect((s.notifications ?? []).filter((n: string) => n.includes(FIRST_BODY)))
    .toHaveLength(1);
  expect(s.completed.filter((x: string) => x === EVENT)).toHaveLength(1);
  expect(s.playback[EVENT].messageIds).toEqual(MUSIC_IDS);
  expect(s.playback[EVENT].deliveredMessageIds).toEqual([]);
  const fingerprint = JSON.stringify({
    triggered: s.variables?.WA_MUSIC_001_TRIGGERED,
    unlocked: (s.unlocked ?? []).filter((id: string) => MUSIC_IDS.includes(id)),
    notifications: s.notifications,
    messageTimes: s.messageTimes ?? {},
  });

  // 验收17：刷新后不重复投递，当前歌曲与进度从存档恢复但不自动续播。
  const srcBefore = (await audioInfo(page)).src;
  await page.reload();
  const p2 = page.locator(".phone-shell");
  await unlockPhone(p2);
  await openMusic(p2);
  const afterReload = await readState(page);
  expect(afterReload.variables?.WA_MUSIC_001_TRIGGERED).toBe(true);
  expect(afterReload.completed.filter((x: string) => x === EVENT)).toHaveLength(1);
  expect((afterReload.notifications ?? []).filter((n: string) => n.includes(FIRST_BODY)))
    .toHaveLength(1);
  const restored = await audioInfo(page);
  expect(restored.src).toBe(srcBefore);
  expect(restored.paused).toBe(true);
  expect(JSON.stringify({
    triggered: afterReload.variables?.WA_MUSIC_001_TRIGGERED,
    unlocked: (afterReload.unlocked ?? []).filter((id: string) => MUSIC_IDS.includes(id)),
    notifications: afterReload.notifications,
    messageTimes: afterReload.messageTimes ?? {},
  })).toBe(fingerprint);
});

// ───────────── 规格 5.2｜通知点击直达学姐私聊，且投递不打断当前音乐

test("验收补充｜学姐新消息通知可点击进入私聊，且不自动跳转、不打断音乐", async ({
  page,
}) => {
  test.setTimeout(120000);
  const phone = await loadPhone(page);
  await openMusic(phone);
  await phone.locator(".music-row").nth(0).click();
  await waitPlaying(page);
  await triggered(page);

  // 投递后仍停在音乐 App，音乐没停；通知横幅出现。
  await expect(phone.locator(".whatsapp-ui")).toHaveCount(0);
  expect((await audioInfo(page)).paused).toBe(false);
  const banner = phone.locator(".device-banner");
  await expect(banner).toBeVisible({ timeout: 8000 });
  await expect(banner).toContainText(FIRST_BODY);

  await banner.click();
  await expect(phone.locator(".whatsapp-ui")).toBeVisible({ timeout: 15000 });
  await expect(phone.locator(".wa-thread-profile")).toBeVisible();
  await expect(phone.locator(".wa-thread-profile")).toContainText("邝学姐");
  // 点击通知只是跳转，音乐仍在后台播放，也没有自动生成机主回复。
  expect((await audioInfo(page)).paused).toBe(false);
  const s = await readState(page);
  expect((s.playback?.[EVENT]?.deliveredMessageIds ?? []).length).toBeLessThan(5);
  expect(s.messageTimes?.[OWNER_ID]).toBeUndefined();
});

// ───────────── 规格 5.1｜加载 / 播放失败不算「成功播放」，绝不投递剧情

test("验收补充2｜音频加载失败时不会触发 WA_MUSIC_001", async ({ page }) => {
  test.setTimeout(120000);
  await page.route("**/music-media/*.mp3", (route) =>
    route.fulfill({ status: 404, contentType: "text/plain", body: "not found" }),
  );
  const phone = await loadPhone(page);
  await openMusic(phone);
  await phone.locator(".music-row").nth(0).click();
  await page.waitForTimeout(1800);
  const s = await readState(page);
  expect(s.variables?.WA_MUSIC_001_TRIGGERED).toBe(false);
  expect(s.completed ?? []).not.toContain(EVENT);
  expect(s.playback?.[EVENT]).toBeUndefined();
  expect(
    (s.notifications ?? []).filter((n: string) => n.includes(FIRST_BODY)),
  ).toHaveLength(0);
  expect((await audioInfo(page)).paused).toBe(true);
});

// ─────────── 验收16/17｜固定对话：逐条显示、机主必须点击发送、时间戳与恢复

test("验收16/17｜固定对话逐条显示、机主手动发送、时间戳真实且刷新后不丢", async ({
  page,
}) => {
  test.setTimeout(300000);
  const phone = await loadPhone(page);
  await openMusic(phone);
  await phone.locator(".music-row").nth(0).click();
  await waitPlaying(page);
  await triggered(page);

  await openWhatsApp(phone);
  const row = phone.locator(".wa-chat-row", { hasText: LINGLING }).first();
  await expect(row).toBeVisible({ timeout: 15000 });
  await row.click();
  await expect(phone.locator(".wa-thread-profile")).toBeVisible();

  // 5 条不得一次性写入历史；最后一句开场不能出现。
  const early = await readPlayback(page);
  expect((early[EVENT]?.deliveredMessageIds ?? []).length).toBeLessThan(5);
  const bubbles = phone.locator(".skin-messages .skin-bubble");
  expect(await bubbles.filter({ hasText: DIALOGUE[4].body }).count()).toBe(0);

  // 推进整个剧本：对方逐条自动显示，机主那条必须点输入框 + 等自动打字 + 点发送。
  let sent = false;
  let done = false;
  for (let step = 0; step < 160; step++) {
    const state = await readState(page);
    let delivered =
      state.playback?.[EVENT]?.deliveredMessageIds?.length ?? 0;
    if (delivered === 5) {
      done = true;
      break;
    }
    const awaiting = await phone
      .locator(".skin-compose[data-awaiting-reply='1']")
      .count();
    if (!awaiting) {
      await page.waitForTimeout(250);
      continue;
    }
    // 等存档游标追上 UI，避免高负载下把下一条错认成对方消息。
    for (let w = 0; w < 60; w++) {
      const synced = await readState(page);
      delivered =
        synced.playback?.[EVENT]?.deliveredMessageIds?.length ?? 0;
      if (delivered === 5 || DIALOGUE[delivered]?.speaker === "机主") break;
      await page.waitForTimeout(250);
    }
    if (delivered === 5) {
      done = true;
      break;
    }
    expect(DIALOGUE[delivered].speaker, `第 ${delivered + 1} 条应为机主回复`)
      .toBe("机主");
    expect(MUSIC_IDS[delivered]).toBe(OWNER_ID);
    // 验收16：自动打字阶段不得生成发送时间、不得自动发送。
    await phone.locator(".native-compose-field").click();
    await expect(
      phone.locator(".skin-compose[data-reply-phase='draft_ready']"),
    ).toBeVisible({ timeout: 25000 });
    expect((await phone.locator(".native-compose-field").textContent())?.trim())
      .toBe(DIALOGUE[1].body);
    expect((await readState(page)).messageTimes?.[OWNER_ID]).toBeUndefined();
    expect((await readState(page)).playback[EVENT].deliveredMessageIds)
      .toHaveLength(delivered);
    sent = true;
    await sendPresetReply(page, phone, () => readPlayback(page), DIALOGUE[1].body);
  }
  expect(sent, "机主那条必须由玩家点击发送").toBe(true);
  expect(done, "5 条剧本必须在限定步数内播完").toBe(true);

  const final = await readState(page);
  const pack = final.playback[EVENT];
  expect(pack.playbackStatus).toBe("completed");
  expect(pack.deliveredMessageIds).toEqual(MUSIC_IDS);
  const texts = await bubbles.allTextContents();
  expect(texts.at(-1)).toContain(DIALOGUE[4].body);
  expect(texts.at(-1)).not.toContain(FIRST_BODY);
  // 逐条台词都真实显示，学姐用繁体粤语、机主用简体。
  for (const d of DIALOGUE)
    expect(texts.some((t: string) => t.includes(d.body)), `缺少台词：${d.body}`)
      .toBe(true);

  // 第六章：对方消息用事件发生时的真实本地时间，机主用真实点击发送时间。
  const times = final.messageTimes ?? {};
  // 打开学姐会话会同时让主线 MIMI-001 消息包合法入队并生成它自己的时间戳，
  // 因此这里只校验本模块 5 条消息，不能独占整个 messageTimes。
  expect(
    Object.keys(times).filter((k) => k.startsWith("msg_music_001_")).sort(),
  ).toEqual([...MUSIC_IDS].sort());
  for (const id of MUSIC_IDS) {
    expect(times[id]).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(times[id].slice(0, 10)).toBe(localStamp().slice(0, 10));
  }
  // 预置历史聊天时间不被改写。
  const { raw, work } = story();
  for (const c of raw.chats)
    for (const m of c.messages.filter((x: any) => !x.hidden)) {
      const it = work.data.whatsapp.find((x: any) => x.id === m.id);
      if (it) expect(it.time).toBe(m.time);
    }

  // 验收17：刷新后消息、完成态与时间戳都不变，也不重复触发。
  await page.reload();
  const p2 = page.locator(".phone-shell");
  await unlockPhone(p2);
  const persisted = await readState(page);
  expect(persisted.playback[EVENT].playbackStatus).toBe("completed");
  expect(persisted.playback[EVENT].deliveredMessageIds).toEqual(MUSIC_IDS);
  expect(persisted.messageTimes).toEqual(times);
  expect(persisted.completed.filter((x: string) => x === EVENT)).toHaveLength(1);
  await openWhatsApp(p2);
  await p2.locator(".wa-chat-row", { hasText: LINGLING }).first().click();
  await expect(
    p2.locator(".skin-bubble", { hasText: DIALOGUE[4].body }),
  ).toHaveCount(1, { timeout: 15000 });
});
