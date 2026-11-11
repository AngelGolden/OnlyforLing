/**
 * 由 scripts/import-douyin.mjs 从 data/douyin/抖音App搭建指令.txt 生成，请勿手工编辑。
 * 全部视频共用一个发布者：资料只在这里保存一份，视频条目只带文件与配文。
 */
export const DOUYIN_AUTHOR = "回温蛋治";
export const DOUYIN_AVATAR = "./dy-media/dy-avatar.png";
export const DOUYIN_AVATAR_NAME = "回温蛋治 头像.png";
export const DOUYIN_PROFILE_URL = "https://v.douyin.com/6LIf7vWFaKA/";

/** 本地静态资源白名单：只允许 ./dy-media/ 下的 ASCII 文件名，与 yt-media 做法一致。 */
export const DY_ASSET_RE = /^\.\/dy-media\/[a-z0-9-]+\.(mp4|png|jpg)$/i;
export function dyAsset(
  meta: Record<string, string> | undefined,
  key: string,
): string {
  const value = meta?.[key] ?? "";
  return DY_ASSET_RE.test(value) ? value : "";
}
