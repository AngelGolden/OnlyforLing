import { expect, type Locator, type Page } from "@playwright/test";

export type PlaybackMap = Record<string, any>;
export type ReadPlayback = () => Promise<PlaybackMap>;

/** 所有消息包里「已写入聊天历史」的 messageId 总数。 */
export function deliveredCount(pb: PlaybackMap): number {
  return Object.values(pb).reduce(
    (n, pk: any) => n + (pk?.deliveredMessageIds?.length ?? 0),
    0,
  );
}

/** 等待剧本游标停在当前账号的预设回复上。 */
export async function waitAwaitingReply(phone: Locator, timeout = 20000) {
  await expect(phone.locator(".skin-compose[data-awaiting-reply='1']")).toBeVisible({
    timeout,
  });
}

/**
 * v1.2 一轮回复：点输入框 → 键盘弹出 → 系统自动逐字输入 → 等 draft_ready → 主动点发送。
 * 发送按钮只在打字完成后可用；没有点击发送就绝不写入聊天历史。
 * 返回发送前已送达的消息总数，便于断言「确实只新增了一条」。
 */
export async function sendPresetReply(
  page: Page,
  phone: Locator,
  read: ReadPlayback,
  expected?: string,
) {
  const before = deliveredCount(await read());
  const field = phone.locator(".native-compose-field");
  const compose = phone.locator(".skin-compose");
  // 之前打字完成却未发送就退出：重进时已是完整草稿，不再重播动画。
  const alreadyReady =
    (await compose.getAttribute("data-reply-phase")) === "draft_ready";
  await field.click();
  await expect(phone.locator(".device-keyboard")).toBeVisible({ timeout: 6000 });
  if (!alreadyReady) {
    // 点击瞬间不得一次性出现完整预设文本；逐字动画由系统自动完成。
    const early = ((await field.textContent()) ?? "").trim();
    if (expected !== undefined && Array.from(expected).length > 4)
      expect(early, "点击输入框时不得瞬间填入完整预设回复").not.toBe(expected);
  }
  await expect(
    phone.locator(".skin-compose[data-reply-phase='draft_ready']"),
  ).toBeVisible({ timeout: 20000 });
  const text = ((await field.textContent()) ?? "").trim();
  if (expected !== undefined) expect(text).toBe(expected);
  else expect(text.length).toBeGreaterThan(0);
  const send = phone.getByRole("button", { name: "发送消息" });
  await expect(send).toBeEnabled({ timeout: 5000 });
  await send.click();
  await expect
    .poll(async () => deliveredCount(await read()), { timeout: 15000 })
    .toBeGreaterThanOrEqual(before + 1);
  return before;
}

/** 等待当前轮次系统自动逐字输入完成，输入框内保留完整草稿但尚未发送。 */
export async function waitDraftReady(phone: Locator, timeout = 20000) {
  await expect(
    phone.locator(".skin-compose[data-reply-phase='draft_ready']"),
  ).toBeVisible({ timeout });
}

/**
 * 把当前会话的固定剧本推进到结束：对方消息自动「正在输入 + 逐字显示」，
 * 每条当前账号回复都经过「点输入框 + 自动打字 + 点发送」，连续回复也逐条等待。
 */
export async function driveThread(
  page: Page,
  phone: Locator,
  read: ReadPlayback,
  isDone: (pb: PlaybackMap) => boolean,
  maxSteps = 320,
) {
  for (let step = 0; step < maxSteps; step++) {
    const pb = await read();
    if (isDone(pb)) return;
    if (await phone.locator(".skin-compose[data-awaiting-reply='1']").count()) {
      await sendPresetReply(page, phone, read);
    } else {
      // 对方消息先「正在输入」再逐字显示，完整后才落盘，这里只等待。
      await page.waitForTimeout(250);
    }
  }
  throw new Error("driveThread: 剧本未在限定步数内完成");
}

/** 从 IndexedDB 读取 Runtime.playback（各 spec 可继续用自己的 readRuntime）。 */
export async function readPlaybackFromDb(page: Page): Promise<PlaybackMap> {
  return page.evaluate(async () => {
    const req = indexedDB.open("foundphone-studio");
    const db: IDBDatabase = await new Promise((res, rej) => {
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    const store = db.transaction("saves", "readonly").objectStore("saves");
    const all: any[] = await new Promise((res, rej) => {
      const r = store.getAll();
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    db.close();
    return all[0]?.state?.playback ?? {};
  });
}
