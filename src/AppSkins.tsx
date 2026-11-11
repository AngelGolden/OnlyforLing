import { KeyboardContext, NativeComposer } from "./DeviceSystem";
import { useSkinState } from "./skinState";
import {
  Fragment,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  ChevronLeft,
  Plus,
  CirclePlus,
  Search,
  MessageCircle,
  Users,
  Compass,
  User,
  Camera,
  Phone,
  Video,
  Settings,
  Heart,
  Send,
  Home,
  Play,
  Bookmark,
  MoreHorizontal,
  Mic,
  Smile,
  Grid,
  CheckCheck,
  AtSign,
  Star,
  Music,
  Image as ImageIcon,
  Layers,
  ShoppingBag,
} from "lucide-react";
import { safeMedia, type EventPlayback, type Item, type UiValue } from "./schema";
import "./skins/safari-extra.css";
export type SkinProps = {
  ui?: Record<string, UiValue>;
  onUi?: (key: string, value: UiValue) => void;
  /** 纯视图状态（页签 / 搜索词 / 滚动位置），与剧情用的 ui 分开持久化 */
  view?: Record<string, UiValue>;
  /** 只写 Runtime.viewState，不派发 variable 事件 */
  onView?: (key: string, value: UiValue) => void;
  /** 各事件消息包的播放状态（持久化在 Runtime 中） */
  playback?: Record<string, EventPlayback>;
  /** 更新某个事件消息包的播放状态（持久化通道） */
  onPlayback?: (
    eventId: string,
    update: (prev: EventPlayback | undefined) => EventPlayback,
  ) => void;
  appId?: string;
  owner?: string;
  virtualTime?: string;
  name: string;
  items: Item[];
  creator: boolean;
  onRead: (id: string) => void;
  onReadThread?: (thread: string) => void;
  onItem: (i: Item) => void;
  onAdd: () => void;
  onBack: () => void;
  thread: string;
  onThread: (s: string) => void;
};
/**
 * 剧情送达的消息（数据里 hidden:true）在玩家打开会话之前视为「还没送达」：
 * 不出现在会话列表的预览里，进入会话后才按顺序播放。
 */
function isPending(i: Item, revealed: string[]) {
  return i.hidden && !revealed.includes(i.id);
}
/**
 * 这几个事件包明确要求：进入会话之前，聊天列表预览就显示第一条收到的消息。
 * 其余事件包（MAP-001 / BR-001 等）仍保持「未送达不预览」的规则，
 * 避免把还没播放的剧情内容提前泄漏到列表里。
 */
const PREVIEW_FIRST_MESSAGE_EVENTS = new Set(["IG-001", "MIMI-001"]);

/**
 * v1.2 草稿进度（持久化在 Runtime.ui 的既有 useSkinState 通道，随存档保存）。
 * 不新建全局状态结构：
 *   incoming       → playbackStatus: "playing" + PackReveal 的本地 incomingPhase
 *   awaiting_reply → playbackStatus: "awaiting_reply"
 *   typing         → 系统正在把预设文字逐字写入真实 draftValue
 *   draft_ready    → 完整草稿在输入框内等待玩家点发送
 *   sent           → deliveredMessageIds 新增该 messageId
 *   completed      → deliveredMessageIds.length >= messageIds.length
 * 打字完成 ≠ 已发送；每个 messageId 只由 deliverPackMessage 写入一次。
 */
type ReplyPhase = "idle" | "typing" | "paused" | "draft_ready";
type ReplyDraft = {
  messageId: string;
  body: string;
  /** 已输入的 Unicode 字符数（Array.from 口径，汉字/标点/Emoji 都不被拆开） */
  typed: number;
  done: boolean;
};
const REPLY_DRAFT_KEY = "waReplyDraft";
function parseReplyDraft(
  raw: string,
  body?: string,
  messageId?: string,
): ReplyDraft | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<ReplyDraft>;
    if (!v || typeof v.messageId !== "string" || typeof v.body !== "string")
      return null;
    if (messageId && v.messageId !== messageId) return null;
    if (body && v.body !== body) return null;
    const total = Array.from(v.body).length;
    return {
      messageId: v.messageId,
      body: v.body,
      typed: Math.max(0, Math.min(total, Number(v.typed) || 0)),
      done: !!v.done,
    };
  } catch {
    return null;
  }
}

/**
 * 把一个会话下所有事件消息包按入队顺序合并成一条固定剧本。
 * delivered 是「已经写进聊天历史」的 messageId 集合（对方 received / 当前账号 sent）。
 * 播放游标 = list 里第一条还没送达的消息；它是对话轮次的唯一依据。
 */
function threadScript(packs: EventPlayback[], items: Item[]) {
  const orderedPacks = packs.slice().sort((a, b) => a.order - b.order);
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const pk of orderedPacks)
    for (const id of pk.messageIds)
      if (!seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
  const list = ids
    .map((id) => items.find((i) => i.id === id))
    .filter((x): x is Item => !!x);
  return {
    orderedPacks,
    list,
    delivered: new Set(packs.flatMap((pk) => pk.deliveredMessageIds)),
  };
}
function packOwner(packs: EventPlayback[], id: string) {
  return packs.find((pk) => pk.messageIds.includes(id));
}
/**
 * 把一条消息正式写入聊天历史。
 * 对方消息由播放器逐条调用；当前账号消息只由玩家点击发送按钮时调用。
 * 幂等：同一个 messageId 已在历史里就不再追加、不推进游标。
 */
function deliverPackMessage(
  packs: EventPlayback[],
  id: string,
  onPlayback?: SkinProps["onPlayback"],
) {
  const owner = packOwner(packs, id);
  if (!owner || owner.deliveredMessageIds.includes(id)) return false;
  onPlayback?.(owner.eventId, (prev) => {
    const p = prev ?? owner;
    if (p.deliveredMessageIds.includes(id)) return p;
    const dd = [...p.deliveredMessageIds, id];
    const done = dd.length >= p.messageIds.length;
    return {
      ...p,
      deliveredMessageIds: dd,
      nextMessageIndex: p.messageIds.indexOf(id) + 1,
      playbackStatus: done ? "completed" : "playing",
    };
  });
  return true;
}
/** 游标停在当前账号的预设回复时，只登记 awaiting_reply 状态，绝不写历史。 */
function markAwaitingReply(
  packs: EventPlayback[],
  id: string,
  onPlayback?: SkinProps["onPlayback"],
) {
  const owner = packOwner(packs, id);
  if (!owner || owner.playbackStatus === "awaiting_reply") return;
  onPlayback?.(owner.eventId, (prev) => ({
    ...(prev ?? owner),
    playbackStatus: "awaiting_reply",
  }));
}
/**
 * 群聊专属头像放在 public/wa-media 下，只作为本地静态资源引用，避免把图片
 * 内联进 work.json 后撑爆 PWA 预缓存体积。这里做严格白名单，不接受任意 URL。
 */
const GROUP_AVATAR_RE = /^\/wa-media\/[a-z0-9-]+\.(jpe?g|png|webp)$/i;
/** 取会话内的群头像（会话级技术字段，编译后写在该会话每条消息的 meta 上）。 */
function groupAvatarOf(items: Item[]) {
  return (
    items.find((i) => GROUP_AVATAR_RE.test(i.meta?.groupAvatar ?? ""))?.meta
      ?.groupAvatar ?? ""
  );
}
/** 群组聊天：气泡显示成员名字、顶部显示「群组」、列表使用群头像。 */
function isGroupItems(items: Item[]) {
  return items.some(
    (i) => i.meta?.conversationKind === "group" || i.folder === "群组",
  );
}
function Avatar({
  name,
  round = false,
  src = "",
}: {
  name: string;
  round?: boolean;
  src?: string;
}) {
  const inline = safeMedia(src);
  const image = inline?.startsWith("data:image/")
    ? inline
    : GROUP_AVATAR_RE.test(src)
      ? // 数据里存的是 /wa-media/...；GitHub Pages 子路径下根路径会指向站点根而 404，
        // 渲染时统一转成 ./ 相对路径，本地与 /OnlyforLing/ 下都能加载。
        `./${src.slice(1)}`
      : "";
  return (
    <span className={`skin-avatar ${round ? "round" : ""}`}>
      {image ? <img src={image} alt="" /> : name.slice(0, 1)}
    </span>
  );
}
function ItemMedia({ item }: { item: Item }) {
  const src = safeMedia(item.media);
  const mediaTitle = item.meta?.mediaTitle || item.title;
  return src ? (
    item.kind === "audio" ? (
      <audio controls src={src} />
    ) : item.kind === "video" ? (
      <video controls playsInline src={src} />
    ) : (
      <img loading="lazy" alt={mediaTitle} src={src} />
    )
  ) : (
    <div className="skin-photo">
      <span>{mediaTitle}</span>
    </div>
  );
}
function formatMessageDate(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return year && month && day
    ? `${year}年${month}月${day}日`
    : value.slice(0, 10);
}
// 打字动画每会话只播一次：已播过的会话记录进 ui.typedThreads（随 runtime 持久化到本地），
// 下次打开手机直接跳过动画、停在最新一条，不再重复播放。
function TypingMessage({
  item,
  animate,
}: {
  item: Item;
  animate: boolean;
}) {
  const [n, setN] = useState(animate ? 0 : item.body.length);
  const [typing, setTyping] = useState(animate);
  useEffect(() => {
    if (!animate) return;
    const t1 = window.setTimeout(() => setTyping(false), 850);
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setN(i);
      if (i >= item.body.length) window.clearInterval(id);
    }, 45);
    return () => {
      window.clearTimeout(t1);
      window.clearInterval(id);
    };
  }, [animate, item.body.length]);
  return (
    <div className="skin-message outgoing">
      <div className={`skin-bubble${typing ? " wa-typing-active" : ""}`}>
        {typing ? (
          <span className="wa-typing-dots">
            <i />
            <i />
            <i />
          </span>
        ) : (
          <>
            {item.body.slice(0, n)}
            {n < item.body.length && <span className="wa-caret" />}
          </>
        )}
        <small className="wx-message-time">
          {item.time.slice(-5)} <CheckCheck size={11} />
        </small>
      </div>
    </div>
  );
}

// 按时间轴把「我的回复（打字）→ 对方回复（淡入）」依次揭示。
// 揭示进度按「消息」记录（ui.revealedMessages，随 runtime 持久化）：
// 已播放过的消息不再重播，新送达的消息则从断点继续按顺序播放。
function RevealTail({
  items,
  prevDate,
  whatsapp,
  onRead,
  creator,
  onItem,
  scrollRef,
  revealed,
  onRevealed,
}: {
  items: Item[];
  prevDate: string;
  whatsapp?: boolean;
  onRead: (id: string) => void;
  creator: boolean;
  onItem: (i: Item) => void;
  scrollRef: RefObject<HTMLDivElement | null>;
  revealed: string[];
  onRevealed: (id: string) => void;
}) {
  // 断点：已经播放过的消息不再重放；未播放的继续按顺序播放。
  const [startStep] = useState(() => {
    const known = new Set(revealed);
    let n = 0;
    while (n < items.length && known.has(items[n].id)) n++;
    return n;
  });
  const [step, setStep] = useState(startStep);
  useEffect(() => {
    if (startStep >= items.length) {
      setStep(items.length);
      return;
    }
    const timers: number[] = [];
    let t = 400;
    for (let i = startStep; i < items.length; i++) {
      const it = items[i];
      const isTyping = it.meta?.typing === "1";
      const dur = isTyping ? it.body.length * 45 + 850 : 500;
      timers.push(
        window.setTimeout(() => {
          setStep(i + 1);
          onRevealed(it.id);
        }, t),
      );
      t += dur;
    }
    return () => timers.forEach((x) => clearTimeout(x));
  }, []);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [step, scrollRef]);
  return (
    <>
      {items.slice(0, step).map((it, i) => {
        const showDate =
          it.time.slice(0, 10) !==
          (i === 0 ? prevDate : items[i - 1].time.slice(0, 10));
        const isTyping = it.meta?.typing === "1";
        return (
          <Fragment key={it.id}>
            {showDate && (
              <div className="skin-date">{formatMessageDate(it.time)}</div>
            )}
            {isTyping ? (
              <TypingMessage item={it} animate={i >= startStep} />
            ) : (
              <div
                className={`skin-message ${it.outgoing ? "outgoing" : ""} wa-fade`}
              >
                {!whatsapp && !it.outgoing && (
                  <Avatar name={it.sender} src={it.avatar} />
                )}
                <button
                  className="skin-bubble"
                  onClick={() => (creator ? onItem(it) : onRead(it.id))}
                >
                  {it.body}
                  <small className="wx-message-time">
                    {it.time.slice(-5)}
                    {whatsapp && it.outgoing && <CheckCheck size={11} />}
                  </small>
                </button>
                {!whatsapp && it.outgoing && (
                  <Avatar name={it.sender} src={it.avatar} />
                )}
              </div>
            )}
          </Fragment>
        );
      })}
    </>
  );
}

/**
 * 事件消息包按「对话轮次」播放（v1.2）：
 * - 游标指向对方消息 → 先显示短暂「正在输入」状态，再把预设文字逐字写进现有气泡；
 *   气泡完整显示后才落盘（写入历史、推进游标），再检查下一条，连续消息逐条显示；
 * - 游标指向当前账号消息 → 暂停并登记 awaiting_reply，等系统逐字输入 + 玩家点发送；
 * - 已送达的消息直接作为历史渲染；重开 App、刷新页面都从断点继续，不重播。
 * 临时预览气泡尚未进入历史，因此不算 delivered，也不推进播放游标。
 */
function PackReveal({
  packs,
  items,
  onPlayback,
  scrollRef,
  whatsapp,
  groupThread = false,
  onRead,
}: {
  packs: EventPlayback[];
  items: Item[];
  onPlayback?: SkinProps["onPlayback"];
  scrollRef: RefObject<HTMLDivElement | null>;
  whatsapp?: boolean;
  /** 群聊事件包也要显示成员名字，与同会话的历史群聊消息保持一致。 */
  groupThread?: boolean;
  onRead: (id: string) => void;
}) {
  const { orderedPacks, list, delivered } = useMemo(
    () => threadScript(packs, items),
    [packs, items],
  );
  // 播放游标：第一条还没送达的消息。为 null 表示整个剧本已结束。
  const cursor = list.find((it) => !delivered.has(it.id)) ?? null;
  const cursorId = cursor?.id ?? "";
  const [incomingPhase, setIncomingPhase] = useState<
    "idle" | "peer-typing" | "peer-revealing"
  >("idle");
  const [revealedChars, setRevealedChars] = useState(0);
  // effect 只依赖游标 id；其余数据用 ref 取最新值，避免父组件定时刷新时重置计时器。
  const ctxRef = useRef({ orderedPacks, cursor, onPlayback });
  ctxRef.current = { orderedPacks, cursor, onPlayback };
  useEffect(() => {
    const { orderedPacks: currentPacks, cursor: current, onPlayback: write } =
      ctxRef.current;
    setIncomingPhase("idle");
    setRevealedChars(0);
    if (!current || !write) return;
    if (current.outgoing) {
      // awaiting_reply：不写历史、不推进游标。
      markAwaitingReply(currentPacks, current.id, write);
      return;
    }
    // 对方消息：正在输入 → 气泡逐字显示 → 完整显示后才写入聊天历史。
    const chars = Array.from(current.body);
    let i = 0;
    let interval = 0;
    const typingTimer = window.setTimeout(
      () => setIncomingPhase("peer-typing"),
      60,
    );
    const revealTimer = window.setTimeout(() => {
      setIncomingPhase("peer-revealing");
      interval = window.setInterval(() => {
        i += 1;
        setRevealedChars(i);
        if (i >= chars.length) {
          window.clearInterval(interval);
          deliverPackMessage(currentPacks, current.id, write);
          setIncomingPhase("idle");
        }
      }, 35);
    }, 420);
    return () => {
      window.clearTimeout(typingTimer);
      window.clearTimeout(revealTimer);
      window.clearInterval(interval);
    };
  }, [cursorId]);
  const shown = list.filter((it) => delivered.has(it.id));
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [shown.length, incomingPhase, revealedChars, scrollRef]);
  if (!list.length) return null;
  const previewChars = cursor ? Array.from(cursor.body) : [];
  return (
    <>
      {shown.map((it) => (
        <div
          key={it.id}
          className={`skin-message ${it.outgoing ? "outgoing" : ""} wa-fade`}
        >
          {whatsapp && groupThread && !it.outgoing ? (
            <div className="wa-group-bubble">
              <span className="wa-group-sender">{it.sender}</span>
              <button className="skin-bubble" onClick={() => onRead(it.id)}>
                {it.body}
                <small className="wx-message-time">{it.time.slice(-5)}</small>
              </button>
            </div>
          ) : (
            <button className="skin-bubble" onClick={() => onRead(it.id)}>
              {it.body}
              <small className="wx-message-time">
                {it.time.slice(-5)}
                {whatsapp && it.outgoing && <CheckCheck size={11} />}
              </small>
            </button>
          )}
        </div>
      ))}
      {incomingPhase !== "idle" && cursor && (
        <div
          key={cursor.id}
          className={`skin-message ${
            incomingPhase === "peer-typing"
              ? "wa-incoming-typing"
              : "wa-incoming-preview"
          }`}
          data-incoming-phase={incomingPhase}
          data-incoming-id={cursor.id}
        >
          <div className="skin-bubble">
            {incomingPhase === "peer-typing" ? (
              <span className="wa-typing-dots">
                <i />
                <i />
                <i />
              </span>
            ) : (
              <>
                {previewChars.slice(0, revealedChars).join("")}
                {revealedChars < previewChars.length && (
                  <span className="wa-caret" aria-hidden="true" />
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
function MessageList({
  items,
  creator,
  onItem,
  onRead,
  whatsapp = false,
  groupThread = false,
  revealed,
  onRevealed,
  packs = [],
  packItems = [],
  onPlayback,
}: {
  items: Item[];
  creator: boolean;
  onItem: (i: Item) => void;
  onRead: (id: string) => void;
  whatsapp?: boolean;
  /** 群组聊天：在对方气泡上方显示发言人名字（含事件消息包）；私聊不加。 */
  groupThread?: boolean;
  revealed: string[];
  onRevealed: (id: string) => void;
  /** 该会话相关的事件消息包（持久化的播放状态） */
  packs?: EventPlayback[];
  /** 属于上述消息包的会话条目（未送达前不进入历史） */
  packItems?: Item[];
  onPlayback?: SkinProps["onPlayback"];
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // 会话标题稳定；玩家打开或切换会话时停在最新一条，创作器保持顶部便于编辑。
  const conversationKey = items[0]?.title ?? "";
  useLayoutEffect(() => {
    if (creator) return;
    const el = scrollRef.current;
    if (!el) return;
    const toBottom = () => {
      el.scrollTop = el.scrollHeight;
    };
    toBottom();
    // 图片/字体异步撑高内容后再校正一次
    const frame = requestAnimationFrame(toBottom);
    return () => cancelAnimationFrame(frame);
  }, [conversationKey, creator]);
  const firstTypingIdx = whatsapp
    ? items.findIndex((i) => i.meta?.typing === "1")
    : -1;
  const before =
    firstTypingIdx >= 0 ? items.slice(0, firstTypingIdx) : items;
  const tail = firstTypingIdx >= 0 ? items.slice(firstTypingIdx) : null;
  const prevDate = before.length
    ? before[before.length - 1].time.slice(0, 10)
    : "";
  return (
    <div
      ref={scrollRef}
      className={`skin-messages ${whatsapp ? "wa-wallpaper" : ""}`}
    >
      {before.map((i, index) => {
        const date = i.time.slice(0, 10);
        const previousDate = items[index - 1]?.time.slice(0, 10);
        const bubble = (
          <button
            className="skin-bubble"
            onClick={() => (creator ? onItem(i) : onRead(i.id))}
          >
            {["image", "audio", "video"].includes(i.kind) ? (
              <ItemMedia item={i} />
            ) : i.kind === "transfer" ? (
              <div className="skin-transfer">
                ¥ {i.body}
                <small>转账记录</small>
              </div>
            ) : (
              i.body
            )}
            <small className={whatsapp ? undefined : "wx-message-time"}>
              {i.time.slice(-5)}{" "}
              {whatsapp && i.outgoing && <CheckCheck size={11} />}
            </small>
          </button>
        );
        // 群组聊天的对方消息上方补发言人名字；当前账号的绿色气泡不加名字。
        const showSender = whatsapp && groupThread && !i.outgoing;
        return (
          <Fragment key={i.id}>
            {date !== previousDate && (
              <div className="skin-date">{formatMessageDate(i.time)}</div>
            )}
            <div className={`skin-message ${i.outgoing ? "outgoing" : ""}`}>
              {!whatsapp && !i.outgoing && (
                <Avatar name={i.sender} src={i.avatar} />
              )}
              {showSender ? (
                <div className="wa-group-bubble">
                  <span className="wa-group-sender">{i.sender}</span>
                  {bubble}
                </div>
              ) : (
                bubble
              )}
              {!whatsapp && i.outgoing && (
                <Avatar name={i.sender} src={i.avatar} />
              )}
            </div>
          </Fragment>
        );
      })}
      {tail && (
        <RevealTail
          items={tail}
          prevDate={prevDate}
          whatsapp={whatsapp}
          onRead={onRead}
          creator={creator}
          onItem={onItem}
          scrollRef={scrollRef}
          revealed={revealed}
          onRevealed={onRevealed}
        />
      )}
      {/* 事件消息包：未送达的不进历史；已送达的作为历史渲染；打开会话后才逐条播放。 */}
      {packs.length > 0 && (
        <PackReveal
          packs={packs}
          items={packItems}
          onPlayback={onPlayback}
          scrollRef={scrollRef}
          whatsapp={whatsapp}
          groupThread={groupThread}
          onRead={onRead}
        />
      )}
    </div>
  );
}
function Compose({
  creator,
  onAdd,
  wa = false,
  draft = "",
  awaiting = false,
  replyPhase = "idle",
  keyboardOpen = false,
  onActivate,
  onSend,
}: {
  creator: boolean;
  onAdd: () => void;
  wa?: boolean;
  /** 输入框内真实草稿值（系统自动逐字写入，不是已发送的消息） */
  draft?: string;
  /** 剧本是否正停在当前账号回复节点 */
  awaiting?: boolean;
  /** idle / typing / paused / draft_ready；打字完成才允许发送 */
  replyPhase?: ReplyPhase;
  /** 模拟键盘是否弹出（输入框获得焦点） */
  keyboardOpen?: boolean;
  onActivate?: () => void;
  onSend?: () => void;
}) {
  const canSend = !!draft && replyPhase === "draft_ready";
  return (
    <div
      className={`skin-compose ${wa ? "wa-compose" : ""}`}
      data-awaiting-reply={awaiting ? "1" : undefined}
      data-reply-phase={wa ? replyPhase : undefined}
      data-keyboard-open={keyboardOpen ? "1" : undefined}
    >
      {wa ? <Plus size={20} /> : <Mic size={20} />}
      <NativeComposer
        creator={creator}
        onAdd={onAdd}
        value={draft}
        onActivate={onActivate}
        caret={wa && !!draft && keyboardOpen}
        focused={wa && keyboardOpen}
      />
      <Smile size={21} />
      {/* 只有完整草稿出现在输入框且打字动画结束后，发送按钮才可用。 */}
      {wa && draft ? (
        <button
          className="wa-send-button"
          aria-label="发送消息"
          onClick={onSend}
          disabled={!canSend}
        >
          <Send size={18} />
        </button>
      ) : wa ? (
        <Mic size={20} />
      ) : (
        <Plus size={22} />
      )}
    </div>
  );
}
export function WeChatSkin(p: SkinProps) {
  const [tab, setTab] = useState("微信"),
    [query, setQuery] = useState(""),
    [moments, setMoments] = useState(false),
    [menu, setMenu] = useState(false),
    [searchOpen, setSearchOpen] = useState(false),
    [utility, setUtility] = useState("");
  const [readThreads, setReadThreads] = useSkinState<string[]>(
    p,
    "readThreads",
    [],
  );
  const [revealed, setRevealed] = useSkinState<string[]>(
    p,
    "revealedMessages",
    [],
  );
  const onRevealed = (id: string) =>
    setRevealed((v) => (v.includes(id) ? v : [...v, id]));
  const conversations = [
    ...new Set(
      p.items
        .filter((i) => !["朋友圈", "我"].includes(i.folder))
        .map((i) => i.title),
    ),
  ];
  const contacts = [
    ...new Set(p.items.map((i) => i.sender).filter((s) => s !== "我")),
  ];
  const posts = p.items.filter(
    (i) => i.folder === "朋友圈" || i.kind === "post",
  );
  return (
    <div
      className="wechat-ui independent-skin"
      data-tab={tab}
      data-thread={!!p.thread}
      data-moments={moments}
      data-utility={!!utility}
    >
      <div className="app-nav wx-nav">
        <button
          aria-label={utility || p.thread || moments ? "返回" : "收藏"}
          onClick={() =>
            utility
              ? setUtility("")
              : p.thread
                ? p.onThread("")
                : moments
                  ? setMoments(false)
                  : setUtility("收藏")
          }
        >
          {utility || p.thread || moments ? (
            <ChevronLeft size={22} />
          ) : (
            <Star size={22} />
          )}
        </button>
        <strong>
          {utility ||
            p.thread ||
            (moments ? "朋友圈" : tab === "微信" ? p.name : tab)}
        </strong>
        <button
          aria-label={
            p.creator ? "新增内容" : p.thread ? "聊天详情" : "微信菜单"
          }
          onClick={
            p.creator
              ? p.onAdd
              : () => (p.thread ? setUtility("聊天信息") : setMenu(!menu))
          }
        >
          {p.thread ? <MoreHorizontal size={22} /> : <CirclePlus size={22} />}
        </button>
      </div>
      {menu && (
        <div className="wx-popup-menu" role="menu">
          {["搜索", "发起群聊", "添加朋友", "扫一扫", "收付款"].map((label) => (
            <button
              role="menuitem"
              key={label}
              onClick={() => {
                setMenu(false);
                if (label === "搜索") {
                  setSearchOpen(true);
                } else setUtility(label);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {utility ? (
        <div className="skin-scroll wx-utility">
          {utility === "聊天信息" && (
            <div className="wx-members">
              {[
                ...new Set(
                  p.items
                    .filter((i) => i.title === p.thread)
                    .map((i) => i.sender),
                ),
              ].map((name) => (
                <div key={name}>
                  <Avatar
                    name={name}
                    src={p.items.find((i) => i.sender === name)?.avatar}
                  />
                  <small>{name}</small>
                </div>
              ))}
            </div>
          )}
          {p.items
            .filter((i) => i.folder === utility)
            .map((i) => (
              <button
                key={i.id}
                className="wx-discovery"
                onClick={() => p.onItem(i)}
              >
                {i.title}
                <span>›</span>
              </button>
            ))}
          {!p.items.some((i) => i.folder === utility) &&
            utility !== "聊天信息" && <p className="skin-empty">暂无内容</p>}
        </div>
      ) : p.thread ? (
        <>
          <MessageList
            items={p.items.filter((i) => i.title === p.thread)}
            creator={p.creator}
            onItem={p.onItem}
            onRead={p.onRead}
            revealed={revealed}
            onRevealed={onRevealed}
          />
          <Compose creator={p.creator} onAdd={p.onAdd} />
        </>
      ) : moments ? (
        <div className="wx-moments">
          <div className="wx-moment-cover">
            <Camera size={32} />
            <span>朋友圈</span>
          </div>
          {posts.map((i) => (
            <button
              key={i.id}
              className="wx-moment-post"
              onClick={() => p.onItem(i)}
            >
              <Avatar name={i.sender} />
              <div>
                <strong>{i.sender}</strong>
                <p>{i.body}</p>
                {i.media && <ItemMedia item={i} />}
                <small>{i.time}</small>
              </div>
            </button>
          ))}
          {!posts.length && <p className="skin-empty">暂无朋友圈动态</p>}
          {p.creator && (
            <button className="phone-add" onClick={p.onAdd}>
              添加朋友圈动态
            </button>
          )}
        </div>
      ) : (
        <div className="skin-scroll">
          {tab === "微信" ? (
            <>
              {searchOpen && (
                <label className="wx-search">
                  <Search size={14} />
                  <input
                    aria-label="搜索微信内容"
                    placeholder="搜索"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
              )}
              {conversations
                .filter(
                  (t) =>
                    t.includes(query) ||
                    p.items.some(
                      (i) => i.title === t && i.body.includes(query),
                    ),
                )
                .map((t) => {
                  const list = p.items.filter((i) => i.title === t);
                  const played = list.filter((i) => !isPending(i, revealed));
                  const last = (played.length ? played : list).at(-1)!;
                  const pending = list.filter((i) => isPending(i, revealed));
                  return (
                    <button
                      className="wx-chat-row"
                      key={t}
                    onClick={() => {
                      setReadThreads((v) => (v.includes(t) ? v : [...v, t]));
                      // 打开会话即视为送达，列表预览随之更新。
                      pending.forEach((i) => onRevealed(i.id));
                      p.onThread(t);
                      p.onRead(t);
                      p.onReadThread?.(t);
                    }}
                    >
                      <span className="wx-chat-avatar">
                        <Avatar name={t} src={last.avatar} />
                        {pending.length > 0 && (
                          <b className="wx-unread">{pending.length}</b>
                        )}
                        {!readThreads.includes(t) &&
                          list.some((i) => !i.read) &&
                          pending.length === 0 && (
                            <b className="wx-unread">
                              {list.filter((i) => !i.read).length}
                            </b>
                          )}
                      </span>
                      <div>
                        <strong>{t}</strong>
                        <p>{last.body}</p>
                      </div>
                      <time>{last.time.slice(-5)}</time>
                    </button>
                  );
                })}
              {!conversations.length && <p className="skin-empty">暂无聊天</p>}
            </>
          ) : tab === "通讯录" ? (
            <>
              <div className="wx-section-label">联系人</div>
              {contacts.map((c) => (
                <button
                  key={c}
                  className="wx-contact"
                  onClick={() => {
                    const item = p.items.find((i) => i.sender === c);
                    if (item) {
                      p.onThread(item.title);
                      p.onRead(item.title);
                    }
                  }}
                >
                  <Avatar
                    name={c}
                    src={p.items.find((i) => i.sender === c)?.avatar}
                  />
                  {c}
                </button>
              ))}
            </>
          ) : tab === "发现" ? (
            <div className="wx-discover-groups">
              {[
                [Camera, "朋友圈", "#26a958"],
                [Play, "视频号", "#fa9d3b"],
                [Music, "听一听", "#fa5151"],
              ].map(([Icon, label, color]) => {
                const Glyph = Icon as typeof Camera;
                return (
                  <button
                    key={String(label)}
                    className="wx-discovery"
                    onClick={() =>
                      label === "朋友圈"
                        ? setMoments(true)
                        : setUtility(String(label))
                    }
                  >
                    <Glyph size={22} style={{ color: String(color) }} />
                    {String(label)}
                    <span>›</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <>
              <div className="wx-profile">
                <Avatar name={p.owner || "我"} />
                <div>
                  <h2>{p.owner || "我"}</h2>
                  <small>微信号：未设置</small>
                  <button
                    className="wx-profile-status"
                    onClick={() => setUtility("状态")}
                  >
                    ＋ 状态
                  </button>
                </div>
              </div>
              <div className="wx-profile-menu">
                {[
                  [MessageCircle, "服务", "#07c160"],
                  [Layers, "收藏", "#e8a828"],
                  [ImageIcon, "朋友圈", "#3a9bd9"],
                  [Layers, "卡包", "#329dd8"],
                  [ShoppingBag, "小店与卡包", "#ed7c59"],
                  [Smile, "表情", "#f7b900"],
                  [Settings, "设置", "#1696d2"],
                ].map(([Icon, label, color]) => {
                  const Glyph = Icon as typeof Settings;
                  return (
                    <button
                      key={String(label)}
                      className="wx-discovery"
                      onClick={() =>
                        label === "朋友圈"
                          ? setMoments(true)
                          : setUtility(String(label))
                      }
                    >
                      <Glyph size={22} style={{ color: String(color) }} />
                      {String(label)}
                      <span>›</span>
                    </button>
                  );
                })}
              </div>
              {p.items
                .filter((i) => i.folder === "我")
                .map((i) => (
                  <button
                    className="wx-discovery"
                    key={i.id}
                    onClick={() => p.onItem(i)}
                  >
                    <User size={18} />
                    {i.title}
                    <span>›</span>
                  </button>
                ))}
              {p.creator && (
                <button className="phone-add" onClick={p.onAdd}>
                  编辑个人资料内容
                </button>
              )}
            </>
          )}
        </div>
      )}
      {!p.thread && !moments && !utility && (
        <nav className="wx-bottom">
          {[
            { label: "微信", icon: MessageCircle },
            { label: "通讯录", icon: Users },
            { label: "发现", icon: Compass },
            { label: "我", icon: User },
          ].map((t) => (
            <button
              className={tab === t.label ? "selected" : ""}
              key={t.label}
              onClick={() => setTab(t.label)}
            >
              <t.icon size={21} />
              <span>{t.label}</span>
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
export function WhatsAppSkin(p: SkinProps) {
  const [tab, setTab] = useState("聊天"),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("全部");
  const [revealed, setRevealed] = useSkinState<string[]>(
    p,
    "revealedMessages",
    [],
  );
  const onRevealed = (id: string) =>
    setRevealed((v) => (v.includes(id) ? v : [...v, id]));
  // 事件消息包：状态持久化在 Runtime.playback 里，与本组件的挂载/渲染无关。
  // 「事件已触发」「消息已写入历史」「消息包已播完」是三个独立状态。
  const packs = useMemo(
    () =>
      Object.values(
        p.playback ?? ({} as Record<string, EventPlayback>),
      )
        .filter((pk) => pk.appId === (p.appId ?? "whatsapp"))
        .sort((a, b) => a.order - b.order),
    [p.playback, p.appId],
  );
  const packedIds = useMemo(
    () => new Set(packs.flatMap((pk) => pk.messageIds)),
    [packs],
  );
  const deliveredIds = useMemo(
    () => new Set(packs.flatMap((pk) => pk.deliveredMessageIds)),
    [packs],
  );
  // v1.2：草稿与打字进度走既有的 Runtime.ui（useSkinState）持久化通道；
  // 播放进度仍只在 Runtime.playback，发送仍只走 deliverPackMessage。
  const keyboard = useContext(KeyboardContext);
  const keyboardRef = useRef(keyboard);
  keyboardRef.current = keyboard;
  const [draftValue, setDraftValue] = useState("");
  const [replyPhase, setReplyPhase] = useState<ReplyPhase>("idle");
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const typedRef = useRef(0);
  const [draftSnapshot, setDraftSnapshot] = useSkinState<string>(
    p,
    REPLY_DRAFT_KEY,
    "",
  );
  const snapshotRef = useRef(draftSnapshot);
  snapshotRef.current = draftSnapshot;
  const writeDraftRef = useRef(setDraftSnapshot);
  writeDraftRef.current = setDraftSnapshot;
  const persistDraft = (value: ReplyDraft | null) =>
    writeDraftRef.current(value ? JSON.stringify(value) : "");
  const threadPacks = useMemo(
    () => packs.filter((pk) => pk.thread === p.thread),
    [packs, p.thread],
  );
  const script = useMemo(
    () =>
      threadScript(
        threadPacks,
        p.items.filter((i) => packedIds.has(i.id)),
      ),
    [threadPacks, p.items, packedIds],
  );
  const pendingItem =
    script.list.find((it) => !script.delivered.has(it.id)) ?? null;
  // 只有「游标恰好停在当前账号的预设回复」时才等待玩家操作。
  const awaitingReply = pendingItem?.outgoing ? pendingItem : null;
  const awaitingId = awaitingReply?.id ?? "";
  const awaitingRef = useRef<Item | null>(null);
  awaitingRef.current = awaitingReply;
  // 草稿归属的那一轮：切会话时不能用新会话的游标去保存旧草稿。
  const draftTargetRef = useRef<Item | null>(null);
  const deliveredRef = useRef(deliveredIds);
  deliveredRef.current = deliveredIds;

  // 中途退出 / 刷新 / 重进：按 messageId + 预设全文校验，只恢复同一轮未发送的草稿。
  // 已完成打字 → 直接显示完整草稿等待发送；未完成 → 保留进度，点输入框后继续。
  useEffect(() => {
    const target = awaitingRef.current;
    const snap = parseReplyDraft(snapshotRef.current, target?.body, target?.id);
    if (target && snap) {
      const chars = Array.from(target.body);
      typedRef.current = Math.min(snap.typed, chars.length);
      draftTargetRef.current = target;
      setDraftValue(chars.slice(0, typedRef.current).join(""));
      setReplyPhase(
        snap.done || typedRef.current >= chars.length ? "draft_ready" : "paused",
      );
      setKeyboardOpen(false);
      return;
    }
    typedRef.current = 0;
    draftTargetRef.current = null;
    setDraftValue("");
    setReplyPhase("idle");
    // 已发送/已完成的过期快照才清掉；切到别的会话时保留，回来还能继续。
    if (!target && snap && deliveredRef.current.has(snap.messageId))
      persistDraft(null);
  }, [awaitingId, p.thread]);

  // 系统自动逐字输入：每个字符都写入真实 draftValue 状态（不是 CSS 假动画），
  // 并按小步长同步到存档；汉字、标点、Emoji 用 Array.from 逐码点输入。
  useEffect(() => {
    if (!keyboardOpen || replyPhase !== "typing") return;
    const target = draftTargetRef.current;
    if (!target) return;
    const chars = Array.from(target.body);
    let i = typedRef.current;
    const timer = window.setInterval(() => {
      i += 1;
      typedRef.current = i;
      const text = chars.slice(0, i).join("");
      setDraftValue(text);
      // 节流落盘：每 4 个字符写一次进度，完成时与收起键盘时再精确写一次。
      if (i % 4 === 0 || i === chars.length)
        persistDraft({
          messageId: target.id,
          body: target.body,
          typed: i,
          done: i >= chars.length,
        });
      if (i >= chars.length) {
        window.clearInterval(timer);
        setReplyPhase("draft_ready");
        persistDraft({
          messageId: target.id,
          body: target.body,
          typed: i,
          done: true,
        });
      }
    }, 55);
    return () => window.clearInterval(timer);
  }, [keyboardOpen, replyPhase, awaitingId]);

  // 键盘被收起 / 离开聊天页面：只保存进度，绝不发送、绝不推进播放游标。
  const closeCompose = () => {
    setKeyboardOpen(false);
    const target = draftTargetRef.current;
    // 用 typedRef 取精确进度：它可能比最近一次渲染的 draftValue 多 1 个字符，
    // 但一定是玩家在屏幕上看到的文字的前缀，退出恢复不会丢字。
    if (!target || typedRef.current <= 0) return;
    const total = Array.from(target.body).length;
    persistDraft({
      messageId: target.id,
      body: target.body,
      typed: Math.min(typedRef.current, total),
      done: typedRef.current >= total,
    });
    setReplyPhase((prev) => (prev === "typing" ? "paused" : prev));
  };
  useEffect(() => {
    keyboardRef.current(false);
  }, [p.thread]);

  const activateCompose = () => {
    if (p.creator || !awaitingReply) {
      keyboard(true);
      return;
    }
    const target = awaitingReply;
    const chars = Array.from(target.body);
    const snap = parseReplyDraft(snapshotRef.current, target.body, target.id);
    draftTargetRef.current = target;
    setKeyboardOpen(true);
    keyboard(true, { onClose: closeCompose });
    if (snap?.done) {
      // 之前打字已完成却不曾发送：直接恢复完整草稿，不重播动画。
      typedRef.current = chars.length;
      setDraftValue(target.body);
      setReplyPhase("draft_ready");
      return;
    }
    // 首次输入框为空；中途退出后从上次进度继续，不允许一次性赋值完整文本。
    const from = snap ? Math.min(snap.typed, chars.length) : 0;
    typedRef.current = from;
    setDraftValue(chars.slice(0, from).join(""));
    setReplyPhase("typing");
    persistDraft({
      messageId: target.id,
      body: target.body,
      typed: from,
      done: false,
    });
  };
  const sendReply = () => {
    const target = awaitingReply;
    if (p.creator || !target) return;
    // 固定剧本：打字完成、文本与预设完全一致、该 messageId 未送达，才允许发送。
    if (replyPhase !== "draft_ready") return;
    if (draftValue !== target.body) return;
    if (script.delivered.has(target.id)) return;
    if (!deliverPackMessage(threadPacks, target.id, p.onPlayback)) return;
    // 先清空真实草稿与快照，再收起键盘，避免 onClose 把已发送内容写回。
    typedRef.current = 0;
    draftTargetRef.current = null;
    setDraftValue("");
    setReplyPhase("idle");
    persistDraft(null);
    setKeyboardOpen(false);
    keyboard(false);
  };
  const tabs = [
    { label: "动态", icon: Compass },
    { label: "通话", icon: Phone },
    { label: "社区", icon: Users },
    { label: "聊天", icon: MessageCircle },
    { label: "设置", icon: Settings },
  ];
  const conversations = [
    ...new Set(
      p.items
        .filter((i) => !["动态", "通话", "社区", "设置"].includes(i.folder))
        .filter((i) => filter !== "未读" || !i.read)
        .map((i) => i.title),
    ),
  ];
  const name = tab === "聊天" ? p.name : tab;
  return (
    <div className="whatsapp-ui independent-skin">
      <div className="app-nav wa-nav">
        <button
          aria-label="返回"
          onClick={() => (p.thread ? p.onThread("") : p.onBack())}
        >
          <ChevronLeft size={22} />
        </button>
        <strong>{p.thread || name}</strong>
        <button
          aria-label={p.creator ? "新增内容" : "搜索内容"}
          onClick={
            p.creator
              ? p.onAdd
              : () =>
                  document
                    .querySelector<HTMLInputElement>(".wa-search input")
                    ?.focus()
          }
        >
          {p.creator ? <Plus size={21} /> : <Search size={20} />}
        </button>
      </div>
      {p.thread ? (
        <>
          <div className="wa-thread-profile">
            <button aria-label="返回聊天列表" onClick={() => p.onThread("")}>
              <ChevronLeft size={23} />
            </button>
            <Avatar
              name={p.thread}
              src={
                groupAvatarOf(p.items.filter((i) => i.title === p.thread)) ||
                p.items.find((i) => i.title === p.thread)?.avatar
              }
              round
            />
            <div>
              <strong>{p.thread}</strong>
              <small>
                {isGroupItems(p.items.filter((i) => i.title === p.thread))
                  ? "群组"
                  : "联系人"}
              </small>
            </div>
            <Video size={18} />
            <Phone size={17} />
          </div>
          <MessageList
            items={p.items.filter(
              (i) => i.title === p.thread && !packedIds.has(i.id),
            )}
            creator={p.creator}
            onItem={p.onItem}
            onRead={p.onRead}
            whatsapp
            groupThread={isGroupItems(
              p.items.filter((i) => i.title === p.thread),
            )}
            revealed={revealed}
            onRevealed={onRevealed}
            packs={threadPacks}
            packItems={p.items.filter((i) => packedIds.has(i.id))}
            onPlayback={p.onPlayback}
          />
          <Compose
            creator={p.creator}
            onAdd={p.onAdd}
            wa
            draft={draftValue}
            awaiting={!!awaitingReply}
            replyPhase={replyPhase}
            keyboardOpen={keyboardOpen}
            onActivate={activateCompose}
            onSend={sendReply}
          />
        </>
      ) : (
        <div className="skin-scroll">
          <h1 className="wa-large-title">{tab}</h1>
          {tab === "聊天" ? (
            <>
              <label className="wa-search">
                <Search size={16} />
                <input
                  placeholder="搜索"
                  aria-label="搜索WhatsApp"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <div className="wa-filters">
                {["全部", "未读", "群组"].map((f) => (
                  <button
                    key={f}
                    className={filter === f ? "selected" : ""}
                    onClick={() => setFilter(f)}
                  >
                    {f}
                  </button>
                ))}
              </div>
              {conversations
                .filter((t) => t.includes(query))
                .filter(
                  (t) =>
                    filter !== "群组" ||
                    p.items.some((i) => i.title === t && i.folder === "群组"),
                )
                .map((t) => {
                  const list = p.items.filter((i) => i.title === t);
                  // 未读数 = 该会话事件包里尚未送达的消息数（每送达一条立即减一）。
                  // 基础剧情里隐藏且未播放的消息沿用 revealed 机制，单独计数。
                  const undelivered = packs
                    .filter((pk) => pk.thread === t)
                    .reduce(
                      (n, pk) =>
                        n +
                        pk.messageIds.filter(
                          (id) => !pk.deliveredMessageIds.includes(id),
                        ).length,
                      0,
                    );
                  const basePending = list.filter(
                    (i) => !packedIds.has(i.id) && isPending(i, revealed),
                  );
                  const unread = undelivered + basePending.length;
                  // 列表预览只显示已进入历史的消息：未送达的事件消息在点进会话前不可见。
                  const played = list.filter(
                    (i) =>
                      (!packedIds.has(i.id) && !isPending(i, revealed)) ||
                      (packedIds.has(i.id) && deliveredIds.has(i.id)),
                  );
                  // 兜底也不取未送达的事件消息，避免预览泄漏新消息内容。
                  const last =
                    (played.length ? played : list).at(-1) ??
                    list.find((i) => !packedIds.has(i.id))!;
                  // 白名单事件包：进入会话前，列表预览就显示第一条收到的消息。
                  // 只对这几个包生效，MAP-001 / BR-001 仍保持「未送达不预览」规则。
                  const previewPending = packs.find(
                    (pk) =>
                      pk.thread === t &&
                      PREVIEW_FIRST_MESSAGE_EVENTS.has(pk.eventId) &&
                      pk.deliveredMessageIds.length === 0,
                  );
                  const shown = previewPending
                    ? (p.items.find(
                        (i) => i.id === previewPending.messageIds[0],
                      ) ?? last)
                    : last;
                  // 会话头像应稳定显示联系人头像：最后一条若由当前账号发出，该条没有头像，
                  // 需回退到会话内对方发来的消息头像，避免退化成首字母占位。
                  const threadAvatar =
                    groupAvatarOf(list) ||
                    shown.avatar ||
                    list.find((i) => !i.outgoing && i.avatar)?.avatar ||
                    list.find((i) => i.avatar)?.avatar ||
                    "";
                  return (
                    <button
                      className="wa-chat-row"
                      key={t}
                    onClick={() => {
                      p.onThread(t);
                      p.onRead(t);
                      p.onReadThread?.(t);
                    }}
                    >
                      <span className="wa-chat-avatar">
                        <Avatar name={t} src={threadAvatar} round />
                        {unread > 0 && <b className="wa-unread">{unread}</b>}
                      </span>
                      <div>
                        <strong>{t}</strong>
                        <p>
                          {shown.outgoing && <CheckCheck size={12} />}{" "}
                          {shown.body}
                        </p>
                      </div>
                      <time>{shown.time.slice(-5)}</time>
                    </button>
                  );
                })}
            </>
          ) : tab === "设置" ? (
            <>
              <div className="wa-settings-profile">
                <Avatar name="我" round />
                <h2>个人资料</h2>
              </div>
              {p.items
                .filter((i) => i.folder === "设置")
                .map((i) => (
                  <button
                    key={i.id}
                    className="wa-record"
                    onClick={() => p.onItem(i)}
                  >
                    {i.title}
                    <span>›</span>
                  </button>
                ))}
            </>
          ) : (
            <>
              {tab === "动态" && (
                <div className="wa-status">
                  <Avatar name="我" round />
                  <span>我的状态</span>
                  {p.creator && (
                    <button aria-label="添加状态" onClick={p.onAdd}>
                      <Plus size={17} />
                    </button>
                  )}
                </div>
              )}
              {p.items
                .filter(
                  (i) =>
                    i.folder === tab || (tab === "通话" && i.kind === "call"),
                )
                .map((i) => (
                  <button
                    className="wa-record"
                    key={i.id}
                    onClick={() => p.onItem(i)}
                  >
                    <Avatar name={i.sender} src={i.avatar} round />
                    <div>
                      <strong>{i.title}</strong>
                      <p>{i.body}</p>
                    </div>
                    <span>
                      {tab === "通话" ? (
                        <Phone size={17} />
                      ) : (
                        <ChevronLeft size={15} />
                      )}
                    </span>
                  </button>
                ))}
              {!p.items.some((i) => i.folder === tab) && (
                <p className="skin-empty">暂无{tab}内容</p>
              )}
            </>
          )}
          {p.creator && (
            <button className="phone-add" onClick={p.onAdd}>
              添加{tab === "聊天" ? "聊天" : tab}内容
            </button>
          )}
        </div>
      )}
      {!p.thread && (
        <nav className="wa-bottom">
          {tabs.map((t) => (
            <button
              className={tab === t.label ? "selected" : ""}
              key={t.label}
              onClick={() => setTab(t.label)}
            >
              <t.icon size={20} />
              <span>{t.label}</span>
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
export function InstagramSkin(p: SkinProps) {
  const [tab, setTab] = useState("首页"),
    [dm, setDm] = useState(false),
    [query, setQuery] = useState(""),
    [likes, setLikes] = useSkinState<string[]>(p, "likes", []),
    [saved, setSaved] = useSkinState<string[]>(p, "saved", []),
    [showSaved, setShowSaved] = useState(false);
  const posts = p.items.filter(
      (i) =>
        i.kind === "post" ||
        !["私信", "Story", "Reels", "个人主页"].includes(i.folder),
    ),
    stories = p.items.filter((i) => i.folder === "Story"),
    reels = p.items.filter((i) => i.kind === "video" || i.folder === "Reels"),
    messages = p.items.filter((i) => i.folder === "私信");
  const tabs = [
    { label: "首页", icon: Home },
    { label: "搜索", icon: Search },
    { label: "Reels", icon: Play },
    { label: "个人主页", icon: User },
  ];
  const shown = (
    showSaved ? posts.filter((i) => saved.includes(i.id)) : posts
  ).filter((i) => (i.title + i.body + i.sender).includes(query));
  return (
    <div className="instagram-ui independent-skin">
      <div className="app-nav ig-nav">
        <button
          aria-label="返回"
          onClick={() => (dm ? setDm(false) : p.onBack())}
        >
          <ChevronLeft size={22} />
        </button>
        <strong>{dm ? "私信" : p.name}</strong>
        <div>
          {p.creator && (
            <button aria-label="新增内容" onClick={p.onAdd}>
              <Plus size={21} />
            </button>
          )}
          <button aria-label="Instagram 私信" onClick={() => setDm(!dm)}>
            <Send size={20} />
          </button>
        </div>
      </div>
      <div className="skin-scroll ig-scroll">
        {dm ? (
          <>
            {messages.map((i) => (
              <button
                key={i.id}
                className="ig-dm-row"
                onClick={() => p.onItem(i)}
              >
                <Avatar name={i.sender} round />
                <div>
                  <strong>{i.sender}</strong>
                  <p>{i.body}</p>
                </div>
              </button>
            ))}
            {!messages.length && <p className="skin-empty">暂无私信</p>}
            {p.creator && (
              <button className="phone-add" onClick={p.onAdd}>
                添加私信
              </button>
            )}
          </>
        ) : tab === "首页" ? (
          <>
            <div className="ig-stories">
              <button
                className="ig-story"
                onClick={
                  p.creator
                    ? p.onAdd
                    : () => {
                        if (stories[0]) p.onItem(stories[0]);
                      }
                }
                disabled={!p.creator && !stories.length}
              >
                <span>
                  <Avatar name="我" round />
                </span>
                <small>你的快拍</small>
              </button>
              {stories.map((i) => (
                <button
                  key={i.id}
                  className="ig-story"
                  onClick={() => p.onItem(i)}
                >
                  <span>
                    <Avatar name={i.sender} round />
                  </span>
                  <small>{i.sender}</small>
                </button>
              ))}
            </div>
            {posts.map((i) => (
              <article className="ig-post" key={i.id}>
                <div className="ig-post-author">
                  <Avatar name={i.sender} round />
                  <strong>{i.sender}</strong>
                  <button
                    aria-label={`帖子详情${i.title}`}
                    onClick={() => p.onItem(i)}
                  >
                    <MoreHorizontal size={19} />
                  </button>
                </div>
                <button className="ig-post-media" onClick={() => p.onItem(i)}>
                  <ItemMedia item={i} />
                </button>
                <div className="ig-post-controls">
                  <button
                    aria-label={`喜欢${i.title}`}
                    onClick={() =>
                      setLikes(
                        likes.includes(i.id)
                          ? likes.filter((x) => x !== i.id)
                          : [...likes, i.id],
                      )
                    }
                  >
                    <Heart
                      size={23}
                      fill={likes.includes(i.id) ? "#ed4956" : "none"}
                      color={likes.includes(i.id) ? "#ed4956" : "currentColor"}
                    />
                  </button>
                  <button
                    aria-label={`评论${i.title}`}
                    onClick={() => p.onItem(i)}
                  >
                    <MessageCircle size={22} />
                  </button>
                  <button
                    aria-label={`查看${i.title}`}
                    onClick={() => p.onItem(i)}
                  >
                    <Send size={21} />
                  </button>
                  <button
                    aria-label={`收藏${i.title}`}
                    onClick={() =>
                      setSaved(
                        saved.includes(i.id)
                          ? saved.filter((x) => x !== i.id)
                          : [...saved, i.id],
                      )
                    }
                  >
                    <Bookmark
                      size={22}
                      fill={saved.includes(i.id) ? "currentColor" : "none"}
                    />
                  </button>
                </div>
                <div className="ig-post-caption">
                  <strong>
                    {i.likes + (likes.includes(i.id) ? 1 : 0)} 次赞
                  </strong>
                  <p>
                    <b>{i.sender}</b> {i.body}
                  </p>
                  <button onClick={() => p.onItem(i)}>
                    查看全部 {i.comments.length} 条评论
                  </button>
                  <time>{i.time}</time>
                </div>
              </article>
            ))}
          </>
        ) : tab === "搜索" ? (
          <>
            <label className="ig-search">
              <Search size={15} />
              <input
                value={query}
                aria-label="搜索Instagram"
                placeholder="搜索"
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <div className="ig-explore">
              {shown.map((i) => (
                <button key={i.id} onClick={() => p.onItem(i)}>
                  <ItemMedia item={i} />
                </button>
              ))}
            </div>
          </>
        ) : tab === "Reels" ? (
          <>
            {reels.map((i) => (
              <div className="ig-reel" key={i.id}>
                <ItemMedia item={i} />
                <button onClick={() => p.onItem(i)}>
                  {i.sender} · {i.title}
                </button>
              </div>
            ))}
            {!reels.length && <p className="skin-empty">暂无 Reels</p>}
          </>
        ) : (
          <>
            <div className="ig-profile">
              <Avatar name={posts[0]?.sender ?? "我"} round />
              <div>
                <strong>{posts.length}</strong>
                <small>帖子</small>
              </div>
              <div>
                <strong>0</strong>
                <small>关注者</small>
              </div>
              <div>
                <strong>0</strong>
                <small>正在关注</small>
              </div>
            </div>
            <h3 className="ig-profile-name">{posts[0]?.sender ?? "我"}</h3>
            <div className="ig-profile-tabs">
              <button aria-label="帖子网格" onClick={() => setShowSaved(false)}>
                <Grid size={21} />
              </button>
              <button
                aria-label="已收藏帖子"
                onClick={() => setShowSaved(true)}
              >
                <Bookmark size={21} />
              </button>
              <button
                aria-label="资料内容"
                onClick={() => {
                  const i = p.items.find((i) => i.folder === "个人主页");
                  if (i) p.onItem(i);
                  else if (p.creator) p.onAdd();
                }}
              >
                <AtSign size={21} />
              </button>
            </div>
            <div className="ig-explore">
              {shown.map((i) => (
                <button key={i.id} onClick={() => p.onItem(i)}>
                  <ItemMedia item={i} />
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      <nav className="ig-bottom">
        {tabs.map((t) => (
          <button
            key={t.label}
            className={tab === t.label ? "selected" : ""}
            aria-label={`Instagram ${t.label}`}
            onClick={() => {
              setTab(t.label);
              setDm(false);
            }}
          >
            <t.icon size={23} />
          </button>
        ))}
      </nav>
    </div>
  );
}
