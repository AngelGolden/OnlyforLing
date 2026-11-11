import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { compileStory } from "../src/story-engine/compiler";

async function loadTemplatePlayer(
  page: Page,
): Promise<ReturnType<Page["locator"]>> {
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

async function openApp(
  phone: ReturnType<Page["locator"]>,
  aria: string,
) {
  await phone.getByRole("button", { name: "返回桌面", exact: true }).click();
  await phone.getByRole("button", { name: aria, exact: true }).click();
}
const SAFARI = "打开浏览器";

// 覆盖 window.open，捕获被打开的真实外链（避免依赖外部网络）。
async function captureWindowOpen(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __openedUrls: string[] }).__openedUrls = [];
    window.open = ((url?: string | URL) => {
      (window as unknown as { __openedUrls: string[] }).__openedUrls.push(
        String(url ?? ""),
      );
      return null;
    }) as typeof window.open;
  });
}

async function searchAndGetOpenedUrl(
  page: Page,
  phone: ReturnType<Page["locator"]>,
  query: string,
): Promise<string | null> {
  await openApp(phone, SAFARI);
  await phone.locator(".safari-address input").fill(query);
  await phone.locator(".safari-address input").press("Enter");
  const urls = await page.evaluate(
    () => (window as unknown as { __openedUrls: string[] }).__openedUrls,
  );
  return urls.length ? urls[urls.length - 1] : null;
}

test("Safari: 搜索 AW 直接跳转真实外链，不展示结果页", async ({ page }) => {
  test.setTimeout(120000);
  await captureWindowOpen(page);
  const phone = await loadTemplatePlayer(page);

  const url = await searchAndGetOpenedUrl(page, phone, "AW");
  expect(url).toBe("https://alwayswonder-co.com/");
  // 命中 redirect 后不应渲染关键字结果页
  await expect(phone.locator(".safari-search-results")).toHaveCount(0);
});

test("Safari: 别名 Always Wonder / alwayswonder 同样直接跳转", async ({
  page,
}) => {
  test.setTimeout(120000);
  await captureWindowOpen(page);
  const phone = await loadTemplatePlayer(page);

  for (const q of ["Always Wonder", "alwayswonder"]) {
    const url = await searchAndGetOpenedUrl(page, phone, q);
    expect(url).toBe("https://alwayswonder-co.com/");
    await expect(phone.locator(".safari-search-results")).toHaveCount(0);
  }
});
