import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { compileStory } from "../src/story-engine/compiler";

const PIN = "0511";

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
  return page.locator(".phone-shell");
}

/** 模拟器里不应该出现把玩家当第三方的元叙事措辞。 */
const FORBIDDEN = ["机主", "物主", "虚构", "作品", "故事", "剧情"];

test("锁屏与桌面不出现第三人称元叙事措辞", async ({ page }) => {
  test.setTimeout(120000);
  const phone = await loadTemplatePlayer(page);

  // 锁屏（未解锁）
  let text = (await phone.locator(".phone-screen").innerText()).replace(
    /\s/g,
    "",
  );
  for (const word of FORBIDDEN) expect(text, "锁屏").not.toContain(word);

  await unlockPhone(phone);
  text = (await phone.locator(".phone-screen").innerText()).replace(/\s/g, "");
  for (const word of FORBIDDEN) expect(text, "桌面").not.toContain(word);
});

test("常用 App 内不出现第三人称元叙事措辞", async ({ page }) => {
  test.setTimeout(120000);
  const phone = await loadTemplatePlayer(page);
  await unlockPhone(phone);

  for (const aria of [
    "打开浏览器",
    "打开WhatsApp",
    "打开地图",
    "打开相册",
    "打开备忘录",
    "打开设置",
  ]) {
    await phone.getByRole("button", { name: "返回桌面", exact: true }).click();
    await phone.getByRole("button", { name: aria, exact: true }).click();
    await page.waitForTimeout(300);
    const text = (await phone.locator(".phone-screen").innerText()).replace(
      /\s/g,
      "",
    );
    for (const word of FORBIDDEN)
      expect(text, aria + " / " + word).not.toContain(word);
  }
});

test("设置里显示的是本机身份而不是第三人称", async ({ page }) => {
  test.setTimeout(120000);
  const phone = await loadTemplatePlayer(page);
  await unlockPhone(phone);
  await phone.getByRole("button", { name: "返回桌面", exact: true }).click();
  await phone.getByRole("button", { name: "打开设置", exact: true }).click();

  // 设置首页的个人资料是机主本人；按后续需求名字设为 Angel gloden，
  // 但聊天里仍用第一人称「我」，历史消息发信人零改动。
  await expect(phone.locator(".settings-account strong")).toHaveText(
    "Angel gloden",
  );

  // 关于本机 → "Angel gloden 的 iPhone"
  await phone.getByText("通用", { exact: true }).click();
  await phone.getByText("关于本机", { exact: true }).click();
  await expect(phone.locator(".phone-screen")).toContainText(
    "Angel gloden 的 iPhone",
  );

  const text = await phone.locator(".phone-screen").innerText();
  expect(text).not.toContain("机主");
});
