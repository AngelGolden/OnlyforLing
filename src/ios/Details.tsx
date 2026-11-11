import { useState } from "react";
import {
  ChevronLeft,
  MoreHorizontal,
  Share,
  Phone,
  MessageCircle,
  Video,
  Folder,
  Search,
  Copy,
  Check,
} from "lucide-react";
import { RichText } from "../RichText";
import type { Item } from "../schema";
import { PhotoDetail } from "../skins/photos-detail";
import { resolvePhotos } from "../skins/photos-state";
import "../skins/photos.css";
export const nativeDetailApps = new Set([
  "notes",
  "photos",
  "contacts",
  "phone",
  "calendar",
  "files",
  "safari",
]);
export function NativeDetail({
  app,
  item,
  back,
}: {
  app: string;
  item: Item;
  back: () => void;
}) {
  const [copied, setCopied] = useState(false),
    [call, setCall] = useState(false);

  // 相册兜底详情：主路径是 PhotosSkin 内部详情（可编辑、可持久化）。
  // 这里复用同一套视图，保证从其它入口进入 photos 详情时也显示真实大图
  // 与该照片自己的拍摄信息，而不是占位文字；此路径只读，不写用户说明。
  if (app === "photos")
    return (
      <PhotoDetail item={item} state={resolvePhotos(undefined)} back={back} />
    );

  const name =
    app === "notes"
      ? "备忘录"
      : app === "contacts"
        ? "通讯录"
        : app === "phone"
          ? "最近通话"
          : app === "calendar"
            ? "日历"
            : app === "files"
              ? "浏览"
              : "书签";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(item.body);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className={"native-detail native-detail-" + app}>
      <header className="app-nav">
        <button aria-label="返回" onClick={back}>
          <ChevronLeft size={24} />
          {name}
        </button>
        <strong />
        <button aria-label="更多操作" onClick={() => setCopied(!copied)}>
          <MoreHorizontal size={23} />
        </button>
      </header>
      {copied && (
        <div className="native-action-sheet">
          <button onClick={copy}>
            <Copy size={18} />
            复制文字
          </button>
          <button onClick={() => setCopied(false)}>取消</button>
        </div>
      )}
      {app === "contacts" || app === "phone" ? (
        <div className="native-detail-scroll">
          <div className="native-contact-hero">
            <span>{item.title.slice(0, 1)}</span>
            <h1>{item.title}</h1>
          </div>
          <div className="native-contact-actions">
            {[
              [MessageCircle, "信息"],
              [Phone, "呼叫"],
              [Video, "视频"],
            ].map(([Icon, label]) => {
              const Glyph = Icon as typeof Phone;
              return (
                <button key={String(label)} onClick={() => setCall(true)}>
                  <Glyph size={23} />
                  {String(label)}
                </button>
              );
            })}
          </div>
          <div className="native-detail-group">
            <small>手机</small>
            <p className="native-blue">{item.meta.phone || "未设置号码"}</p>
          </div>
          <div className="native-detail-group">
            <small>备注</small>
            <p>{item.body}</p>
          </div>
          {call && (
            <div className="native-detail-group">
              <p>通话记录 · {item.title}</p>
              <button onClick={() => setCall(false)}>结束</button>
            </div>
          )}
        </div>
      ) : app === "notes" ? (
        <>
          <div className="native-detail-scroll native-note-paper">
            <time>{item.time}</time>
            <h1>{item.title}</h1>
            <RichText value={item.richText} fallback={item.body} />
          </div>
          <footer className="native-detail-toolbar">
            <button aria-label="返回文件夹" onClick={back}>
              <Folder />
            </button>
            <span />
            <button aria-label="复制备忘录" onClick={copy}>
              {copied ? <Check /> : <Share />}
            </button>
          </footer>
        </>
      ) : app === "calendar" ? (
        <div className="native-detail-scroll native-event-paper">
          <h1>{item.title}</h1>
          <p>{item.time}</p>
          <div className="native-detail-group">
            <small>日程</small>
            <p>{item.body}</p>
          </div>
          {Object.entries(item.meta).map(([k, v]) => (
            <div className="native-detail-group" key={k}>
              <small>{k}</small>
              <p>{v}</p>
            </div>
          ))}
        </div>
      ) : app === "safari" ? (
        <>
          <div className="native-detail-scroll native-reader">
            <h1>{item.title}</h1>
            <RichText value={item.richText} fallback={item.body} />
          </div>
          <footer className="native-reader-address">
            <Search size={16} />
            <span>{item.meta.url || item.title}</span>
            <Share size={18} />
          </footer>
        </>
      ) : (
        <div className="native-detail-scroll native-file-preview">
          <Folder size={64} color="#007aff" />
          <h2>{item.title}</h2>
          <p>{item.body}</p>
          <small>{item.time}</small>
          <button onClick={copy}>复制内容</button>
        </div>
      )}
    </div>
  );
}
