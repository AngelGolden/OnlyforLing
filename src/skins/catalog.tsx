import { lazy, type ComponentType } from "react";
import type { SkinProps } from "../AppSkins";
const system = () => import("./SystemSkins");
const messaging = () => import("./MessagingSkins");
const social = () => import("./SocialSkins");
const media = () => import("./MediaSkins");
const commerce = () => import("./CommerceSkins");
function skin<T>(load: () => Promise<T>, name: keyof T) {
  return lazy(async () => ({
    default: (await load())[name] as ComponentType<SkinProps>,
  }));
}
const mymy = () => import("../vendor/mymy/Apps");
export const catalogSkins = {
  kakao: skin(mymy, "MymyKakao"),
  /** AFTER THE LAST SET 的固定内容 Instagram：story 没有提供 instagram 数据时使用。 */
  instagram: skin(() => import("./InstagramSkin"), "InstagramSkin"),
  /** 自带 instagram 剧情数据的旧演示故事继续使用通用皮肤，避免破坏既有回归测试。 */
  instagramLegacy: skin(mymy, "MymyInstagram"),
  /** 电话 App：固定历史通话 + 固定文字通话剧本，独立皮肤，不影响其它系统皮肤。 */
  phone: skin(() => import("./PhoneSkin"), "PhoneSkin"),
  contacts: skin(system, "ContactsSkin"),
  photos: skin(system, "PhotosSkin"),
  camera: skin(system, "CameraSkin"),
  safari: skin(system, "SafariSkin"),
  notes: skin(system, "NotesSkin"),
  calendar: skin(system, "CalendarSkin"),
  mail: skin(system, "MailSkin"),
  clock: skin(system, "ClockSkin"),
  reminders: skin(system, "RemindersSkin"),
  files: skin(system, "FilesSkin"),
  music: skin(system, "MusicSkin"),
  maps: skin(() => import("./MapsSkin"), "MapsSkin"),
  weather: skin(system, "WeatherSkin"),
  wallet: skin(system, "WalletSkin"),
  health: skin(system, "HealthSkin"),
  find: skin(system, "FindSkin"),
  messages: skin(messaging, "MessagesSkin"),
  qq: skin(messaging, "QQSkin"),
  telegram: skin(messaging, "TelegramSkin"),
  discord: skin(messaging, "DiscordSkin"),
  line: skin(messaging, "LineSkin"),
  messenger: skin(messaging, "MessengerSkin"),
  weibo: skin(social, "WeiboSkin"),
  twitter: skin(mymy, "MymyX"),
  threads: skin(() => import("./ThreadsReference"), "ThreadsReference"),
  facebook: skin(social, "FacebookSkin"),
  redbook: skin(social, "RedbookSkin"),
  pinterest: skin(social, "PinterestSkin"),
  reddit: skin(social, "RedditSkin"),
  forum: skin(social, "ForumSkin"),
  snapchat: skin(social, "SnapchatSkin"),
  /** 手机里已安装的音乐 App：本地歌曲 + 全局后台播放；无本地音轨时回退旧皮肤。 */
  spotify: skin(() => import("./MusicSkin"), "MusicSkin"),
  netease: skin(media, "NeteaseSkin"),
  youtube: skin(media, "YouTubeSkin"),
  bilibili: skin(media, "BilibiliSkin"),
  /** 抖音：8 条用户本地竖屏视频，独立沉浸式皮肤，不影响其它媒体皮肤。 */
  douyin: skin(() => import("./DouyinSkin"), "DouyinSkin"),
  tiktok: skin(media, "TikTokSkin"),
  netflix: skin(media, "NetflixSkin"),
  alipay: skin(commerce, "AlipaySkin"),
  taobao: skin(commerce, "TaobaoSkin"),
  delivery: skin(commerce, "DeliverySkin"),
};
