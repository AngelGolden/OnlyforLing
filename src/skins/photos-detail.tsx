import { useState } from "react";
import { ChevronLeft, Heart, MapPin, Share } from "lucide-react";
import { safeMedia, type Item } from "../schema";
import {
  captionOf,
  favoriteOf,
  formatCaptured,
  photoImage,
  type PhotosState,
} from "./photos-state";
import "./photos.css";

/**
 * Photos 照片详情：相册网格内部详情与 NativeDetail 兜底共用的同一套视图。
 *
 * - 大图优先读 meta.image（本地静态资源白名单），回落到既有 base64 item.media。
 * - 日期 / 时间 / 地点 / 说明都只从当前 item 读取，不共用任何全局说明。
 * - 说明编辑是「受控 + 即时写入」：每次输入都调用 onCaption 落到 Runtime.ui，
 *   因此返回、刷新、关闭 App 后都不会回退；没有 caption 时不渲染说明区域。
 */
export function PhotoDetail({
  item,
  state,
  back,
  onCaption,
  onFavorite,
}: {
  item: Item;
  state: PhotosState;
  back: () => void;
  onCaption?: (id: string, caption: string) => void;
  onFavorite?: (id: string, favorite: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const src = photoImage(item) || safeMedia(item.media);
  const caption = captionOf(state, item);
  const favorite = favoriteOf(state, item);
  const { date, time, weekday } = formatCaptured(item);
  const location = item.meta?.location ?? "";
  const editable = !!onCaption;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(caption || item.title);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div
      className="catalog-skin photos-detail native-detail-photos"
      data-photo-id={item.id}
      data-has-caption={caption ? "1" : "0"}
    >
      <header className="app-nav photos-detail-nav">
        <button aria-label="返回照片网格" onClick={back}>
          <ChevronLeft size={20} />
          所有照片
        </button>
        <strong>{date}</strong>
        {editable ? (
          <button
            aria-label={editing ? "完成编辑照片说明" : "编辑照片说明"}
            onClick={() => setEditing((v) => !v)}
          >
            {editing ? "完成" : "编辑"}
          </button>
        ) : (
          <span />
        )}
      </header>

      <div className="photos-detail-scroll">
        <div className="photos-detail-stage">
          {src ? (
            <img src={src} alt={item.title} />
          ) : (
            <div className="native-photo-caption">
              <h2>{item.title}</h2>
            </div>
          )}
        </div>
        <div className="photos-detail-meta">
          <h1>{date}</h1>
          <p className="photos-detail-subtime">
            {[weekday, time].filter(Boolean).join(" · ")}
          </p>
          {location && (
            <p className="photos-detail-location">
              <MapPin size={13} />
              {location}
            </p>
          )}
          {editing && onCaption ? (
            <textarea
              className="photos-caption-input"
              aria-label="照片说明"
              placeholder="为这张照片添加说明…"
              value={caption}
              onChange={(e) => onCaption(item.id, e.target.value)}
            />
          ) : caption ? (
            <button
              type="button"
              className="photos-caption"
              aria-label="点击说明进入编辑"
              data-caption={caption}
              onClick={() => editable && setEditing(true)}
            >
              {caption}
            </button>
          ) : null}
        </div>
      </div>

      <footer className="native-detail-toolbar photos-detail-toolbar">
        <button aria-label="分享照片说明" onClick={copy}>
          <Share size={19} />
        </button>
        <button
          aria-label="收藏照片"
          aria-pressed={favorite}
          onClick={() => onFavorite?.(item.id, !favorite)}
        >
          <Heart
            size={20}
            fill={favorite ? "#ff3b30" : "none"}
            color={favorite ? "#ff3b30" : undefined}
          />
        </button>
        <span>{copied ? "已复制" : caption ? "说明已自动保存" : item.title}</span>
      </footer>
    </div>
  );
}
