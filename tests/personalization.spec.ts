/**
 * 系统设置个性化验收：闹钟 / 世界时钟 / 卸载 / 日历特别提醒 /
 * 机主头像与名字 / 公用 WiFi / 蓝牙设备。
 *
 * 固定字符串从规格逐字副本 data/personalization/系统设置搭建指令.txt 解析，
 * 再从真实 story.json、compileStory 产物与真实 UI 逐项比对。
 */
import { test, expect, type Locator, type Page } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";
import { compileStory } from "../src/story-engine/compiler";

const raw = JSON.parse(readFileSync("stories/template/story.json", "utf8"));
const work = compileStory(raw).work;
const PIN = String(raw.phone.passcode);
const SPEC = readFileSync("data/personalization/系统设置搭建指令.txt", "utf8");
const ORIGINAL = SPEC.split("## 二、")[0];
const pick = (re: RegExp, label: string) => {
  const m = ORIGINAL.match(re);
  if (!m) throw new Error(`规格逐字副本缺少「${label}」`);
  return m[1].trim();
};

const CALENDAR_TITLE = pick(/内容是：(.+?)。/, "日历提醒内容");
const ACCOUNT_NAME = pick(/名字改为(.+?)。/, "机主名字");
const PUBLIC_WIFI = pick(/公用WiFi：(.+?)。/, "公用 WiFi 名称");
const BLUETOOTH_DEVICE = pick(/设备名是：(.+?)。/, "蓝牙设备名");
const AVATAR_SRC = pick(/头像素材本地路径：(.+)/, "头像素材路径");
const DAY = (() => {
  const m = ORIGINAL.match(/(\d{4})年\.(\d{1,2})月(\d{1,2})日/);
  if (!m) throw new Error("规格逐字副本缺少日历日期");
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
})();

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
    route.fulfill({ json: structuredClone(work) }),
  );
  await page.goto("/?fresh=1");
  const phone = page.locator(".phone-shell");
  await unlockPhone(phone);
  return phone;
}
/**
 * 走主屏的 App 搜索，避免依赖图标是否被收进文件夹。
 * 日历图标会把动态日期（如「周日 25」）渲染进结果按钮的可访问名称，
 * 因此不能用 exact accessible name 定位，改用 .search-result + 文本包含。
 */
async function openApp(phone: Locator, name: string) {
  await phone.getByRole("button", { name: "返回桌面", exact: true }).click();
  await phone.getByRole("button", { name: "搜索", exact: true }).click();
  await phone.getByPlaceholder("App 名称").fill(name);
  const result = phone.locator(".search-result", { hasText: name });
  await expect(result).toHaveCount(1);
  await result.click();
}

test("静态：固定字符串逐字、跳过卸载、资源与编译产物", async () => {
  // 锚定用户字面量，防止规格副本被改写后测试自证。
  expect(CALENDAR_TITLE).toBe("和学姐吃饭");
  expect(ACCOUNT_NAME).toBe("Angel gloden");
  expect(PUBLIC_WIFI).toBe("PolyU");
  expect(BLUETOOTH_DEVICE).toBe("Ling`s airpods");
  expect(DAY).toBe("2026-11-14");
  expect(ORIGINAL).toContain("香港和泰国");

  // 用户澄清：手机自带的「音乐」未安装则跳过卸载，Spotify 与音乐事件保留。
  expect(raw.installedApps).not.toContain("music");
  expect(raw.installedApps).toContain("spotify");
  expect(raw.installedApps).toHaveLength(19);
  expect(raw.content.spotify).toHaveLength(4);
  expect(raw.events.some((e: any) => e.id === "WA_MUSIC_001")).toBe(true);

  // 只改设置页展示，owner 与所有机主消息发信人不动。
  expect(raw.phone.owner).toBe("我");
  expect(raw.phone.accountName).toBe(ACCOUNT_NAME);
  expect(raw.phone.accountAvatar).toBe("/owner-media/ig-owner.jpg");
  expect(raw.phone.publicWifi).toBe(PUBLIC_WIFI);
  expect(raw.phone.bluetoothDevices).toEqual([BLUETOOTH_DEVICE]);
  expect(work.phone.accountName).toBe(ACCOUNT_NAME);
  expect(work.phone.publicWifi).toBe(PUBLIC_WIFI);
  const outgoing = work.data.whatsapp.find((i: any) => i.outgoing === true);
  expect(outgoing?.sender).toBe("我");

  // 时钟：5 个闹钟 + 2 个世界时钟，分属各自 folder。
  expect(raw.content.clock.filter((i: any) => i.folder === "闹钟")).toHaveLength(
    5,
  );
  const worlds = raw.content.clock.filter(
    (i: any) => i.folder === "世界时钟",
  );
  expect(worlds).toHaveLength(2);
  expect(worlds.map((i: any) => i.title)).toEqual(["中国香港", "泰国"]);
  expect(work.data.clock).toHaveLength(7);

  // 日历：逐字标题、用户给定日期、特别提醒标记。
  expect(raw.content.calendar).toHaveLength(1);
  const event = raw.content.calendar[0];
  expect(event.title).toBe(CALENDAR_TITLE);
  expect(event.time.startsWith(DAY)).toBe(true);
  expect(event.meta.special).toBe("true");
  expect(work.data.calendar).toHaveLength(1);

  // 头像是用户原图、二进制一致；运行时只引用本地白名单路径。
  expect(existsSync("public/owner-media/ig-owner.jpg")).toBe(true);
  expect(
    readFileSync("public/owner-media/ig-owner.jpg").equals(
      readFileSync(AVATAR_SRC),
    ),
  ).toBe(true);
  expect(raw.phone.accountAvatar).toMatch(
    /^\/owner-media\/[a-z0-9-]+\.(jpe?g|png|webp)$/i,
  );
});

test("时钟：闹钟与世界时钟分属各自页签，开关可用", async ({ page }) => {
  test.setTimeout(90000);
  const phone = await loadPhone(page);
  await openApp(phone, "时钟");
  await expect(phone.locator(".native-clock")).toBeVisible();

  const alarms = phone.locator('.alarm-row[data-clock-tab="闹钟"]');
  await expect(alarms).toHaveCount(5);
  await expect(alarms.first().locator("time")).toHaveText(/^\d{2}:\d{2}$/);
  await expect(alarms.first()).toContainText("Design Studio 早课");
  const sw = alarms.first().getByRole("switch");
  await expect(sw).toHaveAttribute("aria-checked", "false");
  await sw.click();
  await expect(sw).toHaveAttribute("aria-checked", "true");

  await phone.locator(".catalog-tabs button", { hasText: "世界时钟" }).click();
  const worlds = phone.locator('.alarm-row[data-clock-tab="世界时钟"]');
  await expect(worlds).toHaveCount(2);
  await expect(worlds.nth(0)).toContainText("中国香港");
  await expect(worlds.nth(0)).toContainText("GMT+8");
  await expect(worlds.nth(1)).toContainText("泰国");
  await expect(worlds.nth(1)).toContainText("GMT+7");
  // 切到世界时钟后闹钟条目不应串过来。
  await expect(alarms).toHaveCount(0);
});

test("日历：打开即见 2026 年 11 月 14 日的特别提醒", async ({ page }) => {
  test.setTimeout(90000);
  const phone = await loadPhone(page);
  await openApp(phone, "日历");
  await expect(phone.locator(".month-title h2")).toHaveText("2026 年 11 月");
  await expect(phone.locator(".calendar-grid button.selected")).toHaveText(
    "14",
  );
  const event = phone.locator(".calendar-event");
  await expect(event).toHaveCount(1);
  await expect(event).toContainText(CALENDAR_TITLE);
  await expect(event.locator(".calendar-special")).toHaveText("特别提醒");
  await expect(event.locator("time")).toHaveText("19:00");
});

test("设置：机主头像与名字，账户详情与关于本机一致", async ({ page }) => {
  test.setTimeout(90000);
  const phone = await loadPhone(page);
  await openApp(phone, "设置");
  const account = phone.locator(".settings-account");
  await expect(account).toBeVisible();
  await expect(account.locator("strong")).toHaveText(ACCOUNT_NAME);
  const img = account.locator("img");
  // 渲染层把根路径规范化为 ./ 以兼容 GitHub Pages 子路径；故事数据里的值不变。
  await expect(img).toHaveAttribute("src", "./owner-media/ig-owner.jpg");
  await expect
    .poll(async () =>
      img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0),
    )
    .toBe(true);

  await account.click();
  await expect(phone.locator(".settings-account-detail strong")).toHaveText(
    ACCOUNT_NAME,
  );
  await expect(phone.locator(".settings-account-detail img")).toBeVisible();
  await phone.locator(".settings-native-nav button").click();
  await expect(phone.locator(".settings-account")).toBeVisible();

  await phone.getByText("通用", { exact: true }).click();
  await phone.getByText("关于本机", { exact: true }).click();
  await expect(phone.locator(".phone-screen")).toContainText(
    `${ACCOUNT_NAME} 的 iPhone`,
  );
});

test("无线局域网：列出公用 WiFi PolyU", async ({ page }) => {
  test.setTimeout(90000);
  const phone = await loadPhone(page);
  await openApp(phone, "设置");
  await phone.getByText("无线局域网", { exact: true }).click();
  const wifi = phone.locator(
    `[data-settings-public-wifi="${PUBLIC_WIFI}"]`,
  );
  await expect(wifi).toBeVisible();
  await expect(wifi).toContainText(PUBLIC_WIFI);
  await expect(phone.getByText("公用网络", { exact: true })).toBeVisible();
});

test("蓝牙：我的设备里出现连接过的 Ling`s airpods", async ({ page }) => {
  test.setTimeout(90000);
  const phone = await loadPhone(page);
  await openApp(phone, "设置");
  await phone.getByText("蓝牙", { exact: true }).click();
  const device = phone.locator(
    `[data-settings-bluetooth-device="${BLUETOOTH_DEVICE}"]`,
  );
  await expect(device).toBeVisible();
  await expect(device).toContainText(BLUETOOTH_DEVICE);
  await expect(phone.getByText("我的设备", { exact: true })).toBeVisible();
});
