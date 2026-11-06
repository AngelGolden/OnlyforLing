import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import { compileStory } from "../src/story-engine/compiler";

const work = compileStory(
  JSON.parse(
    readFileSync(
      new URL("../stories/after-the-last-set/story.json", import.meta.url),
      "utf8",
    ),
  ),
).work;

test.beforeEach(async ({ page }) => {
  await page.route("**/work.json", (route) => route.fulfill({ json: work }));
});

test("AFTER THE LAST SET uses the native phone runtime end to end", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  const phone = page.locator(".phone-shell");

  await expect(phone.locator(".lock-screen")).toBeVisible();
  await phone.getByRole("button", { name: "轻触解锁" }).click();
  for (const digit of "0000") {
    await phone.getByRole("button", { name: "密码键" + digit, exact: true }).click();
  }
  await expect(phone.getByText("密码不正确")).toBeVisible();

  for (const digit of "0511") {
    await phone.getByRole("button", { name: "密码键" + digit, exact: true }).click();
  }
  await expect(phone.locator(".home-screen")).toBeVisible();
  await phone.getByRole("button", { name: "打开WhatsApp", exact: true }).click();
  await expect(phone.locator(".wa-large-title")).toHaveText("聊天");

  const chat = phone.locator(".wa-chat-row").filter({ hasText: "鄺學姐 💙" });
  await expect(chat).toHaveCount(1);
  await chat.click();
  await expect(phone.locator(".wa-thread-profile strong")).toHaveText("鄺學姐 💙");
  await expect(phone.locator(".skin-message")).toHaveCount(302);
  await expect(phone.locator(".skin-date")).toHaveCount(21);
  await expect(phone.locator(".skin-photo")).toHaveCount(5);

  for (const caption of [
    "聖誕演出玲玲返圖（待補圖）",
    "豆腐和叉燒的日常照片（待補圖）",
    "健身後的晚餐（待補圖）",
    "模特拍攝工作照片（待補圖）",
    "泰國菜照片（待補圖）",
  ]) {
    await expect(phone.locator(".skin-photo")).toContainText(caption);
  }

  await expect(phone.getByText("邝玲玲", { exact: true })).toHaveCount(0);
  await phone.getByRole("button", { name: "返回聊天列表" }).click();
  await expect(phone.locator(".wa-large-title")).toHaveText("聊天");
  await phone.getByRole("button", { name: "返回桌面", exact: true }).click();
  await expect(phone.locator(".home-screen")).toBeVisible();
  expect(errors).toEqual([]);
});

test("production build serves AFTER THE LAST SET without mocked work.json", async ({ page }) => {
  await page.unroute("**/work.json");
  await page.goto("/");
  const phone = page.locator(".phone-shell");
  await expect(phone.locator(".lock-screen")).toBeVisible();
  await phone.getByRole("button", { name: "轻触解锁" }).click();
  for (const digit of "0511") {
    await phone.getByRole("button", { name: "密码键" + digit, exact: true }).click();
  }
  await expect(phone.locator(".home-screen")).toBeVisible();
  await phone.getByRole("button", { name: "打开WhatsApp", exact: true }).click();
  await expect(
    phone.locator(".wa-chat-row").filter({ hasText: "鄺學姐 💙" }),
  ).toHaveCount(1);
});
