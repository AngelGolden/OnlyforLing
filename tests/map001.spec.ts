import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { compileStory } from "../src/story-engine/compiler";
import { driveThread, readPlaybackFromDb } from "./fixtures/wa-playback";

const PIN = "0511";
const MAPS = "打开地图";
const WHATSAPP = "打开WhatsApp";
const LINGLING = "邝学姐 💙";

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

/** 打开 Maps 首页。 */
async function openMaps(phone: ReturnType<Page["locator"]>) {
  await openApp(phone, MAPS);
  await expect(phone.locator(".maps-ui")).toBeVisible();
}

/** 地图首页 → 搜索栏 → 点击一条最近搜索（搜索面板已打开时直接点）。 */
async function openRecent(phone: ReturnType<Page["locator"]>, label: string) {
  const pill = phone.getByRole("button", { name: "搜索地点", exact: true });
  if (await pill.count()) await pill.click();
  await expect(phone.locator(".maps-recent-row").first()).toBeVisible();
  await phone.locator(".maps-recent-row", { hasText: label }).first().click();
}

/** 结果页 → 搜索面板。 */
async function backToSearch(phone: ReturnType<Page["locator"]>) {
  await phone
    .locator(".maps-panel")
    .getByRole("button", { name: "返回", exact: true })
    .click();
  await expect(phone.locator(".maps-recent-row").first()).toBeVisible();
}

/** 打开通知中心（整屏面板）。 */
async function openNoticeCenter(phone: ReturnType<Page["locator"]>) {
  await phone.getByRole("button", { name: "通知中心" }).click();
  await expect(phone.locator(".notice-cards")).toBeVisible();
}

async function closeNoticeCenter(phone: ReturnType<Page["locator"]>) {
  const close = phone.getByRole("button", { name: "关闭", exact: true });
  if (await close.count()) await close.click();
}

/** MAP-001 里两条当前账号回复必须逐条手动发送；对方消息仍自动到达。 */
async function playMapPack(page: Page, phone: ReturnType<Page["locator"]>) {
  await driveThread(
    page,
    phone,
    () => readPlaybackFromDb(page),
    (pb) =>
      Object.values(pb).some(
        (pk: any) =>
          pk?.messageIds?.includes("msg_map001_01") &&
          pk.playbackStatus === "completed",
      ),
  );
}

// ---------- 地图首页 ----------

test("地图首页显示五个地点标记，可打开与关闭地点卡片", async ({ page }) => {
  test.setTimeout(120000);
  const phone = await loadTemplatePlayer(page);
  await openMaps(phone);

  // 五个标记都在地图上
  for (const name of [
    "香港理工大學",
    "Late Checkout 排練室",
    "學姐家",
    "紅磡站",
    "黃埔天地",
  ])
    await expect(phone.locator(`[aria-label="地图地点${name}"]`)).toHaveCount(1);

  // 点击标记 → 地点卡片
  await phone.locator('[aria-label="地图地点紅磡站"]').click();
  await expect(phone.locator(".maps-place-card")).toContainText("紅磡站");
  await expect(phone.locator(".maps-place-card")).toContainText("交通设施");

  // 关闭卡片 → 恢复完整地图视图
  await phone.getByRole("button", { name: "关闭地点卡片" }).click();
  await expect(phone.locator(".maps-place-card")).toHaveCount(0);

  // 缩放与平移控件可用
  await expect(phone.getByRole("button", { name: "放大地图" })).toBeVisible();
  await expect(phone.getByRole("button", { name: "缩小地图" })).toBeVisible();
  await phone.getByRole("button", { name: "放大地图" }).click();
  await phone.getByRole("button", { name: "缩小地图" }).click();
  await expect(phone.locator(".maps-canvas")).toBeVisible();

  // 学姐家只是普通住宅地点，不触发剧情
  await phone.locator('[aria-label="地图地点學姐家"]').click();
  await expect(phone.locator(".maps-place-card")).toContainText("學姐家");
  await expect(phone.locator(".maps-place-card")).toContainText("住宅");
});

// ---------- 搜索 ----------

test("搜索界面显示四条最近搜索，普通搜索不触发 MAP-001", async ({
  page,
}) => {
  test.setTimeout(120000);
  const phone = await loadTemplatePlayer(page);
  await openMaps(phone);

  await phone.getByRole("button", { name: "搜索地点", exact: true }).click();
  const recents = phone.locator(".maps-recent-row");
  await expect(recents).toHaveCount(4);
  await expect(recents.nth(0)).toContainText("紅磡附近餐廳");
  await expect(recents.nth(1)).toContainText("香港理工大學");
  await expect(recents.nth(2)).toContainText("黃埔天地");
  await expect(recents.nth(3)).toContainText("紅磡站");

  // 普通地点搜索 → 对应结果页
  await recents.nth(1).click();
  await expect(phone.locator(".maps-result-title")).toHaveText("香港理工大學");
  await expect(phone.locator(".maps-place-card.static")).toContainText(
    "香港理工大學",
  );

  // 其他普通搜索也能打开
  await backToSearch(phone);
  await openRecent(phone, "黃埔天地");
  await expect(phone.locator(".maps-result-title")).toHaveText("黃埔天地");
  await backToSearch(phone);
  await openRecent(phone, "紅磡站");
  await expect(phone.locator(".maps-result-title")).toHaveText("紅磡站");

  // 自由输入其他关键词 → 通用结果页，不触发主线
  await backToSearch(phone);
  await phone.getByRole("textbox", { name: "搜索地点" }).fill("上水");
  await phone.getByRole("textbox", { name: "搜索地点" }).press("Enter");
  await expect(phone.locator(".maps-result-title")).toHaveText("上水");

  // 全程没有触发 MAP-001：没有学姐的新消息通知
  await openNoticeCenter(phone);
  await expect(phone.locator(".notice-cards")).not.toContainText(
    "你有冇特別想食咩？",
  );
  await closeNoticeCenter(phone);
});

// ---------- 紅磡附近餐廳结果页 ----------

test("紅磡附近餐廳结果页显示四类餐饮，且不含真实商户资料", async ({
  page,
}) => {
  test.setTimeout(120000);
  const phone = await loadTemplatePlayer(page);
  await openMaps(phone);
  await openRecent(phone, "紅磡附近餐廳");

  await expect(phone.locator(".maps-result-title")).toHaveText("紅磡附近餐廳");
  await expect(phone.locator(".maps-canvas")).toHaveAttribute(
    "data-variant",
    "restaurants",
  );
  for (const cat of ["日式料理", "泰国菜", "港式餐厅", "火锅"])
    await expect(phone.locator(".maps-category", { hasText: cat })).toHaveCount(1);

  // 分类卡片可点击
  await phone.locator(".maps-category", { hasText: "日式料理" }).click();
  await expect(
    phone.locator(".maps-category", { hasText: "日式料理" }),
  ).toHaveClass(/selected/);

  // 不出现真实商户评分 / 价格 / 电话 / 营业时间 / 订座 / 评论
  const text = (await phone.locator(".maps-ui").innerText()).replace(/\s/g, "");
  for (const banned of ["人均", "¥", "港幣", "電話", "訂座", "評論", "★", "星"])
    expect(text).not.toContain(banned);
  expect(text).not.toMatch(/\d(\.\d)?分/);
});

// ---------- MAP-001 触发与消息追加 ----------

test("打开紅磡附近餐廳结果页触发 MAP-001，追加四条 WhatsApp 消息", async ({
  page,
}) => {
  test.setTimeout(180000);
  const phone = await loadTemplatePlayer(page);
  await openMaps(phone);

  // 仅打开搜索栏 / 查看最近搜索列表都不触发
  await phone.getByRole("button", { name: "搜索地点", exact: true }).click();
  await expect(phone.locator(".maps-recent-row").first()).toBeVisible();
  await phone
    .locator(".maps-panel")
    .getByRole("button", { name: "返回地图" })
    .click();

  // 真正打开指定结果页 → 触发 MAP-001
  await openRecent(phone, "紅磡附近餐廳");
  await expect(phone.locator(".maps-result-title")).toHaveText("紅磡附近餐廳");

  // 地图保持前台，不自动切到 WhatsApp
  await expect(phone.locator(".maps-ui")).toBeVisible();

  // WhatsApp 出现学姐的新消息通知
  await openNoticeCenter(phone);
  await expect(phone.locator(".notice-cards")).toContainText(
    "你有冇特別想食咩？",
  );
  await closeNoticeCenter(phone);

  // 进入 WhatsApp：会话列表里只能看到"有新消息"的提示，还不能提前看到新消息内容
  await openApp(phone, WHATSAPP);
  const row = phone.locator(".wa-chat-row", { hasText: LINGLING }).first();
  await expect(row.locator(".wa-unread")).toHaveCount(1);
  await expect(row.locator(".wa-unread")).toHaveText("4");
  await expect(row).not.toContainText("你有冇特別想食咩？");
  await expect(row).not.toContainText("紅磡附近都幾方便呀。");

  // 点进会话：对方消息自动到达，两条当前账号回复逐条手动发送
  await row.click();
  await playMapPack(page, phone);
  await expect(
    phone.locator(".skin-bubble", { hasText: "紅磡附近都幾方便呀。" }),
  ).toHaveCount(1, { timeout: 60000 });

  const bubbles = await phone.locator(".skin-bubble").allTextContents();
  const at = (t: string) => bubbles.findIndex((b) => b.includes(t));
  for (const t of [
    "你有冇特別想食咩？",
    "还没想好呢",
    "想找一家离学校近一点的",
    "紅磡附近都幾方便呀。",
  ]) {
    expect(at(t), "消息缺失: " + t).toBeGreaterThanOrEqual(0);
    expect(bubbles.filter((b) => b.includes(t)).length, "消息重复: " + t).toBe(1);
  }
  expect(at("你有冇特別想食咩？")).toBeLessThan(at("还没想好呢"));
  expect(at("还没想好呢")).toBeLessThan(at("想找一家离学校近一点的"));
  expect(at("想找一家离学校近一点的")).toBeLessThan(at("紅磡附近都幾方便呀。"));

  // 既有聊天记录未被改动
  await expect(
    phone.locator(".skin-bubble", { hasText: "只是覺得當面說會比較好。" }),
  ).toHaveCount(1);
});

test("重复打开结果页不会再次解锁消息，刷新后状态保留", async ({ page }) => {
  test.setTimeout(180000);
  const phone = await loadTemplatePlayer(page);
  await openMaps(phone);
  await openRecent(phone, "紅磡附近餐廳");
  await expect(phone.locator(".maps-result-title")).toHaveText("紅磡附近餐廳");

  await openNoticeCenter(phone);
  const notices = await phone.locator(".device-notice").count();
  expect(notices).toBeGreaterThan(0);
  await closeNoticeCenter(phone);

  // 再次打开同一结果页 → 不重复解锁、不再产生新通知
  await backToSearch(phone);
  await openRecent(phone, "紅磡附近餐廳");
  await openNoticeCenter(phone);
  await expect(phone.locator(".device-notice")).toHaveCount(notices);
  await closeNoticeCenter(phone);

  // 刷新手机 → 从本地存档恢复，事件状态与已解锁消息都保留
  await page.reload();
  await unlockPhone(phone);
  await openMaps(phone);
  await openRecent(phone, "紅磡附近餐廳");
  await expect(phone.locator(".maps-result-title")).toHaveText("紅磡附近餐廳");
  await openNoticeCenter(phone);
  await expect(phone.locator(".device-notice")).toHaveCount(notices);
  await closeNoticeCenter(phone);

  await openApp(phone, WHATSAPP);
  await phone.locator(".wa-chat-row", { hasText: LINGLING }).first().click();
  await playMapPack(page, phone);
  await expect(
    phone.locator(".skin-bubble", { hasText: "紅磡附近都幾方便呀。" }),
  ).toHaveCount(1, { timeout: 60000 });
  const bubbles = await phone.locator(".skin-bubble").allTextContents();
  expect(bubbles.filter((b) => b.includes("你有冇特別想食咩？")).length).toBe(1);
  expect(bubbles.filter((b) => b.includes("紅磡附近都幾方便呀。")).length).toBe(1);
});
