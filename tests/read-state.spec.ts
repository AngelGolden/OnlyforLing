import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { compileStory } from "../src/story-engine/compiler";

const PIN = "0511";
const WHATSAPP = "打开WhatsApp";

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

async function openLingling(phone: ReturnType<Page["locator"]>) {
  await openApp(phone, WHATSAPP);
  await phone
    .locator(".wa-chat-row", { hasText: "邝学姐 💙" })
    .first()
    .click();
}

// 阅读会话后：原开屏通知应清除；读完指定对话按剧情会另触发 MIMI-001 新通知。
test("阅读会话后开屏通知清除，MIMI-001 新通知独立产生", async ({
  page,
}) => {
  test.setTimeout(120000);
  const phone = await loadTemplatePlayer(page);

  // 初始：开屏通知使 WhatsApp 角标为 1
  await expect(
    phone.locator(".app-icon-wrap", { hasText: "WhatsApp" }).locator(".app-badge"),
  ).toHaveCount(1);

  // 打开并阅读邝学姐会话（打字动画播放完毕）
  await openLingling(phone);
  await expect(
    phone.locator(".skin-bubble", { hasText: "只是覺得當面說會比較好" }),
  ).toHaveCount(1);

  // 回到桌面：角标应消失
  await phone.getByRole("button", { name: "返回桌面", exact: true }).click();
  await expect(
    phone.locator(".app-icon-wrap", { hasText: "WhatsApp" }).locator(".app-badge"),
  ).toHaveCount(0);

  // 重新打开手机（刷新 → 从本地存档恢复，仍处于锁屏）
  await page.reload();
  await expect(phone.locator(".lock-screen")).toBeVisible({ timeout: 10000 });
  // 读完开场那段指定对话会按剧情触发 MIMI-001，另生成一条来自 Mimi 🧋 的新通知。
  // 本用例验证的是「开屏那条邝学姐通知已清除」，不能把新剧情通知当成残留。
  const lockNoticeTexts = await phone.locator(".device-notice").allTextContents();
  expect(
    lockNoticeTexts.filter((t) => t.includes("下次見面時")).length,
    "开屏通知「下次見面時…」应已清除",
  ).toBe(0);
  for (const t of lockNoticeTexts)
    expect(t, "锁屏剩余通知只能是 MIMI-001 的 Mimi 新消息").toContain(
      "你跟学姐聊开了吗？",
    );
  // 解锁后：原会话已读，MIMI-001 的未读归在 Mimi 🧋 名下，桌面角标可能仍在；
  // 关键回归是邝学姐这一行本身不再有未读。
  await unlockPhone(phone);
  await openApp(phone, WHATSAPP);
  await expect(
    phone
      .locator(".wa-chat-row", { hasText: "邝学姐 💙" })
      .first()
      .locator(".wa-unread"),
  ).toHaveCount(0);
  await expect(
    phone
      .locator(".wa-chat-row", { hasText: "Mimi 🧋" })
      .first()
      .locator(".wa-unread"),
  ).toHaveCount(1);
});

// 已读会话的打字动画在重新打开手机后不应重复播放。
test("已读会话的打字动画在重新打开手机后不再重复播放", async ({ page }) => {
  test.setTimeout(120000);
  const phone = await loadTemplatePlayer(page);

  // 第一次打开邝学姐：打字动画会播放，等待其完成
  await openLingling(phone);
  await expect(
    phone.locator(".skin-bubble", { hasText: "只是覺得當面說會比較好" }),
  ).toHaveCount(1);

  // 重新打开手机并从本地存档恢复（已读状态持久化）
  await page.reload();
  await unlockPhone(phone);

  // 再次打开邝学姐：不应再出现打字动画的点点，消息应立即完整显示
  await openLingling(phone);
  await expect(phone.locator(".wa-typing-dots")).toHaveCount(0);
  await expect(
    phone.locator(".skin-bubble", { hasText: "只是覺得當面說會比較好" }),
  ).toHaveCount(1);
});

// 关键回归：玩家没等打字动画播完就返回（真实场景），重新打开也不应重复播放。
// 修复前 onTyped 只在动画末尾触发，中途离开会因 unmount 清除定时器而永远不落盘。
test("未等打字动画播完就离开，重新打开也不重复播放", async ({ page }) => {
  test.setTimeout(120000);
  const phone = await loadTemplatePlayer(page);

  // 打开邝学姐：打字动画开始播放，挂载即记录为已播放（即时落盘）
  await openLingling(phone);
  await expect(phone.locator(".wa-thread-profile")).toBeVisible();
  // 不等动画播完，立刻返回桌面
  await page.waitForTimeout(150);
  await phone.getByRole("button", { name: "返回桌面", exact: true }).click();

  // 重新打开手机并从本地存档恢复（已播放状态应已落盘）
  await page.reload();
  await unlockPhone(phone);

  // 再次打开邝学姐：不应再出现打字动画的点点
  await openLingling(phone);
  await expect(phone.locator(".wa-typing-dots")).toHaveCount(0);
  await expect(
    phone.locator(".skin-bubble", { hasText: "只是覺得當面說會比較好" }),
  ).toHaveCount(1);
});
