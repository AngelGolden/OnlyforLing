import { useEffect, useMemo, useRef, useState } from "react";
import type {
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
} from "react";
import { ChevronLeft, Heart } from "lucide-react";
import type { Props } from "./shared";
import { useSkinState } from "../skinState";
import {
  DOUYIN_AUTHOR,
  DOUYIN_AVATAR,
  DOUYIN_AVATAR_NAME,
  DOUYIN_PROFILE_URL,
  dyAsset,
} from "./douyin-data";
import "./douyin.css";

/**
 * 抖音｜竖屏沉浸式短视频浏览。
 *
 * 复用项目既有机制：
 *  - 视频源走 public/dy-media 静态资源白名单（与 yt-media 一致），不内联进 work.json；
 *  - 播放用浏览器原生 <video>（YouTubeSkin 同款），不新建播放器 / 全局状态；
 *  - 观看位置用 useSkinState 写 Runtime.ui.douyin，随 Dexie 存档持久化；
 *  - 外链用 <a target="_blank">（SystemSkins.openExternal 同款外部浏览器通道）。
 * 数据来自 content.douyin，新增视频只改数据、不改这里的布局。
 */
type FeedItem = { id: string; caption: string; src: string };

/** 判定为一次有效滑动的最小位移；切换锁避免一次惯性滚动连跳多条。 */
const SWIPE_THRESHOLD = 38;
const SWITCH_LOCK_MS = 320;
/** 播放进度写存档的最小间隔，避免 timeupdate 高频写 Runtime。 */
const TIME_WRITE_MS = 2000;

/**
 * WA_DOUYIN_001｜八条视频的「顺序浏览进度」。
 *
 * 规格第三章：从第 1 条起建立本轮记录；只有正常滑动进入下一条、且该条视频
 * 确实成功加载并显示在屏幕上，才把它的视频 ID 记进进度。中途离开保留进度、
 * 重新进入接着走；回看 / 重复浏览 / 直接跳到第 8 条 / 加载失败都不推进，
 * 因此也不会触发事件。整份进度用一个 JSON 字符串字段写 Runtime.ui.douyin
 * （UiValue 只允许 string | number | boolean | string[]），单次原子写入，
 * 不新建全局状态，也不碰 8 条视频的数据、内容与顺序。
 */
const VIEW_PROGRESS_KEY = "viewProgress";
/** 完成标志直接写 ui.douyin.viewCompleted，由 Phone.onUi 派发 variable 事件。 */
const VIEW_COMPLETED_KEY = "viewCompleted";
/** 规格：抖音当前共有八条有效视频，全部按序成功显示才算浏览完成。 */
const REQUIRED_VIDEO_COUNT = 8;
/** 加载较慢的视频留足重试窗口（100ms × 50 = 5s），期间不打断播放。 */
const VIEW_POLL_MS = 100;
const VIEW_POLL_TRIES = 50;

type ViewProgress = {
  startedFromFirst: boolean;
  viewedIds: string[];
  lastSequentialIndex: number;
  completed: boolean;
};

function emptyProgress(): ViewProgress {
  return {
    startedFromFirst: false,
    viewedIds: [],
    lastSequentialIndex: -1,
    completed: false,
  };
}

/** 存档里的进度是字符串；容错解析，坏数据一律当作「尚未开始」，不误触发。 */
function parseProgress(raw: string): ViewProgress {
  if (!raw) return emptyProgress();
  try {
    const v = JSON.parse(raw) as Partial<ViewProgress>;
    if (
      typeof v.startedFromFirst !== "boolean" ||
      !Array.isArray(v.viewedIds) ||
      !v.viewedIds.every((x) => typeof x === "string") ||
      typeof v.lastSequentialIndex !== "number" ||
      !Number.isFinite(v.lastSequentialIndex) ||
      typeof v.completed !== "boolean"
    )
      return emptyProgress();
    return {
      startedFromFirst: v.startedFromFirst,
      viewedIds: [...v.viewedIds],
      lastSequentialIndex: v.lastSequentialIndex,
      completed: v.completed,
    };
  } catch {
    return emptyProgress();
  }
}

export function DouyinSkin(p: Props) {
  const feed = useMemo<FeedItem[]>(
    () =>
      p.items
        .map((i) => ({
          id: i.id,
          caption: i.body,
          src: dyAsset(i.meta, "video"),
        }))
        .filter((v) => v.src.toLowerCase().endsWith(".mp4")),
    [p.items],
  );
  const count = feed.length;
  const [index, setIndex] = useSkinState<number>(p, "index", 0);
  const [time, setTime] = useSkinState<number>(p, "time", 0);
  const [liked, setLiked] = useSkinState<string[]>(p, "liked", []);
  const [viewProgressText, setViewProgressText] = useSkinState<string>(
    p,
    VIEW_PROGRESS_KEY,
    "",
  );
  const viewProgress = useMemo(
    () => parseProgress(viewProgressText),
    [viewProgressText],
  );
  /** ref 恒为最新值：轮询回调读它，不必把进度塞进 effect 依赖造成反复写。 */
  const viewProgressRef = useRef(viewProgress);
  viewProgressRef.current = viewProgress;
  const [failed, setFailed] = useState<string[]>([]);
  const [drag, setDrag] = useState(0);
  const [dragging, setDragging] = useState(false);
  const current = Math.max(0, Math.min(index, Math.max(0, count - 1)));

  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);
  const backdropRef = useRef<HTMLVideoElement | null>(null);
  const startY = useRef<number | null>(null);
  const lastSwitch = useRef(0);
  const lastTimeWrite = useRef(0);
  /** 只在本次挂载时从存档恢复一次播放进度，切换条目后不再套用旧进度。 */
  const restore = useRef({ index: current, time });

  const avatar = dyAsset({ avatar: DOUYIN_AVATAR }, "avatar");
  const profileUrl = DOUYIN_PROFILE_URL.trim();

  const go = (delta: number) => {
    if (!count) return;
    const next = Math.max(0, Math.min(current + delta, count - 1));
    if (next === current) return;
    // 离开当前视频立刻暂停，避免后台继续播放 / 多条同时出声。
    videoRefs.current[current]?.pause();
    setTime(0);
    setIndex(next);
  };

  /** 只让当前视频播放；其余暂停且静音。自动播放被浏览器策略拦截时降级静音播放。 */
  useEffect(() => {
    videoRefs.current.forEach((v, i) => {
      if (v && i !== current) {
        v.pause();
        v.muted = true;
      }
    });
    const active = videoRefs.current[current];
    if (!active) return;
    active.muted = false;
    const applyRestore = () => {
      const r = restore.current;
      if (r.index !== current || r.time <= 0) return;
      if (Number.isFinite(active.duration) && active.duration > r.time) {
        try {
          active.currentTime = r.time;
        } catch {
          /* 部分编码不允许 seek，忽略即可 */
        }
      }
      r.time = 0;
    };
    if (active.readyState >= 1) applyRestore();
    else active.addEventListener("loadedmetadata", applyRestore, { once: true });
    const play = async () => {
      try {
        await active.play();
      } catch {
        active.muted = true;
        try {
          await active.play();
        } catch {
          /* 加载失败由 onError 提示，页面保持可用 */
        }
      }
    };
    void play();
    return () => active.removeEventListener("loadedmetadata", applyRestore);
  }, [current, count]);

  /** media 的 error 事件不冒泡，React 的 onError 收不到，必须在元素上原生绑定。 */
  useEffect(() => {
    const bound = feed
      .map((item, i) => ({ id: item.id, node: videoRefs.current[i] }))
      .filter((x): x is { id: string; node: HTMLVideoElement } => !!x.node)
      .map(({ id, node }) => {
        const mark = () =>
          setFailed((f) => (f.includes(id) ? f : [...f, id]));
        node.addEventListener("error", mark);
        // 资源在监听绑定前就已失败时补一次，避免漏掉提示。
        if (node.error) mark();
        return { node, mark };
      });
    return () =>
      bound.forEach(({ node, mark }) =>
        node.removeEventListener("error", mark),
      );
  }, [feed]);

  /**
   * 顺序浏览进度：只认「当前这条视频真的成功加载并出现在屏幕上」。
   * readyState >= 2 表示已有可显示的当前帧，videoWidth/Height > 0 表示解码出画面，
   * bounding box 落在抖音视口内表示确实显示在屏幕上；加载失败或还没加载好都不算。
   * 不要求视频播完，也不改变现有的 play / pause / 切换逻辑。
   */
  const recordView = (position: number, id: string) => {
    const prev = viewProgressRef.current;
    // 只接受严格的 +1 推进：从第 1 条开始，回看、重复浏览、直接跳到第 8 条都跳过。
    if (prev.completed || position !== prev.lastSequentialIndex + 1) return;
    const next: ViewProgress = {
      startedFromFirst: true,
      viewedIds: [...prev.viewedIds, id],
      lastSequentialIndex: position,
      completed: false,
    };
    const finished =
      count === REQUIRED_VIDEO_COUNT &&
      next.viewedIds.length === REQUIRED_VIDEO_COUNT &&
      next.lastSequentialIndex === REQUIRED_VIDEO_COUNT - 1 &&
      next.viewedIds.every((v, i) => v === feed[i]?.id);
    if (finished) next.completed = true;
    viewProgressRef.current = next;
    setViewProgressText(JSON.stringify(next));
    // 只有第 8 条成功显示才写这一项；Phone.onUi 会派发 ui:douyin:viewCompleted，
    // WA_DOUYIN_001 节点再用 once + WA_DOUYIN_001_TRIGGERED 做第二层防重。
    if (finished) p.onUi?.(VIEW_COMPLETED_KEY, true);
  };

  useEffect(() => {
    if (!count) return;
    const item = feed[current];
    const node = videoRefs.current[current];
    if (!item || !node) return;
    let cancelled = false;
    let timer = 0;
    let tries = 0;

    const attempt = () => {
      if (cancelled) return true;
      const prev = viewProgressRef.current;
      // 已完成 / 顺序不对时无需重试；加载失败也直接放弃本条。
      if (prev.completed || current !== prev.lastSequentialIndex + 1)
        return true;
      if (failed.includes(item.id) || node.error) return true;
      if (node.readyState < 2 || node.videoWidth <= 0 || node.videoHeight <= 0)
        return false;
      const box = node.getBoundingClientRect();
      const viewport = node.closest(".douyin-ui")?.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0) return false;
      if (
        viewport &&
        (box.top >= viewport.bottom - 1 || box.bottom <= viewport.top + 1)
      )
        return false;
      recordView(current, item.id);
      return true;
    };

    const tick = () => {
      if (cancelled || attempt()) return;
      if (++tries >= VIEW_POLL_TRIES) return;
      timer = window.setTimeout(tick, VIEW_POLL_MS);
    };
    tick();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [current, count, feed, failed, viewProgressText]);

  /** Skin 卸载（离开 App / 返回主屏）时暂停所有视频，避免后台继续播放。 */
  useEffect(
    () => () => {
      videoRefs.current.forEach((v) => {
        if (v) {
          v.pause();
          v.muted = true;
        }
      });
      backdropRef.current?.pause();
    },
    [],
  );

  /** 键盘上下键也走同一条切换链，便于无触摸设备与自动化验收。 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown" || e.key === "PageDown") {
        e.preventDefault();
        go(1);
      } else if (e.key === "ArrowUp" || e.key === "PageUp") {
        e.preventDefault();
        go(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const lock = () => {
    const now = Date.now();
    if (now - lastSwitch.current < SWITCH_LOCK_MS) return false;
    lastSwitch.current = now;
    return true;
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("a,button")) return;
    startY.current = e.clientY;
    setDragging(true);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (startY.current === null) return;
    setDrag(Math.max(-160, Math.min(160, e.clientY - startY.current)));
  };
  const finishPointer = (clientY: number) => {
    if (startY.current === null) return;
    const delta = clientY - startY.current;
    startY.current = null;
    setDragging(false);
    setDrag(0);
    if (Math.abs(delta) >= SWIPE_THRESHOLD && lock()) go(delta < 0 ? 1 : -1);
  };
  const onWheel = (e: ReactWheelEvent<HTMLDivElement>) => {
    if (Math.abs(e.deltaY) < 8 || !lock()) return;
    go(e.deltaY > 0 ? 1 : -1);
  };

  const onTimeUpdate = (i: number, v: HTMLVideoElement) => {
    if (i !== current) return;
    const now = Date.now();
    if (now - lastTimeWrite.current < TIME_WRITE_MS) return;
    lastTimeWrite.current = now;
    setTime(v.currentTime);
  };

  return (
    <div
      className="douyin-ui"
      data-douyin-root
      data-douyin-index={current}
      data-douyin-count={count}
      data-aspect="9:16"
      data-douyin-viewed-count={viewProgress.viewedIds.length}
      data-douyin-view-completed={String(viewProgress.completed)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => finishPointer(e.clientY)}
      onPointerCancel={(e) => finishPointer(e.clientY)}
      onWheel={onWheel}
    >
      <div
        className="douyin-track"
        style={{
          transform: `translate3d(0, calc(${-current * 100}% + ${drag}px), 0)`,
          transition: dragging ? "none" : undefined,
        }}
      >
        {feed.map((v, i) => {
          const isLiked = liked.includes(v.id);
          const isFailed = failed.includes(v.id);
          return (
            <section
              className="douyin-slide"
              key={v.id}
              data-douyin-id={v.id}
              data-douyin-position={i + 1}
              aria-hidden={i !== current}
            >
              <div className="douyin-stage">
                {/* 当前视频用同一真实素材做模糊背景，铺满 9:16 竖屏；静音不影响单条有声。 */}
                {i === current && !isFailed && (
                  <video
                    ref={(el) => {
                      backdropRef.current = el;
                    }}
                    className="douyin-backdrop"
                    data-douyin-backdrop={v.id}
                    src={v.src}
                    muted
                    loop
                    playsInline
                    autoPlay
                    preload="metadata"
                    aria-hidden="true"
                    onTimeUpdate={(e) => {
                      const front = videoRefs.current[i];
                      const back = e.currentTarget;
                      if (
                        front &&
                        Number.isFinite(front.duration) &&
                        Math.abs(front.currentTime - back.currentTime) > 0.8
                      )
                        back.currentTime = front.currentTime;
                    }}
                  />
                )}
                <video
                  ref={(el) => {
                    videoRefs.current[i] = el;
                  }}
                  className="douyin-video"
                  data-douyin-video={v.id}
                  src={v.src}
                  loop
                  playsInline
                  preload="metadata"
                  onTimeUpdate={(e) => onTimeUpdate(i, e.currentTarget)}
                />
                {isFailed && (
                  <div className="douyin-error" data-douyin-error={v.id}>
                    视频加载失败
                  </div>
                )}
              </div>

              <div className="douyin-overlay">
                <div className="douyin-info">
                  {profileUrl ? (
                    <a
                      className="douyin-author"
                      href={profileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-douyin-profile
                    >
                      {DOUYIN_AUTHOR}
                    </a>
                  ) : (
                    <span className="douyin-author">{DOUYIN_AUTHOR}</span>
                  )}
                  {v.caption && (
                    <p className="douyin-caption" data-douyin-caption={v.id}>
                      {v.caption}
                    </p>
                  )}
                </div>
                <div className="douyin-actions">
                  {profileUrl ? (
                    <a
                      className="douyin-avatar"
                      href={profileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-douyin-profile
                      aria-label={`打开${DOUYIN_AUTHOR}的主页`}
                    >
                      {avatar ? (
                        <img src={avatar} alt={DOUYIN_AVATAR_NAME} />
                      ) : (
                        <span>{DOUYIN_AUTHOR.slice(0, 1)}</span>
                      )}
                    </a>
                  ) : (
                    <span className="douyin-avatar">
                      {avatar ? (
                        <img src={avatar} alt={DOUYIN_AVATAR_NAME} />
                      ) : (
                        <span>{DOUYIN_AUTHOR.slice(0, 1)}</span>
                      )}
                    </span>
                  )}
                  <button
                    className="douyin-like"
                    data-douyin-like={v.id}
                    data-douyin-liked={isLiked}
                    aria-label={isLiked ? "取消点赞" : "点赞"}
                    onClick={() =>
                      setLiked((ids) =>
                        ids.includes(v.id)
                          ? ids.filter((id) => id !== v.id)
                          : [...ids, v.id],
                      )
                    }
                  >
                    <Heart size={27} fill={isLiked ? "#fe2c55" : "none"} />
                  </button>
                </div>
              </div>
            </section>
          );
        })}
      </div>

      <button
        className="douyin-back"
        data-douyin-back
        aria-label="返回"
        onClick={p.onBack}
      >
        <ChevronLeft size={20} />
      </button>
      <span className="douyin-counter" data-douyin-counter>
        {String(current + 1).padStart(2, "0")} / {String(count).padStart(2, "0")}
      </span>
      {count === 0 && <div className="douyin-empty">暂无视频</div>}
    </div>
  );
}
