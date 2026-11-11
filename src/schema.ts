import { z } from "zod";
export const uid = () => crypto.randomUUID();
export const itemSchema = z.object({
  id: z.string(),
  title: z.string().max(1000),
  body: z.string().max(200000),
  richText: z.string().max(400000).default(""),
  meta: z.record(z.string().max(60), z.string().max(2000)).default({}),
  time: z.string(),
  sender: z.string(),
  avatar: z.string().default(""),
  kind: z
    .enum([
      "text",
      "image",
      "audio",
      "video",
      "file",
      "transfer",
      "call",
      "order",
      "note",
      "post",
      "event",
    ])
    .default("text"),
  media: z.string().default(""),
  hidden: z.boolean().default(false),
  unlock: z.string().default(""),
  password: z.string().default(""),
  folder: z.string().default(""),
  favorite: z.boolean().default(false),
  outgoing: z.boolean().default(false),
  read: z.boolean().default(false),
  likes: z.number().default(0),
  comments: z.array(z.string()).default([]),
});
export type Item = z.infer<typeof itemSchema>;
export const conditionSchema = z.object({
  key: z.string(),
  op: z.enum(["eq", "neq", "gt", "lt", "includes"]),
  value: z.union([z.string(), z.number(), z.boolean()]),
});
export type Condition = z.infer<typeof conditionSchema>;
export const actionSchema = z.object({
  type: z.enum([
    "date",
    "variable",
    "unlock",
    "hide",
    "notification",
    "message",
    "time",
    "ending",
    "choice",
    "clue",
    "call",
  ]),
  key: z.string(),
  value: z.union([z.string(), z.number(), z.boolean()]),
});
export type Action = z.infer<typeof actionSchema>;
export const nodeSchema = z.object({
  delayMs: z.number().int().min(0).max(86400000).optional(),
  id: z.string(),
  label: z.string(),
  type: z.enum([
    "start",
    "event",
    "condition",
    "action",
    "choice",
    "delay",
    "ending",
    "comment",
  ]),
  event: z.string(),
  target: z.string(),
  conditions: z.array(conditionSchema),
  logic: z.enum(["and", "or", "not"]).default("and"),
  actions: z.array(actionSchema),
  next: z.array(z.string()),
  once: z.boolean(),
  x: z.number(),
  y: z.number(),
});
export type StoryNode = z.infer<typeof nodeSchema>;
export const workSchema = z.object({
  formatVersion: z.literal(1),
  id: z.string(),
  title: z.string().min(1).max(200),
  description: z.string().max(5000),
  category: z.string(),
  cover: z.string(),
  updatedAt: z.number(),
  phone: z.object({
    owner: z.string(),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    passcode: z.string().max(12),
    wallpaper: z.string(),
    theme: z.enum(["light", "dark"]),
    time: z.string(),
    battery: z.number().min(0).max(100),
    network: z.string(),
    notifications: z.boolean(),
    /** 设置页账户展示名；不改动 owner（聊天里机主仍显示第一人称「我」）。 */
    accountName: z.string().optional(),
    /** 机主头像，只允许 /owner-media/ 下的本地静态图片。 */
    accountAvatar: z.string().optional(),
    /** 设置 → 无线局域网里列出的公用 WiFi。 */
    publicWifi: z.string().optional(),
    /** 设置 → 蓝牙「我的设备」里已配对过的设备。 */
    bluetoothDevices: z.array(z.string()).optional(),
  }),
  apps: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        installed: z.boolean().default(true),
        visible: z.boolean(),
        dock: z.boolean(),
        folder: z.string(),
        icon: z.string(),
      }),
    )
    .max(100),
  data: z.record(z.string(), z.array(itemSchema).max(20000)),
  nodes: z.array(nodeSchema).max(2000),
  variables: z.record(
    z.string(),
    z.union([z.string(), z.number(), z.boolean()]),
  ),
  mode: z.enum(["explore", "story", "mixed"]),
});
export type Work = z.infer<typeof workSchema>;
export type UiValue = string | number | boolean | string[];
/**
 * 事件消息包的播放状态（持久化在 Runtime 中，随存档保存）。
 * eventId  → 触发该消息包的事件节点 id（如 MAP-001）
 * messageIds → 该事件按预设顺序要送达的消息 id
 * deliveredMessageIds → 已经播放并写入聊天历史的消息 id（幂等依据，messageId 唯一）
 * nextMessageIndex → 下一条待播放消息在 messageIds 中的下标（中断续播用）
 */
/**
 * pending：消息包已入队、还没打开会话播放
 * playing：正在按顺序展示对方消息（incoming → received）
 * awaiting_reply：游标停在当前账号的预设回复，等待系统逐字输入 + 玩家点击发送
 * completed：整个消息包已送达
 *
 * v1.2 的 typing / draft_ready 不另建持久化状态结构：复用 Runtime.ui 中按
 * messageId 保存的草稿进度（body / typed / done）与组件本地 replyPhase 表达。
 * 打字完成不等于 sent；sent 只体现为 deliveredMessageIds 新增该 messageId 一次。
 */
export type PlaybackStatus =
  | "pending"
  | "playing"
  | "awaiting_reply"
  | "completed";
export type EventPlayback = {
  eventId: string;
  playbackStatus: PlaybackStatus;
  nextMessageIndex: number;
  deliveredMessageIds: string[];
  messageIds: string[];
  appId: string;
  /** 会话标题（聊天列表里的会话名） */
  thread: string;
  /** 入队顺序（多个事件包并存时按此先后播放） */
  order: number;
};
export type Runtime = {
  date?: string;
  elapsedMs?: number;
  clockRemainderMs?: number;
  scheduled?: { nodeId: string; due: number }[];
  incomingCall?: {
    caller: string;
    target: string;
    status: "ringing" | "answered";
  } | null;
  ui?: Record<string, Record<string, UiValue>>;
  /**
   * 纯视图状态（页签 / 搜索词 / 选中项 / 滚动位置），按 App ID 分组。
   * 刻意与 ui 分开：ui: 条件作用域只读 Runtime.ui，视图状态不该参与剧情判定，
   * 也不改变既有「浏览不产生剧情状态」的回归断言。可选字段，旧存档缺省按 {} 迁移。
   */
  viewState?: Record<string, Record<string, UiValue>>;
  /** 各事件消息包的播放进度（持久化，随存档保存） */
  playback?: Record<string, EventPlayback>;
  /**
   * 新发生消息的真实本地时间戳：messageId → "YYYY-MM-DD HH:MM"。
   * 只在消息真正投递 / 玩家点击发送时生成一次，随存档持久化；
   * 刷新、重新进入 App 都不得重算，历史聊天的 time 字段不受影响。
   */
  messageTimes?: Record<string, string>;
  workId: string;
  revision: number;
  variables: Record<string, string | number | boolean>;
  visited: string[];
  read: string[];
  clues: string[];
  unlocked: string[];
  hidden: string[];
  completed: string[];
  notifications: string[];
  /**
   * 通知 / 来电的一次投递键（"节点ID:action下标"）。可选字段，旧存档没有时按空数组
   * 兼容迁移；用节点 ID 而不是通知文案做键，玩家 dismiss 通知后也不会重复投递。
   */
  deliveredNotices?: string[];
  endings: string[];
  choices: { label: string; target: string }[];
  messages: Record<string, Item[]>;
  time: string;
  trace: string[];
};
export function initialRuntime(w: Work): Runtime {
  return {
    date: w.phone.date,
    elapsedMs: 0,
    clockRemainderMs: 0,
    scheduled: [],
    incomingCall: null,
    ui: {},
    viewState: {},
    playback: {},
    messageTimes: {},
    workId: w.id,
    revision: w.updatedAt,
    variables: { ...w.variables },
    visited: [],
    read: [],
    clues: [],
    unlocked: [],
    hidden: [],
    completed: [],
    notifications: [],
    deliveredNotices: [],
    endings: [],
    choices: [],
    messages: {},
    time: w.phone.time,
    trace: [],
  };
}
export function makeItem(partial: Partial<Item> = {}): Item {
  return itemSchema.parse({
    id: uid(),
    title: "新内容",
    body: "在这里写下故事…",
    time: "2026-09-01 08:30",
    sender: "小林",
    ...partial,
  });
}
export function validateWork(input: unknown): Work {
  return workSchema.parse(input);
}
export function safeMedia(value: string) {
  return /^data:(image\/(png|jpeg|webp|gif)|audio\/(mpeg|mp3|wav|ogg|webm|mp4)|video\/(mp4|webm));base64,[a-zA-Z0-9+/=\s]+$/.test(
    value,
  )
    ? value
    : "";
}
