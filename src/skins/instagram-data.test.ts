import { describe, it, expect } from "vitest";
import {
  FEED_POSTS,
  IG001_POST_ID,
  POST_BY_ID,
  POSTS,
  normalizePublishedAt,
  profilePosts,
  sortedPosts,
  timeKey,
  type IgPost,
} from "./instagram-data";
import {
  LINGLING_NEW_POSTS,
  LINGLING_NEW_RAW_TIMES,
} from "./instagram-lingling-posts";

/** 只用于稳定排序测试的最小帖子对象。 */
const stub = (postId: string, publishedAt: string) =>
  ({ postId, publishedAt } as unknown as IgPost);

const LINGLING_ORDER = [
  "post_ll_20261106_omakase", // 旧 2026-11-06 20:43
  "post_ll_20261104_Fly", // 新 2026-11-04 16:40
  "post_ll_20261102_taiyuan", // 新 2026-11-02 17:42
  "post_ll_20261019_rehearsal", // 旧 2026-10-19 23:26
  "post_ll_20261006_Morning", // 新 2026-10-06 11:23
  "post_ll_20260930_aw", // 新 2026-09-30 18:20
  "post_ll_20260917_pai", // 新 2026-09-17 18:23
  "post_ll_20260914_model", // 旧 2026-09-14 21:10
  "post_ll_20260814_dior", // 新 2026-08-14 17:20
  "post_ll_20260618_fitness", // 旧 2026-06-18 09:40
  "post_ll_20260608_flower", // 新 2026-06-08 12:21
  "post_ll_20260522_life", // 新 2026-05-22 14:29
  "post_ll_20260502_run", // 新 2026-05-02 06:59
  "post_ll_20260420_Night", // 新 2026-04-20 20:39
  "post_ll_20260314_dogs", // 旧 2026-03-14 18:30
  "post_ll_20251220_christmas", // 旧 2025-12-19 23:35
  "post_ll_20251102_editorial", // 旧 2025-11-02 20:15
];

describe("Instagram 学姐主页新增帖子的时间轴", () => {
  it("按香港当地时间 Asia/Hong_Kong 解释 YYYY-MM-DD HH:mm，并归一全角输入", () => {
    expect(normalizePublishedAt("2026-09-17  18：23")).toBe(
      "2026-09-17 18:23",
    );
    expect(normalizePublishedAt("2026-10-06 11：23")).toBe(
      "2026-10-06 11:23",
    );
    // 香港全年 UTC+8：17:42 HKT = 09:42 UTC。
    expect(timeKey("2026-11-02 17:42")).toBe(Date.UTC(2026, 10, 2, 9, 42));
    expect(timeKey("2026-11-04 16:40")).toBeGreaterThan(
      timeKey("2026-11-02 17:42"),
    );
    expect(timeKey("2026-09-17 18:23")).toBe(
      timeKey("2026-09-17  18：23"),
    );
  });

  it("时间相同时保持原有稳定顺序", () => {
    const list = [
      stub("older", "2026-01-01 10:00"),
      stub("same-a", "2026-05-01 10:00"),
      stub("same-b", "2026-05-01 10:00"),
      stub("newest", "2026-11-01 10:00"),
    ];
    expect(sortedPosts(list).map((p) => p.postId)).toEqual([
      "newest",
      "same-a",
      "same-b",
      "older",
    ]);
  });

  it("新旧 17 条帖子按发布时间统一倒序，历史帖落在对应位置", () => {
    const ids = profilePosts("linglingkwong").map((p) => p.postId);
    expect(ids).toEqual(LINGLING_ORDER);
    expect(ids).toHaveLength(17);
    expect(LINGLING_NEW_POSTS).toHaveLength(10);
    expect(new Set(ids).size).toBe(17);
    // 每条旧帖的时间戳仍与规格一致，没有因为重新排序被改写。
    expect(POST_BY_ID["post_ll_20261106_omakase"].publishedAt).toBe(
      "2026-11-06 20:43",
    );
    expect(POST_BY_ID["post_ll_20260914_model"].publishedAt).toBe(
      "2026-09-14 21:10",
    );
  });

  it("新增帖归一后的时间均来自规格原文，且仍是香港时间轴上的同一时刻", () => {
    for (const p of LINGLING_NEW_POSTS) {
      const raw = LINGLING_NEW_RAW_TIMES[p.postId];
      expect(raw, `${p.postId} 缺少原始时间`).toBeTruthy();
      expect(p.publishedAt).toBe(normalizePublishedAt(raw));
      expect(timeKey(p.publishedAt)).toBe(timeKey(raw));
    }
  });

  it("新增帖只进学姐主页，不进 Feed，也不抢 IG-001 的唯一目标", () => {
    expect(POSTS).toHaveLength(27);
    expect(FEED_POSTS.map((p) => p.postId)).toEqual([
      "post_ll_20261106_omakase",
      "post_ag_20261105_quiet",
      "post_lc_20261105_room",
      "post_pd_20261102_rain",
    ]);
    expect(
      POSTS.filter((p) => p.eventHook === "IG-001").map((p) => p.postId),
    ).toEqual([IG001_POST_ID]);
    expect(LINGLING_NEW_POSTS.every((p) => !p.inFeed && !p.eventHook)).toBe(
      true,
    );
    expect(
      LINGLING_NEW_POSTS.every((p) => p.userId === "linglingkwong"),
    ).toBe(true);
  });
});
