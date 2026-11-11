import { useState } from "react";
import { motion } from "motion/react";
import { X } from "lucide-react";
import { AppArtwork } from "./AppArtwork";
import type { Work } from "./schema";
export function notificationContent(text: string, apps: Work["apps"]) {
  // 结构化通知：@appId|time|sender|body —— 可指定 App 图标与通知时间。
  // 旧格式 "发件人:内容" 保持兼容，时间显示「现在」。
  if (text.startsWith("@")) {
    const [appId = "messages", time = "现在", sender = "信息", ...rest] =
      text.slice(1).split("|");
    // 可选末段 ">appId:会话" 指定点击通知后的跳转位置。
    // 用 ">" 前缀识别，避免与正文中出现的 "|" 冲突。
    const tail = rest.at(-1);
    const target = tail?.startsWith(">") ? tail.slice(1) : "";
    return {
      title: sender,
      body: (target ? rest.slice(0, -1) : rest).join("|"),
      appId: apps.some((a) => a.id === appId) ? appId : "messages",
      time,
      target,
    };
  }
  const separator = text.search(/[:：]/);
  const sender = separator > 0 ? text.slice(0, separator) : "信息";
  const app = apps.find((a) => a.name === sender);
  return {
    title: sender,
    body: separator > 0 ? text.slice(separator + 1) : text,
    appId: app?.id ?? "messages",
    time: "现在",
    target: "",
  };
}
export function SystemNotifications({
  notices,
  apps,
  onOpen,
  onDismiss,
  compact = false,
}: {
  notices: string[];
  apps: Work["apps"];
  onOpen: (target?: string, index?: number) => void;
  onDismiss: (index: number) => void;
  compact?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const entries = notices.map((text, index) => ({ text, index })).reverse();
  const shown = compact && !expanded ? entries.slice(0, 1) : entries;
  return (
    <div
      className={
        "device-notices " +
        (compact && !expanded && notices.length > 1 ? "notice-stacked" : "")
      }
    >
      <div className="notice-cards">
        {shown.map(({ text, index }) => {
          const n = notificationContent(text, apps);
          return (
            <motion.div
              layout
              className="device-notice"
              key={text + "::" + index}
              initial={{ opacity: 0, y: 35, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              drag="x"
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.3}
              onDragEnd={(_, info) => {
                if (info.offset.x < -80) onDismiss(index);
              }}
            >
              <button
                className="notice-open"
                onClick={() =>
                  onOpen(n.target || `${n.appId}:${n.title}`, index)
                }
              >
                <span className="notice-app-art">
                  <AppArtwork id={n.appId} />
                </span>
                <span className="notice-copy">
                  <strong>{n.title}</strong>
                  <span>{n.body}</span>
                </span>
                <time>{n.time}</time>
              </button>
              {!compact && (
                <button
                  className="notice-remove"
                  aria-label="清除通知"
                  onClick={() => onDismiss(index)}
                >
                  <X size={15} />
                </button>
              )}
            </motion.div>
          );
        })}
      </div>
      {compact && notices.length > 1 && (
        <button
          className="notice-expand"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "收起" : notices.length + " 条通知"}
        </button>
      )}
    </div>
  );
}
