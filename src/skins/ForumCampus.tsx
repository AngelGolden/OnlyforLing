import { useRef, useState } from "react";
import { ChevronLeft, Eye, Hash, Heart, MessageCircle } from "lucide-react";
import { useScrollRestore, useViewState } from "./viewState";
import {
  BOARD_BY_ID,
  FORUM_BOARDS,
  FORUM_HIDDEN_POSTS,
  FORUM_POSTS,
  HIDDEN_POST_BY_ID,
  POST_BY_ID,
  formatForumTime,
  matchesHiddenRumor,
  searchForumBoards,
  searchForumPosts,
  sortForumPosts,
  type ForumBoardId,
  type ForumComment,
  type ForumPost,
  type ForumSort,
} from "./forum-data";
import { Header, SearchBox, type Props } from "./shared";
import "./forum.css";

/**
 * 校园论坛的固定内容视图。
 *
 * 沿用现有 ForumSkin 的 catalog-skin / Header / SearchBox / forum-banner /
 * forum-topic / forum-board 结构，只是把内容换成预置数据，并把「帖子」与
 * 「板块」同时放在两个各自带搜索栏的区块里。
 *
 * 本视图只用组件内 state，不写 Runtime、不调用 onItem / onUi / onRead：
 * 搜索、切换板块、打开帖子、看评论都是纯浏览行为，不产生任何剧情状态。
 */
export function CampusForumSkin({ p }: { p: Props }) {
  // 板块 / 两个搜索词 / 排序 / 三个滚动位置落 Runtime.ui.forum 随存档恢复；
  // 浏览行为仍然只写纯 UI 状态，不派发剧情。详情页是否打开保持本次会话内状态。
  const [view, patchView] = useViewState(p, {
    postQuery: "",
    boardQuery: "",
    sort: "newest" as ForumSort,
    boardId: "" as ForumBoardId | "",
  });
  const { postQuery, boardQuery, sort, boardId } = view;
  const setPostQuery = (v: string) => patchView({ postQuery: v });
  const setBoardQuery = (v: string) => patchView({ boardQuery: v });
  const setSort = (v: ForumSort) => patchView({ sort: v });
  const setBoardId = (v: ForumBoardId | "") => patchView({ boardId: v });
  const [detailId, setDetailId] = useState<string | null>(null);
  const postsScrollRef = useRef<HTMLDivElement>(null);
  const boardsScrollRef = useRef<HTMLDivElement>(null);
  const detailScrollRef = useRef<HTMLDivElement>(null);
  useScrollRestore(
    p,
    `forum:posts:${boardId || "all"}:${sort}`,
    postsScrollRef,
    !detailId,
    "posts",
  );
  useScrollRestore(p, "forum:boards", boardsScrollRef, !detailId, "boards");
  useScrollRestore(
    p,
    `forum:detail:${detailId ?? ""}`,
    detailScrollRef,
    !!detailId,
    "detail",
  );

  const scoped = boardId
    ? FORUM_POSTS.filter((post) => post.boardId === boardId)
    : FORUM_POSTS;
  // 公开帖子继续走原来的全文搜索与排序，完全不受隐藏索引影响。
  const publicPosts = sortForumPosts(searchForumPosts(scoped, postQuery), sort);
  // 隐藏帖不在 FORUM_POSTS 里，也不进全文索引：只有左侧帖子搜索栏命中独立别名、
  // 且没有板块筛选时，才作为额外结果追加到公开结果之后。
  const hiddenHit =
    !boardId && postQuery.trim().length > 0 && matchesHiddenRumor(postQuery);
  const posts: ForumPost[] = hiddenHit
    ? [...publicPosts, ...FORUM_HIDDEN_POSTS]
    : publicPosts;
  const boards = searchForumBoards(FORUM_BOARDS, boardQuery);
  // 详情页既能打开公开帖，也能打开从搜索结果进入的隐藏帖。
  const detail = detailId
    ? (POST_BY_ID[detailId] ?? HIDDEN_POST_BY_ID[detailId])
    : null;

  if (detail) {
    // 楼中楼层级直接由 replyTo 反推，最多缩进两级，不额外编造互动关系。
    const byFloor = new Map(detail.comments.map((c) => [c.floor, c]));
    const depthOf = (c: ForumComment): number => {
      let depth = 0;
      let cur = c;
      while (cur.replyTo && depth < 2) {
        const parent = byFloor.get(cur.replyTo);
        if (!parent) break;
        depth += 1;
        cur = parent;
      }
      return depth;
    };
    return (
      <div className="catalog-skin forum-ui forum-v1">
        <nav className="app-nav catalog-nav">
          <button
            type="button"
            aria-label="返回帖子列表"
            onClick={() => setDetailId(null)}
          >
            <ChevronLeft size={22} />
          </button>
          <strong>{BOARD_BY_ID[detail.boardId].name}</strong>
          <span />
        </nav>
        <div className="catalog-scroll fm-detail" ref={detailScrollRef}>
          <article className="fm-detail-post" data-post-id={detail.postId}>
            <h1>{detail.title}</h1>
            <div className="fm-detail-meta">
              <span>{detail.displayAuthor ?? detail.authorId}</span>
              <span>{formatForumTime(detail.publishedAt)}</span>
              <span>{BOARD_BY_ID[detail.boardId].name}</span>
            </div>
            {detail.tags && detail.tags.length > 0 && (
              <div className="fm-detail-tags">
                {detail.tags.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
            )}
            {detail.body.split("\n\n").map((para, i) => (
              <p key={i}>{para}</p>
            ))}
            <div className="fm-detail-stats">
              <span>
                <Heart size={13} /> {detail.likes} 赞
              </span>
              <span>
                <MessageCircle size={13} /> {detail.replies} 回复
              </span>
              <span>
                <Eye size={13} /> {detail.views} 浏览
              </span>
            </div>
          </article>
          <h2 className="fm-comments-title">全部评论</h2>
          <ol className="fm-comments">
            {detail.comments.map((c) => (
              <li
                key={c.commentId}
                className={`fm-comment${c.replyTo ? " fm-reply" : ""}`}
                data-comment-id={c.commentId}
                data-depth={c.replyTo ? depthOf(c) : 0}
              >
                <div className="fm-comment-head">
                  <strong>{c.userId}</strong>
                  <span>#{c.floor}</span>
                  {c.replyTo && <em>回复 #{c.replyTo}</em>}
                </div>
                <p>{c.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    );
  }

  return (
    <div className="catalog-skin forum-ui forum-v1">
      <Header p={p} />
      <div className="forum-banner">
        <Hash size={27} />
        <strong>{boardId ? BOARD_BY_ID[boardId].name : "校园论坛"}</strong>
        <span>{FORUM_POSTS.length} 个主题</span>
      </div>
      <div className="fm-columns">
        <section className="fm-posts" aria-label="帖子">
          <SearchBox
            value={postQuery}
            set={setPostQuery}
            placeholder="搜索帖子、关键词或用户"
          />
          <div className="fm-sort">
            <strong>{sort === "newest" ? "最新帖子" : "热门帖子"}</strong>
            <div className="fm-sort-buttons">
              <button
                type="button"
                aria-label="按最新排序"
                aria-pressed={sort === "newest"}
                className={sort === "newest" ? "selected" : ""}
                onClick={() => setSort("newest")}
              >
                最新
              </button>
              <button
                type="button"
                aria-label="按热门排序"
                aria-pressed={sort === "hot"}
                className={sort === "hot" ? "selected" : ""}
                onClick={() => setSort("hot")}
              >
                热门
              </button>
            </div>
          </div>
          {boardId && (
            <button
              type="button"
              className="fm-filter-chip"
              aria-label="清除板块筛选"
              onClick={() => setBoardId("")}
            >
              {BOARD_BY_ID[boardId].name} ×
            </button>
          )}
          <div className="fm-list" ref={postsScrollRef}>
            {posts.map((post) => (
              <button
                type="button"
                className="forum-topic fm-topic"
                key={post.postId}
                data-post-id={post.postId}
                onClick={() => setDetailId(post.postId)}
              >
                <strong>{post.flame ? "🔥" : ""}{post.title}</strong>
                <p>{post.body.split("\n")[0]}</p>
                <div>
                  <span>
                    {post.displayAuthor ?? post.authorId} ·{" "}
                    {post.displayBoard ?? BOARD_BY_ID[post.boardId].name}
                  </span>
                  <span>{formatForumTime(post.publishedAt)}</span>
                </div>
                <div className="fm-topic-stats">
                  <span>
                    <Heart size={11} /> {post.likes}
                  </span>
                  <span>
                    <MessageCircle size={11} /> {post.replies}
                  </span>
                  <span>
                    <Eye size={11} /> {post.views}
                  </span>
                  {post.tags?.includes("热门") && (
                    <span className="fm-hot-tag">热门</span>
                  )}
                </div>
              </button>
            ))}
            {!posts.length && <p className="fm-empty">暂时没有新主题。</p>}
          </div>
        </section>

        <section className="fm-boards" aria-label="板块">
          <SearchBox
            value={boardQuery}
            set={setBoardQuery}
            placeholder="搜索板块"
          />
          <div className="fm-board-list" ref={boardsScrollRef}>
            {boards.map((board) => (
              <button
                type="button"
                className={`forum-board fm-board${boardId === board.id ? " selected" : ""}`}
                key={board.id}
                data-board-id={board.id}
                aria-pressed={boardId === board.id}
                onClick={() =>
                  setBoardId(boardId === board.id ? "" : board.id)
                }
              >
                <Hash size={17} />
                <div>
                  <strong>{board.name}</strong>
                  <small>{board.description}</small>
                  <em>{board.postCount.toLocaleString("en-US")} 帖</em>
                </div>
              </button>
            ))}
            {!boards.length && <p className="fm-empty">没有找到板块。</p>}
          </div>
        </section>
      </div>
    </div>
  );
}
