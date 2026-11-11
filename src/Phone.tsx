import { StatusGlyph } from "./ios/StatusGlyph";
import { SocialDetail, socialDetailApps } from "./skins/SocialDetails";
import { NativeCalculator } from "./ios/Calculator";
import { HomeLauncher } from "./launcher/HomeLauncher";
import { useDeviceLayout } from "./launcher/layout";
import "./launcher/launcher.css";
import { NativeDetail, nativeDetailApps } from "./ios/Details";
import "./ios/details.css";
import {
  SystemNotifications,
  notificationContent,
} from "./SystemNotifications";
import {
  readLauncherOrigin,
  AppWindow,
  screenOrigin,
} from "./vendor/ios-web/Launcher";
import {
  DeviceLock,
  ControlCenter,
  DeviceKeyboard,
  KeyboardContext,
  NativeSettings,
  type KeyboardControl,
  type KeyboardSession,
} from "./DeviceSystem";
import { AppArtwork, hasNativeArtwork } from "./AppArtwork";
import { getFields } from "./fields";
import { catalogSkins } from "./skins/catalog";
import { SCROLL_END_KEY } from "./skins/shared";
import {
  musicStore,
  MUSIC_UI_APP,
  MUSIC_STATE_KEY,
  MUSIC_FIRST_PLAYED_KEY,
  MUSIC_FIRST_PLAYED_TARGET,
  MUSIC_VIDEO_APPS,
  type MusicState,
} from "./music/globalPlayer";
import "./skins/skins.css";
import "./ios18.css";
import "./device-system.css";
import "./ios/tokens.css";
import "./ios/reference.css";
import "./ios/status-bar.css";
import { WeChatSkin, WhatsAppSkin } from "./AppSkins";
import { RichText } from "./RichText";
import {
  useEffect,
  useState,
  useRef,
  useMemo,
  Suspense,
  type CSSProperties,
} from "react";
import { AnimatePresence } from "motion/react";
import {
  ChevronLeft,
  Plus,
  Search,
  LockKeyhole,
  Heart,
  MessageCircle,
  MoreHorizontal,
  ArrowUp,
  Folder,
  Phone as PhoneIcon,
} from "lucide-react";
import { getApp, type AppPlugin } from "./registry";
import {
  initialRuntime,
  safeMedia,
  type Work,
  type Item,
  type Runtime,
  type UiValue,
  type EventPlayback,
} from "./schema";
import { dispatch, choose, visible, advance } from "./engine";
import { db } from "./persistence";
export function AppIcon({
  id,
  name,
  small = false,
  custom = "",
  date,
  time,
  badge = 0,
}: {
  id: string;
  name?: string;
  small?: boolean;
  custom?: string;
  date?: string;
  time?: string;
  badge?: number;
}) {
  const a = getApp(id);
  const Icon = a.icon;
  return (
    <span className={`app-icon-wrap ${small ? "small" : ""}`}>
      <span className="app-icon" style={{ background: a.color }}>
        {custom ? (
          safeMedia(custom) ? (
            <img src={safeMedia(custom)} alt="自定义图标" />
          ) : (
            <span>{custom.slice(0, 2)}</span>
          )
        ) : hasNativeArtwork(id) ? (
          <AppArtwork id={id} date={date} time={time} />
        ) : (
          <Icon size={small ? 21 : 28} strokeWidth={1.65} />
        )}
      </span>
      {name && <span className="app-name">{name}</span>}
      {badge > 0 && <span className="app-badge">{badge}</span>}
    </span>
  );
}
// 玩家捡到手机时把时钟对齐到真实系统时间；之后仍由 engine 的 advance()
// 按 1:1 现实流速推进，剧情延迟/定时事件不受影响。
function clockFields() {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
  };
}
function freshRuntime(work: Work): Runtime {
  return { ...initialRuntime(work), ...clockFields() };
}
// 作品数据可用 "@now"（消息时间）/ "|now|"（通知时间）标记「当下」。
// 每次打开手机时替换为真实系统时刻：锁屏通知永远是刚收到的，
// 且通知与对应聊天消息的时间始终一致；会话内保持不变。
function alignNow(work: Work): Work {
  const { time, date } = clockFields();
  const full = `${date} ${time}`;
  let touched = false;
  const nodes = work.nodes.map((n) => {
    let changed = false;
    const actions = n.actions.map((a) => {
      const value = String(a.value);
      if (a.type === "notification" && value.includes("|now|")) {
        changed = true;
        touched = true;
        return { ...a, value: value.replace("|now|", `|${time}|`) };
      }
      return a;
    });
    return changed ? { ...n, actions } : n;
  });
  const data: Work["data"] = {};
  for (const [app, items] of Object.entries(work.data)) {
    let changed = false;
    const next = items.map((i) => {
      if (i.time !== "@now") return i;
      changed = true;
      touched = true;
      return { ...i, time: full };
    });
    data[app] = changed ? next : items;
  }
  if (!touched) return work;
  return { ...work, nodes, data, phone: { ...work.phone, time, date } };
}

// ── 新发生消息的真实时间戳 ────────────────────────────────────────────────
// 设备本地时区的完整日期时间（与 clockFields 同一时区口径），格式沿用 Item.time，
// 界面按 WhatsApp 原有样式取 slice(0,10) / slice(-5) 显示。
function realLocalStamp() {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    ` ${pad(now.getHours())}:${pad(now.getMinutes())}`
  );
}
/**
 * 事件消息包「刚入队」的那一刻生成一次真实时间：包内对方消息共用一个发生时间。
 * 当前账号（outgoing）的预设回复不在此写入 —— 它必须等玩家真正点击发送，
 * 由 onPlayback 生成发送时间；自动逐字打字 / 草稿阶段不产生发送时间。
 * 已存在的时间戳一律不重算：刷新 / 重新进入 App 都不会改变已生成的消息时间。
 */
function withEventTimes(
  before: Runtime,
  next: Runtime,
  outgoingIds: Set<string>,
): Runtime {
  const beforePacks = before.playback ?? {};
  const nextPacks = next.playback ?? {};
  const fresh = Object.keys(nextPacks).filter((id) => !beforePacks[id]);
  if (!fresh.length) return next;
  const times = { ...(next.messageTimes ?? {}) };
  const stamp = realLocalStamp();
  let changed = false;
  for (const packId of fresh)
    for (const id of nextPacks[packId].messageIds)
      if (!outgoingIds.has(id) && !times[id]) {
        times[id] = stamp;
        changed = true;
      }
  return changed ? { ...next, messageTimes: times } : next;
}
/** 渲染层统一覆盖：只改带动态时间的消息，历史聊天的 time 原样保留。 */
function applyMessageTimes(
  items: Item[],
  times?: Record<string, string>,
): Item[] {
  if (!times || !Object.keys(times).length) return items;
  return items.map((i) => {
    const t = times[i.id];
    return t && t !== i.time ? { ...i, time: t } : i;
  });
}

// ── WA_LC_001 的 Notes / Photos 浏览完成判定 ────────────────────────────
const REVIEW_KEYS: Record<string, string> = {
  notes: "notes_reviewed",
  photos: "photos_reviewed",
};
const SCROLL_KEY = SCROLL_END_KEY;
const mimiComplete = (s: Runtime) =>
  s.playback?.["MIMI-001"]?.playbackStatus === "completed";
/** 离开 App 时才记录：本次进入后确实滚到列表末尾，且 MIMI-001 已完整结束。 */
function recordReview(s: Runtime, app: string): Runtime {
  const key = REVIEW_KEYS[app];
  if (!key || !s.ui?.[app]?.[SCROLL_KEY] || !mimiComplete(s)) return s;
  const ui = s.ui ?? {};
  return {
    ...s,
    variables: { ...s.variables, [key]: true },
    ui: { ...ui, [app]: { ...ui[app], [SCROLL_KEY]: false } },
  };
}
/** 每次进入都重置本次浏览标记，因此 MIMI-001 完成之前的滚动不计入。 */
function resetScrollEnd(s: Runtime, app: string): Runtime {
  if (!REVIEW_KEYS[app] || !s.ui?.[app]?.[SCROLL_KEY]) return s;
  const ui = s.ui ?? {};
  return {
    ...s,
    ui: { ...ui, [app]: { ...ui[app], [SCROLL_KEY]: false } },
  };
}
type PhoneProps = Omit<Parameters<typeof PhoneRuntime>[0], "deviceLayout">;
export function Phone(props: PhoneProps) {
  const deviceLayout = useDeviceLayout(props.work, props.creator);
  const alignedWork = useMemo(
    () => (props.creator ? deviceLayout.work : alignNow(deviceLayout.work)),
    [deviceLayout.work, props.creator],
  );
  return (
    <PhoneRuntime
      {...props}
      work={alignedWork}
      deviceLayout={deviceLayout}
    />
  );
}
function PhoneRuntime({
  deviceLayout,
  work,
  creator = false,
  onEdit,
  onAdd,
  onSettings,
  onOpen,
  runtime: external,
  onRuntime,
}: {
  deviceLayout: ReturnType<typeof useDeviceLayout>;
  work: Work;
  creator?: boolean;
  onEdit?: (app: string, item: Item) => void;
  onAdd?: (app: string) => void;
  onSettings?: () => void;
  onOpen?: (app: string) => void;
  runtime?: Runtime;
  onRuntime?: (s: Runtime) => void;
}) {
  const [app, setApp] = useState("");
  const [homeRequest, setHomeRequest] = useState(0);
  const [locked, setLocked] = useState(!creator);
  const [pinOpen, setPinOpen] = useState(false);
  const [quickCamera, setQuickCamera] = useState(false);
  const [keyboard, setKeyboard] = useState(false);
  // 键盘只做视觉；会话仅保留「收起时保存打字进度」的回调，不承载草稿文本。
  const keyboardSessionRef = useRef<KeyboardSession | null>(null);
  // 所有收起键盘的路径都走这里：只关闭键盘、通知剧本保存进度，绝不自动发送。
  const closeKeyboard = () => {
    keyboardSessionRef.current?.onClose?.();
    keyboardSessionRef.current = null;
    setKeyboard(false);
  };
  const openKeyboard: KeyboardControl = (open, session) => {
    if (!open) {
      closeKeyboard();
      return;
    }
    keyboardSessionRef.current = session ?? null;
    setKeyboard(true);
  };
  const [recent, setRecent] = useState<string[]>([]);
  const appSnapshots = useRef(new Map<string, HTMLElement>());
  const [banner, setBanner] = useState("");
  const noticesSeen = useRef(0);
  // 通知点击跳转：锁屏时先记下目标，解锁成功后再进入对应 App / 会话。
  const [noticeThread, setNoticeThread] = useState("");
  const [noticeJumpId, setNoticeJumpId] = useState(0);
  const pendingNotice = useRef<{ target?: string; index?: number } | null>(
    null,
  );
  const [contextApp, setContextApp] = useState("");
  const [deviceScale, setDeviceScale] = useState(0.84);
  const shell = useRef<HTMLDivElement>(null);
  const gesture = useRef({ x: 0, y: 0, time: 0, zone: "" });
  const [launchOrigin, setLaunchOrigin] = useState(screenOrigin);

  // 键盘高度随设备缩放与草稿内容变化，用实测高度驱动聊天内容区底部留白：
  // 输入栏因此始终紧贴键盘上沿，既不被遮挡，也不会留出大片空白。
  useEffect(() => {
    const screen = shell.current?.querySelector<HTMLElement>(".phone-screen");
    if (!screen) return;
    if (!keyboard) {
      screen.style.removeProperty("--keyboard-height");
      return;
    }
    const kb = screen.querySelector<HTMLElement>(".device-keyboard");
    if (!kb) return;
    const sync = () =>
      screen.style.setProperty("--keyboard-height", `${kb.offsetHeight}px`);
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(kb);
    return () => {
      observer.disconnect();
      screen.style.removeProperty("--keyboard-height");
    };
  }, [keyboard]);

  const beginUnlock = () => {
    setPinError("");
    setQuickCamera(false);
    if (work.phone.passcode) setPinOpen(true);
    else unlock();
  };
  const pressTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const gestureConsumed = useRef(false);
  const [pinError, setPinError] = useState("");
  const [folder, setFolder] = useState("");
  const [panel, setPanel] = useState("");
  const [own, setOwn] = useState(() =>
    creator || external ? initialRuntime(work) : freshRuntime(work),
  );
  const [ready, setReady] = useState(creator || !!external);
  const [loadError, setLoadError] = useState("");
  useEffect(() => {
    const el = shell.current;
    if (!el) return;
    const fit = () => {
      setDeviceScale(
        Math.max(
          0.4,
          Math.min(
            1,
            (el.parentElement!.clientWidth - 24) / 407,
            (window.innerHeight - (creator ? 170 : external ? 150 : 40)) / 866,
          ),
        ),
      );
    };
    const observer = new ResizeObserver(fit);
    observer.observe(el.parentElement!);
    window.addEventListener("resize", fit);
    fit();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, [creator, ready]);
  const s = external ?? own;
  const runtimeRef = useRef(s);
  runtimeRef.current = s;
  const update = (next: Runtime) => {
    // 所有写回 Runtime 的路径都经过这里：新入队的消息包在此一次性生成真实时间。
    const stamped = withEventTimes(runtimeRef.current, next, outgoingIds);
    runtimeRef.current = stamped;
    setOwn(stamped);
    onRuntime?.(stamped);
  };
  /** 当前账号发出的消息：只有它们才在玩家点击发送时生成发送时间。 */
  const outgoingIds = useMemo(
    () =>
      new Set(
        Object.values(work.data)
          .flat()
          .filter((i) => i.outgoing)
          .map((i) => i.id),
      ),
    [work],
  );
  // 全局音乐播放器不在皮肤内，由 Phone 这一层把状态桥接到 Runtime 存档。
  // 普通状态静默写回（不派发事件）；只有首次真正开始播放才派发 variable 事件。
  musicStore.configure({
    writeState: (next) => {
      const current = runtimeRef.current;
      update({
        ...current,
        ui: {
          ...current.ui,
          [MUSIC_UI_APP]: {
            ...current.ui?.[MUSIC_UI_APP],
            [MUSIC_STATE_KEY]: JSON.stringify(next),
          },
        },
      });
    },
    fireFirstPlayed: () => {
      if (creator) return;
      const current = runtimeRef.current;
      update(
        dispatch(
          work,
          {
            ...current,
            ui: {
              ...current.ui,
              [MUSIC_UI_APP]: {
                ...current.ui?.[MUSIC_UI_APP],
                [MUSIC_FIRST_PLAYED_KEY]: true,
              },
            },
          },
          "variable",
          MUSIC_FIRST_PLAYED_TARGET,
        ),
      );
    },
    readState: () => {
      const raw = runtimeRef.current.ui?.[MUSIC_UI_APP]?.[MUSIC_STATE_KEY];
      if (typeof raw !== "string") return null;
      try {
        return JSON.parse(raw) as Partial<MusicState>;
      } catch {
        return null;
      }
    },
  });
  // 存档加载完成后恢复当前歌曲与进度；刻意不自动续播。
  useEffect(() => {
    if (ready) musicStore.restore();
  }, [ready, work.id]);
  useEffect(() => {
    let active = true;
    if (creator || external) return;
    void db.saves
      .get(work.id)
      .then((saved) => {
        if (!active) return;
        if (saved && saved.state.revision === work.updatedAt)
          // 刷新/隔天再打开时重新对齐现实时间，但保留已有游玩进度
          setOwn({ ...saved.state, ...clockFields() });
        else {
          setOwn(dispatch(work, freshRuntime(work), "start"));
          if (saved) setLoadError("内容已更新，已重新开始。");
        }
        setReady(true);
      })
      .catch(() => {
        setOwn(dispatch(work, freshRuntime(work), "start"));
        setLoadError("无法读取本地存档。本次仍可游玩。");
        setReady(true);
      });
    return () => {
      active = false;
    };
  }, [work.id, work.updatedAt, creator, external]);
  useEffect(() => {
    if (!creator && !external && ready)
      void db.saves
        .put({ id: work.id, state: own })
        .catch(() => setLoadError("存档失败，请检查浏览器存储权限。"));
  }, [own, creator, work.id, external, ready]);
  useEffect(() => {
    if (creator || external || !ready) return;
    const interval = setInterval(() => {
      const previous = runtimeRef.current;
      const next = advance(work, previous, 1000);
      // 跨过午夜时让状态栏/锁屏日期跟随现实（分钟仍由 advance 1:1 推进）
      next.date = clockFields().date;
      runtimeRef.current = next;
      const changed =
        next.time !== previous.time ||
        next.date !== previous.date ||
        next.trace.join() !== previous.trace.join() ||
        (next.scheduled?.length ?? 0) !== (previous.scheduled?.length ?? 0) ||
        (next.scheduled?.length ?? 0) > 0 ||
        Math.floor((next.elapsedMs ?? 0) / 5000) !==
          Math.floor((previous.elapsedMs ?? 0) / 5000);
      if (changed) update(next);
    }, 1000);
    return () => clearInterval(interval);
  }, [creator, external, ready, work.id, work.updatedAt]);
  const event = (event: string, target: string) => {
    if (!creator) update(dispatch(work, runtimeRef.current, event, target));
  };
  /**
   * 正常返回手机主屏幕。离开 Notes / Photos 时先记录浏览完成状态，
   * 再派发 home 事件；只有「从最后浏览的 Notes 或 Photos 返回主屏」才派发，
   * 从其它 App 返回、或还停留在 App 内，都不会触发 WA_LC_001。
   */
  const goHome = () => {
    const previousApp = app;
    const reviewed = recordReview(runtimeRef.current, previousApp);
    if (reviewed !== runtimeRef.current) update(reviewed);
    if (REVIEW_KEYS[previousApp]) event("home", previousApp);
    // WA_LC_002：沿用 goHome 这一条现有返回主屏路径，只补派一个专用导航事件；
    // 触发条件（WA_LC_001 已触发 / 已打开 WhatsApp / 群聊 9 条消息包播放完成 /
    // 尚未触发）全部由 story.json 的 WA_LC_002 节点判定，不在此写剧情逻辑。
    // 刻意不复用 "home" 事件名，避免改变 WA_LC_001「只从 Notes / Photos 返回」的语义。
    if (previousApp === "whatsapp") event("wa_lc001_read", "whatsapp");
    setApp("");
    setFolder("");
    setPanel("");
  };
  const captureApp = () => {
    if (!app) return;
    const current = shell.current?.querySelector<HTMLElement>(".app-screen");
    if (!current) return;
    const snapshot = current.cloneNode(true) as HTMLElement;
    snapshot.style.transform = "none";
    snapshot.style.opacity = "1";
    snapshot.style.filter = "none";
    snapshot.style.borderRadius = "0";
    snapshot.querySelectorAll("audio").forEach((el) => el.remove());
    snapshot.querySelectorAll("video").forEach((el) => {
      el.removeAttribute("autoplay");
      el.removeAttribute("src");
    });
    snapshot.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));
    appSnapshots.current.set(app, snapshot);
    for (const id of appSnapshots.current.keys())
      if (!recent.includes(id) && id !== app) appSnapshots.current.delete(id);
  };
  const open = (id: string) => {
    if (!work.apps.some((a) => a.id === id && a.installed)) return;
    // 抖音 / YouTube 是项目中实际的 App ID。打开它们时立即暂停后台音乐并保存进度，
    // 由 App 切换这一事件触发（不用轮询）；返回桌面或普通 App 不自动恢复。
    if ((MUSIC_VIDEO_APPS as readonly string[]).includes(id))
      musicStore.pauseForVideo();
    // 从一个 App 直接切到另一个 App 也算「离开」；新进入的 App 重置浏览标记。
    let s = recordReview(runtimeRef.current, app);
    s = resetScrollEnd(s, id);
    if (s !== runtimeRef.current) update(s);
    setApp(id);
    closeKeyboard();
    setRecent((v) => [id, ...v.filter((a) => a !== id)].slice(0, 8));
    setFolder("");
    setPanel("");
    onOpen?.(id);
    event("openApp", id);
  };
  const installedApps = work.apps.filter((a) => a.installed);
  const apps = installedApps.filter((a) => a.visible);
  const unlock = (pin = "") => {
    if (!work.phone.passcode || pin === work.phone.passcode) {
      setLocked(false);
      setPinOpen(false);
      event("password", pin);
      // 锁屏期间点过通知：解锁成功后进入对应 App / 会话
      const pending = pendingNotice.current;
      if (pending) {
        pendingNotice.current = null;
        jumpToNotice(pending.target, pending.index);
      }
    } else {
      setPinError("密码不正确");
      setPinOpen(true);
    }
  };
  useEffect(() => {
    if (app && !work.apps.some((a) => a.id === app && a.installed)) setApp("");
  }, [app, work.apps]);
  const displayTime = creator ? work.phone.time : s.time || work.phone.time;
  const plugin = getApp(app);
  useEffect(() => {
    const count = s.notifications.length;
    if (!locked && work.phone.notifications && count > noticesSeen.current) {
      setBanner(s.notifications.at(-1) || "");
      const timer = setTimeout(() => setBanner(""), 4500);
      noticesSeen.current = count;
      return () => clearTimeout(timer);
    }
    noticesSeen.current = count;
  }, [s.notifications.length, locked, work.phone.notifications]);
  const dismissNotice = (index: number) =>
    update({
      ...runtimeRef.current,
      notifications: runtimeRef.current.notifications.filter(
        (_, i) => i !== index,
      ),
    });
  // 读过一个会话后，移除该会话对应的通知：锁屏不再出现，App 角标减少或消失。
  const dismissThread = (thread: string) => {
    if (creator) return;
    const base = runtimeRef.current;
    const remaining = base.notifications.filter((t) => {
      const n = notificationContent(t, work.apps);
      return !(
        n.target === `${app}:${thread}` ||
        (!n.target && n.appId === app && n.title === thread)
      );
    });
    if (remaining.length !== base.notifications.length)
      update({ ...base, notifications: remaining });
  };
  // 通知跳转目标形如 "whatsapp:邝学姐 💙"：先进入 App，再定位到会话。
  // 没有显式目标时（旧格式通知）打开通知对应的 App。
  const jumpToNotice = (target?: string, index?: number) => {
    if (index !== undefined) dismissNotice(index);
    setBanner("");
    if (!target) return;
    const sep = target.indexOf(":");
    const appId = sep < 0 ? target : target.slice(0, sep);
    const thread = sep < 0 ? "" : target.slice(sep + 1);
    if (!work.apps.some((a) => a.id === appId && a.installed)) return;
    setNoticeThread(thread);
    setNoticeJumpId((v) => v + 1);
    open(appId);
  };
  const openNotice = (target?: string, index?: number) => {
    if (locked) {
      pendingNotice.current = { target, index };
      beginUnlock();
      return;
    }
    jumpToNotice(target, index);
  };
  if (!ready) return <div className="phone-loading">正在恢复进度…</div>;
  return (
    <div
      ref={shell}
      style={{ "--phone-scale": deviceScale } as CSSProperties}
      className={`phone-shell ios18 ${work.phone.theme === "dark" ? "dark-phone" : ""}`}
    >
      <KeyboardContext.Provider value={openKeyboard}>
        <div
          className={`phone-screen wallpaper-${work.phone.wallpaper} ${locked ? "is-locked" : ""} ${app ? "in-app" : ""} ${keyboard ? "keyboard-open" : ""}`}
          data-app={app}
          onDragStart={(e) => e.preventDefault()}
          onPointerDown={(e) => {
            gestureConsumed.current = false;
            const button = (e.target as HTMLElement).closest<HTMLElement>(
              "[data-app-id]",
            );
            if (button) {
              pressTimer.current = setTimeout(() => {
                gestureConsumed.current = true;
                setContextApp(button.dataset.appId || "");
              }, 550);
            }
            const box = e.currentTarget.getBoundingClientRect(),
              x = (e.clientX - box.left) / deviceScale,
              y = (e.clientY - box.top) / deviceScale;
            gesture.current = {
              x,
              y,
              time: Date.now(),
              zone: y < 58 ? "top" : y > 818 ? "bottom" : locked ? "lock" : "",
            };
          }}
          onPointerMove={(e) => {
            if (Math.abs(e.movementX) > 5 || Math.abs(e.movementY) > 5)
              clearTimeout(pressTimer.current);
          }}
          onPointerCancel={() => clearTimeout(pressTimer.current)}
          onPointerUp={(e) => {
            clearTimeout(pressTimer.current);
            const box = e.currentTarget.getBoundingClientRect(),
              y = (e.clientY - box.top) / deviceScale,
              g = gesture.current;
            const dy = y - g.y;
            if (g.zone === "top" && dy > 65)
              setPanel(g.x > 230 ? "control" : "notification");
            else if ((g.zone === "bottom" || g.zone === "lock") && dy < -55) {
              gestureConsumed.current = true;
              if (!locked) captureApp();
              closeKeyboard();
              if (panel) {
                setPanel("");
              } else if (locked) {
                beginUnlock();
              } else if (g.zone === "bottom" && Date.now() - g.time > 450) {
                captureApp();
                setPanel("switcher");
              } else {
                goHome();
              }
            }
          }}
          onClickCapture={(e) => {
            const target = (e.target as HTMLElement).closest(
              ".home-app-grid button,.dock button",
            );
            if (target) {
              setLaunchOrigin(
                readLauncherOrigin(target as HTMLElement, e.currentTarget),
              );
            }
          }}
        >
          <div className="wallpaper-orb orb-one" />
          <div className="wallpaper-orb orb-two" />
          <div className="status-bar">
            <button
              onClick={() =>
                setPanel(panel === "notification" ? "" : "notification")
              }
              className="status-time"
              aria-label="通知中心"
            >
              {displayTime}
              <StatusGlyph kind="silent" />
            </button>
            <div className="dynamic-island" />
            <button
              className="signals"
              onClick={() => setPanel(panel === "control" ? "" : "control")}
              aria-label="控制中心"
            >
              <StatusGlyph kind="cellular" />
              <StatusGlyph kind="wifi" />
              <span
                className={`ios-battery${work.phone.battery <= 20 ? " low-battery" : ""}`}
              >
                <span style={{ width: `${work.phone.battery}%` }} />
                <b>{work.phone.battery}</b>
              </span>
            </button>
          </div>
          <AnimatePresence mode="wait">
            {locked && !(quickCamera && app === "camera") ? (
              <DeviceLock
                work={
                  s.date
                    ? { ...work, phone: { ...work.phone, date: s.date } }
                    : work
                }
                time={displayTime}
                notices={s.notifications}
                onDismiss={dismissNotice}
                onNoticeOpen={openNotice}
                pinOpen={pinOpen}
                setPinOpen={setPinOpen}
                error={pinError}
                onUnlock={unlock}
                onLight={() => setPanel("light")}
                onCamera={() => {
                  setQuickCamera(true);
                  open("camera");
                }}
              />
            ) : app && app !== "appstore" ? (
              <AppWindow
                key={app}
                className={`app-screen engine-${plugin.engine} skin-${app}`}
                creator={creator}
                origin={launchOrigin}
              >
                <AppContent
                  app={plugin}
                  name={
                    work.apps.find((a) => a.id === app)?.name ?? plugin.name
                  }
                  items={applyMessageTimes(
                    [
                      ...(work.data[app] ?? []),
                      ...(s.messages[app] ?? []),
                    ],
                    s.messageTimes,
                  )}
                  creator={creator}
                  state={s}
                  noticeThread={noticeThread}
                  noticeJumpId={noticeJumpId}
                  onRead={(id) => event("read", id)}
                  onReadThread={(thread) => dismissThread(thread)}
                  onEdit={(item) => onEdit?.(app, item)}
                  onAdd={() => onAdd?.(app)}
                  onBack={goHome}
                  onSettings={onSettings}
                  onView={(key, value) => {
                    const current = runtimeRef.current;
                    // 纯视图状态只写 Runtime.viewState，刻意不经过 dispatch，
                    // 避免滚动 / 搜索这类高频写入重入事件队列。
                    update({
                      ...current,
                      viewState: {
                        ...current.viewState,
                        [app]: {
                          ...current.viewState?.[app],
                          [key]: value,
                        },
                      },
                    });
                  }}
                  onUi={(key, value) => {
                    const current = runtimeRef.current;
                    update(
                      dispatch(
                        work,
                        {
                          ...current,
                          ui: {
                            ...current.ui,
                            [app]: { ...current.ui?.[app], [key]: value },
                          },
                        },
                        "variable",
                        `ui:${app}:${key}`,
                      ),
                    );
                  }}
                  playback={s.playback ?? {}}
                  onPlayback={(eventId, updateFn) => {
                    const current = runtimeRef.current;
                    const prev = current.playback?.[eventId];
                    const next = updateFn(prev);
                    // 直接写 Runtime：播放进度只改 playback，不走事件队列，
                    // 避免重入 runQueue 造成事件重复触发。
                    // 玩家点击发送写进历史时才生成这条消息的发送时间；
                    // 自动打字、草稿、打开输入框都不产生时间。
                    const added = next.deliveredMessageIds.filter(
                      (id) => !(prev?.deliveredMessageIds ?? []).includes(id),
                    );
                    const times = { ...(current.messageTimes ?? {}) };
                    let stamped = false;
                    for (const id of added)
                      if (outgoingIds.has(id)) {
                        times[id] = realLocalStamp();
                        stamped = true;
                      }
                    update({
                      ...current,
                      playback: { ...current.playback, [eventId]: next },
                      ...(stamped ? { messageTimes: times } : {}),
                    });
                  }}
                  work={work}
                />
              </AppWindow>
            ) : (
              <HomeLauncher
                key={
                  "home-" + homeRequest + (app === "appstore" ? "store" : "")
                }
                storeOpen={app === "appstore"}
                closeStore={goHome}
                work={work}
                layout={deviceLayout.layout}
                change={deviceLayout.change}
                importLayout={deviceLayout.importLayout}
                error={deviceLayout.error}
                open={open}
                onFolder={setFolder}
                search={() => setPanel("search")}
                time={displayTime}
                icon={(a, small) => {
                  // 未读角标 = 尚未清除的、属于该 App 的通知数
                  const badge = s.notifications.filter(
                    (t) => notificationContent(t, work.apps).appId === a.id,
                  ).length;
                  return (
                    <AppIcon
                      key={a.id}
                      id={a.id}
                      name={small ? undefined : a.name}
                      small={small}
                      custom={a.icon}
                      date={s.date || work.phone.date}
                      time={s.time}
                      badge={badge}
                    />
                  );
                }}
                clearApp={(id) =>
                  update({
                    ...runtimeRef.current,
                    messages: Object.fromEntries(
                      Object.entries(runtimeRef.current.messages).filter(
                        ([app]) => app !== id,
                      ),
                    ),
                  })
                }
              />
            )}
          </AnimatePresence>
          {folder && (
            <div className="folder-overlay" onClick={() => setFolder("")}>
              <h2>{folder}</h2>
              <div className="folder-apps" onClick={(e) => e.stopPropagation()}>
                {apps
                  .filter((a) => a.folder === folder)
                  .map((a) => (
                    <button key={a.id} onClick={() => open(a.id)}>
                      <AppIcon id={a.id} name={a.name} custom={a.icon} />
                    </button>
                  ))}
              </div>
              <button className="glass-btn" onClick={() => setFolder("")}>
                关闭文件夹
              </button>
            </div>
          )}
          {panel === "control" && (
            <ControlCenter
              battery={work.phone.battery}
              network={work.phone.network}
              close={() => setPanel("")}
            />
          )}
          {panel && panel !== "control" && panel !== "switcher" && (
            <div
              className={`system-panel ${panel === "light" ? "flash-on" : ""}`}
            >
              <button className="panel-close" onClick={() => setPanel("")}>
                关闭 <ChevronLeft size={14} />
              </button>
              {panel === "notification" ? (
                <>
                  <h2>通知中心</h2>
                  {work.phone.notifications && s.notifications.length ? (
                    <SystemNotifications
                      notices={s.notifications}
                      apps={work.apps}
                      onOpen={(target, index) => {
                        setPanel("");
                        openNotice(target, index);
                      }}
                      onDismiss={dismissNotice}
                    />
                  ) : (
                    <p>没有新通知</p>
                  )}
                </>
              ) : panel === "search" ? (
                <>
                  <h2>搜索 App</h2>
                  <AppSearch apps={installedApps} open={open} />
                </>
              ) : (
                <h2>手电筒已打开</h2>
              )}
            </div>
          )}
          {!creator && s.choices.length > 0 && !locked && (
            <div className="story-overlay">
              <span className="eyebrow">你来到了一个岔路口</span>
              <h3>你会如何选择？</h3>
              {s.choices.map((c) => (
                <button
                  key={c.target}
                  onClick={() => update(choose(work, s, c.target))}
                >
                  {c.label}
                  <ArrowUp size={15} />
                </button>
              ))}
            </div>
          )}
          {!creator && s.endings.length > 0 && !locked && (
            <div className="story-overlay ending">
              <span className="eyebrow">ENDING · {s.endings.length}</span>
              <h2>这一段就到这里。</h2>
              <p>{s.endings[s.endings.length - 1]}</p>
              <button
                onClick={() => {
                  update(dispatch(work, freshRuntime(work), "start"));
                  setApp("");
                  setLocked(true);
                }}
              >
                重新开始
              </button>
            </div>
          )}
          {!creator && s.incomingCall && (
            <div className="incoming-call-screen">
              <small>
                {s.incomingCall.status === "ringing" ? "来电" : "通话中"}
              </small>
              <div className="incoming-avatar">
                {s.incomingCall.caller.slice(0, 1)}
              </div>
              <h2>{s.incomingCall.caller}</h2>
              {s.incomingCall.status === "answered" &&
                (() => {
                  const record = work.data.phone?.find(
                    (i) => i.id === s.incomingCall?.target,
                  );
                  return record?.kind === "audio" && safeMedia(record.media) ? (
                    <audio controls src={safeMedia(record.media)} />
                  ) : (
                    <p>来电中。</p>
                  );
                })()}
              <div className="incoming-actions">
                <button
                  className="decline-call"
                  onClick={() => {
                    const call = runtimeRef.current.incomingCall;
                    if (call)
                      update(
                        dispatch(
                          work,
                          { ...runtimeRef.current, incomingCall: null },
                          call.status === "ringing"
                            ? "callDeclined"
                            : "callEnded",
                          call.target || call.caller,
                        ),
                      );
                  }}
                >
                  <PhoneIcon size={25} />
                  <span>
                    {s.incomingCall.status === "ringing" ? "拒接" : "挂断"}
                  </span>
                </button>
                {s.incomingCall.status === "ringing" && (
                  <button
                    className="accept-call"
                    onClick={() => {
                      const call = runtimeRef.current.incomingCall;
                      if (call)
                        update(
                          dispatch(
                            work,
                            {
                              ...runtimeRef.current,
                              incomingCall: { ...call, status: "answered" },
                            },
                            "callAnswered",
                            call.target || call.caller,
                          ),
                        );
                    }}
                  >
                    <PhoneIcon size={25} />
                    <span>接听</span>
                  </button>
                )}
              </div>
            </div>
          )}
          {banner && !locked && (
            <button
              className="device-banner"
              onClick={() => {
                const n = notificationContent(banner, work.apps);
                openNotice(n.target || `${n.appId}:${n.title}`);
              }}
            >
              <AppIcon
                id={notificationContent(banner, work.apps).appId}
                small
              />
              <span>
                <strong>{notificationContent(banner, work.apps).title}</strong>
                <span>{notificationContent(banner, work.apps).body}</span>
              </span>
            </button>
          )}
          {panel === "switcher" && (
            <div className="device-switcher">
              <div className="switcher-cards">
                {recent
                  .filter(
                    (id) =>
                      installedApps.some((a) => a.id === id) &&
                      appSnapshots.current.has(id),
                  )
                  .map((id) => (
                    <button
                      className="recent-app-card"
                      key={id}
                      onClick={() => open(id)}
                    >
                      <span className="recent-app-label">
                        <AppIcon id={id} small />
                        <strong>
                          {work.apps.find((a) => a.id === id)?.name}
                        </strong>
                      </span>
                      <span className="recent-app-window">
                        <span
                          className="recent-app-snapshot"
                          aria-hidden="true"
                          inert
                          ref={(el) => {
                            const snapshot = appSnapshots.current.get(id);
                            if (el && snapshot)
                              el.replaceChildren(snapshot.cloneNode(true));
                          }}
                        />
                      </span>
                    </button>
                  ))}
              </div>
              <button className="switcher-done" onClick={() => setPanel("")}>
                完成
              </button>
            </div>
          )}
          {contextApp && (
            <div
              className="home-context-shade"
              onClick={() => setContextApp("")}
            >
              <div className="home-context-menu">
                <AppIcon id={contextApp} />
                <strong>
                  {work.apps.find((a) => a.id === contextApp)?.name}
                </strong>
                <button
                  onClick={() => {
                    open(contextApp);
                    setContextApp("");
                  }}
                >
                  打开 App
                </button>
                <button
                  onClick={() => {
                    setContextApp("");
                    setPanel("search");
                  }}
                >
                  在 App 库中查看
                </button>
                <button onClick={() => setContextApp("")}>取消</button>
              </div>
            </div>
          )}
          {keyboard && (
            <DeviceKeyboard close={closeKeyboard} />
          )}
          {loadError && (
            <button className="runtime-error" onClick={() => setLoadError("")}>
              {loadError}
            </button>
          )}
          <button
            className="home-indicator"
            aria-label="返回桌面"
            onClick={() => {
              if (gestureConsumed.current) return;
              if (locked) {
                beginUnlock();
                return;
              }
              captureApp();
              setHomeRequest((n) => n + 1);
              closeKeyboard();
              goHome();
            }}
          />
          <div className="screen-dimmer" />
          <div className="hardware-reflection" />
        </div>
      </KeyboardContext.Provider>
    </div>
  );
}
function AppSearch({
  apps,
  open,
}: {
  apps: Work["apps"];
  open: (id: string) => void;
}) {
  const [q, set] = useState("");
  return (
    <>
      <input
        autoFocus
        value={q}
        placeholder="App 名称"
        onChange={(e) => set(e.target.value)}
      />
      {apps
        .filter((a) => a.name.toLowerCase().includes(q.toLowerCase()))
        .map((a) => (
          <button
            className="search-result"
            key={a.id}
            onClick={() => open(a.id)}
          >
            <AppIcon id={a.id} small />
            {a.name}
          </button>
        ))}
    </>
  );
}
function Media({ item }: { item: Item }) {
  const src = safeMedia(item.media);
  return src ? (
    item.kind === "audio" ? (
      <audio controls src={src} />
    ) : item.kind === "video" ? (
      <video controls playsInline src={src} />
    ) : (
      <img loading="lazy" src={src} alt={item.title} />
    )
  ) : (
    <div
      className={`original-art art-${item.id.includes("ticket") ? "ticket" : "rain"}`}
    >
      <span>
        {item.id.includes("ticket") ? "城南 / SOUTHBOUND" : "after the rain"}
      </span>
      <strong>{item.id.includes("ticket") ? "09 · 01" : "雨 后"}</strong>
      <small>
        {item.id.includes("ticket")
          ? "16:30 · 一张未完成的约定"
          : "a little moment of quiet"}
      </small>
    </div>
  );
}
function AppContent({
  app,
  name,
  items,
  creator,
  state,
  onRead,
  onReadThread,
  onEdit,
  onAdd,
  onBack,
  onSettings,
  onUi,
  onView,
  playback,
  onPlayback,
  work,
  noticeThread = "",
  noticeJumpId = 0,
}: {
  app: AppPlugin;
  name: string;
  items: Item[];
  creator: boolean;
  state: Runtime;
  onRead: (id: string) => void;
  onReadThread?: (thread: string) => void;
  onEdit: (item: Item) => void;
  onAdd: () => void;
  onBack: () => void;
  onSettings?: () => void;
  onUi?: (key: string, value: UiValue) => void;
  onView?: (key: string, value: UiValue) => void;
  playback?: Record<string, EventPlayback>;
  onPlayback?: (
    eventId: string,
    update: (prev: EventPlayback | undefined) => EventPlayback,
  ) => void;
  work: Work;
  noticeThread?: string;
  noticeJumpId?: number;
}) {
  const [detail, setDetail] = useState<Item | null>(null);
  const [thread, setThread] = useState("");
  const [tab, setTab] = useState(app.tabs[0]);
  const [q, setQ] = useState("");
  const [pw, setPw] = useState("");
  const [unlocks, setUnlocks] = useState<string[]>([]);
  const [pwError, setPwError] = useState("");
  const [likes, setLikes] = useState<string[]>([]);
  const shown = items
    .filter((i) => creator || visible(i, state))
    .filter((i) =>
      (i.title + i.body + i.sender).toLowerCase().includes(q.toLowerCase()),
    );
  const filtered =
    tab === "收藏"
      ? shown.filter((i) => i.favorite)
      : tab === app.tabs[0]
        ? shown
        : shown.filter((i) => i.folder === tab);
  const read = (i: Item) => {
    if (creator) {
      onEdit(i);
      return;
    }
    setDetail(i);
    if (!i.password || unlocks.includes(i.id)) onRead(i.id);
  };
  const chats = [...new Set(shown.map((i) => i.title))];
  // 通知点击跳转：进入 App 后自动定位到对应会话（仅当该会话当前可见）。
  useEffect(() => {
    if (noticeThread && chats.includes(noticeThread)) setThread(noticeThread);
  }, [noticeJumpId, noticeThread]);
  const back = () => {
    if (detail) setDetail(null);
    else if (thread) setThread("");
    else onBack();
  };
  // 故事自带 instagram 内容时沿用通用皮肤；AFTER THE LAST SET 的 instagram
  // 数据为空，改用固定内容的 Instagram App（内容不来自 story.json）。
  const skinKey =
    app.id === "instagram" && items.length > 0 ? "instagramLegacy" : app.id;
  const Skin =
    app.id === "wechat"
      ? WeChatSkin
      : app.id === "whatsapp"
        ? WhatsAppSkin
        : (catalogSkins[skinKey as keyof typeof catalogSkins] ?? null);
  const detailView = detail ? (
    <div className="phone-content detail-content">
      {detail.password && !creator && !unlocks.includes(detail.id) ? (
        <div className="locked-note">
          <LockKeyhole size={36} />
          <h3>这条内容已锁定</h3>
          <input
            type="password"
            placeholder="内容密码"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
          />
          <button
            onClick={() => {
              if (pw === detail.password) {
                setUnlocks([...unlocks, detail.id]);
                onRead(detail.id);
                setPwError("");
              } else setPwError("密码不正确");
            }}
          >
            解锁内容
          </button>
          <small>{pwError}</small>
        </div>
      ) : (
        <>
          <small className="detail-meta">
            {detail.time} · {detail.sender}
          </small>
          <h2>{detail.title}</h2>
          {(detail.media || ["media", "social"].includes(app.engine)) && (
            <Media item={detail} />
          )}
          <RichText value={detail.richText} fallback={detail.body} />
          <dl className="item-metadata">
            {getFields(app.id)
              .filter((f) => detail.meta?.[f.key])
              .map((f) => (
                <div key={f.key}>
                  <dt>{f.label}</dt>
                  <dd>{detail.meta[f.key]}</dd>
                </div>
              ))}
          </dl>
          {detail.folder && (
            <span className="folder-label">
              <Folder size={12} />
              {detail.folder}
            </span>
          )}
          {detail.comments.map((c, i) => (
            <p key={i} className="comment">
              {c}
            </p>
          ))}
        </>
      )}
    </div>
  ) : null;
  if (Skin)
    return (
      <>
        <div className="catalog-slot" hidden={!!detail}>
          <Suspense fallback={<div className="catalog-loading">正在打开…</div>}>
            <Skin
              appId={app.id}
              owner={work.phone.owner}
              virtualTime={state.time}
              ui={state.ui?.[app.id]}
              onUi={creator ? undefined : onUi}
              view={state.viewState?.[app.id]}
              onView={creator ? undefined : onView}
              playback={playback}
              onPlayback={creator ? undefined : onPlayback}
              name={name}
              items={shown}
              creator={creator}
              onRead={onRead}
              onItem={read}
              onReadThread={onReadThread}
              onAdd={onAdd}
              onBack={onBack}
              thread={thread}
              onThread={setThread}
            />
          </Suspense>
        </div>
        {detail &&
          (socialDetailApps.has(app.id) &&
          (!detail.password || unlocks.includes(detail.id)) ? (
            <SocialDetail
              app={app.id}
              item={detail}
              back={back}
              owner={work.phone.owner}
              ui={state.ui?.[app.id]}
              onUi={onUi}
            />
          ) : nativeDetailApps.has(app.id) &&
            (!detail.password || unlocks.includes(detail.id)) ? (
            <NativeDetail app={app.id} item={detail} back={back} />
          ) : (
            <>
              <div className="app-nav">
                <button aria-label="返回" onClick={back}>
                  <ChevronLeft size={23} />
                </button>
                <strong>{detail.title}</strong>
                <span />
              </div>
              {detailView}
            </>
          ))}
      </>
    );
  return (
    <>
      <div className="app-nav">
        <button onClick={back} aria-label="返回">
          <ChevronLeft size={23} />
          {detail || thread ? "返回" : ""}
        </button>
        <strong>{thread || name}</strong>
        <button
          onClick={
            creator
              ? onAdd
              : () =>
                  document
                    .querySelector<HTMLInputElement>(
                      ".app-screen .phone-search input",
                    )
                    ?.focus()
          }
          aria-label={creator ? "新增内容" : "搜索内容"}
        >
          {creator ? <Plus size={22} /> : <Search size={20} />}
        </button>
      </div>
      {app.id === "settings" && !detail ? (
        <NativeSettings
          work={work}
          items={items}
          creator={creator}
          onItem={read}
          onSettings={onSettings}
        />
      ) : app.id === "calculator" && !detail ? (
        <NativeCalculator
          items={shown}
          onRead={read}
          ui={state.ui?.[app.id]}
          onUi={onUi}
        />
      ) : detail ? (
        detailView
      ) : app.engine === "messaging" && thread ? (
        <div className="chat-content">
          <div className="chat-time">2026 年 9 月 1 日</div>
          {shown
            .filter((i) => i.title === thread)
            .map((i) => (
              <button
                key={i.id}
                className={`message-row ${i.outgoing ? "outgoing" : ""}`}
                onClick={() => (creator ? onEdit(i) : onRead(i.id))}
              >
                <span className="avatar">{i.sender.slice(0, 1)}</span>
                <span className="bubble">
                  {i.kind === "image" ||
                  i.kind === "audio" ||
                  i.kind === "video" ? (
                    <Media item={i} />
                  ) : i.kind === "transfer" ? (
                    <span className="transfer">
                      ¥ {i.body}
                      <small>转账记录</small>
                    </span>
                  ) : (
                    i.body
                  )}
                  <small>
                    {i.time.slice(-5)} {i.read ? "✓✓" : ""}
                  </small>
                  {creator && (i.hidden || i.unlock) && (
                    <LockKeyhole size={12} />
                  )}
                </span>
              </button>
            ))}
          {creator ? (
            <button className="chat-compose" onClick={onAdd}>
              ＋ 添加一条消息
            </button>
          ) : (
            <div className="chat-compose muted">
              回复会出现在这里。
            </div>
          )}
        </div>
      ) : (
        <div
          className={`phone-content ${app.engine === "social" ? "feed-content" : ""}`}
        >
          {app.engine !== "media" && (
            <div className="phone-search">
              <Search size={15} />
              <input
                placeholder={`搜索${name}`}
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
          )}
          {app.engine === "messaging" ? (
            chats.map((t) => {
              const list = shown.filter((i) => i.title === t),
                last = list[list.length - 1];
              return (
                <button
                  className="contact-row"
                  key={t}
                onClick={() => {
                  setThread(t);
                  onRead(t);
                  onReadThread?.(t);
                }}
                >
                  <span className="avatar" style={{ background: app.color }}>
                    {t.slice(0, 1)}
                  </span>
                  <span>
                    <strong>{t}</strong>
                    <p>{last.body}</p>
                  </span>
                  <small>{last.time.slice(-5)}</small>
                </button>
              );
            })
          ) : app.engine === "media" ? (
            <>
              <div className="media-heading">
                <h1>{tab}</h1>
                <p>{filtered.length} 个片段</p>
              </div>
              <div className="media-grid">
                {filtered.map((i) => (
                  <button key={i.id} onClick={() => read(i)}>
                    <Media item={i} />
                    <span>
                      {i.title} {creator && i.hidden ? "· 隐藏" : ""}
                    </span>
                  </button>
                ))}
              </div>
            </>
          ) : app.engine === "social" ? (
            filtered.map((i) => (
              <article className="social-post" key={i.id}>
                <div className="post-author">
                  <span className="avatar" style={{ background: app.color }}>
                    {i.sender.slice(0, 1)}
                  </span>
                  <div>
                    <strong>{i.sender}</strong>
                    <small>{i.time}</small>
                  </div>
                  <button aria-label="查看帖子详情" onClick={() => read(i)}>
                    <MoreHorizontal size={20} />
                  </button>
                </div>
                <button className="post-image" onClick={() => read(i)}>
                  <Media item={i} />
                </button>
                <div className="post-actions">
                  <button
                    aria-label="点赞"
                    onClick={() =>
                      setLikes(
                        likes.includes(i.id)
                          ? likes.filter((id) => id !== i.id)
                          : [...likes, i.id],
                      )
                    }
                  >
                    <Heart
                      size={22}
                      fill={likes.includes(i.id) ? "#d67670" : "none"}
                    />
                  </button>
                  <button aria-label="查看评论" onClick={() => read(i)}>
                    <MessageCircle size={22} />
                  </button>
                  <small>
                    {i.likes + (likes.includes(i.id) ? 1 : 0)} 次喜欢
                  </small>
                </div>
                <button className="post-text" onClick={() => read(i)}>
                  <strong>{i.title}</strong>
                  <p>{i.body}</p>
                </button>
              </article>
            ))
          ) : (
            filtered.map((i) => (
              <button
                key={i.id}
                className={`record-row ${app.engine === "document" ? "document-row" : ""}`}
                onClick={() => read(i)}
              >
                <div className="record-symbol">
                  {app.engine === "records" ? (
                    <app.icon size={20} />
                  ) : (
                    <span>{i.title.slice(0, 1)}</span>
                  )}
                </div>
                <div>
                  <strong>{i.title}</strong>
                  <p>{i.body.split("\n")[0]}</p>
                  <small>
                    {i.time} {i.folder && `· ${i.folder}`}
                  </small>
                </div>
                {i.password || i.hidden ? (
                  <LockKeyhole size={14} />
                ) : (
                  <ChevronLeft className="chevron-right" size={16} />
                )}
              </button>
            ))
          )}
          {!filtered.length && app.engine !== "messaging" && (
            <div className="empty-app">
              <app.icon size={36} />
              <h3>这一页还很安静</h3>
              <p>
                {creator
                  ? "添加属于这个 App 的内容。"
                  : "暂时没有可浏览的内容。"}
              </p>
            </div>
          )}
          {creator && (
            <button className="phone-add" onClick={onAdd}>
              <Plus size={15} />
              添加
              {app.engine === "messaging"
                ? "聊天"
                : app.engine === "social"
                  ? "帖子"
                  : app.engine === "media"
                    ? "素材"
                    : "内容"}
            </button>
          )}
        </div>
      )}
      {!detail &&
        !thread &&
        app.id !== "calculator" &&
        app.id !== "settings" && (
          <div className="app-tabs">
            {app.tabs.map((t, i) => (
              <button
                key={t}
                className={tab === t ? "selected" : ""}
                onClick={() => setTab(t)}
              >
                {i === 0 ? (
                  <MessageCircle size={17} />
                ) : i === 1 ? (
                  <Search size={17} />
                ) : (
                  <UsersIcon />
                )}
                <span>{t}</span>
              </button>
            ))}
          </div>
        )}
    </>
  );
}
function UsersIcon() {
  return <PhoneIcon size={17} />;
}
