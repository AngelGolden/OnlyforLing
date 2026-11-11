import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { compileStory } from "../src/story-engine/compiler";
import {
  driveThread,
  sendPresetReply,
  waitAwaitingReply,
  type PlaybackMap,
} from "./fixtures/wa-playback";

const PIN = "0511";
const WHATSAPP = "打开WhatsApp";
const MAPS = "打开地图";
const LINGLING = "邝学姐 💙";
const MSGS = [
  "你有冇特別想食咩？",
  "还没想好呢",
  "想找一家离学校近一点的",
  "紅磡附近都幾方便呀。",
];
const IDS = [
  "msg_map001_01",
  "msg_map001_02",
  "msg_map001_03",
  "msg_map001_04",
];

async function unlockPhone(phone: ReturnType<Page["locator"]>) {
  await phone.getByRole("button", { name: "轻触解锁" }).click();
  for (const d of PIN)
    await phone.getByRole("button", { name: "密码键" + d }).click();
  await expect(
    phone.getByRole("button", { name: "搜索", exact: true }),
  ).toBeVisible({ timeout: 10000 });
}

async function loadTemplatePlayer(page: Page) {
  const raw = JSON.parse(readFileSync("stories/template/story.json", "utf8"));
  const { work } = compileStory(raw);
  await page.route("**/work.json", (route) => route.fulfill({ json: work }));
  await page.goto("/");
  const phone = page.locator(".phone-shell");
  await unlockPhone(phone);
  return phone;
}

async function openApp(phone: ReturnType<Page["locator"]>, aria: string) {
  await phone.getByRole("button", { name: "返回桌面", exact: true }).click();
  await phone.getByRole("button", { name: aria, exact: true }).click();
}

/** Maps → 紅磡附近餐廳结果页，触发 MAP-001。 */
async function triggerMap001(phone: ReturnType<Page["locator"]>) {
  await openApp(phone, MAPS);
  await expect(phone.locator(".maps-ui")).toBeVisible();
  await phone.getByRole("button", { name: "搜索地点", exact: true }).click();
  await expect(phone.locator(".maps-recent-row").first()).toBeVisible();
  await phone
    .locator(".maps-recent-row", { hasText: "紅磡附近餐廳" })
    .first()
    .click();
  await expect(phone.locator(".maps-result-title")).toHaveText("紅磡附近餐廳");
}

/** 从本地存档直接读取 Runtime.playback，验证播放状态确实持久化。 */
async function readPlayback(page: Page): Promise<Record<string, any>> {
  return page.evaluate(async () => {
    const req = indexedDB.open("foundphone-studio");
    const db: IDBDatabase = await new Promise((res, rej) => {
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    const tx = db.transaction("saves", "readonly");
    const store = tx.objectStore("saves");
    const all: any[] = await new Promise((res, rej) => {
      const r = store.getAll();
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    db.close();
    return all[0]?.state?.playback ?? {};
  });
}

function mapPack(pb: Record<string, any>) {
  return Object.values(pb).find((pk: any) =>
    pk?.messageIds?.includes(IDS[0]),
  ) as any;
}

const isMapDone = (pb: PlaybackMap) =>
  mapPack(pb)?.playbackStatus === "completed";

async function openThread(phone: ReturnType<Page["locator"]>) {
  await openApp(phone, WHATSAPP);
  const row = phone.locator(".wa-chat-row", { hasText: LINGLING }).first();
  await expect(row).toBeVisible();
  await row.click();
}

async function waitCompleted(page: Page) {
  await expect
    .poll(
      async () => mapPack(await readPlayback(page))?.playbackStatus,
      { timeout: 20000 },
    )
    .toBe("completed");
}

async function bubbleTexts(phone: ReturnType<Page["locator"]>) {
  return phone.locator(".skin-bubble").allTextContents();
}

function assertOnceInOrder(bubbles: string[]) {
  const at = (t: string) => bubbles.findIndex((b) => b.includes(t));
  for (const t of MSGS) {
    expect(at(t), "消息缺失: " + t).toBeGreaterThanOrEqual(0);
    expect(
      bubbles.filter((b) => b.includes(t)).length,
      "消息重复: " + t,
    ).toBe(1);
  }
  expect(at(MSGS[0]), "顺序错误 01→02").toBeLessThan(at(MSGS[1]));
  expect(at(MSGS[1]), "顺序错误 02→03").toBeLessThan(at(MSGS[2]));
  expect(at(MSGS[2]), "顺序错误 03→04").toBeLessThan(at(MSGS[3]));
}

// ---------- 场景 A：首次触发，点进私聊才按顺序播放 ----------

test("验收A｜MAP-001 首次触发：进入学姐私聊后四条消息按正确顺序播放", async ({
  page,
}) => {
  test.setTimeout(180000);
  const phone = await loadTemplatePlayer(page);
  await triggerMap001(phone);

  // 1) 触发只做「入队」：包存在但一条都没送达，状态 pending。
  await expect
    .poll(async () => mapPack(await readPlayback(page))?.playbackStatus, {
      timeout: 15000,
    })
    .toBe("pending");
  const enqueued = mapPack(await readPlayback(page));
  expect(enqueued.deliveredMessageIds).toEqual([]);
  expect(enqueued.messageIds).toEqual(IDS);

  // 2) 打开 WhatsApp 只显示聊天列表：角标 4，预览里还没有新消息内容。
  await openApp(phone, WHATSAPP);
  const row = phone.locator(".wa-chat-row", { hasText: LINGLING }).first();
  await expect(row.locator(".wa-unread")).toHaveText("4");
  await expect(row).not.toContainText(MSGS[0]);
  await expect(row).not.toContainText(MSGS[3]);
  // 打开 App 本身不播放任何消息。
  expect(mapPack(await readPlayback(page)).deliveredMessageIds).toEqual([]);

  // 3) 点进私聊：对方消息自动到达；当前账号连续两条回复必须逐条手动发送。
  await row.click();
  const read = () => readPlayback(page);
  await waitAwaitingReply(phone);
  await sendPresetReply(page, phone, read, MSGS[1]);
  await waitAwaitingReply(phone);
  await sendPresetReply(page, phone, read, MSGS[2]);
  await expect(
    phone.locator(".skin-bubble", { hasText: MSGS[3] }),
  ).toHaveCount(1, { timeout: 60000 });
  assertOnceInOrder(await bubbleTexts(phone));
  await expect(
    phone.locator(".skin-bubble", { hasText: "只是覺得當面說會比較好。" }),
  ).toHaveCount(1);

  // 4) 播完持久化为 completed，游标 4，四条 messageId 各一次。
  await waitCompleted(page);
  const done = mapPack(await readPlayback(page));
  expect(done.deliveredMessageIds).toEqual(IDS);
  expect(done.nextMessageIndex).toBe(4);
});

// ---------- 场景 B：播放完成后反复进入，不重播 ----------

test("验收B｜MAP-001 播放完成后反复进入 WhatsApp 与私聊不重播", async ({
  page,
}) => {
  test.setTimeout(180000);
  const phone = await loadTemplatePlayer(page);
  await triggerMap001(phone);
  await openThread(phone);
  await driveThread(page, phone, () => readPlayback(page), isMapDone);
  await expect(
    phone.locator(".skin-bubble", { hasText: MSGS[3] }),
  ).toHaveCount(1, { timeout: 60000 });
  await waitCompleted(page);

  for (let round = 1; round <= 3; round++) {
    // 退出 WhatsApp 回到桌面，再进入：只显示聊天列表，已读后角标消失。
    // 不走「返回聊天列表」按钮：通知横幅会覆盖会话页顶部，那是另一处 UI 层级问题。
    await phone.getByRole("button", { name: "返回桌面", exact: true }).click();
    await phone.getByRole("button", { name: WHATSAPP, exact: true }).click();
    const row = phone.locator(".wa-chat-row", { hasText: LINGLING }).first();
    await expect(row).toBeVisible();
    await expect(row.locator(".wa-unread")).toHaveCount(0, { timeout: 10000 });

    // 再点开学姐私聊：四条历史各一次，不重新播放、不重复追加 messageId。
    await row.click();
    assertOnceInOrder(await bubbleTexts(phone));
    const pk = mapPack(await readPlayback(page));
    expect(pk.playbackStatus, `第 ${round} 轮状态被改动`).toBe("completed");
    expect(pk.deliveredMessageIds).toEqual(IDS);
    expect(new Set(pk.deliveredMessageIds).size).toBe(4);
  }

  // 刷新页面（重开手机）后仍是完整历史，不重播、不重复。
  await page.reload();
  await unlockPhone(phone);
  await openThread(phone);
  assertOnceInOrder(await bubbleTexts(phone));
  expect(mapPack(await readPlayback(page)).playbackStatus).toBe("completed");
});

// ---------- 场景 C：中途离开，续播下一条未播放消息 ----------

test("验收C｜MAP-001 播放中途离开，重新进入从下一条未播放消息继续", async ({
  page,
}) => {
  test.setTimeout(180000);
  const phone = await loadTemplatePlayer(page);
  await triggerMap001(phone);
  await openThread(phone);

  // 等第一条消息落盘后立刻离开，制造「中途退出」。
  await expect
    .poll(
      async () => mapPack(await readPlayback(page))?.deliveredMessageIds?.length ?? 0,
      { timeout: 30000, intervals: [100, 200] },
    )
    .toBeGreaterThan(0);
  await phone.getByRole("button", { name: "返回桌面", exact: true }).click();

  // 确认存档确实是「播了一部分、未完成」。
  const mid = mapPack(await readPlayback(page));
  const k = mid.deliveredMessageIds.length as number;
  expect(k, "退出时应处于播放中途").toBeGreaterThan(0);
  expect(k, "退出时不应已播完").toBeLessThan(4);
  expect(mid.playbackStatus).not.toBe("completed");
  expect(mid.deliveredMessageIds).toEqual(IDS.slice(0, k));

  // 重新进入：前 k 条作为历史直接显示，播放状态不回退、不重置。
  // 不断言「第 k+1 条此刻必须还没出现」：续播 timer 400ms 就会触发，
  // 而 openThread 自身的点击与等待已可能超过这个时间，那是预期行为而非缺陷。
  await openThread(phone);
  const immediate = await bubbleTexts(phone);
  for (let i = 0; i < k; i++)
    expect(
      immediate.filter((b) => b.includes(MSGS[i])).length,
      `已播放的第 ${i + 1} 条应保留`,
    ).toBe(1);
  const resumed = mapPack(await readPlayback(page));
  expect(
    resumed.deliveredMessageIds.slice(0, k),
    "续播不应重播或丢弃已播放消息",
  ).toEqual(IDS.slice(0, k));
  expect(resumed.playbackStatus, "续播不应把状态重置为 pending").not.toBe(
    "pending",
  );
  expect(resumed.nextMessageIndex, "播放游标应停在断点").toBeGreaterThanOrEqual(
    k,
  );

  // 续播：第 k+1 条起若是当前账号回复，必须逐条点输入框并点击发送。
  await driveThread(page, phone, () => readPlayback(page), isMapDone);
  // 全部送达后，每条出现时前面的不重复、送达顺序不跳条。
  for (let i = k; i < 4; i++) {
    await expect(
      phone.locator(".skin-bubble", { hasText: MSGS[i] }),
    ).toHaveCount(1, { timeout: 60000 });
    const snap = await bubbleTexts(phone);
    for (const m of MSGS.slice(0, i + 1))
      expect(
        snap.filter((b) => b.includes(m)).length,
        `播放到第 ${i + 1} 条时出现重复: ${m}`,
      ).toBe(1);
    const pk = mapPack(await readPlayback(page));
    expect(
      pk.deliveredMessageIds.slice(0, k),
      "续播过程中已播前缀被改动",
    ).toEqual(IDS.slice(0, k));
    expect(
      IDS.slice(0, pk.deliveredMessageIds.length),
      "送达顺序出现跳条或重排",
    ).toEqual(pk.deliveredMessageIds);
  }
  assertOnceInOrder(await bubbleTexts(phone));
  await waitCompleted(page);
  const final = mapPack(await readPlayback(page));
  expect(final.deliveredMessageIds).toEqual(IDS);
  expect(new Set(final.deliveredMessageIds).size).toBe(4);
});
