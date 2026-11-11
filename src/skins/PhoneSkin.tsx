/**
 * 电话 App：iOS 原生风格的四个导航页 + 全屏文字通话。
 *
 * 设计约束（规格第十二章）：
 *  - 不重构全局系统；不调用 p.onItem / p.onRead，所以通话、详情、拨号都不派发剧情
 *    read 事件，也不产生通知（唯一例外是第一次学姐挂断后的两条 WhatsApp 消息，
 *    走 story.json 既有 unlock + notification 事件链）。
 *  - 所有可变状态只经 p.ui / p.onUi 写 Runtime.ui.phone（UiValue 只允许基础类型，
 *    所以结构化状态统一存 JSON 字符串），随 Dexie 存档持久化。
 *  - 台词只读 src/skins/phone-data.ts（从用户规格逐字生成），运行时绝不临场生成。
 *  - 新通话用设备本地真实时间；预置历史记录时间固定不变。
 */
import {
  ChevronLeft,
  Clock,
  Delete,
  Grid,
  MicOff,
  Phone,
  PhoneCall,
  PhoneIncoming,
  PhoneOutgoing,
  Search,
  Star,
  Users,
  Volume2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSkinState } from "../skinState";
import { useScrollRestore, useViewState } from "./viewState";
import type { Item } from "../schema";
import type { Props } from "./shared";
import { meta } from "./shared";
import {
  BUSY_MS,
  CHAR_MS,
  FIRST_CALL_WA,
  FIRST_LINGLING_CONNECTED_MS,
  LINE_GAP_MS,
  LINGLING_SCRIPT,
  MIMI_SCRIPT,
  MOM_SCRIPT,
  NO_ANSWER_MS,
  PHONE_CONTACTS,
  PHONE_HISTORY,
  RING_MS,
  UNKNOWN_NUMBERS,
  type CallLine,
} from "./phone-data";
import "./phone.css";

const SCRIPTS: Record<string, readonly CallLine[]> = {
  mom: MOM_SCRIPT,
  mimi: MIMI_SCRIPT,
  lingling4: LINGLING_SCRIPT,
};

type CallRecord = {
  id: string;
  name: string;
  number: string;
  contactKey: string;
  direction: string;
  status: string;
  duration: string;
  startAt: string;
  connectedAt: string;
  endedAt: string;
  startMs: number;
  lines: CallLine[];
  /** 新通话记录：保证同分钟多条也按真实顺序倒序排列。 */
  seq: number;
};

type PhoneState = {
  /** 规格 7 建议的状态名，只由真正发起的新呼出电话递增。 */
  lingling_call_attempt_count: number;
  firstCallDone: boolean;
  firstWaSent: boolean;
  secondCallDone: boolean;
  thirdCallDone: boolean;
  fourthConnected: boolean;
  fourthCompleted: boolean;
};

type Phase =
  | "ringing"
  | "connected"
  | "busy"
  | "no_answer"
  | "ended";

type Session = {
  id: string;
  name: string;
  number: string;
  contactKey: string;
  avatar: string;
  phase: Phase;
  /** 学姐第几次拨打（非学姐为 0）。 */
  attempt: number;
  scenario: "none" | "mom" | "mimi" | "lingling4";
  /** 无人接听的响铃时长（毫秒），由发起时的分支决定。 */
  ringMs: number;
  startAt: string;
  startMs: number;
  connectedAt: string;
  connectedMs: number;
  endedAt: string;
  endedMs: number;
  lines: CallLine[];
  /** 下一条待播放台词下标；刷新恢复时从这里继续，已完整显示的不重播。 */
  lineIndex: number;
  status: string;
  message: string;
  duration: string;
};

const DEFAULT_STATE: PhoneState = {
  lingling_call_attempt_count: 0,
  firstCallDone: false,
  firstWaSent: false,
  secondCallDone: false,
  thirdCallDone: false,
  fourthConnected: false,
  fourthCompleted: false,
};

const KEYS = {
  log: "callLog",
  state: "phoneState",
  session: "callSession",
  /** 只在第一次学姐挂断时写一次：ui 变化会派发 variable 事件，触发 PHONE_LC_001。 */
  firstEnd: "linglingFirstCallEnd",
};

function parse<T>(raw: string, fallback: T): T {
  try {
    const v = JSON.parse(raw) as T;
    return v ?? fallback;
  } catch {
    return fallback;
  }
}
function pad(n: number) {
  return String(n).padStart(2, "0");
}
/** 与 Phone.realLocalStamp() 同一口径：设备本地 YYYY-MM-DD HH:MM。 */
function localStamp(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function stampMs(ymdhm: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(ymdhm);
  return m
    ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime()
    : 0;
}
function durationText(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}
function isMissed(status: string) {
  return status === "未接来电" || status === "无人接听" || status === "已取消";
}
/**
 * 通讯录号码是模拟器内的脱敏值（例如 +852 6*** 0511），* 代表被遮盖的一位。
 * 拨号键盘只能按出 0-9 / * / #，所以把 * 当作通配符：玩家按出等长号码，
 * 遮盖位填任意数字或 * 都能识别为已保存联系人；其余一律显示「未知号码」。
 */
function dialMatches(input: string, pattern: string) {
  const norm = (s: string) => s.replace(/[\s+-]/g, "");
  const a = Array.from(norm(input));
  const b = Array.from(norm(pattern));
  if (!a.length || a.length !== b.length) return false;
  return a.every((ch, i) =>
    b[i] === "*" ? ch === "*" || /[0-9]/.test(ch) : ch === b[i],
  );
}
function contactByNumber(number: string) {
  return PHONE_CONTACTS.find((c) => dialMatches(number, c.number));
}
function avatarOf(p: Props, name: string) {
  const contactItem = p.items.find(
    (i) => meta(i, "kind") === "contact" && i.title === name,
  );
  return contactItem?.avatar || "";
}
function statusLabel(phase: Phase, session: Session) {
  switch (phase) {
    case "ringing":
      return "正在呼叫…";
    case "busy":
      return "线路忙线，请稍后再试";
    case "no_answer":
      return "对方暂时无法接通";
    case "connected":
      return session.scenario === "none" ? "通话中" : "通话中 · 文字通话";
    case "ended":
      return session.message || "通话已结束";
  }
}
function Avatar({ name, src, large }: { name: string; src: string; large?: boolean }) {
  return src ? (
    <img
      className={`phone-avatar ${large ? "is-large" : ""}`}
      src={src}
      alt={name}
    />
  ) : (
    <span className={`phone-avatar is-default ${large ? "is-large" : ""}`}>
      {Array.from(name)[0] || "?"}
    </span>
  );
}

export function PhoneSkin(p: Props) {
  // 页签 / 搜索词 / 最近通话列表位置随存档恢复；通话状态机仍在既有 KEYS.*
  // 中持久化，不受这里的视图状态影响。
  const [view, patchView] = useViewState(p, { tab: "最近通话", q: "" });
  const tab = view.tab;
  const setTab = (v: string) => patchView({ tab: v });
  const q = view.q;
  const setQ = (v: string) => patchView({ q: v });
  const listScrollRef = useRef<HTMLDivElement>(null);
  const [digits, setDigits] = useState("");
  const [detail, setDetail] = useState<
    | { kind: "record"; record: CallRecord }
    | { kind: "contact"; contactKey: string }
    | null
  >(null);
  const [muted, setMuted] = useState(false);
  const [speaker, setSpeaker] = useState(false);
  const [typing, setTyping] = useState({ id: "", index: -1, chars: 0 });
  const [elapsed, setElapsed] = useState(0);
  /** 只用于给新记录一个稳定的顺序号，避免同一分钟多条记录排序抖动。 */
  const seqRef = useRef(0);

  const [logRaw, setLogRaw] = useSkinState<string>(p, KEYS.log, "[]");
  const [stateRaw, setStateRaw] = useSkinState<string>(
    p,
    KEYS.state,
    JSON.stringify(DEFAULT_STATE),
  );
  const [sessionRaw, setSessionRaw] = useSkinState<string>(p, KEYS.session, "");

  const state = parse<PhoneState>(stateRaw, DEFAULT_STATE);
  const log = parse<CallRecord[]>(logRaw, []);
  const session = sessionRaw ? parse<Session | null>(sessionRaw, null) : null;
  useScrollRestore(
    p,
    `phone:list:${tab}`,
    listScrollRef,
    !session && !detail,
  );
  const contacts = useMemo(
    () => p.items.filter((i) => meta(i, "kind") === "contact"),
    [p.items],
  );

  // 预置历史：时间固定，绝不随现实时间变化（规格九.9）。
  const history: CallRecord[] = useMemo(
    () =>
      PHONE_HISTORY.map((h) => {
        const c = PHONE_CONTACTS.find((x) => x.name === h.name);
        return {
          id: h.id,
          name: h.name,
          number: c ? c.number : h.name,
          contactKey: c ? c.key : "",
          direction: h.direction,
          status: h.status,
          duration: h.duration,
          startAt: h.time,
          connectedAt: "",
          endedAt: "",
          startMs: stampMs(h.time),
          lines: [],
          seq: -1,
        };
      }),
    [],
  );
  const allRecords = useMemo(
    () =>
      [...history, ...log].sort(
        (a, b) => b.startMs - a.startMs || b.seq - a.seq,
      ),
    [history, log],
  );
  seqRef.current = Math.max(seqRef.current, ...log.map((r) => r.seq), 0);

  const writeState = (next: PhoneState) =>
    setStateRaw(JSON.stringify(next));

  /** 真正发起一通新呼出电话：这里是拨打次数唯一递增点。 */
  const startCall = (target: {
    name: string;
    number: string;
    contactKey: string;
  }) => {
    if (session && session.phase !== "ended") return;
    const now = Date.now();
    const isLingling = target.contactKey === "lingling";
    let attempt = 0;
    let scenario: Session["scenario"] = "none";
    let phase: Phase = "ringing";
    let ringMs = NO_ANSWER_MS;
    let message = "";

    if (target.contactKey === "mother") {
      scenario = "mom";
      ringMs = RING_MS;
    } else if (target.contactKey === "mimi") {
      scenario = "mimi";
      ringMs = RING_MS;
    } else if (isLingling) {
      attempt = state.lingling_call_attempt_count + 1;
      if (attempt === 1) {
        // 响铃几声 → 接通约 5 秒 → 对方挂断 → 两条 WhatsApp 消息
        ringMs = RING_MS;
      } else if (attempt === 2 || attempt === 3) {
        // 忙音，不响铃、不接通
        phase = "busy";
        message = "线路忙线，请稍后再试";
      } else if (attempt === 4) {
        scenario = "lingling4";
        ringMs = RING_MS;
      } else {
        // 第五次及以后：普通响铃 8 秒后无人接听，不再有特殊剧情
        ringMs = NO_ANSWER_MS;
      }
    } else {
      // 陌生号码：允许回拨，但绝不接通、绝不生成对话
      ringMs = NO_ANSWER_MS;
    }

    if (isLingling) {
      writeState({
        ...state,
        lingling_call_attempt_count: attempt,
        ...(attempt === 1 ? { firstCallDone: true } : {}),
        ...(attempt === 2 ? { secondCallDone: true } : {}),
        ...(attempt === 3 ? { thirdCallDone: true } : {}),
        ...(attempt === 4 ? { fourthConnected: true } : {}),
      });
    }

    const next: Session = {
      id: `call_${now}_${Math.random().toString(36).slice(2, 8)}`,
      name: target.name,
      number: target.number,
      contactKey: target.contactKey,
      avatar: avatarOf(p, target.name),
      phase,
      attempt,
      scenario,
      ringMs,
      startAt: localStamp(),
      startMs: now,
      connectedAt: "",
      connectedMs: 0,
      endedAt: "",
      endedMs: 0,
      lines: [],
      lineIndex: 0,
      status: "",
      message,
      duration: "",
    };
    setTyping({ id: next.id, index: 0, chars: 0 });
    setElapsed(0);
    setMuted(false);
    setSpeaker(false);
    setDetail(null);
    setSessionRaw(JSON.stringify(next));
  };

  /** 结束通话：生成唯一一条新记录、写实际时长、触发第一次学姐的 WhatsApp 消息。 */
  const finishCall = (s: Session, status: string) => {
    if (s.phase === "ended") return;
    const now = Date.now();
    const duration = s.connectedMs ? durationText(now - s.connectedMs) : "";
    const seq = seqRef.current + 1;
    seqRef.current = seq;
    const record: CallRecord = {
      id: s.id,
      name: s.name,
      number: s.number,
      contactKey: s.contactKey,
      direction: "呼出",
      status,
      duration,
      startAt: s.startAt,
      connectedAt: s.connectedAt,
      endedAt: localStamp(),
      startMs: s.startMs,
      lines: s.lines,
      seq,
    };
    setLogRaw((prev) => {
      const list = parse<CallRecord[]>(prev, []);
      if (list.some((r) => r.id === s.id)) return prev;
      return JSON.stringify([record, ...list]);
    });

    let nextState: PhoneState | null = null;
    if (s.attempt === 4) nextState = { ...state, fourthCompleted: true };
    if (s.attempt === 1 && !state.firstWaSent)
      nextState = { ...(nextState ?? state), firstWaSent: true };
    if (nextState) writeState(nextState);

    // 第一次学姐挂断：只投递一次。ui 变化 → Phone.onUi 派发 variable 事件
    // → story.json 的 PHONE_LC_001 节点 unlock 两条 hidden 消息并投递未读通知。
    if (s.attempt === 1 && !state.firstWaSent) p.onUi?.(KEYS.firstEnd, true);

    setSessionRaw(
      JSON.stringify({
        ...s,
        phase: "ended",
        status,
        duration,
        endedAt: localStamp(),
        endedMs: now,
        message:
          status === "已接通后对方挂断"
            ? "通话已结束 · 对方已挂断"
            : status === "忙线"
              ? "线路忙线，请稍后再试"
              : status === "无人接听"
                ? "对方暂时无法接通"
                : status === "已取消"
                  ? "通话已结束 · 已挂断"
                  : "通话已结束",
      } satisfies Session),
    );
  };

  /** 挂断按钮：只保留已完整显示的台词，不补齐未出现的部分。 */
  const hangUp = () => {
    if (!session || session.phase === "ended") return;
    finishCall(
      session,
      session.connectedMs ? "已接听" : "已取消",
    );
  };

  const patchSession = (s: Session, patch: Partial<Session>) =>
    setSessionRaw(
      JSON.stringify({
        ...parse<Session>(sessionRaw, s),
        ...patch,
      }),
    );

  // ---- 通话阶段驱动 ---------------------------------------------------------
  useEffect(() => {
    if (!session) return;
    const s = session;
    if (s.phase === "ringing") {
      const t = window.setTimeout(() => {
        if (s.scenario === "none" && s.attempt === 1) {
          // 第一次学姐：短暂接通，没有任何文字对话
          patchSession(s, {
            phase: "connected",
            connectedAt: localStamp(),
            connectedMs: Date.now(),
          });
        } else if (s.scenario !== "none") {
          patchSession(s, {
            phase: "connected",
            connectedAt: localStamp(),
            connectedMs: Date.now(),
          });
        } else {
          patchSession(s, {
            phase: "no_answer",
            message: "对方暂时无法接通",
          });
        }
      }, s.ringMs);
      return () => window.clearTimeout(t);
    }
    if (s.phase === "no_answer") {
      const t = window.setTimeout(() => finishCall(s, "无人接听"), 1200);
      return () => window.clearTimeout(t);
    }
    if (s.phase === "busy") {
      const t = window.setTimeout(() => finishCall(s, "忙线"), BUSY_MS);
      return () => window.clearTimeout(t);
    }
    if (s.phase === "connected" && s.scenario === "none") {
      const t = window.setTimeout(
        () => finishCall(s, "已接通后对方挂断"),
        FIRST_LINGLING_CONNECTED_MS,
      );
      return () => window.clearTimeout(t);
    }
    if (s.phase !== "connected" || s.scenario === "none") return;

    // 固定文字通话：一条完整出现后才继续下一条。
    const script = SCRIPTS[s.scenario];
    if (s.lineIndex >= script.length) {
      const t = window.setTimeout(() => finishCall(s, "已接听"), LINE_GAP_MS);
      return () => window.clearTimeout(t);
    }
    const line = script[s.lineIndex];
    const total = Array.from(line.text).length;
    if (
      typing.id !== s.id ||
      typing.index !== s.lineIndex ||
      typing.chars > total
    ) {
      setTyping({ id: s.id, index: s.lineIndex, chars: 0 });
      return;
    }
    if (typing.chars < total) {
      const t = window.setTimeout(
        () => setTyping((x) => ({ ...x, chars: x.chars + 1 })),
        CHAR_MS,
      );
      return () => window.clearTimeout(t);
    }
    const t = window.setTimeout(() => {
      // 一条完整出现 → 落盘（刷新恢复时从这里继续，不重播已显示台词）
      setSessionRaw((prev) => {
        const cur = parse<Session | null>(prev, null);
        if (
          !cur ||
          cur.id !== s.id ||
          cur.phase !== "connected" ||
          cur.lineIndex !== s.lineIndex
        )
          return prev;
        return JSON.stringify({
          ...cur,
          lines: [...cur.lines, line],
          lineIndex: cur.lineIndex + 1,
        });
      });
      setTyping({ id: s.id, index: s.lineIndex + 1, chars: 0 });
    }, LINE_GAP_MS);
    return () => window.clearTimeout(t);
    // finishCall / patchSession 每轮重建，靠 sessionRaw + typing 驱动；
    // 闭包读到的 s 与当前存档一致（写回是同步的）。
    // deps 刻意不含每轮重建的回调（本项目未启用 react-hooks 插件，不用 disable 注释）。
  }, [sessionRaw, typing, stateRaw, logRaw]);

  // 通话计时（只在接通后走；结束态显示最终时长）
  useEffect(() => {
    if (!session || !session.connectedMs) return;
    if (session.phase === "ended") {
      setElapsed(Math.round((session.endedMs - session.connectedMs) / 1000));
      return;
    }
    const tick = () =>
      setElapsed(Math.round((Date.now() - session.connectedMs) / 1000));
    tick();
    const t = window.setInterval(tick, 1000);
    return () => window.clearInterval(t);
  }, [session?.id, session?.phase, session?.connectedMs, session?.endedMs]);

  // ---- 各部分渲染 -----------------------------------------------------------
  const shownRecords = allRecords.filter((r) =>
    (r.name + r.number + r.status).toLowerCase().includes(q.toLowerCase()),
  );
  const shownContacts = contacts.filter((i) =>
    (i.title + meta(i, "number")).toLowerCase().includes(q.toLowerCase()),
  );
  const dialMatch = digits ? contactByNumber(digits) : undefined;
  const dialDisplay = !digits
    ? "输入号码"
    : dialMatch
      ? dialMatch.name
      : "未知号码";

  const back = () => {
    if (session) {
      if (session.phase === "ended") {
        // 已经结束：清掉会话，回到最近通话列表。
        setSessionRaw("");
        setTab("最近通话");
      } else {
        // 通话中离开 App：不结束通话、不补齐台词。已完整显示的台词与播放
        // 游标都留在存档里，重新打开电话 App（或刷新后重进）从下一条继续。
        p.onBack();
      }
      return;
    }
    if (detail) {
      setDetail(null);
      return;
    }
    p.onBack();
  };

  const callRows = shownRecords.map((r) => (
    <button
      key={r.id}
      className={`phone-row ${isMissed(r.status) ? "is-missed" : ""}`}
      data-call-row={r.id}
      onClick={() => setDetail({ kind: "record", record: r })}
    >
      <Avatar name={r.name} src={avatarOf(p, r.name)} />
      <span className="phone-row-main">
        <strong>{r.name}</strong>
        <small>
          {r.direction === "呼出" ? (
            <PhoneOutgoing size={12} aria-label="呼出" />
          ) : (
            <PhoneIncoming size={12} aria-label="呼入" />
          )}
          {r.status}
          {r.duration ? ` · ${r.duration}` : ""}
        </small>
      </span>
      <time>{r.startAt.slice(5)}</time>
    </button>
  ));

  const contactRows = shownContacts.map((i) => (
    <button
      key={i.id}
      className="phone-row"
      data-contact-row={meta(i, "contactKey")}
      onClick={() =>
        setDetail({ kind: "contact", contactKey: meta(i, "contactKey") })
      }
    >
      <Avatar name={i.title} src={i.avatar} />
      <span className="phone-row-main">
        <strong>{i.title}</strong>
        <small>{meta(i, "note")}</small>
      </span>
      <span className="phone-row-number">{meta(i, "number")}</span>
    </button>
  ));

  const detailView = detail ? (
    <div className="phone-detail" data-phone-detail>
      {(() => {
        const r =
          detail.kind === "record"
            ? detail.record
            : allRecords.find((x) => x.contactKey === detail.contactKey);
        const c =
          detail.kind === "contact"
            ? PHONE_CONTACTS.find((x) => x.key === detail.contactKey)
            : PHONE_CONTACTS.find((x) => x.key === r?.contactKey);
        const name =
          detail.kind === "contact" ? (c?.name ?? "") : (r?.name ?? "");
        const number =
          detail.kind === "contact" ? (c?.number ?? "") : (r?.number ?? "");
        const contactKey = c?.key ?? "";
        const related = detail.kind === "contact"
          ? allRecords.filter((x) => x.contactKey === contactKey)
          : r
            ? [r]
            : [];
        return (
          <>
            <div className="phone-detail-hero">
              <Avatar name={name} src={avatarOf(p, name)} large />
              <h2>{name}</h2>
              <p>{number}</p>
              <button
                className="phone-call-button"
                data-phone-call-btn
                aria-label="呼叫"
                onClick={() =>
                  startCall({ name, number, contactKey })
                }
              >
                <Phone size={19} fill="currentColor" />
                呼叫
              </button>
            </div>
            <div className="phone-detail-info">
              {detail.kind === "record" && r ? (
                <>
                  <div>
                    <small>类型</small>
                    <span>{r.direction}</span>
                  </div>
                  <div>
                    <small>状态</small>
                    <span className={isMissed(r.status) ? "is-missed-text" : ""}>
                      {r.status}
                    </span>
                  </div>
                  <div>
                    <small>时间</small>
                    <span>{r.startAt}</span>
                  </div>
                  {r.duration && (
                    <div>
                      <small>通话时长</small>
                      <span>{r.duration}</span>
                    </div>
                  )}
                </>
              ) : (
                <div>
                  <small>备注</small>
                  <span>{c?.note ?? ""}</span>
                </div>
              )}
            </div>
            {related.length > 0 && (
              <div className="phone-detail-related">
                <h3>最近通话</h3>
                {related.map((x) => (
                  <div key={x.id} className="phone-related-row">
                    <span>{x.direction} · {x.status}</span>
                    <time>{x.startAt}</time>
                    {x.duration && <em>{x.duration}</em>}
                  </div>
                ))}
              </div>
            )}
            {/* 第四次通话保存的全部文字内容 */}
            {detail.kind === "record" && r && r.lines.length > 0 && (
              <div className="phone-detail-transcript">
                <h3>通话内容</h3>
                {r.lines.map((l, i) => (
                  <div
                    key={i}
                    className={`phone-transcript-line ${l.side}`}
                    data-call-side={l.side}
                  >
                    {l.text}
                  </div>
                ))}
              </div>
            )}
          </>
        );
      })()}
    </div>
  ) : null;

  const tabIcons: ReactNode[] = [<Star />, <Clock />, <Users />, <Grid />];
  const tabs = ["收藏", "最近通话", "通讯录", "拨号键盘"];

  return (
    <div className="catalog-skin phone-skin">
      <header className="app-nav catalog-nav phone-nav">
        {/* 全屏通话时导航被通话层覆盖，返回入口改由通话界面自己提供，
            避免出现一个看得见却点不到的按钮。 */}
        {session ? (
          <span />
        ) : (
          <button aria-label="返回" onClick={back}>
            <ChevronLeft size={22} />
            {detail ? "返回" : ""}
          </button>
        )}
        <strong>电话</strong>
        <div>
          {!session && !detail && (tab === "最近通话" || tab === "通讯录") && (
            <Search size={18} />
          )}
        </div>
      </header>

      {!session && !detail && (
        <div className="catalog-scroll phone-scroll" ref={listScrollRef}>
          <h1>{tab}</h1>
          {(tab === "最近通话" || tab === "通讯录") && (
            <div className="phone-search">
              <Search size={14} />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="搜索"
                aria-label="搜索"
              />
            </div>
          )}

          {tab === "收藏" && (
            <div className="phone-empty">
              <Star size={30} />
              <p>暂无收藏联系人</p>
            </div>
          )}
          {tab === "最近通话" && (
            <div className="phone-list" data-phone-recents>
              {callRows.length ? callRows : <div className="phone-empty"><p>没有通话记录</p></div>}
            </div>
          )}
          {tab === "通讯录" && (
            <div className="phone-list" data-phone-contacts>
              {contactRows}
            </div>
          )}
          {tab === "拨号键盘" && (
            <div className="phone-dialer">
              <output data-dial-display>{dialDisplay}</output>
              <small className="phone-dial-number">{digits || " "}</small>
              <div className="phone-keypad">
                {["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"].map(
                  (k) => (
                    <button
                      key={k}
                      data-dial-key={k}
                      onClick={() => setDigits((s) => s + k)}
                    >
                      {k}
                      <small>
                        {
                          (
                            {
                              "2": "ABC",
                              "3": "DEF",
                              "4": "GHI",
                              "5": "JKL",
                              "6": "MNO",
                              "7": "PQRS",
                              "8": "TUV",
                              "9": "WXYZ",
                            } as Record<string, string>
                          )[k]
                        }
                      </small>
                    </button>
                  ),
                )}
              </div>
              <div className="phone-dial-actions">
                <button
                  className="phone-dial-call"
                  data-phone-dial-call
                  disabled={!digits}
                  aria-label="拨号"
                  onClick={() =>
                    startCall({
                      name: dialMatch ? dialMatch.name : "未知号码",
                      number: digits,
                      contactKey: dialMatch ? dialMatch.key : "",
                    })
                  }
                >
                  <Phone size={24} fill="currentColor" />
                </button>
                <button
                  className="phone-dial-delete"
                  data-phone-dial-delete
                  aria-label="删除"
                  onClick={() => setDigits((s) => s.slice(0, -1))}
                >
                  <Delete size={20} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {!session && detail && <div className="catalog-scroll phone-scroll">{detailView}</div>}

      {!session && (
        <nav className="catalog-tabs phone-tabs">
          {tabs.map((t, i) => (
            <button
              key={t}
              data-phone-tab={t}
              className={tab === t ? "selected" : ""}
              onClick={() => {
                setTab(t);
                setDetail(null);
                setQ("");
              }}
            >
              {tabIcons[i]}
              <span>{t}</span>
            </button>
          ))}
        </nav>
      )}

      {session && (
        <div
          className="phone-call-screen"
          data-call-phase={session.phase}
          data-call-attempt={session.attempt}
          data-call-line-index={session.lineIndex}
        >
          {/* 通话中途可正常退出：只离开 App，会话与已显示台词留在存档里。 */}
          <button
            className="phone-call-back"
            data-phone-call-back
            aria-label="返回"
            onClick={back}
          >
            <ChevronLeft size={17} />
            返回
          </button>
          <div className="phone-call-hero">
            <Avatar name={session.name} src={session.avatar} large />
            <h2>{session.name}</h2>
            <p>{session.number}</p>
            <div className="phone-call-status" data-call-status>
              {statusLabel(session.phase, session)}
            </div>
            <div className="phone-call-timer" data-call-timer>
              {session.phase === "connected" || session.phase === "ended"
                ? session.phase === "ended" && session.duration
                  ? session.duration
                  : durationText(elapsed * 1000)
                : "00:00"}
            </div>
          </div>

          <div className="phone-call-transcript" data-call-transcript>
            {session.lines.map((l, i) => (
              <div
                key={i}
                className={`phone-bubble ${l.side}`}
                data-call-side={l.side}
              >
                {l.text}
              </div>
            ))}
            {session.phase === "connected" &&
              session.scenario !== "none" &&
              typing.id === session.id &&
              typing.index === session.lineIndex &&
              SCRIPTS[session.scenario]?.[session.lineIndex] && (
                <div
                  className={`phone-bubble is-typing ${
                    SCRIPTS[session.scenario][session.lineIndex].side
                  }`}
                  data-call-side={
                    SCRIPTS[session.scenario][session.lineIndex].side
                  }
                  data-call-typing
                >
                  {Array.from(
                    SCRIPTS[session.scenario][session.lineIndex].text,
                  )
                    .slice(0, typing.chars)
                    .join("")}
                </div>
              )}
          </div>

          <div className="phone-call-controls">
            <button
              className={muted ? "is-on" : ""}
              data-call-mute
              aria-label="静音"
              onClick={() => setMuted((v) => !v)}
            >
              <MicOff size={21} />
              <small>静音</small>
            </button>
            <button
              className={speaker ? "is-on" : ""}
              data-call-speaker
              aria-label="扬声器"
              onClick={() => setSpeaker((v) => !v)}
            >
              <Volume2 size={21} />
              <small>扬声器</small>
            </button>
            <button
              className="phone-hangup"
              data-phone-hangup
              aria-label="挂断"
              disabled={session.phase === "ended"}
              onClick={hangUp}
            >
              <PhoneCall size={24} />
            </button>
          </div>

          {session.phase === "ended" && (
            <button
              className="phone-finish"
              data-phone-finish
              onClick={() => {
                setSessionRaw("");
                setTab("最近通话");
              }}
            >
              返回最近通话
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** 供测试读取：第一次挂断后应投递的两条固定 WhatsApp 消息（不参与运行时生成）。 */
export const PHONE_FIRST_CALL_WA = FIRST_CALL_WA;
export const PHONE_UNKNOWN_NUMBERS = UNKNOWN_NUMBERS;
export const PHONE_HISTORY_ITEMS = PHONE_HISTORY;
export const phoneItemsOf = (items: Item[]) =>
  items.filter((i) => meta(i, "kind") === "contact");
