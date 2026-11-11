/**
 * 系统设置个性化数据导入（幂等）。
 *
 * 规格逐字副本：data/personalization/系统设置搭建指令.txt
 * 只写 stories/template/story.json 的：
 *   - phone.accountName / accountAvatar / publicWifi / bluetoothDevices
 *   - content.clock（闹钟 + 世界时钟）
 *   - content.calendar（1 条特别提醒）
 * 不碰 installedApps（用户澄清：手机自带的「音乐」未安装则跳过卸载）、
 * 不碰 chats / events / variables / 任何既有聊天记录。
 */
import {
  readFileSync,
  writeFileSync,
  copyFileSync,
  mkdirSync,
  existsSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const storyPath = path.join(root, "stories/template/story.json");
const specPath = path.join(root, "data/personalization/系统设置搭建指令.txt");

const spec = readFileSync(specPath, "utf8");
const original = spec.split("## 二、")[0];
const pick = (re, label) => {
  const m = original.match(re);
  if (!m) throw new Error(`规格里找不到「${label}」，请检查逐字副本`);
  return m[1].trim();
};

const calendarTitle = pick(/内容是：(.+?)。/, "日历提醒内容");
const accountName = pick(/名字改为(.+?)。/, "机主名字");
const publicWifi = pick(/公用WiFi：(.+?)。/, "公用 WiFi 名称");
const bluetoothDevice = pick(/设备名是：(.+?)。/, "蓝牙设备名");
const avatarSrc = pick(/头像素材本地路径：(.+)/, "头像素材路径");
const dateMatch = original.match(/(\d{4})年\.(\d{1,2})月(\d{1,2})日/);
if (!dateMatch) throw new Error("规格里找不到日历日期");
const specialDate = `${dateMatch[1]}-${dateMatch[2].padStart(2, "0")}-${dateMatch[3].padStart(2, "0")}`;
if (!original.includes("香港") || !original.includes("泰国"))
  throw new Error("规格里找不到世界时钟的两个地区");

const OWNER_AVATAR = "/owner-media/ig-owner.jpg";

/** 助手按机主人设拟定的闹钟（用户只要求「几个适合机主人设的闹钟」）。 */
const ALARMS = [
  { clock: "07:30", title: "Design Studio 早课", repeat: "周一至周五" },
  { clock: "09:30", title: "周末整理作品集", repeat: "周六、周日" },
  { clock: "12:45", title: "图书馆改草图", repeat: "周一至周五" },
  { clock: "18:30", title: "Late Checkout 练团", repeat: "周三、周五" },
  { clock: "23:00", title: "给妈妈打电话", repeat: "周日" },
];
/** 「香港」按规范显示为「中国香港」，与泰国同属世界时钟条目。 */
const WORLD_CLOCKS = [
  { city: "中国香港", zone: "GMT+8", offset: "与本地时间相同" },
  { city: "泰国", zone: "GMT+7", offset: "曼谷 · 比本地慢 1 小时" },
];

const before = readFileSync(storyPath, "utf8");
const next = JSON.parse(before);
const storyDate = next.phone.date;

// phone：先剔除本轮字段再按固定顺序追加，保证第二次运行完全一致。
const keptPhone = { ...next.phone };
for (const k of [
  "accountName",
  "accountAvatar",
  "publicWifi",
  "bluetoothDevices",
])
  delete keptPhone[k];
next.phone = {
  ...keptPhone,
  accountName,
  accountAvatar: OWNER_AVATAR,
  publicWifi,
  bluetoothDevices: [bluetoothDevice],
};

const clockItems = [
  ...ALARMS.map((a, n) => ({
    id: `clock_alarm_${String(n + 1).padStart(2, "0")}`,
    title: a.title,
    body: "",
    kind: "event",
    folder: "闹钟",
    time: `${storyDate} ${a.clock}`,
    meta: { clock: a.clock, repeat: a.repeat },
  })),
  ...WORLD_CLOCKS.map((w, n) => ({
    id: `clock_world_${String(n + 1).padStart(2, "0")}`,
    title: w.city,
    body: "",
    kind: "event",
    folder: "世界时钟",
    time: `${storyDate} 08:00`,
    meta: { city: w.city, zone: w.zone, offset: w.offset },
  })),
];
next.content.clock = clockItems;

const calendarBase = (next.content.calendar ?? []).filter(
  (i) => !String(i.id).startsWith("calendar_special_"),
);
next.content.calendar = [
  ...calendarBase,
  {
    id: `calendar_special_${specialDate.replace(/-/g, "")}`,
    title: calendarTitle,
    body: "",
    kind: "event",
    // 用户只给了日期没给时刻，取晚饭时间。
    time: `${specialDate} 19:00`,
    meta: { special: "true", note: "特别提醒" },
  },
];

const after = JSON.stringify(next, null, 2) + "\n";
const changed = before !== after;
if (changed) writeFileSync(storyPath, after);

// 头像：二进制原样复制，不转码、不改写；运行时只引用 /owner-media/ 白名单路径。
const avatarDir = path.join(root, "public/owner-media");
mkdirSync(avatarDir, { recursive: true });
const avatarDest = path.join(avatarDir, "ig-owner.jpg");
let copied = 0;
if (
  !existsSync(avatarDest) ||
  !readFileSync(avatarDest).equals(readFileSync(avatarSrc))
) {
  copyFileSync(avatarSrc, avatarDest);
  copied = 1;
}

console.log(
  `系统设置导入：${ALARMS.length} 个闹钟 | ${WORLD_CLOCKS.length} 个世界时钟 | ` +
    `日历特别提醒 1 条（${specialDate}） | 头像新复制 ${copied} 张 | ` +
    `installedApps ${next.installedApps.length}（未安装「音乐」，跳过卸载） | ` +
    (changed ? "已写入 story.json" : "幂等（无改动）"),
);
