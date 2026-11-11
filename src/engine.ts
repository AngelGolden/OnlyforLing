import type { Action, Condition, Runtime, StoryNode, Work } from "./schema";
import { makeItem } from "./schema";
import { registry } from "./registry";
/** 聊天类 App：只有它们的"解锁内容"才被视为事件消息包。 */
const MESSAGING_APPS = new Set(
  registry.filter((r) => r.engine === "messaging").map((r) => r.id),
);
/** 是不是一条会话消息（聊天 App 里的消息条目）。 */
function isChatMessage(w: Work, id: string): boolean {
  for (const [appId, items] of Object.entries(w.data)) {
    if (!MESSAGING_APPS.has(appId)) continue;
    const item = items.find((i) => i.id === id);
    if (item) return !!item.meta?.conversationId;
  }
  return false;
}
export function testCondition(c: Condition, s: Runtime): boolean {
  const [scope, ...rest] = c.key.split(":");
  const key = rest.join(":");
  const lists: Record<string, string[]> = {
    visited: s.visited,
    read: s.read,
    clue: s.clues,
    unlocked: s.unlocked,
    completed: s.completed,
  };
  const actual =
    scope === "ui"
      ? s.ui?.[rest[0]]?.[rest.slice(1).join(":")]
      : // "playback:<事件ID>" 读消息包的完成态，用于判断某个剧情对话是否已完整结束。
        scope === "playback"
        ? s.playback?.[key]?.playbackStatus
        : lists[scope]
          ? lists[scope].includes(key)
          : s.variables[c.key];
  switch (c.op) {
    case "eq":
      return actual === c.value;
    case "neq":
      return actual !== c.value;
    case "gt":
      return typeof actual === "number" && actual > Number(c.value);
    case "lt":
      return typeof actual === "number" && actual < Number(c.value);
    case "includes":
      return String(actual ?? "").includes(String(c.value));
  }
}
/** 找到内容条目所属的 App。 */
function findItemApp(w: Work, id: string): string {
  for (const [appId, items] of Object.entries(w.data))
    if (items.some((i) => i.id === id)) return appId;
  return "";
}
/**
 * 事件"入队"：事件触发后，把它要送达的聊天消息登记成一个待播放消息包。
 * 这里只登记（queued/pending），不播放；播放由玩家打开对应会话时进行。
 * 每个事件一个独立的包，互不影响。
 */
function enqueueEventPack(
  w: Work,
  s: Runtime,
  nodeId: string,
  actions: Action[],
) {
  const ids: string[] = [];
  for (const a of actions) {
    if (a.type !== "unlock") continue;
    // 只有"会话消息"才构成事件消息包（解锁照片、备忘录等不算）。
    if (!isChatMessage(w, a.key)) continue;
    if (!ids.includes(a.key)) ids.push(a.key);
  }
  if (!ids.length) return;
  s.playback ??= {};
  const existing = s.playback[nodeId];
  if (existing) {
    // 同一个事件重复触发：只补齐缺失的消息，不重置播放进度。
    for (const id of ids)
      if (!existing.messageIds.includes(id)) existing.messageIds.push(id);
    return;
  }
  const appId = findItemApp(w, ids[0]);
  const thread =
    w.data[appId]?.find((i) => i.id === ids[0])?.title ?? "";
  s.playback[nodeId] = {
    eventId: nodeId,
    playbackStatus: "pending",
    nextMessageIndex: 0,
    deliveredMessageIds: [],
    messageIds: ids,
    appId,
    thread,
    order: Object.keys(s.playback).length,
  };
}
/**
 * 通知与来电是「一次投递」的副作用：用「事件节点 ID + action 下标」做持久化幂等键。
 * 没有 once 的节点（例如开屏的 start-lock-notice）在重复 dispatch 或刷新后
 * 就不会重复 push 通知；玩家主动 dismiss 通知也不会让事件重新投递。
 * 键存在 Runtime 上随存档保存，旧存档缺字段时 ??= [] 兼容迁移。
 */
function deliverNotice(
  s: Runtime,
  nodeId: string,
  actionIndex: number,
  notice: string,
) {
  s.deliveredNotices ??= [];
  const key = `${nodeId}:${actionIndex}`;
  if (s.deliveredNotices.includes(key)) return false;
  // 兼容旧存档：新增字段缺失时，通知文案还在 notifications 里就说明此前投递过。
  // 补写幂等键但不重复 push，迁移后刷新 / dismiss 也不会再次投递。
  if (s.notifications.includes(notice)) {
    s.deliveredNotices.push(key);
    return false;
  }
  s.deliveredNotices.push(key);
  return true;
}
function apply(
  a: Action,
  s: Runtime,
  w: Work,
  nodeId = "",
  actionIndex = -1,
) {
  const noticeAllowed = (notice: string) =>
    !nodeId || deliverNotice(s, nodeId, actionIndex, notice);
  switch (a.type) {
    case "date":
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(a.value))) s.date = String(a.value);
      break;
    case "variable":
      s.variables[a.key] = a.value;
      break;
    case "unlock":
      if (!s.unlocked.includes(a.key)) s.unlocked.push(a.key);
      break;
    case "hide":
      if (!s.hidden.includes(a.key)) s.hidden.push(a.key);
      break;
          case "notification":
            if (noticeAllowed(String(a.value)))
              s.notifications.push(String(a.value));
            break;
          case "call":
            if (!noticeAllowed(`${String(a.value)} 来电`)) break;
            s.notifications.push(`${String(a.value)} 来电`);
      s.incomingCall = {
        caller: String(a.value),
        target: a.key,
        status: "ringing",
      };
      break;
    case "clue":
      if (!s.clues.includes(a.key)) s.clues.push(a.key);
      break;
    case "time":
      s.time = String(a.value);
      s.clockRemainderMs = 0;
      break;
    case "ending":
      if (!s.endings.includes(String(a.value))) s.endings.push(String(a.value));
      break;
    case "choice":
      if (!s.choices.some((c) => c.target === a.key))
        s.choices.push({ label: String(a.value), target: a.key });
      break;
    case "message":
      s.messages[a.key] = [
        ...(s.messages[a.key] ?? []),
        makeItem({
          id: `event-${a.key}-${s.completed.length}-${s.messages[a.key]?.length ?? 0}`,
          title: "新消息",
          sender: w.phone.owner,
          body: String(a.value),
        }),
      ];
      break;
  }
}
function runQueue(
  w: Work,
  s: Runtime,
  event: string,
  target: string,
  queue: string[],
  resuming = new Set<string>(),
) {
  const seen = new Set<string>();
  let steps = 0;
  while (queue.length && steps++ < 200) {
    const id = queue.shift()!;
    const n = w.nodes.find((n) => n.id === id);
    if (!n || seen.has(id) || (n.once && s.completed.includes(id))) continue;
    seen.add(id);
    const conditions = n.conditions.map((c) => testCondition(c, s));
    const pass =
      n.logic === "or"
        ? conditions.some(Boolean)
        : n.logic === "not"
          ? !conditions.every(Boolean)
          : conditions.every(Boolean);
    if (!pass) continue;
    if (n.type === "delay" && !resuming.has(id)) {
      s.scheduled ??= [];
      if (!s.scheduled.some((t) => t.nodeId === id))
        s.scheduled.push({
          nodeId: id,
          due: (s.elapsedMs ?? 0) + (n.delayMs ?? 1000),
        });
      s.trace.push(`delay:${n.delayMs ?? 1000}ms → ${n.label}`);
      continue;
    }
    if (!s.completed.includes(id)) s.completed.push(id);
    s.trace.push(`${event}:${target} → ${n.label}`);
    // 事件触发的当下只做"入队"：登记待播放消息包，不写入聊天历史，也不播放。
    enqueueEventPack(w, s, n.id, n.actions);
    for (const [actionIndex, a] of n.actions.entries()) {
      const previous =
        a.type === "variable"
          ? s.variables[a.key]
          : a.type === "time"
            ? s.time
            : undefined;
      apply(a, s, w, id, actionIndex);
      if (a.type === "variable" && previous !== s.variables[a.key])
        queue.push(
          ...w.nodes
            .filter(
              (n) =>
                n.event === "variable" && (!n.target || n.target === a.key),
            )
            .map((n) => n.id),
        );
      if (a.type === "time" && previous !== s.time)
        queue.push(
          ...w.nodes
            .filter(
              (n) => n.event === "time" && (!n.target || n.target === s.time),
            )
            .map((n) => n.id),
        );
    }
    if (
      n.type === "ending" &&
      !n.actions.some((a) => a.type === "ending") &&
      !s.endings.includes(n.label)
    )
      s.endings.push(n.label);
    if (n.type === "choice") {
      for (const id of n.next)
        if (!s.choices.some((c) => c.target === id))
          s.choices.push({
            label: w.nodes.find((n) => n.id === id)?.label ?? id,
            target: id,
          });
    } else queue.push(...n.next);
  }
  s.trace = s.trace.slice(-100);
  return s;
}
export function dispatch(
  w: Work,
  previous: Runtime,
  event: string,
  target = "",
): Runtime {
  const s = structuredClone(previous);
  if (event === "choose") s.choices = [];
  if (event === "openApp" && !s.visited.includes(target))
    s.visited.push(target);
  if (event === "read" && !s.read.includes(target)) s.read.push(target);
  if (w.mode === "explore") return s;
  const queue = w.nodes
    .filter(
      (n) =>
        (n.type === "start" && event === "start") ||
        (n.event === event && (!n.target || n.target === target)),
    )
    .map((n) => n.id);
  return runQueue(w, s, event, target, queue);
}
export function advance(
  w: Work,
  previous: Runtime,
  milliseconds: number,
): Runtime {
  const s = structuredClone(previous);
  const delta = Number.isFinite(milliseconds)
    ? Math.max(0, Math.min(milliseconds, 86400000))
    : 0;
  const end = (s.elapsedMs ?? 0) + delta;
  s.elapsedMs ??= 0;
  s.clockRemainderMs ??= 0;
  s.scheduled ??= [];
  let resumes = 0;
  while (true) {
    s.scheduled.sort((a, b) => a.due - b.due);
    const due =
      w.mode !== "explore" && resumes < 200 ? s.scheduled[0] : undefined;
    const clockAt = s.elapsedMs + 60000 - s.clockRemainderMs;
    const next = Math.min(
      end,
      clockAt,
      due ? Math.max(s.elapsedMs, due.due) : Infinity,
    );
    s.clockRemainderMs += next - s.elapsedMs;
    s.elapsedMs = next;
    if (s.clockRemainderMs >= 60000) {
      s.clockRemainderMs -= 60000;
      const match = s.time.match(/^(\d{1,2}):(\d{2})$/);
      if (match) {
        const value = (Number(match[1]) * 60 + Number(match[2]) + 1) % 1440;
        s.time =
          String(Math.floor(value / 60)).padStart(2, "0") +
          ":" +
          String(value % 60).padStart(2, "0");
        if (w.mode !== "explore")
          runQueue(
            w,
            s,
            "time",
            s.time,
            w.nodes
              .filter(
                (n) => n.event === "time" && (!n.target || n.target === s.time),
              )
              .map((n) => n.id),
          );
      }
    }
    if (due && due.due <= s.elapsedMs) {
      s.scheduled.splice(s.scheduled.indexOf(due), 1);
      resumes++;
      runQueue(w, s, "timer", due.nodeId, [due.nodeId], new Set([due.nodeId]));
      continue;
    }
    if (s.elapsedMs >= end) break;
  }
  return s;
}
export function choose(w: Work, s: Runtime, id: string) {
  const node = w.nodes.find((n) => n.id === id);
  if (!node || !s.choices.some((c) => c.target === id)) return s;
  return dispatch(
    {
      ...w,
      nodes: w.nodes.map((n) =>
        n.id === id ? { ...n, event: "choose", target: id } : n,
      ),
    },
    s,
    "choose",
    id,
  );
}
export function validateGraph(nodes: StoryNode[]) {
  const errors: string[] = [];
  for (const n of nodes) {
    for (const id of n.next)
      if (!nodes.some((x) => x.id === id))
        errors.push(`${n.label} 引用了不存在的节点 ${id}`);
    if (n.next.includes(n.id))
      errors.push(`${n.label} 存在自环（运行时会阻止循环）`);
  }
  const reachable = new Set<string>();
  const visit = (id: string) => {
    if (reachable.has(id)) return;
    reachable.add(id);
    nodes.find((n) => n.id === id)?.next.forEach(visit);
  };
  nodes
    .filter((n) => n.type === "start" || n.event)
    .forEach((n) => visit(n.id));
  nodes
    .filter((n) => n.type !== "comment" && !reachable.has(n.id))
    .forEach((n) => errors.push(`${n.label} 不可达`));
  return errors;
}
export function visible(
  item: { id: string; hidden: boolean; unlock: string },
  s: Runtime,
) {
  return (
    !s.hidden.includes(item.id) &&
    (!item.hidden || s.unlocked.includes(item.id)) &&
    (!item.unlock ||
      testCondition({ key: item.unlock, op: "eq", value: true }, s))
  );
}
