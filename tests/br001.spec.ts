import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { compileStory } from "../src/story-engine/compiler";

async function loadTemplatePlayer(page: Page): Promise<ReturnType<Page["locator"]>> {
  const raw = JSON.parse(readFileSync("stories/template/story.json", "utf8"));
  const { work } = compileStory(raw);
  await page.route("**/work.json", (route) =>
    route.fulfill({ json: work }),
  );
  await page.goto("/");
  const phone = page.locator(".phone-shell");
  await phone.getByRole("button", { name: "轻触解锁" }).click();
  const pin = String(raw.phone?.passcode || "");
  if (/^\d+$/.test(pin)) {
    for (const d of pin)
      await phone.getByRole("button", { name: "密码键" + d }).click();
  }
  await expect(
    phone.getByRole("button", { name: "搜索", exact: true }),
  ).toBeVisible({ timeout: 10000 });
  return phone;
}
// 通过 dock / 主屏按钮的 aria-label（形如“打开浏览器”）打开 App。
async function openApp(phone: ReturnType<Page["locator"]>, aria: string) {
  await phone.getByRole("button", { name: "返回桌面", exact: true }).click();
  await phone.getByRole("button", { name: aria, exact: true }).click();
}
const SAFARI = "打开浏览器";
const WHATSAPP = "打开WhatsApp";

test("BR-001: 打开餐厅历史记录触发解锁 wa-msg-308 与通知", async ({
  page,
}) => {
  test.setTimeout(120000);
  const phone = await loadTemplatePlayer(page);

  // 1) Safari 首页：个人收藏 + 最近浏览历史都渲染
  await openApp(phone, SAFARI);
  await expect(phone.locator(".safari-favorites button")).toHaveCount(4);
  await expect(phone.locator(".safari-hist-row")).toHaveCount(10);

  // 2) 关键字搜索命中作者配置结果（邝玲玲 → 相关公开资讯等）
  await phone.locator(".safari-address input").fill("邝玲玲");
  await phone.locator(".safari-address input").press("Enter");
  await expect(phone.locator(".safari-search-results")).toContainText(
    "相关公开资讯",
  );

  // 3) 打开邝学姐会话，等待打字动画完成（同时让 typedConversations 标记完成）
  await openApp(phone, WHATSAPP);
  await phone
    .locator(".wa-chat-row", { hasText: "邝学姐 💙" })
    .first()
    .click();
  await expect(
    phone.locator(".skin-bubble", { hasText: "下次見面時" }),
  ).toHaveCount(1);
  await expect(
    phone.locator(".skin-bubble", { hasText: "只是覺得當面說會比較好" }),
  ).toHaveCount(1, { timeout: 20000 });
  // 触发前，餐廳消息不应存在
  await expect(
    phone.locator(".skin-bubble", { hasText: "餐廳選好未呀" }),
  ).toHaveCount(0);

  // 4) 回到 Safari，打开"理工大学附近餐厅"历史记录 → 触发 BR-001
  await openApp(phone, SAFARI);
  await phone
    .locator(".safari-hist-row", { hasText: "香港理工大学附近好吃的餐厅" })
    .click();
  await expect(phone.locator(".safari-page")).toContainText("附近餐厅");

  // 4.5) BR-001 通知此时已出现（尚未打开该会话，通知仍在通知中心）
  await phone.getByRole("button", { name: "通知中心" }).click();
  await expect(phone.locator(".notice-cards")).toContainText("餐廳選好未呀☺️");
  await phone.getByRole("button", { name: "关闭", exact: true }).click();

  // 5) 重新打开邝学姐会话：wa-msg-308 已被解锁，应即时可见。
  //    按"已读即清通知"需求，打开会话后该会话通知会被清除（见步骤 6 验证）。
  await openApp(phone, WHATSAPP);
  await phone
    .locator(".wa-chat-row", { hasText: "邝学姐 💙" })
    .first()
    .click();
  await expect(
    phone.locator(".skin-bubble", { hasText: "餐廳選好未呀☺️" }),
  ).toHaveCount(1);

  // 6) 打开会话后该会话通知已清除：回到桌面，WhatsApp 角标应为 0。
  await phone.getByRole("button", { name: "返回桌面", exact: true }).click();
  await expect(
    phone.locator(".app-icon-wrap", { hasText: "WhatsApp" }).locator(".app-badge"),
  ).toHaveCount(0);
});

test("BR-001 一次性：重复打开历史记录不再重复解锁", async ({ page }) => {
  test.setTimeout(120000);
  const phone = await loadTemplatePlayer(page);

  const openRestaurant = async () => {
    await openApp(phone, SAFARI);
    await phone
      .locator(".safari-hist-row", { hasText: "香港理工大学附近好吃的餐厅" })
      .click();
    await expect(phone.locator(".safari-page")).toContainText("附近餐厅");
  };

  await openRestaurant();
  await openApp(phone, WHATSAPP);
  await phone
    .locator(".wa-chat-row", { hasText: "邝学姐 💙" })
    .first()
    .click();
  await expect(
    phone.locator(".skin-bubble", { hasText: "餐廳選好未呀☺️" }),
  ).toHaveCount(1);
  const countFirst = await phone
    .locator(".skin-bubble", { hasText: "餐廳選好未呀☺️" })
    .count();

  // 再次打开同一历史记录
  await openRestaurant();
  await openApp(phone, WHATSAPP);
  await phone
    .locator(".wa-chat-row", { hasText: "邝学姐 💙" })
    .first()
    .click();
  await expect(
    phone.locator(".skin-bubble", { hasText: "餐廳選好未呀☺️" }),
  ).toHaveCount(1);
  const countSecond = await phone
    .locator(".skin-bubble", { hasText: "餐廳選好未呀☺️" })
    .count();

  expect(countSecond).toBe(countFirst);
});
