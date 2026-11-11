import { test, expect, type Locator, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { compileStory } from "../src/story-engine/compiler";

/**
 * WhatsApp 三组聊天固定数据导入验收。
 * 验收断言独立于 scripts/import-wa-chats.mjs 的解析器：这里直接重新解析
 * data/wa-chats/ 下的用户原文副本，再与编译产物逐条比对，避免「自己验证自己」。
 */
type SrcMsg = { who: string; body: string; lineNo: number };
type Section = { date: string; start: number; end: number; msgs: SrcMsg[] };

const DATE_RE =
  /^\s*(\d{4}-\d{2}-\d{2})\s*[｜|\s]\s*(\d{1,2})[:：](\d{2})\s*[—\-–~～]\s*(\d{1,2})[:：](\d{2})/;
const MSG_RE = /^\*\*(.+?)：\*\*( ?)(.*)$/;

function parseSource(file: string): Section[] {
  const lines = readFileSync(file, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/);
  const sections: Section[] = [];
  let cur: Section | null = null;
  lines.forEach((line, i) => {
    const d = line.match(DATE_RE);
    if (d) {
      cur = {
        date: d[1],
        start: Number(d[2]) * 60 + Number(d[3]),
        end: Number(d[4]) * 60 + Number(d[5]),
        msgs: [],
      };
      sections.push(cur);
      return;
    }
    const m = line.match(MSG_RE);
    if (m && cur) cur.msgs.push({ who: m[1], body: m[3], lineNo: i + 1 });
  });
  return sections;
}

const SOURCES = [
  {
    key: "mom",
    title: "妈妈",
    chatId: "wa-mother",
    file: "data/wa-chats/mom.txt",
    prefix: "mom",
    sourceId: "mom",
    group: false,
    count: 65,
    senders: { 妈妈: "mother", Angel: "owner" },
    visibleSenders: ["妈妈", "我"],
  },
  {
    key: "lc",
    title: "Late Checkout 🎸",
    chatId: "wa-late-checkout",
    file: "data/wa-chats/late-checkout.txt",
    prefix: "lc",
    sourceId: "group_late_checkout",
    group: true,
    count: 86,
    senders: {
      鼓手: "drummer_a",
      键盘手: "keyboard_c",
      鄺學姐: "lingling",
      Angel: "owner",
    },
    visibleSenders: ["鼓手", "键盘手", "鄺學姐", "我"],
  },
  {
    key: "design",
    title: "DESIGN STUDIO 25/26",
    chatId: "wa-design",
    file: "data/wa-chats/design-studio.txt",
    prefix: "design",
    sourceId: "group_design_studio_2526",
    group: true,
    count: 47,
    senders: {
      Chloe: "design_chloe",
      Ethan: "design_ethan",
      Mimi: "mimi_friend",
      Jason: "design_jason",
      Ava: "design_ava",
      Angel: "owner",
    },
    visibleSenders: ["Chloe", "Ethan", "Mimi", "Jason", "Ava", "我"],
  },
] as const;

let cachedWork: any = null;
let cachedRaw: any = null;
function story() {
  if (!cachedRaw) cachedRaw = JSON.parse(readFileSync("stories/template/story.json", "utf8"));
  if (!cachedWork) cachedWork = compileStory(cachedRaw).work;
  return { raw: cachedRaw, work: cachedWork };
}
const itemsOf = (title: string) =>
  story().work.data.whatsapp.filter((i: any) => i.title === title);
/**
 * WA_LC_001 的 9 条 hidden 事件消息沿用 Late Checkout 🎸 会话，但它们是触发后
 * 才投递的实时消息包，不是本文件验收的「静态导入历史聊天」。按稳定 ID 前缀分离，
 * 使 198 条原文的逐字 / 顺序 / 时间断言仍覆盖全部静态历史而不被稀释。
 */
const LC_EVENT_PREFIX = "msg_lc001_";
const staticItemsOf = (title: string) =>
  itemsOf(title).filter(
    (i: any) => !String(i.id).startsWith(LC_EVENT_PREFIX),
  );
const chatOf = (id: string) => story().raw.chats.find((c: any) => c.id === id);
const allSourceMsgs = (s: (typeof SOURCES)[number]) =>
  parseSource(s.file).flatMap((x) => x.msgs);

async function loadPhone(page: Page): Promise<Locator> {
  const raw = JSON.parse(readFileSync("stories/template/story.json", "utf8"));
  const { work } = compileStory(raw);
  await page.route("**/work.json", (route) => route.fulfill({ json: work }));
  await page.goto("/");
  const phone = page.locator(".phone-shell");
  await phone.getByRole("button", { name: "轻触解锁" }).click();
  for (const d of String(raw.phone?.passcode ?? ""))
    await phone.getByRole("button", { name: "密码键" + d }).click();
  await expect(phone.getByRole("button", { name: "搜索", exact: true })).toBeVisible({
    timeout: 10000,
  });
  return phone;
}
async function openWhatsApp(phone: Locator) {
  await phone.getByRole("button", { name: "返回桌面", exact: true }).click();
  await phone.getByRole("button", { name: "打开WhatsApp", exact: true }).click();
  await expect(phone.locator(".wa-chat-row").first()).toBeVisible({ timeout: 10000 });
}
async function openThread(phone: Locator, title: string) {
  await phone.locator(".wa-chat-row", { hasText: title }).first().click();
}
async function backToList(phone: Locator) {
  await phone.getByRole("button", { name: "返回聊天列表" }).click();
}
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
      r.onerror = () => rej(req.error);
    });
    db.close();
    return all[0]?.state ?? {};
  });
}
/** 只比较剧情相关字段，排除已读标记等纯 UI 状态。 */
function storyFingerprint(s: any) {
  return JSON.stringify({
    playback: s.playback ?? {},
    completed: s.completed ?? [],
    unlocked: s.unlocked ?? [],
    hidden: s.hidden ?? [],
    notifications: s.notifications ?? [],
    variables: s.variables ?? {},
    endings: s.endings ?? [],
  });
}

test("验收1｜妈妈聊天 65 条全部导入，界面可见且顺序一致", async ({ page }) => {
  test.setTimeout(120000);
  const s = SOURCES[0];
  const items = staticItemsOf(s.title);
  const src = allSourceMsgs(s);
  expect(items).toHaveLength(65);
  expect(items.map((i: any) => i.body)).toEqual(src.map((m) => m.body));
  expect(items[0].body).toBe("这周学校还忙吗？");
  expect(items.at(-1).body).toBe("妈妈也想你 ❤️");
  expect(items.filter((i: any) => i.outgoing)).toHaveLength(
    src.filter((m) => m.who === "Angel").length,
  );

  const phone = await loadPhone(page);
  await openWhatsApp(phone);
  await openThread(phone, s.title);
  await expect(phone.locator(".skin-bubble")).toHaveCount(65, { timeout: 15000 });
  const bubbles = await phone.locator(".skin-bubble").allTextContents();
  expect(bubbles[0]).toContain("这周学校还忙吗？");
  expect(bubbles.at(-1)).toContain("妈妈也想你 ❤️");
});

test("验收3｜乐队群聊 86 条全部导入，成员名称与联系人 ID 正确", async ({ page }) => {
  test.setTimeout(120000);
  const s = SOURCES[1];
  const items = staticItemsOf(s.title);
  const src = allSourceMsgs(s);
  expect(items).toHaveLength(86);
  expect(items.map((i: any) => i.body)).toEqual(src.map((m) => m.body));
  expect([...new Set(items.map((i: any) => i.sender))].sort()).toEqual(
    [...s.visibleSenders].sort(),
  );
  expect(items.every((i: any) => i.folder === "群组")).toBe(true);
  // 源文件发言人 → story.json 的 senderId 映射，逐条核对。
  const chat = chatOf(s.chatId);
  const history = chat.messages.filter(
    (m: any) => !String(m.id).startsWith(LC_EVENT_PREFIX),
  );
  expect(history).toHaveLength(86);
  src.forEach((m, i) => {
    expect(history[i].senderId).toBe((s.senders as Record<string, string>)[m.who]);
  });
  // 86 条静态历史之后追加的是 9 条 hidden 实时事件消息，顺序固定且不会提前显示。
  const pack = chat.messages.filter((m: any) =>
    String(m.id).startsWith(LC_EVENT_PREFIX),
  );
  expect(pack).toHaveLength(9);
  expect(chat.messages.slice(0, 86)).toEqual(history.slice(0, 86));
  expect(chat.messages.slice(86)).toEqual(pack);
  // 鄺學姐复用现有 lingling，头像与私人聊天一致；鼓手/键盘手头像默认。
  const senior = items.filter((i: any) => i.sender === "鄺學姐");
  const seniorPrivate = itemsOf("邝学姐 💙").find((i: any) => i.sender === "鄺學姐");
  expect(senior).toHaveLength(24);
  expect(senior.every((i: any) => i.avatar && i.avatar === seniorPrivate?.avatar)).toBe(true);
  expect(
    items.filter((i: any) => ["鼓手", "键盘手"].includes(i.sender)).every((i: any) => !i.avatar),
  ).toBe(true);

  const phone = await loadPhone(page);
  await openWhatsApp(phone);
  await openThread(phone, s.title);
  await expect(phone.locator(".skin-bubble")).toHaveCount(86, { timeout: 15000 });
});

test("验收4｜专业群聊 47 条全部导入，Mimi 复用现有 mimi_friend", async ({ page }) => {
  test.setTimeout(120000);
  const s = SOURCES[2];
  const items = staticItemsOf(s.title);
  const src = allSourceMsgs(s);
  expect(items).toHaveLength(47);
  expect(items.map((i: any) => i.body)).toEqual(src.map((m) => m.body));
  expect([...new Set(items.map((i: any) => i.sender))].sort()).toEqual(
    [...s.visibleSenders].sort(),
  );
  const raw = story().raw;
  const mimiContacts = raw.contacts.filter((c: any) => c.id === "mimi_friend");
  expect(mimiContacts, "不得创建重复 Mimi 联系人").toHaveLength(1);
  expect(
    raw.contacts.filter((c: any) => /mimi/i.test(c.id) && c.id !== "mimi_friend"),
  ).toHaveLength(0);
  const chat = chatOf(s.chatId);
  expect(chat.title).toBe("DESIGN STUDIO 25/26");
  expect(chat.participants).toEqual([
    "owner",
    "mimi_friend",
    "design_chloe",
    "design_ethan",
    "design_jason",
    "design_ava",
  ]);
  const mimiMsgs = items.filter((i: any) => i.sender === "Mimi");
  expect(mimiMsgs).toHaveLength(12);
  expect(
    chat.messages.filter((m: any) => m.sender === "Mimi").every((m: any) => m.senderId === "mimi_friend"),
  ).toBe(true);
  const privateMimi = itemsOf("Mimi 🧋").find((i: any) => i.sender === "Mimi");
  expect(mimiMsgs.every((i: any) => i.avatar && i.avatar === privateMimi?.avatar)).toBe(true);

  const phone = await loadPhone(page);
  await openWhatsApp(phone);
  await openThread(phone, s.title);
  await expect(phone.locator(".skin-bubble")).toHaveCount(47, { timeout: 15000 });
});

test("验收5｜三组消息时间顺序正确，日期与原文段落范围一致", () => {
  for (const s of SOURCES) {
    const sections = parseSource(s.file);
    const items = staticItemsOf(s.title);
    expect(items).toHaveLength(s.count);
    expect(items.every((i: any, n: number) => n === 0 || items[n - 1].time <= i.time)).toBe(true);
    let offset = 0;
    for (const section of sections) {
      const slice = items.slice(offset, offset + section.msgs.length);
      offset += section.msgs.length;
      expect(slice).toHaveLength(section.msgs.length);
      for (const item of slice) {
        expect(item.time.slice(0, 10)).toBe(section.date);
        const [h, m] = item.time.slice(-5).split(":").map(Number);
        const minute = h * 60 + m;
        expect(minute).toBeGreaterThanOrEqual(section.start);
        expect(minute).toBeLessThanOrEqual(section.end);
      }
      if (slice.length > 1) {
        expect(slice[0].time.slice(-5)).toBe(
          `${String(Math.floor(section.start / 60)).padStart(2, "0")}:${String(section.start % 60).padStart(2, "0")}`,
        );
        expect(slice.at(-1).time.slice(-5)).toBe(
          `${String(Math.floor(section.end / 60)).padStart(2, "0")}:${String(section.end % 60).padStart(2, "0")}`,
        );
      }
    }
    expect(offset).toBe(s.count);
  }
});

test("验收6｜198 条原文逐字未改，无「机主」字样，messageId 独立稳定", () => {
  let total = 0;
  const ids = new Set<string>();
  for (const s of SOURCES) {
    const items = staticItemsOf(s.title);
    const src = allSourceMsgs(s);
    expect(items).toHaveLength(src.length);
    src.forEach((m, i) => {
      // 逐字比对，包括原文里的前导 / 尾随空格。
      expect(items[i].body, `${s.key} 第 ${m.lineNo} 行`).toBe(m.body);
      expect(items[i].sender, `${s.key} 第 ${m.lineNo} 行发言人`).toBe(
        m.who === "Angel" ? "我" : m.who,
      );
      expect(items[i].id).toMatch(new RegExp(`^${s.prefix}_\\d{4}-\\d{2}-\\d{2}_\\d{2}$`));
      expect(items[i].meta?.sourceId).toBe(s.sourceId);
      expect(ids.has(items[i].id)).toBe(false);
      ids.add(items[i].id);
      expect(items[i].body).not.toContain("机主");
    });
    total += src.length;
    expect(items.filter((i: any) => i.hidden || i.unlock || i.meta?.typing)).toHaveLength(0);
  }
  expect(total).toBe(198);
  expect(ids.size).toBe(198);
  // 原文里 3 条带前导 / 尾随空格的消息，导入后必须原样保留。
  const spaced = SOURCES.flatMap((s) => allSourceMsgs(s)).filter((m) => m.body !== m.body.trim());
  expect(spaced).toHaveLength(3);
  const allBodies = SOURCES.flatMap((s) => staticItemsOf(s.title).map((i: any) => i.body));
  for (const m of spaced) expect(allBodies).toContain(m.body);
});

test("验收7｜重复打开与刷新不重复生成历史消息", async ({ page }) => {
  test.setTimeout(180000);
  const phone = await loadPhone(page);
  await openWhatsApp(phone);
  for (const s of SOURCES) {
    await openThread(phone, s.title);
    await expect(phone.locator(".skin-bubble")).toHaveCount(s.count, { timeout: 15000 });
    await backToList(phone);
    await openThread(phone, s.title);
    await expect(phone.locator(".skin-bubble")).toHaveCount(s.count, { timeout: 15000 });
    await backToList(phone);
  }
  await page.reload();
  await expect(phone.locator(".lock-screen")).toBeVisible({ timeout: 10000 });
  await phone.getByRole("button", { name: "轻触解锁" }).click();
  for (const d of String(story().raw.phone?.passcode ?? ""))
    await phone.getByRole("button", { name: "密码键" + d }).click();
  await openWhatsApp(phone);
  for (const s of SOURCES) {
    await openThread(phone, s.title);
    await expect(phone.locator(".skin-bubble")).toHaveCount(s.count, { timeout: 15000 });
    await backToList(phone);
  }
});

/**
 * 群组聊天补充验收：v1.3 要求两个群使用用户指定的专属头像、明确标为「群组」，
 * 并在每条对方回复上显示成员名字；私聊与 MIMI-001 实时剧情气泡不受影响。
 */
const GROUPS = [
  {
    title: "Late Checkout 🎸",
    chatId: "wa-late-checkout",
    asset: "/wa-media/avatar-late-checkout.jpg",
  },
  {
    title: "DESIGN STUDIO 25/26",
    chatId: "wa-design",
    asset: "/wa-media/avatar-design-studio.jpg",
  },
] as const;

test("补充1｜两个群聊使用用户指定专属头像，列表与会话顶部一致", async ({ page }) => {
  test.setTimeout(150000);
  for (const g of GROUPS) {
    const chat = chatOf(g.chatId);
    expect(chat.kind, `${g.title} 必须显式标记为群组聊天`).toBe("group");
    expect(chat.groupAvatar).toBe(g.asset);
    const items = itemsOf(g.title);
    expect(items.every((i: any) => i.meta?.conversationKind === "group")).toBe(true);
    expect(items.every((i: any) => i.meta?.groupAvatar === g.asset)).toBe(true);
    // 头像必须是项目内的本地静态图，且体积足够小，不把 work.json 撑过 PWA 上限。
    const buf = readFileSync("public" + g.asset);
    expect(buf[0]).toBe(0xff);
    expect(buf[1]).toBe(0xd8);
    expect(buf.length).toBeLessThan(20000);
  }

  const phone = await loadPhone(page);
  await openWhatsApp(phone);
  for (const g of GROUPS) {
    const row = phone.locator(".wa-chat-row", { hasText: g.title }).first();
    const img = row.locator(".wa-chat-avatar img");
    // 数据值仍是 /wa-media/...；渲染层为兼容 GitHub Pages 子路径转成 ./ 相对路径。
    await expect(img, `${g.title} 列表头像`).toHaveAttribute(
      "src",
      `./${g.asset.slice(1)}`,
    );
    await expect
      .poll(() => img.evaluate((el: any) => el.naturalWidth))
      .toBeGreaterThan(0);
    await openThread(phone, g.title);
    await expect(phone.locator(".wa-thread-profile img")).toHaveAttribute(
      "src",
      `./${g.asset.slice(1)}`,
    );
    await expect(phone.locator(".wa-thread-profile small")).toHaveText("群组");
    await backToList(phone);
  }
  // 私聊不能误标为群组，也不能套用群头像。
  await openThread(phone, "妈妈");
  await expect(phone.locator(".wa-thread-profile small")).toHaveText("联系人");
  await expect(
    phone.locator(".wa-thread-profile img[src^='/wa-media/']"),
  ).toHaveCount(0);
  await backToList(phone);
  // 两个群聊都归在既有的「群组」筛选里，私聊不会混进来。
  await phone.locator(".wa-filters button", { hasText: "群组" }).click();
  await expect(phone.locator(".wa-chat-row")).toHaveCount(2);
  for (const g of GROUPS)
    await expect(
      phone.locator(".wa-chat-row", { hasText: g.title }),
    ).toHaveCount(1);
  await phone.locator(".wa-filters button", { hasText: "全部" }).click();
});

/**
 * WA_LC_001 之后，乐队群聊的 9 条事件消息在触发后同样显示成员名字
 * （见 tests/wa-lc001.spec.ts 验收9+10）。本用例使用全新存档，事件包仍为 hidden，
 * 所以只校验静态历史气泡数量，并据此确认新消息不会在触发前提前出现。
 */
test("补充2｜群聊对方气泡显示成员名字，私聊不显示", async ({ page }) => {
  test.setTimeout(180000);
  const phone = await loadPhone(page);
  await openWhatsApp(phone);
  for (const s of [SOURCES[1], SOURCES[2]]) {
    const incoming = staticItemsOf(s.title).filter((i: any) => !i.outgoing);
    await openThread(phone, s.title);
    await expect(phone.locator(".skin-bubble")).toHaveCount(s.count, { timeout: 15000 });
    const labels = phone.locator(".wa-group-sender");
    await expect(labels, `${s.title} 每条对方消息都要显示发言人`).toHaveCount(
      incoming.length,
    );
    expect(await labels.allTextContents()).toEqual(incoming.map((i: any) => i.sender));
    await backToList(phone);
  }
  for (const title of ["妈妈", "Mimi 🧋"]) {
    await openThread(phone, title);
    await expect(phone.locator(".wa-group-sender"), `${title} 为私聊`).toHaveCount(0);
    await backToList(phone);
  }
});

test("补充3｜MIMI-001 属实时剧情对话，静态历史清单冻结且不预置未来日期", () => {
  const { raw } = story();
  const today = raw.phone.date;
  expect(today).toBe("2026-11-08");
  expect(SOURCES, "静态历史源文件集合已冻结，新增聊天须沿现实时间线触发").toHaveLength(3);

  // MIMI-001 的 14 条对白由 variable 事件触发、逐条 unlock，紧跟当前日期发生，
  // 属于「实时剧情对话」，不是可静态导入的历史聊天内容。
  const ep = (chatOf("wa-mimi")?.messages ?? []).filter((m: any) =>
    String(m.id).startsWith("msg_mimi001_"),
  );
  expect(ep).toHaveLength(14);
  expect(ep.every((m: any) => m.hidden)).toBe(true);
  expect(ep.every((m: any) => m.time.slice(0, 10) === "2026-11-07")).toBe(true);
  const node = raw.events.find((e: any) => e.id === "MIMI-001");
  expect(node).toBeTruthy();
  expect(node.event).toBe("variable");
  expect(node.once).toBe(true);
  const unlockKeys = (node.actions ?? [])
    .filter((a: any) => a.type === "unlock")
    .map((a: any) => a.key);
  expect(unlockKeys).toHaveLength(14);
  expect(new Set(unlockKeys)).toEqual(new Set(ep.map((m: any) => m.id)));

  const staticIds = new Set(
    SOURCES.flatMap((s) => staticItemsOf(s.title).map((i: any) => i.id)),
  );
  expect(ep.every((m: any) => !staticIds.has(m.id))).toBe(true);
  // 三组静态历史全部严格早于当前日期，且不携带任何剧情触发标记。
  for (const s of SOURCES) {
    const items = staticItemsOf(s.title);
    expect(items.every((i: any) => i.time.slice(0, 10) < today)).toBe(true);
    expect(
      items.every((i: any) => !i.hidden && !i.unlock && !i.meta?.typing),
    ).toBe(true);
  }
  // WA_LC_001 的 9 条群聊新消息属于实时事件包：只保留 @now 占位，不预置故事日期，
  // 真实本地时间在触发时才生成并持久化（见 tests/wa-lc001.spec.ts 验收9+10、11、14）。
  const lcPack = itemsOf("Late Checkout 🎸").filter((i: any) => i.hidden);
  expect(lcPack).toHaveLength(9);
  expect(lcPack.every((i: any) => String(i.id).startsWith(LC_EVENT_PREFIX))).toBe(
    true,
  );
  expect(lcPack.every((i: any) => i.time === "@now")).toBe(true);
  expect(lcPack.every((i: any) => !i.unlock)).toBe(true);
});

test("验收8｜浏览静态历史不触发通知或剧情事件，其他聊天保持不变", async ({ page }) => {
  test.setTimeout(180000);
  const { raw, work } = story();
  // WA_LC_001 新增 1 个 home 事件节点，WA_LC_002 再新增 1 个最终私聊节点，
  // 电话模块再新增 1 个 variable 节点（第一次拨打学姐挂断后的两条 WhatsApp 消息）；
  // 三组静态历史本身仍不是 hidden / unlock，也不进任何消息包。乐队群聊末尾另有
  // 9 条 hidden 实时事件消息，学姐私聊末尾另有 46 条 WA_LC_002 hidden 消息 +
  // 2 条电话事件 hidden 消息 + 4 条 WA_DOUYIN_001 hidden 消息，
  // WA_DOUYIN_001 另新增 1 个 variable 节点；都与静态历史隔离，单独校验。
  expect(raw.events).toHaveLength(14);
  expect(work.nodes).toHaveLength(14);
  for (const s of SOURCES) {
    const items = staticItemsOf(s.title);
    expect(items.filter((i: any) => i.hidden || i.unlock)).toHaveLength(0);
    expect(items.filter((i: any) => i.meta?.typing)).toHaveLength(0);
  }
  const pack = itemsOf("Late Checkout 🎸").filter((i: any) => i.hidden);
  expect(pack).toHaveLength(9);
  expect(pack.every((i: any) => String(i.id).startsWith(LC_EVENT_PREFIX))).toBe(
    true,
  );
  expect(itemsOf("妈妈").filter((i: any) => i.hidden)).toHaveLength(0);
  expect(
    itemsOf("DESIGN STUDIO 25/26").filter((i: any) => i.hidden),
  ).toHaveLength(0);
  // 既有聊天与原有主线事件的消息包没有被改动；学姐私聊在末尾追加了
  // WA_LC_002 的 46 条 hidden 最终对话 + 电话模块的 2 条 + 音乐模块的 5 条 +
  // WA_DOUYIN_001 的 4 条 hidden 事件消息（都不在三组静态历史源文件内）。
  expect(itemsOf("邝学姐 💙")).toHaveLength(376);
  const phonePack = itemsOf("邝学姐 💙").filter((i: any) =>
    String(i.id).startsWith("msg_phone_lc1_"),
  );
  expect(phonePack).toHaveLength(2);
  expect(phonePack.every((i: any) => i.hidden === true)).toBe(true);
  const musicPack = itemsOf("邝学姐 💙").filter((i: any) =>
    String(i.id).startsWith("msg_music_001_"),
  );
  expect(musicPack).toHaveLength(5);
  expect(musicPack.every((i: any) => i.hidden === true)).toBe(true);
  const douyinPack = itemsOf("邝学姐 💙").filter((i: any) =>
    String(i.id).startsWith("msg_wa_douyin_001_"),
  );
  expect(douyinPack).toHaveLength(4);
  expect(douyinPack.every((i: any) => i.hidden === true)).toBe(true);
  expect(itemsOf("Mimi 🧋")).toHaveLength(185);
  expect(raw.events.map((e: any) => e.id)).toEqual([
    "start-lock-notice",
    "WA_EP00_COMPLETE",
    "BR-001-RESTAURANT-SEARCH",
    "MAP-001",
    "IG-001",
    "TEST-BR001-ENDING",
    "TEST-MAP001-ENDING",
    "WA_EP00_DIALOGUE_COMPLETE",
    "MIMI-001",
    "WA_LC_001",
    "WA_LC_002",
    "PHONE_LC_001",
    "WA_MUSIC_001",
    "WA_DOUYIN_001",
  ]);
  // 变量节点都仍有明确 target，新导入的静态历史消息没有绑定任何触发条件。
  const variableNodes = work.nodes.filter((n: any) => n.event === "variable");
  expect(variableNodes).toHaveLength(6);
  expect(variableNodes.every((n: any) => !!n.target)).toBe(true);

  const phone = await loadPhone(page);
  await openWhatsApp(phone);
  const before = storyFingerprint(await readState(page));
  for (const s of SOURCES) {
    const row = phone.locator(".wa-chat-row", { hasText: s.title }).first();
    await expect(row.locator(".wa-unread"), `${s.title} 不应显示未读角标`).toHaveCount(0);
    await openThread(phone, s.title);
    await expect(phone.locator(".skin-bubble")).toHaveCount(s.count, { timeout: 15000 });
    await backToList(phone);
  }
  const after = storyFingerprint(await readState(page));
  expect(after, "浏览三组历史聊天不得改变剧情状态或通知").toBe(before);
  // 桌面 WhatsApp 图标不出现新消息角标。
  await phone.getByRole("button", { name: "返回桌面", exact: true }).click();
  await expect(
    phone.locator(".app-icon-wrap", { hasText: "WhatsApp" }).locator(".app-badge"),
  ).toHaveCount(0);
});
