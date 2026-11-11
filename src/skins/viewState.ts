import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import type { Props } from "./shared";

/**
 * 页面状态恢复的最小实现：复用「Skin 属性 → Phone.update → Runtime → IndexedDB」
 * 这一条既有持久化链路（与 useSkinState 同构），不新建导航系统，
 * 也不改 Phone.app / AppContent.thread 的全局语义。
 *
 * 纯视图状态放在 Runtime.viewState，而不是 Runtime.ui：ui: 条件作用域只读 ui，
 * 视图状态不该参与剧情判定；onView 也不经过 dispatch，滚动 / 搜索不会重入事件队列。
 * 两个键都写成 JSON 字符串（UiValue 只允许 string/number/boolean/string[]），
 * 随存档一起保存，离开 App、切换 App、刷新页面后回填。
 */
export const VIEW_STATE_KEY = "viewState";
export const SCROLL_STATE_KEY = "scrollState";

/** 内容 ID 辅助定位：优先用列表行自带的稳定 ID 属性，找不到才回退到像素。 */
const ANCHOR_ATTRS = [
  "data-scroll-id",
  "data-note-id",
  "data-photo-id",
  "data-post-id",
  "data-comment-id",
  "data-board-id",
  "data-call-row",
  "data-contact-row",
];
const ANCHOR_SELECTOR = ANCHOR_ATTRS.map((a) => `[${a}]`).join(",");

type Stored = Record<string, unknown>;
type ScrollEntry = { top: number; anchor?: string; offset?: number };

function parseObject(raw: string): Stored {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Stored)
      : {};
  } catch {
    return {};
  }
}

function anchorId(node: HTMLElement): string {
  for (const attr of ANCHOR_ATTRS) {
    const value = node.getAttribute(attr);
    if (value) return value;
  }
  return "";
}
type ViewProps = Pick<Props, "view" | "onView">;

/** 与 useSkinState 同构，但读写 Runtime.viewState，且不派发 variable 事件。 */
function useViewString(
  p: ViewProps,
  key: string,
): [string, Dispatch<SetStateAction<string>>] {
  const stored = p.view?.[key];
  const [local, setLocal] = useState("");
  const ref = useRef("");
  const lastWritten = useRef<unknown>(undefined);
  const seeded = useRef(false);
  if (!seeded.current) {
    seeded.current = true;
    ref.current = typeof stored === "string" ? stored : local;
    lastWritten.current = ref.current;
  } else if (
    stored !== undefined &&
    JSON.stringify(stored) !== JSON.stringify(lastWritten.current) &&
    JSON.stringify(stored) !== JSON.stringify(ref.current)
  ) {
    // 外部（例如从存档恢复）改写了这一项：以存档为准。
    ref.current = stored as string;
    lastWritten.current = stored;
  }
  const set: Dispatch<SetStateAction<string>> = (next) => {
    const updated =
      typeof next === "function"
        ? (next as (value: string) => string)(ref.current)
        : next;
    ref.current = updated;
    lastWritten.current = updated;
    setLocal(updated);
    p.onView?.(key, updated);
  };
  return [ref.current, set];
}

/**
 * 把 App 内部的页面 / 筛选 / 选中状态合并保存成一个 JSON 字符串。
 * patch 只改传入的字段，其余保留；读取时再与 initial 合并，新增字段有安全默认值。
 * 刻意不把「详情页是否打开」放进来：重开 App 仍从列表进入，避免改变既有导航语义。
 */
export function useViewState<V extends object>(
  p: ViewProps,
  initial: V,
): [V, (patch: Partial<V>) => void] {
  const initialRef = useRef(initial);
  const [raw, setRaw] = useViewString(p, VIEW_STATE_KEY);
  const value = useMemo(
    () => ({ ...initialRef.current, ...parseObject(raw) }) as V,
    [raw],
  );
  const patch = (next: Partial<V>) =>
    setRaw((prev) =>
      JSON.stringify(Object.assign({}, parseObject(prev), next)),
    );
  return [value, patch];
}

function firstVisibleAnchor(el: HTMLElement): { anchor: string; offset: number } {
  const base = el.getBoundingClientRect().top;
  for (const node of Array.from(
    el.querySelectorAll<HTMLElement>(ANCHOR_SELECTOR),
  )) {
    const delta = node.getBoundingClientRect().top - base;
    if (delta >= 0) {
      const id = anchorId(node);
      if (id) return { anchor: id, offset: Math.round(delta) };
    }
  }
  return { anchor: "", offset: 0 };
}

/**
 * 按「页面路由键」保存滚动位置，防抖 180ms（不轮询、不驱动剧情）。
 * 保存时额外记录第一个可见内容行的 ID 和相对偏移；还原时若该 ID 仍在列表中，
 * 就按内容对齐，避免列表数据变化后单纯依赖旧像素定位错误。
 *
 * active 用于容器被详情页替换后重新挂载的场景（false → true 视为一次新的挂载）。
 */
export function useScrollRestore(
  p: ViewProps,
  routeKey: string,
  ref: RefObject<HTMLElement | null>,
  active = true,
  slot = "main",
) {
  // 同一个 Skin 里若存在多个独立滚动区（论坛的帖子 / 板块 / 详情），
  // 每个槽位用不同的持久化键，避免两个防抖写入互相覆盖。
  const [raw, setRaw] = useViewString(
    p,
    slot === "main" ? SCROLL_STATE_KEY : `${SCROLL_STATE_KEY}:${slot}`,
  );
  // onView 写入会让组件重渲染，setRaw / raw 每次都是新引用；用 ref 固定住最新值，
  // 避免滚动监听器被反复解绑重绑。
  const rawRef = useRef(raw);
  rawRef.current = raw;
  const setRef = useRef(setRaw);
  setRef.current = setRaw;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restored = useRef("");

  const entryOf = (source: string): ScrollEntry | null => {
    const entry = parseObject(source)[routeKey];
    return entry && typeof entry === "object" ? (entry as ScrollEntry) : null;
  };

  useLayoutEffect(() => {
    if (!active) {
      restored.current = "";
      return;
    }
    if (restored.current === routeKey) return;
    const el = ref.current;
    restored.current = routeKey;
    const entry = entryOf(rawRef.current);
    if (!el || !entry) return;
    const pixel = Number(entry.top) || 0;
    const offset = Number(entry.offset) || 0;
    // 保存时 anchor 在内容坐标系中的位置 = 当时的 scrollTop + 相对容器的偏移。
    const savedAnchorY = pixel + offset;
    const apply = () => {
      let top = pixel;
      if (entry.anchor) {
        const anchor = Array.from(
          el.querySelectorAll<HTMLElement>(ANCHOR_SELECTOR),
        ).find((n) => anchorId(n) === entry.anchor);
        if (anchor) {
          const current =
            anchor.getBoundingClientRect().top - el.getBoundingClientRect().top;
          const anchorY = el.scrollTop + current;
          // App 打开动画会临时用 transform 挪动容器，getBoundingClientRect 此时
          // 失真（实测偏差接近一整屏）。测量可信时才按内容 ID 校正列表数据变化，
          // 否则回退到像素位置，避免把已恢复的滚动位置错误地拉回顶部。
          if (Math.abs(anchorY - savedAnchorY) <= 120)
            top = anchorY - offset;
        }
      }
      const desired = Math.max(0, Math.round(top));
      el.scrollTop = desired;
      // 内容尚未撑开时 scrollTop 会被浏览器夹到 0，返回 false 让重试继续。
      return Math.abs(el.scrollTop - desired) <= 1;
    };
    // 首帧可能处于打开动画 / 异步播种阶段：有限帧内持续按最新测量校正，
    // 动画结束后停止，不再干预玩家之后的手动滚动；尺寸变化事件再补一次。
    let frames = 0;
    let raf = 0;
    let done = false;
    const attempt = () => {
      if (done) return;
      const ok = apply();
      if (++frames >= 24 && ok) {
        done = true;
        return;
      }
      if (frames < 60) raf = requestAnimationFrame(attempt);
    };
    attempt();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            if (done) return;
            frames = 0;
            attempt();
          });
    observer?.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      observer?.disconnect();
    };
  }, [routeKey, active, ref]);

  useEffect(() => {
    if (!active) return;
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        const { anchor, offset } = firstVisibleAnchor(el);
        const entry: ScrollEntry = { top: Math.round(el.scrollTop) };
        if (anchor) {
          entry.anchor = anchor;
          entry.offset = offset;
        }
        setRef.current((prev) =>
          JSON.stringify(
            Object.assign({}, parseObject(prev), { [routeKey]: entry }),
          ),
        );
      }, 180);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    };
  }, [routeKey, active, ref]);
}
