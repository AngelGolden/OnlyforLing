import {
  Bookmark,
  ChevronLeft,
  Heart,
  Home,
  Layers,
  MessageCircle,
  MoreHorizontal,
  Play,
  Search,
  Send,
  X,
} from "lucide-react";
import { useMemo, useRef, useState, type ReactNode } from "react";
import type { SkinProps } from "../AppSkins";
import { useSkinState } from "../skinState";
import { useScrollRestore, useViewState } from "./viewState";
import {
  ACCOUNTS,
  ACCOUNT_BY_ID,
  FEED_POSTS,
  IG001_POST_ID,
  POST_BY_ID,
  SELF_ID,
  formatPostTime,
  profilePosts,
  type IgMedia,
  type IgPost,
} from "./instagram-data";
import "./instagram.css";

/**
 * AFTER THE LAST SET — Instagram App 本体。
 *
 * 负责普通社交浏览与互动：Feed / Search / Profile / 点赞 / 评论 / 收藏 / 关注。
 * 内容全部来自 instagram-data.ts 的固定数据，不读取 story.json 的 items，
 * 不调用 onRead / onItem，也不直接派发剧情节点。
 * 浏览（切换页面、查看主页、打开帖子、查看评论）只改本地视图状态，不写入存档；
 * 只有点赞、收藏、关注、发表评论这些明确的公开操作才会经 onUi 持久化。
 *
 * IG-001：爱心按钮与双击照片共用同一个 setLikeState。只有「主动从未点赞变成
 * 已点赞」且命中 IG-001 目标帖子时，才额外登记一次点赞意图（igxLikeIntent）。
 * 前置条件、一次性、消息入队与通知都由故事引擎负责；刷新、状态恢复、
 * 取消点赞、重新点赞、重复渲染都不会产生新的有效意图。
 */

/** 点赞意图的 UI 状态键：仅由主动 false→true 的点赞行为写入。 */
const LIKE_INTENT_KEY = "igxLikeIntent";

/** 「为你推荐」只显示这四个账号；hongkongpolyu 仍保留在账号数据中，可被搜索到。 */
const FEATURED_IDS = [
  "linglingkwong",
  "latecheckout.hk",
  "polyudiary.hk",
  "angel.golden",
];

const FOLLOWING_INITIAL = [
  "linglingkwong",
  "latecheckout.hk",
  "hongkongpolyu",
  "polyudiary.hk",
];

const DM_IDS = [
  "linglingkwong",
  "latecheckout.hk",
  "polyudiary.hk",
  "mimi.jpg",
  "chloe.archive",
];

type Tab = "home" | "search" | "dm" | "profile";
type Page =
  | { type: "profile"; userId: string }
  | { type: "post"; postId: string }
  | { type: "comments"; postId: string }
  | { type: "saved" }
  | { type: "conversation"; userId: string; sharePostId?: string };
type Sheet =
  | { type: "postMenu"; postId: string }
  | { type: "share"; postId: string };

type OwnComment = { commentId: string; postId: string; text: string };

function parseOwn(raw: string[]): OwnComment[] {
  const out: OwnComment[] = [];
  for (const s of raw) {
    try {
      const v = JSON.parse(s) as OwnComment;
      if (
        v &&
        typeof v.commentId === "string" &&
        typeof v.postId === "string" &&
        typeof v.text === "string"
      )
        out.push(v);
    } catch {
      // 忽略损坏的历史数据，不影响其余评论
    }
  }
  return out;
}

function thumb(m: IgMedia): string {
  return m.type === "image" ? m.src : m.poster;
}

function shortDate(publishedAt: string): string {
  const [, m, d] = publishedAt.split(" ")[0].split("-");
  return `${Number(m)}月${Number(d)}日`;
}

function usernameOf(userId: string): string {
  return ACCOUNT_BY_ID[userId]?.username ?? userId;
}

function toggleIn(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

function Avatar({
  userId,
  size = "sm",
}: {
  userId: string;
  size?: "xs" | "sm" | "md" | "lg" | "nav";
}) {
  const a = ACCOUNT_BY_ID[userId];
  if (a?.avatar)
    return (
      <img
        className={`igx-avatar igx-avatar-${size}`}
        src={a.avatar}
        alt=""
        data-user-id={userId}
      />
    );
  // 未配置图片的账号统一使用同一枚圆形默认头像：不按账号生成字母或颜色。
  return (
    <span
      className={`igx-avatar igx-avatar-${size} igx-avatar-fallback`}
      data-user-id={userId}
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" focusable="false">
        <circle cx="12" cy="8.6" r="3.7" />
        <path d="M4.6 20.4c0-3.8 3.3-6.5 7.4-6.5s7.4 2.7 7.4 6.5z" />
      </svg>
    </span>
  );
}

/** 横向搜索栏：放大镜固定在左，输入框占满剩余宽度，整体是一个组件。 */
function SearchBar({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  label: string;
}) {
  return (
    <div className="igx-search-field">
      <Search size={18} className="igx-search-icon" aria-hidden="true" />
      <input
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button
          type="button"
          className="igx-search-clear"
          aria-label="清除搜索"
          onClick={() => onChange("")}
        >
          <X size={15} />
        </button>
      )}
    </div>
  );
}

/** Search / 私信共用的账号行：avatar | account-info | action。 */
function AccountRow({
  userId,
  secondary,
  actionLabel,
  onOpen,
}: {
  userId: string;
  secondary: string;
  actionLabel: string;
  onOpen: () => void;
}) {
  return (
    <div className="igx-result" data-user-id={userId}>
      <button type="button" className="igx-result-main" onClick={onOpen}>
        <Avatar userId={userId} size="md" />
        <span className="igx-result-info">
          <strong>{usernameOf(userId)}</strong>
          <small>{secondary}</small>
        </span>
      </button>
      <div className="igx-result-action">
        <button type="button" onClick={onOpen}>
          {actionLabel}
        </button>
      </div>
    </div>
  );
}

/** 把 @用户名 渲染成可点击的账号入口；其余文字保持原样。 */
function MentionText({
  text,
  onMention,
}: {
  text: string;
  onMention: (userId: string) => void;
}) {
  const parts = text.split(/(@[A-Za-z0-9._]+)/g);
  return (
    <>
      {parts.map((part, i) => {
        const id = part.startsWith("@") ? part.slice(1) : "";
        return id && ACCOUNT_BY_ID[id] ? (
          <button
            key={i}
            type="button"
            className="igx-mention"
            onClick={() => onMention(id)}
          >
            {part}
          </button>
        ) : (
          <span key={i}>{part}</span>
        );
      })}
    </>
  );
}

/** 每张照片都是独立的 <img> / <video>，横向滑动切换，不是拼贴图。 */
function MediaCarousel({
  post,
  onLike,
}: {
  post: IgPost;
  /** desired=true：双击照片只点赞、不取消，与爱心按钮共用同一个状态入口。 */
  onLike: (desired: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState(0);
  return (
    <div className="igx-media-wrap">
      <div
        className="igx-media"
        ref={ref}
        onDoubleClick={() => onLike(true)}
        onScroll={(e) => {
          const el = e.currentTarget;
          if (el.clientWidth)
            setIdx(Math.round(el.scrollLeft / el.clientWidth));
        }}
      >
        {post.media.map((m, i) =>
          m.type === "image" ? (
            <img
              key={i}
              className="igx-photo"
              src={m.src}
              alt={m.alt}
              loading="lazy"
            />
          ) : (
            <video
              key={i}
              className="igx-photo igx-video"
              src={m.src}
              poster={m.poster}
              controls
              playsInline
              preload="metadata"
            />
          ),
        )}
      </div>
      {post.media.length > 1 && (
        <>
          <span className="igx-media-count">
            <Layers size={13} /> {idx + 1}/{post.media.length}
          </span>
          <div className="igx-dots">
            {post.media.map((_, i) => (
              <button
                key={i}
                type="button"
                aria-label={`查看第 ${i + 1} 张`}
                className={i === idx ? "igx-dot on" : "igx-dot"}
                onClick={() => {
                  const el = ref.current;
                  if (el) {
                    el.scrollTo({
                      left: i * el.clientWidth,
                      behavior: "smooth",
                    });
                    setIdx(i);
                  }
                }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

type PostCardProps = {
  post: IgPost;
  isLiked: boolean;
  isSaved: boolean;
  extraComments: number;
  detail?: boolean;
  /** 传入期望的点赞状态；按钮切换、双击照片只点赞，都走同一入口。 */
  onLike: (desired: boolean) => void;
  onSave: () => void;
  onComments: () => void;
  onProfile: (userId: string) => void;
  onMenu: () => void;
  onShare: () => void;
};

function PostCard({
  post,
  isLiked,
  isSaved,
  extraComments,
  detail = false,
  onLike,
  onSave,
  onComments,
  onProfile,
  onMenu,
  onShare,
}: PostCardProps) {
  const a = ACCOUNT_BY_ID[post.userId];
  const likes = post.likes + (isLiked ? 1 : 0);
  const commentCount = post.commentCount + extraComments;
  return (
    <article
      className={detail ? "igx-post igx-post-detail" : "igx-post"}
      data-post-id={post.postId}
    >
      <div className="igx-post-head">
        <button
          type="button"
          className="igx-avatar-btn"
          aria-label={`查看 ${usernameOf(post.userId)} 主页`}
          onClick={() => onProfile(post.userId)}
        >
          <Avatar userId={post.userId} />
        </button>
        <div className="igx-post-who">
          <button
            type="button"
            className="igx-username"
            onClick={() => onProfile(post.userId)}
          >
            {usernameOf(post.userId)}
          </button>
          {post.location && (
            <span className="igx-location">{post.location}</span>
          )}
        </div>
        <button
          type="button"
          className="igx-icon-btn"
          aria-label="更多"
          onClick={onMenu}
        >
          <MoreHorizontal size={20} />
        </button>
      </div>

      <MediaCarousel post={post} onLike={onLike} />

      <div className="igx-actions">
        <button
          type="button"
          className="igx-icon-btn"
          aria-label={isLiked ? "取消点赞" : "点赞"}
          aria-pressed={isLiked}
          onClick={() => onLike(!isLiked)}
        >
          <Heart
            size={24}
            fill={isLiked ? "#ff3040" : "none"}
            color={isLiked ? "#ff3040" : "#111"}
          />
        </button>
        <button
          type="button"
          className="igx-icon-btn"
          aria-label="评论"
          onClick={onComments}
        >
          <MessageCircle size={24} />
        </button>
        <button
          type="button"
          className="igx-icon-btn"
          aria-label="分享"
          onClick={onShare}
        >
          <Send size={23} />
        </button>
        <button
          type="button"
          className="igx-icon-btn igx-save"
          aria-label={isSaved ? "取消收藏" : "收藏"}
          aria-pressed={isSaved}
          onClick={onSave}
        >
          <Bookmark size={23} fill={isSaved ? "#111" : "none"} />
        </button>
      </div>

      <div className="igx-likes" data-likes={likes}>
        {/* 用户按 20.8k / 20K 等原文填写的点赞数按原文展示；点赞后数值变化才回退到数字格式。 */}
        {post.likesLabel && !isLiked
          ? `${post.likesLabel} 次赞`
          : `${likes.toLocaleString("en-US")} 次赞`}
      </div>
      <div className="igx-caption">
        <button
          type="button"
          className="igx-username"
          onClick={() => onProfile(post.userId)}
        >
          {usernameOf(post.userId)}
        </button>{" "}
        <MentionText text={post.caption} onMention={onProfile} />
      </div>
      <button
        type="button"
        className="igx-comment-link"
        onClick={onComments}
      >
        查看全部 {commentCount.toLocaleString("en-US")} 条评论
      </button>
      <div className="igx-time">{formatPostTime(post.publishedAt)}</div>
      {!detail && (
        <button
          type="button"
          className="igx-add-comment"
          onClick={onComments}
        >
          添加评论…
        </button>
      )}
      {a?.displayName && detail && (
        <div className="igx-detail-meta">{shortDate(post.publishedAt)}</div>
      )}
    </article>
  );
}

function CommentRow({
  userId,
  text,
  replyTo,
  commentId,
  replyToCommentId,
  onProfile,
}: {
  userId: string;
  text: string;
  replyTo?: string;
  commentId?: string;
  replyToCommentId?: string;
  onProfile: (userId: string) => void;
}) {
  return (
    <div
      className="igx-comment"
      data-comment-id={commentId ?? ""}
      data-reply-to-comment={replyToCommentId ?? ""}
    >
      <button
        type="button"
        className="igx-avatar-btn"
        aria-label={`查看 ${usernameOf(userId)} 主页`}
        onClick={() => onProfile(userId)}
      >
        <Avatar userId={userId} size="xs" />
      </button>
      <div className="igx-comment-body">
        <button
          type="button"
          className="igx-username"
          onClick={() => onProfile(userId)}
        >
          {usernameOf(userId)}
        </button>
        {replyTo && (
          <>
            {" 回复 "}
            <button
              type="button"
              className="igx-mention"
              onClick={() => onProfile(replyTo)}
            >
              @{usernameOf(replyTo)}
            </button>
          </>
        )}{" "}
        <span>{text}</span>
      </div>
    </div>
  );
}

function CommentsList({
  post,
  own,
  onProfile,
}: {
  post: IgPost;
  own: OwnComment[];
  onProfile: (userId: string) => void;
}) {
  return (
    <div className="igx-comments">
      <div className="igx-comment igx-caption-comment">
        <button
          type="button"
          className="igx-avatar-btn"
          aria-label={`查看 ${usernameOf(post.userId)} 主页`}
          onClick={() => onProfile(post.userId)}
        >
          <Avatar userId={post.userId} size="xs" />
        </button>
        <div className="igx-comment-body">
          <button
            type="button"
            className="igx-username"
            onClick={() => onProfile(post.userId)}
          >
            {usernameOf(post.userId)}
          </button>{" "}
          <span>{post.caption}</span>
          <small>{shortDate(post.publishedAt)}</small>
        </div>
      </div>
      {post.comments.map((c) => (
        <CommentRow
          key={c.commentId}
          userId={c.userId}
          text={c.text}
          replyTo={c.replyTo}
          commentId={c.commentId}
          replyToCommentId={c.replyToCommentId}
          onProfile={onProfile}
        />
      ))}
      {own.map((c) => (
        <CommentRow
          key={c.commentId}
          userId={SELF_ID}
          text={c.text}
          onProfile={onProfile}
        />
      ))}
      {post.comments.length === 0 && own.length === 0 && (
        <p className="igx-empty">还没有评论。</p>
      )}
    </div>
  );
}

function ProfileGrid({
  posts,
  onPost,
}: {
  posts: IgPost[];
  onPost: (postId: string) => void;
}) {
  if (!posts.length) return <p className="igx-empty">这里还没有帖子。</p>;
  return (
    <div className="igx-grid">
      {posts.map((p) => (
        <button
          key={p.postId}
          type="button"
          className="igx-cell"
          data-post-id={p.postId}
          aria-label={`查看 ${p.postId} 帖子`}
          onClick={() => onPost(p.postId)}
        >
          <img src={thumb(p.media[0])} alt="" loading="lazy" />
          {p.media.length > 1 && (
            <Layers className="igx-cell-badge" size={17} />
          )}
          {p.media[0].type === "video" && (
            <Play className="igx-cell-badge igx-cell-play" size={17} />
          )}
        </button>
      ))}
    </div>
  );
}

function ProfileView({
  userId,
  isFollowing,
  onFollow,
  onPost,
  onProfile,
  onSaved,
}: {
  userId: string;
  isFollowing: boolean;
  onFollow: () => void;
  onPost: (postId: string) => void;
  onProfile: (userId: string) => void;
  onSaved: () => void;
}) {
  const a = ACCOUNT_BY_ID[userId];
  if (!a) return <p className="igx-empty">找不到这个账号。</p>;
  const isSelf = userId === SELF_ID;
  const posts = profilePosts(userId);
  return (
    <div className="igx-profile" data-profile-id={userId}>
      <div className="igx-profile-top">
        <Avatar userId={userId} size="lg" />
        <div className="igx-stats">
          <div>
            <strong>{a.posts ?? posts.length}</strong>
            <span>帖子</span>
          </div>
          <div>
            <strong>{a.followers ?? "—"}</strong>
            <span>粉丝</span>
          </div>
          <div>
            <strong>{a.following ?? "—"}</strong>
            <span>关注中</span>
          </div>
        </div>
      </div>
      <div className="igx-profile-bio">
        <strong>{a.displayName}</strong>
        {a.bio.map((line, i) => (
          <div key={i}>
            <MentionText text={line} onMention={onProfile} />
          </div>
        ))}
      </div>
      <div className="igx-profile-actions">
        {isSelf ? (
          <button type="button" className="igx-pill" onClick={onSaved}>
            已收藏
          </button>
        ) : (
          <button
            type="button"
            className={isFollowing ? "igx-pill igx-pill-muted" : "igx-pill"}
            aria-pressed={isFollowing}
            onClick={onFollow}
          >
            {isFollowing ? "已关注" : "关注"}
          </button>
        )}
      </div>
      <div className="igx-profile-tabs">
        <span className="on">帖子</span>
      </div>
      <ProfileGrid posts={posts} onPost={onPost} />
    </div>
  );
}

export function InstagramSkin(p: SkinProps) {
  // 页签与两个搜索词落 Runtime.viewState.instagram 随存档恢复；页面栈 / 草稿 / 弹层
  // 仍是本次会话内的视图状态，重开 App 从当前页签的根页面进入。
  const [view, patchView] = useViewState(p, {
    tab: "home" as Tab,
    query: "",
    dmQuery: "",
  });
  const tab = view.tab;
  const setTab = (t: Tab) => patchView({ tab: t });
  const query = view.query;
  const setQuery = (v: string) => patchView({ query: v });
  const dmQuery = view.dmQuery;
  const setDmQuery = (v: string) => patchView({ dmQuery: v });
  const [pages, setPages] = useState<Page[]>([]);
  const [commentDraft, setCommentDraft] = useState("");
  const [dmDraft, setDmDraft] = useState("");
  const [dmMessages, setDmMessages] = useState<Record<string, string[]>>({});
  const [sheet, setSheet] = useState<Sheet | null>(null);

  // 只有这些明确的公开互动会经 onUi 落到 Runtime.ui，随存档持久化。
  const [liked, setLiked] = useSkinState<string[]>(p, "igxLiked", []);
  const [saved, setSaved] = useSkinState<string[]>(p, "igxSaved", []);
  const [following, setFollowing] = useSkinState<string[]>(
    p,
    "igxFollowing",
    FOLLOWING_INITIAL,
  );
  const [ownRaw, setOwnRaw] = useSkinState<string[]>(p, "igxComments", []);

  const ownComments = useMemo(() => parseOwn(ownRaw), [ownRaw]);
  const screen = pages.length ? pages[pages.length - 1] : null;
  const bodyKey = screen ? JSON.stringify(screen) : `tab:${tab}`;
  const bodyScrollRef = useRef<HTMLDivElement>(null);
  useScrollRestore(p, bodyKey, bodyScrollRef);

  const push = (page: Page) => setPages((prev) => [...prev, page]);
  const back = () => setPages((prev) => prev.slice(0, -1));
  const goTab = (t: Tab) => {
    setTab(t);
    setPages([]);
    setSheet(null);
  };
  const openProfile = (userId: string) => {
    setSheet(null);
    push({ type: "profile", userId });
  };
  const openPost = (postId: string) => {
    setSheet(null);
    push({ type: "post", postId });
  };
  const openComments = (postId: string) => {
    setSheet(null);
    push({ type: "comments", postId });
  };
  /**
   * 唯一的点赞状态入口。只有「主动从未点赞变成已点赞」才算一次有效点赞行为；
   * 已点赞时双击照片是空操作，不会取消点赞，也不会产生第二次意图。
   * IG-001 的意图登记与点赞状态写入是两次独立的 onUi，Phone.tsx 的 update()
   * 会同步刷新 runtimeRef，因此后一次派发能看到前一次的最新状态。
   */
  const setLikeState = (postId: string, desired: boolean) => {
    const wasLiked = liked.includes(postId);
    if (wasLiked === desired) return;
    setLiked((prev) =>
      desired
        ? prev.includes(postId)
          ? prev
          : [...prev, postId]
        : prev.filter((id) => id !== postId),
    );
    if (
      !wasLiked &&
      desired &&
      postId === IG001_POST_ID &&
      POST_BY_ID[postId]?.eventHook === "IG-001"
    ) {
      p.onUi?.(LIKE_INTENT_KEY, postId);
    }
  };
  const toggleSave = (postId: string) =>
    setSaved((prev) => toggleIn(prev, postId));
  const toggleFollow = (userId: string) =>
    setFollowing((prev) => toggleIn(prev, userId));

  const submitComment = (postId: string) => {
    const text = commentDraft.trim();
    if (!text) return;
    const entry: OwnComment = {
      commentId: `cmt_own_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      postId,
      text,
    };
    setOwnRaw((prev) => [...prev, JSON.stringify(entry)]);
    setCommentDraft("");
  };

  const postCardProps = (post: IgPost, detail = false): PostCardProps => ({
    post,
    isLiked: liked.includes(post.postId),
    isSaved: saved.includes(post.postId),
    extraComments: ownComments.filter((c) => c.postId === post.postId).length,
    detail,
    onLike: (desired: boolean) => setLikeState(post.postId, desired),
    onSave: () => toggleSave(post.postId),
    onComments: () => openComments(post.postId),
    onProfile: openProfile,
    onMenu: () => setSheet({ type: "postMenu", postId: post.postId }),
    onShare: () => setSheet({ type: "share", postId: post.postId }),
  });

  const dmAccounts = DM_IDS.filter(
    (id) =>
      !dmQuery ||
      `${usernameOf(id)} ${ACCOUNT_BY_ID[id]?.displayName ?? ""}`
        .toLowerCase()
        .includes(dmQuery.toLowerCase()),
  );

  const searchResults = query.trim()
    ? ACCOUNTS.filter((a) =>
        `${a.username} ${a.displayName}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
      )
    : FEATURED_IDS.map((id) => ACCOUNT_BY_ID[id]).filter(Boolean);

  let title = "";
  if (screen) {
    if (screen.type === "profile") title = usernameOf(screen.userId);
    else if (screen.type === "post") title = "帖子";
    else if (screen.type === "comments") title = "评论";
    else if (screen.type === "saved") title = "已收藏";
    else title = usernameOf(screen.userId);
  }

  const header: ReactNode = screen ? (
    <header className="igx-subhead">
      <button type="button" aria-label="返回" onClick={back}>
        <ChevronLeft size={24} />
      </button>
      <strong>{title}</strong>
      <span className="igx-subhead-right" />
    </header>
  ) : tab === "profile" ? (
    <header className="igx-subhead">
      <button
        type="button"
        aria-label="返回"
        onClick={() => goTab("home")}
      >
        <ChevronLeft size={24} />
      </button>
      <strong>{SELF_ID}</strong>
      <span className="igx-subhead-right" />
    </header>
  ) : (
    <header className="igx-topbar">
      <button
        type="button"
        className="igx-logo"
        aria-label="Instagram 首页"
        onClick={() => goTab("home")}
      >
        Instagram
      </button>
      <div className="igx-topbar-actions">
        <button
          type="button"
          aria-label="私信"
          onClick={() => goTab("dm")}
        >
          <Send size={22} />
        </button>
      </div>
    </header>
  );

  let content: ReactNode;
  if (screen) {
    if (screen.type === "profile") {
      content = (
        <ProfileView
          userId={screen.userId}
          isFollowing={following.includes(screen.userId)}
          onFollow={() => toggleFollow(screen.userId)}
          onPost={openPost}
          onProfile={openProfile}
          onSaved={() => push({ type: "saved" })}
        />
      );
    } else if (screen.type === "post") {
      const post = POST_BY_ID[screen.postId];
      content = post ? (
        <PostCard {...postCardProps(post, true)} />
      ) : (
        <p className="igx-empty">找不到这则帖子。</p>
      );
    } else if (screen.type === "comments") {
      const post = POST_BY_ID[screen.postId];
      content = post ? (
        <CommentsList
          post={post}
          own={ownComments.filter((c) => c.postId === post.postId)}
          onProfile={openProfile}
        />
      ) : (
        <p className="igx-empty">找不到这则帖子。</p>
      );
    } else if (screen.type === "saved") {
      const posts = saved.map((id) => POST_BY_ID[id]).filter(Boolean);
      content = (
        <div className="igx-saved">
          {posts.length ? (
            <ProfileGrid posts={posts} onPost={openPost} />
          ) : (
            <p className="igx-empty">还没有收藏的帖子。</p>
          )}
        </div>
      );
    } else {
      const userId = screen.userId;
      const msgs = dmMessages[userId] ?? [];
      const shared = screen.sharePostId
        ? POST_BY_ID[screen.sharePostId]
        : undefined;
      content = (
        <div className="igx-conversation">
          <button
            type="button"
            className="igx-conversation-user"
            onClick={() => openProfile(userId)}
          >
            <Avatar userId={userId} size="md" />
            <strong>{usernameOf(userId)}</strong>
          </button>
          {shared && (
            <button
              type="button"
              className="igx-shared"
              onClick={() => openPost(shared.postId)}
            >
              <img src={thumb(shared.media[0])} alt="" />
              <span>
                分享了一则帖子
                <small>@{usernameOf(shared.userId)}</small>
              </span>
            </button>
          )}
          {msgs.length === 0 && (
            <p className="igx-empty">还没有消息。</p>
          )}
          {msgs.map((m, i) => (
            <div key={i} className="igx-dm-bubble">
              {m}
            </div>
          ))}
        </div>
      );
    }
  } else if (tab === "home") {
    content = (
      <div className="igx-feed">
        {FEED_POSTS.map((post) => (
          <PostCard key={post.postId} {...postCardProps(post)} />
        ))}
      </div>
    );
  } else if (tab === "search") {
    content = (
      <div className="igx-search">
        <SearchBar
          value={query}
          onChange={setQuery}
          placeholder="搜索账号"
          label="搜索账号"
        />
        <div className="igx-section-title">
          {query.trim() ? "搜索结果" : "为你推荐"}
        </div>
        {searchResults.length ? (
          searchResults.map((a) => (
            <AccountRow
              key={a.userId}
              userId={a.userId}
              secondary={a.displayName}
              actionLabel="查看"
              onOpen={() => openProfile(a.userId)}
            />
          ))
        ) : (
          <p className="igx-empty">没有找到相关账号。</p>
        )}
      </div>
    );
  } else if (tab === "dm") {
    content = (
      <div className="igx-dm">
        <SearchBar
          value={dmQuery}
          onChange={setDmQuery}
          placeholder="搜索联系人"
          label="搜索联系人"
        />
        <div className="igx-section-title">消息</div>
        {dmAccounts.map((id) => (
          <AccountRow
            key={id}
            userId={id}
            secondary={dmMessages[id]?.at(-1) ?? "发送消息"}
            actionLabel="发送"
            onOpen={() => push({ type: "conversation", userId: id })}
          />
        ))}
        {!dmAccounts.length && <p className="igx-empty">没有找到联系人。</p>}
      </div>
    );
  } else {
    content = (
      <ProfileView
        userId={SELF_ID}
        isFollowing={true}
        onFollow={() => undefined}
        onPost={openPost}
        onProfile={openProfile}
        onSaved={() => push({ type: "saved" })}
      />
    );
  }

  const conv = screen?.type === "conversation" ? screen : null;
  const commentScreen =
    screen?.type === "comments" ? screen : null;

  return (
    <div className="independent-skin instagram-ui igx-ui">
      {header}
      <div className="igx-body" key={bodyKey} ref={bodyScrollRef}>
        {content}
      </div>

      {commentScreen && (
        <form
          className="igx-composer"
          onSubmit={(e) => {
            e.preventDefault();
            submitComment(commentScreen.postId);
          }}
        >
          <Avatar userId={SELF_ID} size="xs" />
          <input
            aria-label="添加评论"
            placeholder="添加评论…"
            value={commentDraft}
            onChange={(e) => setCommentDraft(e.target.value)}
          />
          <button type="submit" aria-label="发布评论">
            发布
          </button>
        </form>
      )}

      {conv && (
        <form
          className="igx-composer"
          onSubmit={(e) => {
            e.preventDefault();
            const text = dmDraft.trim();
            if (!text) return;
            setDmMessages((prev) => ({
              ...prev,
              [conv.userId]: [...(prev[conv.userId] ?? []), text],
            }));
            setDmDraft("");
          }}
        >
          <input
            aria-label="输入消息"
            placeholder="发消息…"
            value={dmDraft}
            onChange={(e) => setDmDraft(e.target.value)}
          />
          <button type="submit" aria-label="发送消息">
            发送
          </button>
        </form>
      )}

      <nav className="igx-bottom" aria-label="Instagram 导航">
        {(
          [
            ["home", "首页"],
            ["search", "搜索"],
            ["dm", "私信"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-label={label}
            aria-current={tab === key ? "page" : undefined}
            className={tab === key ? "on" : ""}
            onClick={() => goTab(key)}
          >
            {key === "home" ? (
              <Home size={24} />
            ) : key === "search" ? (
              <Search size={24} />
            ) : (
              <Send size={23} />
            )}
          </button>
        ))}
        <button
          type="button"
          aria-label="个人主页"
          aria-current={tab === "profile" ? "page" : undefined}
          className={tab === "profile" ? "on" : ""}
          onClick={() => goTab("profile")}
        >
          <Avatar userId={SELF_ID} size="nav" />
        </button>
      </nav>

      {sheet && (
        <div
          className="igx-sheet-backdrop"
          onClick={() => setSheet(null)}
        >
          <div
            className="igx-sheet"
            onClick={(e) => e.stopPropagation()}
          >
            {sheet.type === "postMenu" ? (
              <>
                <button
                  type="button"
                  onClick={() => openPost(sheet.postId)}
                >
                  查看帖子详情
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setSheet({ type: "share", postId: sheet.postId })
                  }
                >
                  分享给…
                </button>
              </>
            ) : (
              <>
                <div className="igx-sheet-title">发送给</div>
                {DM_IDS.map((id) => (
                  <button
                    key={id}
                    type="button"
                    className="igx-sheet-account"
                    onClick={() => {
                      setSheet(null);
                      push({
                        type: "conversation",
                        userId: id,
                        sharePostId: sheet.postId,
                      });
                    }}
                  >
                    <Avatar userId={id} size="xs" />
                    {usernameOf(id)}
                  </button>
                ))}
              </>
            )}
            <button
              type="button"
              className="igx-sheet-cancel"
              onClick={() => setSheet(null)}
            >
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
