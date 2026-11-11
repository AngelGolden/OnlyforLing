import type { Item } from "../schema";

/**
 * Photos 相册的展示与可编辑状态。
 *
 * story.json 的 content.photos 是 42 张固定照片的只读编译结果（Item）。
 * 用户改过的说明 / 收藏落在 Runtime.ui.photos.photosState（JSON 字符串，
 * 因为 UiValue 只允许 string | number | boolean | string[]），随存档持久化。
 *
 * 这里不新增剧情状态结构：浏览、编辑、收藏都只写 Runtime.ui，
 * 不派发剧情事件、不写 playback / variables / notifications。
 */

/** 与 scripts/import-photos.mjs 一致的本地静态图片白名单，拒绝任意 URL。 */
export const PHOTO_MEDIA_RE =
  /^\.\/photo-media\/[a-z0-9-]+\.(jpe?g|png|webp)$/i;
export const PHOTOS_UI_KEY = "photosState";

/** 只读本 App 白名单内的本地静态图；没有则回落到既有 base64 媒体渲染。 */
export function photoImage(item: Item): string {
  const value = item.meta?.image ?? "";
  return PHOTO_MEDIA_RE.test(value) ? value : "";
}

export type PhotosState = {
  version: 1;
  /** 用户编辑过的说明，key 为照片 id；空串表示用户主动清空说明 */
  captions: Record<string, string>;
  /** 用户改过的收藏状态，key 为照片 id */
  favorites: Record<string, boolean>;
};

const emptyState = (): PhotosState => ({
  version: 1,
  captions: {},
  favorites: {},
});

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

export function resolvePhotos(raw: string | undefined): PhotosState {
  if (!raw) return emptyState();
  try {
    const v = JSON.parse(raw) as PhotosState;
    if (
      !v ||
      v.version !== 1 ||
      !isRecord(v.captions) ||
      !isRecord(v.favorites) ||
      !Object.values(v.captions).every((x) => typeof x === "string") ||
      !Object.values(v.favorites).every((x) => typeof x === "boolean")
    )
      return emptyState();
    return v;
  } catch {
    return emptyState();
  }
}

export function captionOf(state: PhotosState, item: Item): string {
  return state.captions[item.id] ?? item.body ?? "";
}

export function favoriteOf(state: PhotosState, item: Item): boolean {
  return state.favorites[item.id] ?? item.favorite;
}

export function withCaption(
  state: PhotosState,
  id: string,
  caption: string,
): PhotosState {
  return { ...state, captions: { ...state.captions, [id]: caption } };
}

export function withFavorite(
  state: PhotosState,
  id: string,
  favorite: boolean,
): PhotosState {
  return { ...state, favorites: { ...state.favorites, [id]: favorite } };
}

export function serializePhotos(state: PhotosState): string {
  return JSON.stringify(state);
}

/** 排序键：优先用规范化 ISO 拍摄时间；兼容旧数据里只有 time 的情况。 */
export function capturedKey(item: Item): string {
  return item.meta?.capturedAt || `${item.time.replace(" ", "T")}:00`;
}

/** 默认按拍摄时间倒序；同一时刻用 id 稳定排序，不依赖 work.json 里的顺序。 */
export function sortPhotos(items: Item[]): Item[] {
  return [...items].sort(
    (a, b) =>
      capturedKey(b).localeCompare(capturedKey(a)) || a.id.localeCompare(b.id),
  );
}

/** 详情页展示用的中文日期与星期。 */
export function formatCaptured(item: Item): {
  date: string;
  time: string;
  weekday: string;
} {
  const m = item.time.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
  if (!m) return { date: item.time, time: "", weekday: "" };
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const weekdays = [
    "星期日",
    "星期一",
    "星期二",
    "星期三",
    "星期四",
    "星期五",
    "星期六",
  ];
  const weekday = weekdays[new Date(year, month - 1, day).getDay()] ?? "";
  return { date: `${year}年${month}月${day}日`, time: `${m[4]}:${m[5]}`, weekday };
}
