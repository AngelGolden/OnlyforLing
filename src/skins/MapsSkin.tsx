import {
  ChevronLeft,
  Compass,
  MapPin,
  Minus,
  Plus,
  Search,
  Utensils,
  X,
} from "lucide-react";
import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { meta, type Props } from "./shared";
import "./maps.css";

/** 「紅磡附近餐廳」搜索结果页 ID —— MAP-001 的触发页面。 */
const RESTAURANT_RESULT_ID = "map_result_hung_hom_restaurants";
const RESTAURANT_QUERY = "紅磡附近餐廳";

/** 预置的最近搜索记录（顺序固定，第一条是 MAP-001 主线入口）。 */
const RECENT_SEARCHES = [
  RESTAURANT_QUERY,
  "香港理工大學",
  "黃埔天地",
  "紅磡站",
];

const PIN_COLORS: Record<string, string> = {
  school: "#6f93cf",
  music: "#a273c9",
  home: "#d9814f",
  transit: "#3f7fbf",
  mall: "#cf9c3c",
  japanese: "#dd6158",
  thai: "#4da173",
  hk: "#3a8ab5",
  hotpot: "#b84b3c",
};

type Point = {
  id: string;
  title: string;
  kind: string;
  type: string;
  body: string;
  x: number;
  y: number;
};

type Category = { id: string; title: string };
type Pin = { category: string; x: number; y: number };

function parseJson<T>(raw: string, fallback: T): T {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

/** 标记：标准图钉造型，尖端指向坐标。 */
function PinShape({ color, label }: { color: string; label: string }) {
  return (
    <g>
      <ellipse cx="0" cy="3" rx="7" ry="2.6" fill="#000" opacity="0.16" />
      <path
        d="M0 6 C -9 -7 -14 -12 -14 -20 a14 14 0 1 1 28 0 C14 -12 9 -7 0 6 Z"
        fill={color}
        stroke="#fff"
        strokeWidth="1.6"
      />
      <circle cx="0" cy="-20" r="8.4" fill="rgba(255,255,255,0.92)" />
      <text
        x="0"
        y="-20"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="9.5"
        fontWeight="700"
        fill={color}
      >
        {label.slice(0, 1)}
      </text>
    </g>
  );
}

/** 校园／建筑／水域等底图元素。首页为竖幅 400×760，餐厅结果页为横幅 400×300。 */
function BaseMap({ variant }: { variant: "home" | "restaurants" }) {
  if (variant === "restaurants")
    return (
      <g>
        <rect width="400" height="300" fill="var(--map-land)" />
        <path
          d="M0 0 H400 V52 C348 62 300 46 250 56 C196 66 150 44 96 56 C54 65 26 52 0 60 Z"
          fill="var(--map-water)"
        />
        <text
          x="200"
          y="28"
          textAnchor="middle"
          fontSize="9"
          fill="var(--map-water-label)"
        >
          維多利亞港
        </text>
        <g
          stroke="var(--map-road)"
          strokeWidth="7"
          strokeLinecap="round"
          fill="none"
        >
          <path d="M0 104 H400" />
          <path d="M0 164 H400" />
          <path d="M0 236 H400" />
          <path d="M84 52 V300" />
          <path d="M168 52 V300" />
          <path d="M262 52 V300" />
          <path d="M342 52 V300" />
        </g>
        <path
          d="M20 196 H380"
          stroke="var(--map-arterial)"
          strokeWidth="11"
          fill="none"
          strokeLinecap="round"
        />
        <rect
          x="286"
          y="166"
          width="80"
          height="50"
          rx="5"
          fill="var(--map-commercial)"
        />
        <text
          x="326"
          y="195"
          textAnchor="middle"
          fontSize="9"
          fill="var(--map-commercial-label)"
        >
          黃埔天地
        </text>
        <rect
          x="38"
          y="118"
          width="66"
          height="44"
          rx="5"
          fill="var(--map-block)"
        />
        <text
          x="71"
          y="144"
          textAnchor="middle"
          fontSize="9"
          fill="var(--map-block-label)"
        >
          紅磡
        </text>
        <g
          fill="var(--map-residential)"
          stroke="var(--map-residential-edge)"
        >
          <rect x="284" y="240" width="30" height="22" rx="3" />
          <rect x="322" y="240" width="30" height="22" rx="3" />
          <rect x="284" y="268" width="30" height="22" rx="3" />
          <rect x="322" y="268" width="30" height="22" rx="3" />
        </g>
      </g>
    );
  return (
    <g>
      <rect width="400" height="760" fill="var(--map-land)" />
      <path
        d="M0 0 H400 V88 C340 100 300 84 250 92 C190 102 150 80 100 90 C60 98 30 86 0 94 Z"
        fill="var(--map-water)"
      />
      <text
        x="200"
        y="42"
        textAnchor="middle"
        fontSize="9"
        fill="var(--map-water-label)"
      >
        維多利亞港
      </text>
      <g
        stroke="var(--map-road)"
        strokeWidth="7"
        strokeLinecap="round"
        fill="none"
      >
        <path d="M0 150 H400" />
        <path d="M0 232 H400" />
        <path d="M0 372 H400" />
        <path d="M0 480 H400" />
        <path d="M0 600 H400" />
        <path d="M0 700 H400" />
        <path d="M58 88 V760" />
        <path d="M128 88 V760" />
        <path d="M204 88 V760" />
        <path d="M284 88 V760" />
        <path d="M354 88 V760" />
      </g>
      <path
        d="M0 200 C90 186 176 214 266 196 C332 183 372 190 400 180"
        stroke="var(--map-arterial)"
        strokeWidth="12"
        fill="none"
        strokeLinecap="round"
      />
      {/* 校园 */}
      <rect
        x="138"
        y="246"
        width="118"
        height="112"
        rx="8"
        fill="var(--map-campus)"
      />
      <g fill="var(--map-building)">
        <rect x="148" y="256" width="32" height="26" rx="2" />
        <rect x="186" y="256" width="24" height="26" rx="2" />
        <rect x="216" y="256" width="20" height="26" rx="2" />
        <rect x="148" y="290" width="24" height="22" rx="2" />
        <rect x="178" y="290" width="32" height="22" rx="2" />
        <rect x="148" y="320" width="42" height="18" rx="2" />
      </g>
      {/* 运动场 */}
      <rect
        x="200"
        y="290"
        width="44"
        height="56"
        rx="3"
        fill="var(--map-field)"
      />
      <circle
        cx="222"
        cy="318"
        r="15"
        fill="none"
        stroke="var(--map-field-edge)"
        strokeWidth="1.4"
      />
      {/* 商业区 */}
      <rect
        x="288"
        y="396"
        width="82"
        height="56"
        rx="5"
        fill="var(--map-commercial)"
      />
      <text
        x="329"
        y="428"
        textAnchor="middle"
        fontSize="9"
        fill="var(--map-commercial-label)"
      >
        黃埔
      </text>
      {/* 住宅区 */}
      <g fill="var(--map-residential)" stroke="var(--map-residential-edge)">
        <rect x="296" y="500" width="30" height="22" rx="3" />
        <rect x="334" y="500" width="30" height="22" rx="3" />
        <rect x="296" y="530" width="30" height="22" rx="3" />
        <rect x="334" y="530" width="30" height="22" rx="3" />
      </g>
      <text x="36" y="274" fontSize="9" fill="var(--map-label)">
        尖沙咀
      </text>
      <text x="88" y="134" fontSize="9" fill="var(--map-label)">
        紅磡
      </text>
      <text x="284" y="662" fontSize="9" fill="var(--map-label)">
        九龍東
      </text>
    </g>
  );
}

function MapCanvas({
  variant,
  points,
  pan,
  zoom,
  onPan,
  onPick,
  selected,
}: {
  variant: "home" | "restaurants";
  points: Point[];
  pan: { x: number; y: number };
  zoom: number;
  onPan: (dx: number, dy: number) => void;
  onPick: (id: string) => void;
  selected: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    x: number;
    y: number;
    id: number;
    moved: boolean;
  } | null>(null);
  const viewW = 400;
  const viewH = variant === "home" ? 760 : 300;
  const scale = () => {
    const el = ref.current;
    if (!el) return 1;
    return viewW / Math.max(1, el.getBoundingClientRect().width);
  };
  // 注意：不在 pointerdown 立刻 setPointerCapture —— 指针捕获会让浏览器把 click
  // 重定向到捕获元素，导致标记点击失效；改为真正开始拖动后才捕获。
  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    drag.current = {
      x: e.clientX,
      y: e.clientY,
      id: e.pointerId,
      moved: false,
    };
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    if (!d.moved) {
      if (Math.abs(e.clientX - d.x) < 4 && Math.abs(e.clientY - d.y) < 4) return;
      d.moved = true;
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    }
    const k = scale();
    onPan((e.clientX - d.x) / k, (e.clientY - d.y) / k);
    d.x = e.clientX;
    d.y = e.clientY;
  };
  const up = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.id === e.pointerId) drag.current = null;
  };
  return (
    <div
      ref={ref}
      className="maps-canvas"
      data-variant={variant}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    >
      <svg
        className="maps-svg"
        viewBox={`0 0 ${viewW} ${viewH}`}
        role="img"
        aria-label={variant === "home" ? "香港九龍地圖" : "紅磡與黃埔地圖"}
      >
        <g
          transform={`translate(${pan.x} ${pan.y}) translate(${viewW / 2} ${
            viewH / 2
          }) scale(${zoom}) translate(${-viewW / 2} ${-viewH / 2})`}
        >
          <BaseMap variant={variant} />
          {points.map((pt) => (
            <g
              key={pt.id}
              className="maps-marker"
              role="button"
              tabIndex={0}
              aria-label={`地图地点${pt.title}`}
              aria-pressed={selected === pt.id}
              onClick={(e) => {
                e.stopPropagation();
                onPick(pt.id);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onPick(pt.id);
                }
              }}
              transform={`translate(${pt.x} ${pt.y})`}
            >
              <PinShape
                color={PIN_COLORS[pt.kind] ?? "#6b7d8c"}
                label={pt.title}
              />
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
}

export function MapsSkin(p: Props) {
  const [view, setView] = useState<"home" | "search" | "result">("home");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [selected, setSelected] = useState("");
  const [category, setCategory] = useState("");
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);

  const places: Point[] = p.items
    .filter((i) => i.folder === "地点")
    .map((i) => ({
      id: i.id,
      title: i.title,
      kind: meta(i, "kind", "place"),
      type: meta(i, "type", "地点"),
      body: i.body,
      x: Number(meta(i, "x", "0")) || 0,
      y: Number(meta(i, "y", "0")) || 0,
    }));

  const restaurantItem = p.items.find((i) => i.id === RESTAURANT_RESULT_ID);
  const categories = parseJson<Category[]>(
    meta(restaurantItem, "categories"),
    [],
  );
  const restaurantPins = parseJson<Pin[]>(meta(restaurantItem, "pins"), []);
  const restaurantPoints: Point[] = restaurantPins.map((pin, n) => {
    const cat = categories.find((c) => c.id === pin.category);
    return {
      id: `map-restaurant-${n}`,
      title: cat?.title ?? "餐厅",
      kind: pin.category,
      type: cat?.title ?? "餐厅",
      body: "",
      x: pin.x,
      y: pin.y,
    };
  });

  const openResult = (raw: string) => {
    const q = raw.trim();
    if (!q) return;
    setQuery(q);
    setSelected("");
    setCategory("");
    setPan({ x: 0, y: 0 });
    setZoom(1);
    setView("result");
    // 实际打开「紅磡附近餐廳」结果页时派发事件，由事件系统判断前置条件后解锁消息包。
    if (q === RESTAURANT_QUERY && restaurantItem) p.onRead(restaurantItem.id);
  };

  const openPlaceResult = (title: string) => {
    const place = places.find((x) => x.title === title);
    setQuery(title);
    setSelected(place?.id ?? "");
    setCategory("");
    setPan({ x: 0, y: 0 });
    setZoom(1);
    setView("result");
  };

  const matched = draft.trim()
    ? places.filter((x) => x.title.includes(draft.trim()))
    : [];
  const placeById = (id: string) => places.find((x) => x.id === id);
  const isRestaurant = query === RESTAURANT_QUERY;
  const resultPlace = places.find((x) => x.title === query);

  return (
    <div className="maps-ui" data-view={view}>
      {view === "home" && (
        <>
          <button
            className="maps-search-pill"
            aria-label="搜索地点"
            onClick={() => {
              setDraft("");
              setView("search");
            }}
          >
            <Search size={15} />
            <span>搜索地点</span>
          </button>
          <MapCanvas
            variant="home"
            points={places}
            pan={pan}
            zoom={zoom}
            onPan={(dx, dy) => setPan((v) => ({ x: v.x + dx, y: v.y + dy }))}
            onPick={(id) => setSelected((s) => (s === id ? "" : id))}
            selected={selected}
          />
          <div className="maps-controls">
            <button
              aria-label="放大地图"
              onClick={() => setZoom((z) => Math.min(3, +(z + 0.5).toFixed(2)))}
            >
              <Plus size={18} />
            </button>
            <button
              aria-label="缩小地图"
              onClick={() => setZoom((z) => Math.max(1, +(z - 0.5).toFixed(2)))}
            >
              <Minus size={18} />
            </button>
            <button
              aria-label="回到香港理工大學"
              onClick={() => {
                setPan({ x: 0, y: 0 });
                setZoom(1);
              }}
            >
              <Compass size={18} />
            </button>
          </div>
          {selected && placeById(selected) && (
            <div className="maps-place-card" role="dialog" aria-label="地点信息">
              <button
                className="maps-card-close"
                aria-label="关闭地点卡片"
                onClick={() => setSelected("")}
              >
                <X size={15} />
              </button>
              <strong>{placeById(selected)!.title}</strong>
              <small>{placeById(selected)!.type}</small>
              <p>{placeById(selected)!.body}</p>
            </div>
          )}
        </>
      )}

      {view === "search" && (
        <div className="maps-panel">
          <div className="maps-panel-nav">
            <button
              aria-label="返回地图"
              onClick={() => {
                setDraft("");
                setView("home");
              }}
            >
              <ChevronLeft size={22} />
            </button>
            <label className="maps-search-field">
              <Search size={15} />
              <input
                aria-label="搜索地点"
                placeholder="搜索地点"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") openResult(draft);
                }}
              />
              {draft && (
                <button aria-label="清除搜索" onClick={() => setDraft("")}>
                  <X size={14} />
                </button>
              )}
            </label>
          </div>
          <div className="maps-panel-scroll">
            <h4 className="native-section">最近搜索</h4>
            <ul className="maps-recent">
              {RECENT_SEARCHES.map((r) => (
                <li key={r}>
                  <button
                    className="maps-recent-row"
                    onClick={() => openResult(r)}
                  >
                    <Search size={15} />
                    <span>{r}</span>
                  </button>
                </li>
              ))}
            </ul>
            {matched.length > 0 && (
              <>
                <h4 className="native-section">地点</h4>
                <ul className="maps-recent">
                  {matched.map((x) => (
                    <li key={x.id}>
                      <button
                        className="maps-recent-row"
                        onClick={() => openPlaceResult(x.title)}
                      >
                        <MapPin size={15} />
                        <span>{x.title}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      )}

      {view === "result" && (
        <div className="maps-panel">
          <div className="maps-panel-nav">
            <button
              aria-label="返回"
              onClick={() => {
                setQuery("");
                setView("search");
              }}
            >
              <ChevronLeft size={22} />
            </button>
            <strong className="maps-result-title">{query}</strong>
          </div>
          <div className="maps-result-body">
            <MapCanvas
              variant={isRestaurant ? "restaurants" : "home"}
              points={isRestaurant ? restaurantPoints : places}
              pan={pan}
              zoom={zoom}
              onPan={(dx, dy) => setPan((v) => ({ x: v.x + dx, y: v.y + dy }))}
              onPick={(id) => {
                if (isRestaurant) setCategory(id.replace("map-restaurant-", ""));
                else setSelected((s) => (s === id ? "" : id));
              }}
              selected={isRestaurant ? "" : selected}
            />
            {isRestaurant ? (
              <div className="maps-result-scroll">
                <div className="maps-category-row">
                  {categories.map((c) => (
                    <button
                      key={c.id}
                      className={`maps-category${category === c.id ? " selected" : ""}`}
                      onClick={() =>
                        setCategory((cur) => (cur === c.id ? "" : c.id))
                      }
                    >
                      <span
                        className="maps-category-dot"
                        style={{ background: PIN_COLORS[c.id] ?? "#6b7d8c" }}
                      />
                      {c.title}
                    </button>
                  ))}
                </div>
                <p className="maps-result-note">
                  {restaurantItem?.body ||
                    "紅磡與黃埔一帶的餐飲類別。"}
                </p>
              </div>
            ) : resultPlace ? (
              <div className="maps-result-scroll">
                <div className="maps-place-card static">
                  <strong>{resultPlace.title}</strong>
                  <small>{resultPlace.type}</small>
                  <p>{resultPlace.body}</p>
                </div>
              </div>
            ) : (
              <div className="maps-result-scroll">
                <p className="maps-result-note">
                  沒有找到「{query}」的匹配地點。以下是地圖上的地點。
                </p>
                <ul className="maps-recent">
                  {places.map((x) => (
                    <li key={x.id}>
                      <button
                        className="maps-recent-row"
                        onClick={() => openPlaceResult(x.title)}
                      >
                        <MapPin size={15} />
                        <span>{x.title}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
      {view === "home" && !selected && (
        <div className="maps-home-hint">
          <Utensils size={14} />
          <span>地圖上可點擊標記查看地點</span>
        </div>
      )}
    </div>
  );
}
