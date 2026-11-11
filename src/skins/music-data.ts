/**
 * 由 scripts/import-music.mjs 生成：音乐 App 的静态资源白名单与剧情键。
 * 歌曲清单本身只存在 story.json 的 content.spotify，皮肤从 p.items 读取。
 */
export const MUSIC_APP_ID = "spotify";
export const MUSIC_EVENT_ID = "WA_MUSIC_001";
export const MUSIC_FIRST_PLAYED_TARGET = "ui:music:firstPlayed";
/** 只允许 ./music-media/ 下的 ASCII 音频文件名，与 dy-media / yt-media 做法一致。 */
export const MUSIC_ASSET_RE = /^\.\/music-media\/[a-z0-9-]+\.(mp3|m4a|aac|wav)$/i;
export function musicAsset(
  meta: Record<string, string> | undefined,
  key = "audio",
): string {
  const value = meta?.[key] ?? "";
  return MUSIC_ASSET_RE.test(value) ? value : "";
}
