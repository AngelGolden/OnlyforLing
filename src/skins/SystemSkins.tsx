export { WeatherSkin, HealthSkin } from "./CalibratedSystemApps";
import { AudioPlayer, useTrack } from "../audio";
import "./safari-extra.css";
import "./notes.css";
import "./personalization.css";
import {
  CHECKLIST_RE,
  NOTES_UI_KEY,
  checklistLines,
  nowStamp,
  resolveNotes,
  seedNotes,
  serializeNotes,
  sortNotes,
  updateNote,
  type NoteRecord,
  type NotesState,
} from "./notes-state";
import {
  PHOTOS_UI_KEY,
  favoriteOf,
  photoImage,
  resolvePhotos,
  serializePhotos,
  sortPhotos,
  withCaption,
  withFavorite,
  type PhotosState,
} from "./photos-state";
import { PhotoDetail } from "./photos-detail";
import { useSkinState } from "../skinState";
import { useScrollRestore, useViewState } from "./viewState";
import {
  Calendar,
  Camera,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  ExternalLink,
  FileText,
  Folder,
  Globe,
  Grid,
  Heart,
  Image,
  Check,
  LockKeyhole,
  Plus,
  Trash2,
  MapPin,
  Music,
  Phone,
  Search,
  SkipForward,
  Star,
  Users,
  Wallet,
} from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type UIEvent,
} from "react";
import { download } from "../io";
import { makeItem, safeMedia, type Item } from "../schema";
import {
  Add,
  Avatar,
  Empty,
  groupItems,
  Header,
  Media,
  meta,
  Row,
  SCROLL_END_KEY,
  SearchBox,
  Tabs,
  useContent,
  type Props,
} from "./shared";
/**
 * WA_LC_001：只在「本次进入 App 后确实滚动过、且到达当前列表末尾」时写一次标记。
 * 仅打开 App 就退出、或停在列表中部，都不会写；标记由 Phone.recordReview 消费。
 */
function useScrollEnd(onUi?: Props["onUi"]) {
  const reached = useRef(false);
  return (e: UIEvent<HTMLDivElement>) => {
    if (reached.current || !onUi) return;
    const el = e.currentTarget;
    if (
      el.scrollTop > 0 &&
      el.scrollTop + el.clientHeight >= el.scrollHeight - 24
    ) {
      reached.current = true;
      onUi(SCROLL_END_KEY, true);
    }
  };
}
export function PhoneSkin(p: Props) {
  const { tab, setTab, q, setQ, items } = useContent(p, "最近通话");
  const [digits, setDigits] = useState(""),
    [call, setCall] = useState("");
  const list = tab === "收藏" ? items.filter((i) => i.favorite) : items;
  return (
    <div className="catalog-skin native-phone">
      <Header p={p} />
      <div className="catalog-scroll">
        <h1>{tab}</h1>
        {tab === "拨号键盘" ? (
          <div className="dialer">
            <output>{digits || "输入号码"}</output>
            <div>
              {["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"].map(
                (k) => (
                  <button key={k} onClick={() => setDigits((s) => s + k)}>
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
            <button
              className="dial-call"
              disabled={!digits}
              aria-label="拨号"
              onClick={() => {
                setCall(digits);
                const i = items.find((i) => meta(i, "number") === digits);
                if (i) p.onRead(i.id);
              }}
            >
              <Phone size={24} />
            </button>
            <button onClick={() => setDigits((s) => s.slice(0, -1))}>
              删除
            </button>
          </div>
        ) : (
          <>
            <SearchBox value={q} set={setQ} />
            {list.map((i) => (
              <button
                className={`call-row ${meta(i, "status") === "未接" ? "missed" : ""}`}
                key={i.id}
                onClick={() => p.onItem(i)}
              >
                <Phone size={17} />
                <span>
                  <strong>{i.title}</strong>
                  <small>
                    {meta(i, "number", i.sender)} ·{" "}
                    {meta(i, "status", "通话记录")}
                  </small>
                </span>
                <time>{i.time.slice(5, 10)}</time>
              </button>
            ))}
            <Empty items={list} />
          </>
        )}
      </div>
      <Tabs
        tabs={["收藏", "最近通话", "通讯录", "拨号键盘"]}
        value={tab}
        set={setTab}
        icons={[<Star />, <Clock />, <Users />, <Grid />]}
      />
      {call && (
        <div className="virtual-call">
          <small>通话中</small>
          <Avatar name={call} />
          <h2>{call}</h2>
          <p>正在接通…</p>
          <button aria-label="挂断" onClick={() => setCall("")}>
            <Phone />
          </button>
        </div>
      )}
    </div>
  );
}
export function ContactsSkin(p: Props) {
  const { q, setQ, items } = useContent(p, "所有联系人");
  return (
    <div className="catalog-skin native-contacts">
      <Header p={p} />
      <div className="catalog-scroll">
        <h1>通讯录</h1>
        <SearchBox value={q} set={setQ} />
        <button
          className="contact-self"
          onClick={() => {
            if (items[0]) p.onItem(items[0]);
            else if (p.creator) p.onAdd();
          }}
        >
          <Avatar name={p.owner ?? "我"} />
          <span>
            <strong>{p.owner ?? "我的名片"}</strong>
            <small>我的名片</small>
          </span>
        </button>
        {groupItems(items, "所有联系人").map((g) => (
          <section key={g}>
            <h4 className="native-section">{g}</h4>
            {items
              .filter((i) => (i.folder || "所有联系人") === g)
              .sort((a, b) => a.title.localeCompare(b.title, "zh-CN"))
              .map((i) => (
                <Row
                  key={i.id}
                  item={i}
                  onItem={p.onItem}
                  leading={<Avatar name={i.title} />}
                />
              ))}
          </section>
        ))}
        <Empty items={items} />
      </div>
    </div>
  );
}
/** 相册缩略图：本地静态图优先，旧的内嵌 base64 媒体仍可正常显示。 */
function PhotoThumb({ item }: { item: Item }) {
  const src = photoImage(item);
  return src ? (
    <img className="photos-thumb" loading="lazy" alt={item.title} src={src} />
  ) : (
    <Media item={item} />
  );
}

/**
 * Photos 相册：42 张固定照片为只读编译结果，用户编辑过的说明 / 收藏状态
 * 落在 Runtime.ui.photos.photosState。详情在本 Skin 内切换（与 Notes 一致），
 * 不调用 p.onItem，因此浏览、编辑、收藏都不会派发剧情 read 事件。
 */
export function PhotosSkin(p: Props) {
  // 页面状态（页签 / 搜索词 / 相册）与网格滚动位置落到 Runtime.viewState.photos，
  // 离开 App、切到别的 App、刷新后都能恢复；详情是否打开仍是本次会话内的状态。
  // 用户编辑的 caption / 收藏仍走 Runtime.ui.photos 的 photosState，两者互不覆盖。
  const [view, patchView] = useViewState(p, {
    tab: "图库",
    q: "",
    album: "",
  });
  const { tab, q, album } = view;
  const setTab = (t: string) => patchView({ tab: t });
  const setQ = (s: string) => patchView({ q: s });
  const setAlbum = (a: string) => patchView({ album: a });
  const [raw, setRaw] = useSkinState<string>(p, PHOTOS_UI_KEY, "");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const gridScrollRef = useRef<HTMLDivElement>(null);
  const savedScrollRef = useRef(0);
  const hadDetailRef = useRef(false);
  const onListScroll = useScrollEnd(p.onUi);
  useScrollRestore(
    p,
    `photos:grid:${album || tab}`,
    gridScrollRef,
    !selectedId,
  );

  const state = resolvePhotos(raw);
  const items = p.items.filter((i) =>
    (
      i.title +
      i.body +
      i.sender +
      i.folder +
      Object.values(i.meta ?? {}).join(" ")
    )
      .toLowerCase()
      .includes(q.toLowerCase()),
  );
  const ordered = sortPhotos(items);
  const selected = selectedId
    ? (ordered.find((i) => i.id === selectedId) ?? null)
    : null;

  const save = (next: PhotosState) => setRaw(serializePhotos(next));
  const open = (i: Item) => {
    // 打开前记住网格滚动位置；详情卸载网格后，返回时由 useLayoutEffect 还原。
    savedScrollRef.current = gridScrollRef.current?.scrollTop ?? 0;
    setSelectedId(i.id);
  };
  const close = () => setSelectedId(null);

  useLayoutEffect(() => {
    // 只在「本次进入 App 内从详情返回」时用即时记录的像素还原；
    // App 重开 / 刷新由 useScrollRestore 按内容 ID 还原，这里不要覆盖成 0。
    if (!selectedId && hadDetailRef.current && gridScrollRef.current)
      gridScrollRef.current.scrollTop = savedScrollRef.current;
    hadDetailRef.current = !!selectedId;
  }, [selectedId]);

  if (selected)
    return (
      <PhotoDetail
        item={selected}
        state={state}
        back={close}
        onCaption={(id, caption) => save(withCaption(state, id, caption))}
        onFavorite={(id, favorite) => save(withFavorite(state, id, favorite))}
      />
    );

  const list =
    tab === "收藏"
      ? ordered.filter((i) => favoriteOf(state, i))
      : album
        ? ordered.filter((i) => (i.folder || "未分类") === album)
        : ordered;
  return (
    <div className="catalog-skin native-photos">
      <Header p={p} />
      <div
        className="catalog-scroll"
        ref={gridScrollRef}
        onScroll={tab === "相簿" ? undefined : onListScroll}
      >
        <h1>{album || tab}</h1>
        {tab === "相簿" && !album ? (
          <div className="album-grid">
            {groupItems(ordered, "未分类").map((g) => (
              <button key={g} onClick={() => setAlbum(g)}>
                <PhotoThumb
                  item={ordered.find((i) => (i.folder || "未分类") === g)!}
                />
                <strong>{g}</strong>
                <small>
                  {ordered.filter((i) => (i.folder || "未分类") === g).length} 项
                </small>
              </button>
            ))}
          </div>
        ) : (
          <>
            <SearchBox value={q} set={setQ} />
            <div className="photo-mosaic">
              {list.map((i) => (
                <button
                  aria-label={`查看${i.title}`}
                  key={i.id}
                  data-photo-id={i.id}
                  data-has-image={photoImage(i) ? "1" : "0"}
                  onClick={() => open(i)}
                >
                  <PhotoThumb item={i} />
                  {favoriteOf(state, i) && <Heart size={12} fill="white" />}
                </button>
              ))}
            </div>
            <p className="media-count">{list.length} 个项目</p>
          </>
        )}
        <Empty items={list} />
      </div>
      <Tabs
        tabs={["图库", "相簿", "收藏"]}
        value={tab}
        set={(t) => {
          setTab(t);
          setAlbum("");
        }}
        icons={[<Image />, <Folder />, <Heart />]}
      />
    </div>
  );
}
export function CameraSkin(p: Props) {
  const [mode, setMode] = useState("照片"),
    [index, setIndex] = useState(0);
  const frames = p.items.filter((i) =>
    mode === "视频" ? i.kind === "video" : i.kind !== "video",
  );
  const frame = frames[index % Math.max(frames.length, 1)];
  return (
    <div className="catalog-skin native-camera">
      <Header p={p} />
      <div className="camera-top">
        <span>闪光灯关闭</span>
        <span>{mode === "视频" ? "HD · 30" : "4:3"}</span>
      </div>
      <div className="camera-view">
        {frame ? <Media item={frame} /> : <p>未设置取景画面</p>}
        <div className="camera-grid" />
      </div>
      <div className="camera-mode">
        {["视频", "照片"].map((m) => (
          <button
            className={mode === m ? "selected" : ""}
            key={m}
            onClick={() => {
              setMode(m);
              setIndex(0);
            }}
          >
            {m}
          </button>
        ))}
      </div>
      <div className="camera-controls">
        <button
          aria-label="查看上一画面"
          disabled={!frames.length}
          onClick={() => setIndex((i) => (i + 1) % frames.length)}
        >
          <Image size={24} />
        </button>
        <button
          className="camera-shutter"
          aria-label={p.creator ? "编辑拍摄画面" : "查看拍摄内容"}
          disabled={!p.creator && !frame}
          onClick={() => (p.creator ? p.onAdd() : frame && p.onItem(frame))}
        >
          <span />
        </button>
        <button
          aria-label="切换取景画面"
          disabled={frames.length < 2}
          onClick={() => setIndex((i) => i + 1)}
        >
          <Camera size={24} />
        </button>
      </div>
      <small className="camera-caption">取景内容</small>
    </div>
  );
}
function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function SafariSkin(p: Props) {
  const all = p.items;
  const favorites = all.filter((i) => i.favorite);
  const history = all
    .filter((i) => i.folder === "history")
    .sort((a, b) => b.time.localeCompare(a.time));
  const keywords = all.filter((i) => i.folder === "keyword");

  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"书签" | "历史记录">("书签");
  const [results, setResults] = useState<{
    query: string;
    keyword: Item | null;
  } | null>(null);
  const [reader, setReader] = useState<Item | null>(null);

  // 关键字映射：命中作者配置的关键字 → 其预设结果；否则仅返回 null（通用模板）。
  const matchKeyword = (raw: string): Item | null => {
    const query = raw.trim().toLowerCase();
    if (!query) return null;
    for (const kw of keywords) {
      const aliases = [
        kw.title,
        ...(meta(kw, "aliases") || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      ].map((s) => s.toLowerCase());
      if (aliases.includes(query)) return kw;
      // 仅对 >=3 字符的别名做包含匹配，且查询长度接近别名，避免「餐厅」误命中「红磡餐厅」之类
      const hit = aliases.find(
        (a) =>
          a.length >= 3 &&
          query.includes(a) &&
          (/\s/.test(query) || query.length <= a.length * 2),
      );
      if (hit) return kw;
    }
    return null;
  };

  const submit = () => {
    const query = q.trim();
    if (!query) return;
    const kw = matchKeyword(query);
    // 关键字可配置“直接跳转真实外链”：命中即在新标签打开，不展示结果页。
    const redirect = kw ? meta(kw, "redirect") : "";
    if (redirect) {
      openExternal(redirect);
      setResults(null);
      return;
    }
    setReader(null);
    setResults({ query, keyword: kw });
  };

  const openExternal = (url: string) => {
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  };

  const openReader = (item: Item) => {
    setResults(null);
    setReader(item);
  };

  const openByTarget = (id: string) => {
    const target = all.find((i) => i.id === id);
    if (target) openReader(target);
  };

  // 打开历史记录：先派发 read（BR-001 命中目标时解锁 wa-msg-308 + 通知），再展示结果页。
  const openHistory = (item: Item) => {
    p.onRead(item.id);
    setResults(null);
    setReader(item);
  };

  const openSite = (i: Item) => {
    const url = meta(i, "url");
    if (url) openExternal(url);
    else openReader(i);
  };

  const goBack = () => {
    if (reader) setReader(null);
    else if (results) setResults(null);
    else p.onBack();
  };

  const chooseTab = (t: string) => {
    setReader(null);
    setResults(null);
    setTab(t as "书签" | "历史记录");
  };

  const inReader = !!reader;
  const inResults = !!results && !reader;

  return (
    <div className="catalog-skin native-safari">
      <Header p={{ ...p, onBack: goBack }} />
      <div className="safari-address">
        {inReader || inResults ? (
          <button className="safari-back" aria-label="返回" onClick={goBack}>
            <ChevronLeft size={18} />
          </button>
        ) : null}
        <LockKeyhole size={13} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={
            inReader
              ? meta(reader, "url", "网页")
              : inResults
                ? results!.query
                : "搜索或输入网站名称"
          }
          aria-label="地址栏"
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />
        {!inReader && !inResults ? (
          <button className="safari-go" aria-label="搜索" onClick={submit}>
            <Search size={16} />
          </button>
        ) : (
          <ExternalLink size={15} />
        )}
      </div>
      <div className="catalog-scroll">
        {inReader ? (
          <SafariReader
            item={reader}
            onExternal={openExternal}
            onPage={openReader}
          />
        ) : inResults ? (
          <SafariResults
            query={results!.query}
            keyword={results!.keyword}
            onInternal={openByTarget}
            onExternal={openExternal}
            onPage={openReader}
          />
        ) : tab === "书签" ? (
          <>
            <h4 className="native-section">个人收藏</h4>
            <div className="safari-favorites">
              {favorites.map((i) => (
                <button key={i.id} onClick={() => openSite(i)}>
                  <span>
                    <Globe size={28} />
                  </span>
                  <strong>{i.title}</strong>
                  <small>{meta(i, "url")}</small>
                </button>
              ))}
            </div>
            <h4 className="native-section">最近浏览</h4>
            <div className="safari-history">
              {history.map((i) => (
                <button
                  key={i.id}
                  className="safari-hist-row"
                  onClick={() => openHistory(i)}
                >
                  <Clock size={15} />
                  <div>
                    <strong>{i.title}</strong>
                    <small>{meta(i, "url") || i.time}</small>
                  </div>
                  <time>{i.time.slice(5, 10)}</time>
                </button>
              ))}
            </div>
            <Empty items={history} />
          </>
        ) : (
          <div className="safari-history">
            {history.map((i) => (
              <button
                key={i.id}
                className="safari-hist-row"
                onClick={() => openHistory(i)}
              >
                <Clock size={15} />
                <div>
                  <strong>{i.title}</strong>
                  <small>{meta(i, "url") || i.time}</small>
                </div>
                <time>{i.time.slice(5, 10)}</time>
              </button>
            ))}
            <Empty items={history} />
          </div>
        )}
      </div>
      {!inReader && (
        <Tabs
          tabs={["书签", "历史记录"]}
          value={tab}
          set={chooseTab}
          icons={[<Globe />, <Clock />]}
        />
      )}
    </div>
  );
}

function SafariResults({
  query,
  keyword,
  onInternal,
  onExternal,
  onPage,
}: {
  query: string;
  keyword: Item | null;
  onInternal: (id: string) => void;
  onExternal: (url: string) => void;
  onPage: (item: Item) => void;
}) {
  if (keyword) {
    const list = parseJson<
      {
        result_id: string;
        result_title: string;
        result_description: string;
        internal_target: string;
        external_url: string;
      }[]
    >(meta(keyword, "results"), []);
    return (
      <div className="safari-search-results">
        <div className="safari-search-head">搜索 “{query}”</div>
        {list.map((r) => (
          <button
            key={r.result_id}
            className="safari-result"
            onClick={() =>
              r.internal_target
                ? onInternal(r.internal_target)
                : r.external_url
                  ? onExternal(r.external_url)
                  : undefined
            }
          >
            <strong>{r.result_title}</strong>
            <small>{r.result_description}</small>
            {r.external_url && <span className="safari-ext">↗</span>}
          </button>
        ))}
      </div>
    );
  }
  const generic = [
    `关于「${query}」的论坛讨论`,
    `「${query}」相关资讯`,
    `「${query}」的网页结果`,
  ];
  return (
    <div className="safari-search-results">
      <div className="safari-search-head">搜索 “{query}”</div>
      {generic.map((t, i) => (
        <button
          key={i}
          className="safari-result"
          onClick={() =>
            onPage(
              makeItem({
                title: t,
                body: `这是关于「${query}」的普通生活资讯，。`,
                folder: "page",
              }),
            )
          }
        >
          <strong>{t}</strong>
          <small>普通网络结果</small>
        </button>
      ))}
    </div>
  );
}

function SafariReader({
  item,
  onExternal,
  onPage,
}: {
  item: Item;
  onExternal: (url: string) => void;
  onPage: (item: Item) => void;
}) {
  const m = item.meta ?? {};
  const resultPage = parseJson<{ t: string; d: string }[]>(
    m.result_page ?? "",
    [],
  );
  const restaurants = parseJson<string[]>(m.restaurants ?? "", []);
  const url = m.url || "";
  if (resultPage.length || restaurants.length) {
    return (
      <div className="safari-page">
        <div className="safari-page-title">{item.title}</div>
        <div className="safari-search-results">
          {resultPage.map((r, i) => (
            <button
              key={i}
              className="safari-result"
              onClick={() =>
                onPage(makeItem({ title: r.t, body: r.d, folder: "page" }))
              }
            >
              <strong>{r.t}</strong>
              <small>{r.d}</small>
            </button>
          ))}
        </div>
        {restaurants.length > 0 && (
          <>
            <h4 className="native-section">附近餐厅</h4>
            <ul className="safari-restaurants">
              {restaurants.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </>
        )}
      </div>
    );
  }
  if (url) {
    return (
      <div className="safari-page">
        <div className="safari-page-title">{item.title}</div>
        <a
          className="safari-ext-card"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => {
            e.preventDefault();
            onExternal(url);
          }}
        >
          <Globe size={18} />
          <span>{url}</span>
          <ExternalLink size={15} />
        </a>
      </div>
    );
  }
  return (
    <div className="safari-page">
      <div className="safari-page-title">{item.title}</div>
      <div className="safari-page-body">{item.body || "（暂无内容）"}</div>
    </div>
  );
}
/** 显示用的轻量排版：只把 **加粗** 渲染成粗体，不改动任何存储文本。 */
function inlineText(text: string): ReactNode[] {
  return text
    .split(/(\*\*[^*]+\*\*)/g)
    .filter(Boolean)
    .map((part, i) =>
      part.startsWith("**") && part.endsWith("**") ? (
        <strong key={i}>{part.slice(2, -2)}</strong>
      ) : (
        <span key={i}>{part}</span>
      ),
    );
}

/** 只读视图里的清单行：勾选状态单独持久化，正文 body 永远保持导入时的原文。 */
function NoteBody({
  note,
  onToggle,
}: {
  note: NoteRecord;
  onToggle: (ordinal: number) => void;
}) {
  let ordinal = 0;
  return (
    <div className="notes-body-view">
      {note.body.split("\n").map((line, i) => {
        const m = line.match(CHECKLIST_RE);
        if (m) {
          const o = ordinal++;
          const checked = note.checked.includes(o);
          return (
            <button
              type="button"
              key={i}
              role="checkbox"
              aria-checked={checked}
              aria-label={`清单项 ${m[1]}`}
              data-check-ordinal={o}
              className={`notes-check-row${checked ? " checked" : ""}`}
              onClick={() => onToggle(o)}
            >
              <span className="notes-check-box">{checked && <Check size={12} />}</span>
              <span className="notes-check-text">{inlineText(m[1])}</span>
            </button>
          );
        }
        return (
          <p className="notes-line" key={i}>
            {line ? inlineText(line) : "\u00a0"}
          </p>
        );
      })}
    </div>
  );
}

/** 列表预览：取第一行非空文字，去掉清单/加粗标记，仅用于展示，不改 body。 */
function previewOf(body: string) {
  const line =
    body.split("\n").find((x) => x.trim()) || "没有其他文本";
  const plain = line.replace(CHECKLIST_RE, "$1").replace(/\*\*/g, "");
  return plain;
}

/**
 * Notes 备忘录：15 条固定原文为只读种子，用户编辑落 Runtime.ui.notes.notesState。
 * 全部交互（打开 / 搜索 / 编辑 / 勾选 / 删除 / 新建）只走 onUi 写 UI 状态，
 * 不调用 onItem / onRead，因此不会派发任何剧情事件、也不会产生通知。
 */
export function NotesSkin(p: Props) {
  const [raw, setRaw] = useSkinState<string>(p, NOTES_UI_KEY, "");
  // 文件夹 / 搜索词 / 列表滚动位置持久化；用户编辑内容仍在 notesState。
  const [view, patchView] = useViewState(p, { folder: "", q: "" });
  const folder = view.folder || null;
  const q = view.q;
  const setFolder = (f: string | null) => patchView({ folder: f ?? "" });
  const setQ = (s: string) => patchView({ q: s });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const seededRef = useRef(false);
  const paperScrollRef = useRef<HTMLDivElement>(null);
  const listScrollRef = useRef<HTMLDivElement>(null);
  const onListScroll = useScrollEnd(p.onUi);
  useScrollRestore(p, `notes:list:${folder || "all"}`, listScrollRef, !selectedId);

  // 首次导入：把固定原文播种成可编辑状态并记录 imported 标记。
  // 已有存档（哪怕字符串异常）一律不覆盖，避免把用户已编辑的内容恢复成初始文案。
  useEffect(() => {
    if (seededRef.current || !p.onUi || raw || !p.items.length) return;
    seededRef.current = true;
    setRaw(serializeNotes(seedNotes(p.items)));
  }, []);

  // 列表和详情复用同一个 .catalog-scroll 节点，从滚动过的列表打开备忘录时会
  // 沿用旧 scrollTop；每次打开都回到顶部，保证先看到日期、标题和正文开头。
  useLayoutEffect(() => {
    if (selectedId && paperScrollRef.current)
      paperScrollRef.current.scrollTop = 0;
  }, [selectedId]);

  const state = resolveNotes(p.items, raw);
  const notes = sortNotes(state.notes);
  const selected = selectedId
    ? (state.notes.find((n) => n.id === selectedId && !n.deleted) ?? null)
    : null;

  const save = (next: NotesState) => setRaw(serializeNotes(next));
  const patchSelected = (patch: Partial<NoteRecord>) => {
    if (selected) save(updateNote(state, selected.id, patch));
  };
  const closeNote = () => {
    setSelectedId(null);
    setEditing(false);
    setConfirmDelete(false);
  };
  const toggleCheck = (ordinal: number) => {
    if (!selected) return;
    const checked = selected.checked.includes(ordinal)
      ? selected.checked.filter((x) => x !== ordinal)
      : [...selected.checked, ordinal];
    save(updateNote(state, selected.id, { checked }));
  };
  const removeNote = () => {
    if (!selected) return;
    save({
      ...state,
      notes: state.notes.map((n) =>
        n.id === selected.id ? { ...n, deleted: true } : n,
      ),
    });
    closeNote();
  };
  const createNote = () => {
    const stamp = nowStamp();
    const id = `note_user_${Date.now()}`;
    const record: NoteRecord = {
      id,
      title: "",
      body: "",
      createdAt: stamp,
      modifiedAt: stamp,
      type: "text",
      folder: folder || "备忘录",
      checked: [],
      deleted: false,
    };
    save({ ...state, notes: [record, ...state.notes] });
    setSelectedId(id);
    setEditing(true);
    setConfirmDelete(false);
  };

  if (selected)
    return (
      <div className="catalog-skin native-notes notes-editor" data-note-id={selected.id}>
        <header className="app-nav notes-editor-nav">
          <button aria-label="返回备忘录列表" onClick={closeNote}>
            <ChevronLeft size={22} />
            备忘录
          </button>
          <strong />
          <button
            aria-label={editing ? "完成编辑" : "编辑备忘录"}
            onClick={() => {
              setEditing(!editing);
              setConfirmDelete(false);
            }}
          >
            {editing ? "完成" : "编辑"}
          </button>
        </header>
        <div className="catalog-scroll notes-paper-scroll" ref={paperScrollRef}>
          <div className="native-note-paper notes-paper">
            <time>{selected.modifiedAt}</time>
            {editing ? (
              <>
                <input
                  className="notes-title-input"
                  aria-label="备忘录标题"
                  placeholder="标题"
                  value={selected.title}
                  onChange={(e) => patchSelected({ title: e.target.value })}
                />
                <textarea
                  className="notes-body-input"
                  aria-label="备忘录正文"
                  placeholder="开始书写…"
                  value={selected.body}
                  onChange={(e) => patchSelected({ body: e.target.value })}
                />
              </>
            ) : (
              <>
                <h1>{selected.title || "新备忘录"}</h1>
                <NoteBody note={selected} onToggle={toggleCheck} />
              </>
            )}
          </div>
        </div>
        <footer className="native-detail-toolbar notes-editor-toolbar">
          <button aria-label="返回文件夹" onClick={closeNote}>
            <Folder size={19} />
          </button>
          <span />
          <button
            aria-label="删除备忘录"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 size={18} />
          </button>
        </footer>
        {confirmDelete && (
          <div className="native-action-sheet notes-delete-sheet">
            <small>删除后无法恢复，确定删除这条备忘录？</small>
            <button
              className="notes-delete-confirm"
              aria-label="确认删除备忘录"
              onClick={removeNote}
            >
              删除备忘录
            </button>
            <button onClick={() => setConfirmDelete(false)}>取消</button>
          </div>
        )}
      </div>
    );

  const folders = [...new Set(notes.map((n) => n.folder || "备忘录"))];
  const query = q.trim().toLowerCase();
  const list = notes.filter(
    (n) =>
      (!folder || (n.folder || "备忘录") === folder) &&
      (!query || (n.title + "\n" + n.body).toLowerCase().includes(query)),
  );
  return (
    <div className="catalog-skin native-notes">
      <Header p={p} />
      <div className="catalog-scroll" ref={listScrollRef} onScroll={onListScroll}>
        <button className="notes-back" onClick={() => setFolder(null)}>
          <Folder size={17} />
          文件夹
        </button>
        <h1>{folder || "所有备忘录"}</h1>
        <SearchBox value={q} set={setQ} />
        {!folder && (
          <div className="note-folders">
            {folders.map((g) => (
              <button key={g} onClick={() => setFolder(g)}>
                <Folder size={17} />
                {g}
                <small>{notes.filter((n) => (n.folder || "备忘录") === g).length}</small>
              </button>
            ))}
          </div>
        )}
        <div className="notes-list">
          {list.map((n) => (
            <button
              key={n.id}
              className="notes-row"
              data-note-id={n.id}
              data-checklist-count={checklistLines(n.body).length}
              onClick={() => {
                setSelectedId(n.id);
                setEditing(false);
                setConfirmDelete(false);
              }}
            >
              <strong>{n.title || "新备忘录"}</strong>
              <p>
                <time>{n.modifiedAt.slice(5, 10)}</time> {previewOf(n.body)}
              </p>
              <small>{n.folder}</small>
            </button>
          ))}
        </div>
        {!list.length && <p className="catalog-empty">暂无备忘录</p>}
      </div>
      <div className="notes-footer">
        <span>{list.length} 则备忘录</span>
        {!p.creator && (
          <button
            className="notes-compose"
            aria-label="新建备忘录"
            onClick={createNote}
          >
            <Plus size={15} />
          </button>
        )}
        <Add p={p} label="新建备忘录" />
      </div>
    </div>
  );
}
export function CalendarSkin(p: Props) {
  // 有「特别提醒」时默认打开那一天，避免玩家要连翻两个月才看得到。
  const special = p.items.find(
    (i) => i.meta?.special === "true" && /^\d{4}-\d{2}-\d{2}/.test(i.time),
  );
  const [month, setMonth] = useState(
    special ? Number(special.time.slice(5, 7)) - 1 : 8,
  );
  const [year, setYear] = useState(
    special ? Number(special.time.slice(0, 4)) : 2026,
  );
  const [day, setDay] = useState(
    special ? Number(special.time.slice(8, 10)) : 1,
  );
  const prefix = `${year}-${String(month + 1).padStart(2, "0")}`;
  const list = p.items.filter((i) =>
    i.time.startsWith(`${prefix}-${String(day).padStart(2, "0")}`),
  );
  const move = (d: number) => {
    const date = new Date(Date.UTC(year, month + d, 1));
    setYear(date.getUTCFullYear());
    setMonth(date.getUTCMonth());
    setDay(1);
  };
  const first = new Date(Date.UTC(year, month, 1)).getUTCDay(),
    days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return (
    <div className="catalog-skin native-calendar">
      <Header p={p} />
      <div className="catalog-scroll">
        <div className="month-title">
          <button aria-label="上个月" onClick={() => move(-1)}>
            <ChevronLeft />
          </button>
          <h2>
            {year} 年 {month + 1} 月
          </h2>
          <button aria-label="下个月" onClick={() => move(1)}>
            <ChevronRight />
          </button>
        </div>
        <div className="calendar-grid">
          {["日", "一", "二", "三", "四", "五", "六"].map((t) => (
            <small key={t}>{t}</small>
          ))}
          {Array.from({ length: first }, (_, i) => (
            <span key={"blank" + i} />
          ))}
          {Array.from({ length: days }, (_, i) => (
            <button
              className={day === i + 1 ? "selected" : ""}
              key={i}
              onClick={() => setDay(i + 1)}
            >
              {i + 1}
              {p.items.some((x) =>
                x.time.startsWith(
                  `${prefix}-${String(i + 1).padStart(2, "0")}`,
                ),
              ) && <i />}
            </button>
          ))}
        </div>
        <h4 className="native-section">
          {month + 1} 月 {day} 日
        </h4>
        {list.map((i) => (
          <button
            className="calendar-event"
            key={i.id}
            onClick={() => p.onItem(i)}
          >
            <time>{i.time.slice(-5)}</time>
            <div>
              <strong>
                {i.title}
                {i.meta?.special === "true" && (
                  <em className="calendar-special">
                    {meta(i, "note", "特别提醒")}
                  </em>
                )}
              </strong>
              <p>{meta(i, "location", i.body)}</p>
            </div>
          </button>
        ))}
        <Empty items={list} label="当天没有日程" />
        <Add p={p} label="添加日程" />
      </div>
    </div>
  );
}
export function MailSkin(p: Props) {
  const { tab, setTab, q, setQ, items } = useContent(p, "收件箱");
  const list = items.filter(
    (i) =>
      tab === "全部邮件" ||
      i.folder === tab ||
      (tab === "收件箱" &&
        (!i.folder || !["草稿", "已发送"].includes(i.folder))),
  );
  return (
    <div className="catalog-skin native-mail">
      <Header p={p} />
      <div className="mail-folders">
        {["收件箱", "草稿", "已发送", "全部邮件"].map((t) => (
          <button
            key={t}
            className={tab === t ? "selected" : ""}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="catalog-scroll">
        <h1>{tab}</h1>
        <SearchBox value={q} set={setQ} />
        {list.map((i) => (
          <button
            className="mail-preview"
            key={i.id}
            onClick={() => p.onItem(i)}
          >
            <i className={!i.read ? "unread" : ""} />
            <div>
              <strong>{i.sender}</strong>
              <h3>{i.title}</h3>
              <p>{i.body}</p>
            </div>
            <time>{i.time.slice(5, 10)}</time>
          </button>
        ))}
        <Empty items={list} />
      </div>
      <footer className="mail-footer">
        <span>{list.length} 封邮件</span>
        <Add p={p} label="写邮件" />
      </footer>
    </div>
  );
}
export function ClockSkin(p: Props) {
  const { tab, setTab, items } = useContent(p, "闹钟");
  // content.clock 同时存放闹钟与世界时钟，按 folder 分给各自的页签。
  const shown = items.filter((i) => (i.folder || "闹钟") === tab);
  const [enabled, setEnabled] = useSkinState<string[]>(p, "alarms", []),
    [seconds, setSeconds] = useState(0),
    [running, setRunning] = useState(false);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [running]);
  return (
    <div className="catalog-skin native-clock">
      <Header p={p} />
      <div className="catalog-scroll">
        <h1>{tab}</h1>
        {tab === "秒表" ? (
          <div className="stopwatch">
            <output>
              {String(Math.floor(seconds / 60)).padStart(2, "0")}:
              {String(seconds % 60).padStart(2, "0")}
            </output>
            <div>
              <button
                onClick={() => {
                  setSeconds(0);
                  setRunning(false);
                }}
              >
                复位
              </button>
              <button onClick={() => setRunning(!running)}>
                {running ? "暂停" : "开始"}
              </button>
            </div>
          </div>
        ) : (
          shown.map((i) => (
            <div className="alarm-row" key={i.id} data-clock-tab={tab}>
              <button onClick={() => p.onItem(i)}>
                {tab === "世界时钟" ? (
                  <>
                    <time className="alarm-zone">
                      {meta(i, "zone", "GMT+8")}
                    </time>
                    <small>{meta(i, "city", i.title)}</small>
                    {meta(i, "offset") && (
                      <small className="alarm-sub">{meta(i, "offset")}</small>
                    )}
                  </>
                ) : (
                  <>
                    <time>{meta(i, "clock", i.time.slice(-5))}</time>
                    <small>{i.title}</small>
                    {meta(i, "repeat") && (
                      <small className="alarm-sub">{meta(i, "repeat")}</small>
                    )}
                  </>
                )}
              </button>
              {tab === "闹钟" ? (
                <button
                  role="switch"
                  aria-label={`闹钟${i.title}`}
                  aria-checked={enabled.includes(i.id)}
                  className={`native-switch ${enabled.includes(i.id) ? "on" : ""}`}
                  onClick={() =>
                    setEnabled(
                      enabled.includes(i.id)
                        ? enabled.filter((x) => x !== i.id)
                        : [...enabled, i.id],
                    )
                  }
                >
                  <span />
                </button>
              ) : (
                <Clock size={35} />
              )}
            </div>
          ))
        )}
      </div>
      <Tabs
        tabs={["世界时钟", "闹钟", "秒表"]}
        value={tab}
        set={setTab}
        icons={[<Globe />, <Clock />, <Clock />]}
      />
    </div>
  );
}
export function RemindersSkin(p: Props) {
  const { tab, setTab, q, setQ, items } = useContent(p, "全部");
  const [checked, setChecked] = useSkinState<string[]>(p, "checked", []);
  const list =
    tab === "已完成"
      ? items.filter((i) => checked.includes(i.id))
      : items.filter((i) => !checked.includes(i.id));
  return (
    <div className="catalog-skin native-reminders">
      <Header p={p} />
      <div className="catalog-scroll">
        <SearchBox value={q} set={setQ} />
        <div className="reminder-categories">
          {["全部", "已完成"].map((t) => (
            <button key={t} onClick={() => setTab(t)}>
              <Calendar size={22} />
              <strong>
                {t === "全部" ? items.length - checked.length : checked.length}
              </strong>
              <span>{t}</span>
            </button>
          ))}
        </div>
        <h1>{tab}</h1>
        {list.map((i) => (
          <div className="reminder-row" key={i.id}>
            <button
              aria-label={`完成${i.title}`}
              role="checkbox"
              aria-checked={checked.includes(i.id)}
              onClick={() =>
                setChecked(
                  checked.includes(i.id)
                    ? checked.filter((x) => x !== i.id)
                    : [...checked, i.id],
                )
              }
            >
              <CheckCircle size={21} />
            </button>
            <button onClick={() => p.onItem(i)}>
              <strong>{i.title}</strong>
              <small>
                {i.time} · {i.folder}
              </small>
            </button>
          </div>
        ))}
        <Add p={p} label="新提醒事项" />
      </div>
    </div>
  );
}
export function FilesSkin(p: Props) {
  const { tab, setTab, q, setQ, items } = useContent(p, "最近项目");
  const [folder, setFolder] = useState("");
  const list = folder
    ? items.filter((i) => (i.folder || "我的iPhone") === folder)
    : items;
  return (
    <div className="catalog-skin native-files">
      <Header p={p} />
      <div className="catalog-scroll">
        <h1>{folder || tab}</h1>
        <SearchBox value={q} set={setQ} />
        {tab === "浏览" && !folder ? (
          <div className="file-folders">
            {groupItems(items, "我的iPhone").map((g) => (
              <button key={g} onClick={() => setFolder(g)}>
                <Folder size={45} />
                <strong>{g}</strong>
              </button>
            ))}
          </div>
        ) : (
          <div className="file-grid">
            {list.map((i) => (
              <div key={i.id}>
                <button onClick={() => p.onItem(i)}>
                  {i.media ? <Media item={i} /> : <FileText size={49} />}
                  <strong>{i.title}</strong>
                  <small>
                    {meta(i, "extension", "文件")} ·{" "}
                    {meta(i, "size", i.time.slice(0, 10))}
                  </small>
                </button>
                <button
                  aria-label={`下载${i.title}文本`}
                  onClick={() =>
                    download(
                      new Blob([i.body], { type: "text/plain" }),
                      `${i.title}.txt`,
                    )
                  }
                >
                  <Download size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
        <Empty items={list} />
      </div>
      <Tabs
        tabs={["最近项目", "浏览"]}
        value={tab}
        set={(t) => {
          setTab(t);
          setFolder("");
        }}
        icons={[<Clock />, <Folder />]}
      />
    </div>
  );
}
export function MusicSkin(p: Props) {
  const { tab, setTab, items } = useContent(p, "资料库");
  const [song, setSong] = useTrack(p, items);
  return (
    <div className="catalog-skin native-music">
      <Header p={p} />
      <div className="catalog-scroll">
        <h1>{tab}</h1>
        {tab === "歌单" ? (
          <div className="music-albums">
            {groupItems(items, "我的音乐").map((g) => (
              <button
                key={g}
                onClick={() => {
                  const i = items.find((i) => (i.folder || "我的音乐") === g);
                  if (i) setSong(i);
                }}
              >
                <Music size={51} />
                <strong>{g}</strong>
              </button>
            ))}
          </div>
        ) : (
          items.map((i, n) => (
            <button
              className="music-track"
              key={i.id}
              onClick={() => {
                setSong(i);
              }}
            >
              <small>{n + 1}</small>
              <span>
                <strong>{i.title}</strong>
                <small>
                  {i.sender} · {meta(i, "album")}
                </small>
              </span>
              <span>{meta(i, "duration")}</span>
            </button>
          ))
        )}
        <Empty items={items} />
      </div>
      {song && (
        <div className="native-now-playing">
          <button onClick={() => p.onItem(song)}>
            <Music size={20} />
            {song.title}
          </button>
          {song.kind === "audio" && safeMedia(song.media) ? (
            <AudioPlayer p={p} item={song} />
          ) : (
            <button onClick={() => p.onItem(song)}>查看歌曲内容</button>
          )}
          <button
            aria-label="下一首"
            onClick={() =>
              setSong(
                items[
                  (items.findIndex((i) => i.id === song.id) + 1) % items.length
                ],
              )
            }
          >
            <SkipForward size={18} />
          </button>
        </div>
      )}
      <Tabs
        tabs={["资料库", "歌单"]}
        value={tab}
        set={setTab}
        icons={[<Music />, <Folder />]}
      />
    </div>
  );
}
function LocationMap({
  items,
  onItem,
  find = false,
}: {
  items: Item[];
  onItem: (i: Item) => void;
  find?: boolean;
}) {
  return (
    <div className={`fiction-map ${find ? "find-map" : ""}`}>
      <svg viewBox="0 0 300 300" aria-label="地图">
        <rect width="300" height="300" fill="#e4e5d8" />
        {[35, 100, 190, 260].map((n) => (
          <path
            key={n}
            d={`M0 ${n} H300 M${n} 0 V300`}
            stroke="#fff"
            strokeWidth="11"
          />
        ))}
        <path
          d="M20 0 Q190 110 120 300"
          stroke="#b6d8df"
          strokeWidth="24"
          fill="none"
        />
        <rect x="205" y="112" width="42" height="65" rx="7" fill="#bdcfac" />
      </svg>
      {items.map((i, n) => (
        <button
          key={i.id}
          aria-label={`地图位置${i.title}`}
          className="map-pin"
          style={{
            left: `${Math.max(5, Math.min(90, Number(meta(i, "x", String(20 + ((n * 17) % 65))))))}%`,
            top: `${Math.max(8, Math.min(80, Number(meta(i, "y", String(25 + ((n * 13) % 50))))))}%`,
          }}
          onClick={() => onItem(i)}
        >
          {find ? <Avatar name={i.title} /> : <MapPin size={24} />}
        </button>
      ))}
    </div>
  );
}
export function WalletSkin(p: Props) {
  const [selected, setSelected] = useState("");
  const cards = p.items.filter((i) => i.folder !== "交易"),
    transactions = p.items.filter((i) => i.folder === "交易");
  return (
    <div className="catalog-skin native-wallet">
      <Header p={p} />
      <div className="catalog-scroll">
        <h1>钱包</h1>
        <div className="wallet-stack">
          {cards.map((i, n) => (
            <button
              key={i.id}
              className={selected === i.id ? "selected" : ""}
              style={{
                background: ["#252d38", "#716456", "#4a655d", "#735e6b"][n % 4],
              }}
              onClick={() => {
                setSelected(i.id);
                p.onItem(i);
              }}
            >
              <strong>{i.title}</strong>
              <span>{meta(i, "number", "••••")}</span>
              <small>{meta(i, "amount", i.sender)}</small>
            </button>
          ))}
        </div>
        <h4 className="native-section">交易记录</h4>
        {transactions.map((i) => (
          <Row key={i.id} item={i} onItem={p.onItem} leading={<Wallet />}>
            <strong>{meta(i, "amount")}</strong>
          </Row>
        ))}
        <Empty items={p.items} />
      </div>
    </div>
  );
}
export function FindSkin(p: Props) {
  const { tab, setTab, items } = useContent(p, "设备");
  const list = items.filter((i) =>
    tab === "设备" ? i.folder !== "人物" : i.folder === "人物",
  );
  return (
    <div className="catalog-skin native-find">
      <Header p={p} />
      <LocationMap items={list} onItem={p.onItem} find />
      <div className="find-sheet">
        <h2>{tab}</h2>
        {list.map((i) => (
          <Row
            key={i.id}
            item={i}
            onItem={p.onItem}
            leading={<Avatar name={i.title} />}
          >
            {meta(i, "status", "位置记录")}
          </Row>
        ))}
        <Empty items={list} />
      </div>
      <Tabs
        tabs={["人物", "设备"]}
        value={tab}
        set={setTab}
        icons={[<Users />, <MapPin />]}
      />
    </div>
  );
}
