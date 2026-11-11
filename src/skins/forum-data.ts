/**
 * 校园论坛固定内容数据。
 *
 * 这里只存放预置的板块、帖子与评论，不调用事件引擎、不生成动态内容。
 * 所有板块、帖子、评论与账号都使用稳定 ID；帖子列表按 publishedAt 排序，
 * 绝不按 postId 字符串排序。
 *
 * 论坛是非官方校园社区：板块数据里的帖子数是模拟总量，与这里展示的
 * 固定帖子条数是两回事，不做任何换算或随机补齐。
 */

export const FORUM_USER_IDS = [
  "afterhours_31",
  "afterclass_09",
  "backstage_22",
  "bassline_17",
  "citywalk_23",
  "design_ki",
  "filmgrain_hk",
  "harbourboy",
  "harbourlight",
  "hfala",
  "hkafterclass",
  "hkfilmroll",
  "hunghom_eat",
  "littleharbour",
  "lowend_17",
  "m0onlit_hk",
  "mainland_days",
  "mainland_student",
  "mango_milk",
  "pinkcloud_22",
  "polyu_mango",
  "polyumango",
  "redbrickcoffee",
  "stageleft",
  "teaandrain",
] as const;

export type ForumUserId = (typeof FORUM_USER_IDS)[number];

/**
 * 账号语言风格说明（只用于人工核对，不参与渲染或排序）：
 * mainland_student 普通话表达 / design_ki 普通话为主 / filmgrain_hk 普通话为主；
 * hkafterclass 粤语繁体 / harbourboy 粤语口语 / m0onlit_hk 粤语夹英语；
 * bassline_17 中英粤语混合。其余账号沿用各自预置留言的语体。
 */
export const FORUM_USER_STYLES: Partial<Record<ForumUserId, string>> = {
  mainland_student: "普通话表达",
  design_ki: "普通话为主",
  filmgrain_hk: "普通话为主",
  hkafterclass: "粤语繁体",
  harbourboy: "粤语口语",
  m0onlit_hk: "粤语夹英语",
  bassline_17: "中英粤语混合",
};

export type ForumBoardId =
  | "board_campus"
  | "board_music"
  | "board_people"
  | "board_hunghom"
  | "board_chat";

export type ForumBoard = {
  id: ForumBoardId;
  name: string;
  description: string;
  /** 模拟板块总帖数，不是本页预置帖子的条数 */
  postCount: number;
};

export const FORUM_BOARDS: ForumBoard[] = [
  {
    id: "board_campus",
    name: "校园生活",
    description: "课程、社团、活动、校园日常",
    postCount: 1286,
  },
  {
    id: "board_music",
    name: "音乐社 / 乐队交流",
    description: "排练、演出、乐队消息",
    postCount: 428,
  },
  {
    id: "board_people",
    name: "人物与校园活动",
    description: "校园人物、活动、讨论",
    postCount: 736,
  },
  {
    id: "board_hunghom",
    name: "红磡 / 黄埔生活",
    description: "餐厅、购物、交通、生活",
    postCount: 953,
  },
  {
    id: "board_chat",
    name: "吹水台",
    description: "闲聊、日常讨论",
    postCount: 2416,
  },
];

export const BOARD_BY_ID: Record<ForumBoardId, ForumBoard> = Object.fromEntries(
  FORUM_BOARDS.map((b) => [b.id, b]),
) as Record<ForumBoardId, ForumBoard>;

export type ForumComment = {
  commentId: string;
  userId: ForumUserId;
  body: string;
  /** 楼层号，从 1 开始 */
  floor: number;
  /** 仅标注语义上明确的楼中楼回复，不额外编造互动关系 */
  replyTo?: number;
};

export type ForumPost = {
  postId: string;
  boardId: ForumBoardId;
  title: string;
  authorId: ForumUserId;
  publishedAt: string;
  body: string;
  likes: number;
  replies: number;
  views: number;
  comments: ForumComment[];
  /** 以下四项只给隐藏爆料帖使用；普通帖子不设置，渲染时回退到默认字段。 */
  displayAuthor?: string;
  displayBoard?: string;
  tags?: string[];
  flame?: boolean;
};

/** 固定帖子，按规格顺序书写；展示时统一用 sortForumPosts 重新排序。 */
export const FORUM_POSTS: ForumPost[] = [
  {
    postId: "forum_001_christmas_live",
    boardId: "board_music",
    title: "Late Checkout 圣诞场有人拍到全程吗？",
    authorId: "afterhours_31",
    publishedAt: "2025-12-20 00:28",
    body: "昨晚 Late Checkout 的圣诞场气氛真的好好，主唱现场比短视频里还稳。\n\n有没有人录到第二首？想再听一次副歌，现场大家一起唱的时候真的有点起鸡皮疙瘩。",
    likes: 214,
    replies: 36,
    views: 4826,
    comments: [
      {
        commentId: "forum_001_c01",
        userId: "harbourlight",
        body: "佢 live 真係好穩，後半段全場都跟住唱。",
        floor: 1,
      },
      {
        commentId: "forum_001_c02",
        userId: "design_ki",
        body: "新bass是不是今年刚加入的？台上感觉还蛮自然。",
        floor: 2,
      },
      {
        commentId: "forum_001_c03",
        userId: "bassline_17",
        body: "係呀，之前嗰位去实习，呢位係临时顶上，最近先熟起来。",
        floor: 3,
        replyTo: 2,
      },
      {
        commentId: "forum_001_c04",
        userId: "design_ki",
        body: "这个base真是换的太好了，之前那个base做的烂事真当互联网没记忆呢",
        floor: 4,
        replyTo: 3,
      },
      {
        commentId: "forum_001_c05",
        userId: "hfala",
        body: "哦？楼上有瓜？",
        floor: 5,
        replyTo: 4,
      },
      {
        commentId: "forum_001_c06",
        userId: "citywalk_23",
        body: "主唱人气真的好高，我朋友根本不知道这是校园乐队，纯粹为了她来的哈哈。",
        floor: 6,
      },
      {
        commentId: "forum_001_c07",
        userId: "hkafterclass",
        body: "佢本身就唔少人識啦，當晚觀眾比預期多好多。",
        floor: 7,
        replyTo: 6,
      },
    ],
  },
  {
    postId: "forum_002_new_bass",
    boardId: "board_campus",
    title: "新 bass 第一次上台，是不是有点紧张？",
    authorId: "polyu_mango",
    publishedAt: "2026-02-23 11:42",
    body: "最近看到 Late Checkout 的现场照片，感觉那个新 bass 已经跟大家熟起来了。\n\n好奇有没有人认识？感觉之前都没怎么见过她。",
    likes: 96,
    replies: 18,
    views: 2183,
    comments: [
      {
        commentId: "forum_002_c01",
        userId: "lowend_17",
        body: "好像是设计系的，平时不怎么在公开活动露面。",
        floor: 1,
      },
      {
        commentId: "forum_002_c02",
        userId: "m0onlit_hk",
        body: "我有睇过佢哋排练，主唱好似幾有耐性，成日會停低同佢對拍子。",
        floor: 2,
      },
      {
        commentId: "forum_002_c03",
        userId: "mainland_days",
        body: "从临时顶替到现在能一起演出，应该练了挺久吧。",
        floor: 3,
      },
      {
        commentId: "forum_002_c04",
        userId: "harbourboy",
        body: "新成员要适应嘛，大家都照顾下正常啦。",
        floor: 4,
      },
      {
        commentId: "forum_002_c05",
        userId: "design_ki",
        body: "但感觉她们两个配合得越来越好了。",
        floor: 5,
        replyTo: 2,
      },
    ],
  },
  {
    postId: "forum_003_lingling_on_campus",
    boardId: "board_people",
    title: "有人在理大见过 Lingling 吗？",
    authorId: "pinkcloud_22",
    publishedAt: "2026-04-12 17:36",
    body: "以前只在网上刷到她，最近才知道她原来就是理大的。\n\n有没有人偶遇过？感觉她现实里应该也很有气质吧。",
    likes: 342,
    replies: 49,
    views: 8614,
    comments: [
      {
        commentId: "forum_003_c01",
        userId: "redbrickcoffee",
        body: "有见过一次，真人真的好靓，气质同镜头里面好唔同。",
        floor: 1,
      },
      {
        commentId: "forum_003_c02",
        userId: "mainland_student",
        body: "她之前是图书馆幽灵来着，这学期开始很少见她。",
        floor: 2,
      },
      {
        commentId: "forum_003_c03",
        userId: "hkfilmroll",
        body: "佢返學同做嘢都好忙㗎，唔係成日見到。",
        floor: 3,
        replyTo: 2,
      },
      {
        commentId: "forum_003_c04",
        userId: "afterhours_31",
        body: "她本人好像蛮低调的，不过人很好啦，之前夜市活动还看到她帮人摆摊",
        floor: 4,
      },
      {
        commentId: "forum_003_c05",
        userId: "m0onlit_hk",
        body: "校内现在好多人都识佢啦，唔止fans。",
        floor: 5,
      },
    ],
  },
  {
    postId: "forum_004_special_care",
    boardId: "board_music",
    title: "上次排练，主唱是不是对新 bass 特别照顾？",
    authorId: "filmgrain_hk",
    publishedAt: "2026-09-22 22:14",
    body: "不知道是不是我观察得太仔细。\n\n上次听 Late Checkout 彩排的时候，主唱好几次回头确认 bass 那边的声音，还问她 monitor 听不听得到。\n\n正式开始前也等她调整好才继续。\n\n可能是我想多了？但感觉她对新 bass 真的蛮上心的。",
    likes: 187,
    replies: 31,
    views: 4205,
    comments: [
      {
        commentId: "forum_004_c01",
        userId: "lowend_17",
        body: "我都有留意到，佢真係望住右邊確認咗幾次。",
        floor: 1,
      },
      {
        commentId: "forum_004_c02",
        userId: "design_ki",
        body: "可能是新成员吧，主唱要照顾整体配合。",
        floor: 2,
      },
      {
        commentId: "forum_004_c03",
        userId: "harbourboy",
        body: "佢平时对队友都几好，唔好咁快脑补啦 😂",
        floor: 3,
      },
      {
        commentId: "forum_004_c04",
        userId: "mainland_days",
        body: "贴主是cpf就不要躲躲藏藏的了。",
        floor: 4,
      },
      {
        commentId: "forum_004_c05",
        userId: "m0onlit_hk",
        body: "主唱大人的唯粉已经打过来了。",
        floor: 5,
        replyTo: 4,
      },
      {
        commentId: "forum_004_c06",
        userId: "citywalk_23",
        body: "乐队内部的事还是不要乱猜比较好，不过现场确实挺默契的。",
        floor: 6,
      },
    ],
  },
  {
    postId: "forum_005_popularity",
    boardId: "board_people",
    title: "原来喜欢 Lingling 的人真的这么多？",
    authorId: "littleharbour",
    publishedAt: "2026-10-06 20:17",
    body: "最近校园活动的帖子下面，总能看到有人问她会不会出现。\n\n之前以为只是粉丝比较集中，结果发现本地同学也有不少人认识她。",
    likes: 426,
    replies: 62,
    views: 11936,
    comments: [
      {
        commentId: "forum_005_c01",
        userId: "hkafterclass",
        body: "佢本身就有自己嘅粉丝群啦。",
        floor: 1,
      },
      {
        commentId: "forum_005_c02",
        userId: "mainland_student",
        body: "她在网上关注度本来就很高，我室友也喜欢她。",
        floor: 2,
      },
      {
        commentId: "forum_005_c03",
        userId: "filmgrain_hk",
        body: "之前经常能在健身房看到她，最近看她ig感觉很忙。",
        floor: 3,
      },
      {
        commentId: "forum_005_c04",
        userId: "redbrickcoffee",
        body: "但校内见到佢都好自然，唔会刻意摆架子。",
        floor: 4,
        replyTo: 2,
      },
      {
        commentId: "forum_005_c05",
        userId: "design_ki",
        body: "所以她来参加校园活动的时候总是很多人围观。",
        floor: 5,
      },
    ],
  },
  {
    postId: "forum_006_future_gig",
    boardId: "board_music",
    title: "Late Checkout 下学年还会继续演出吗？",
    authorId: "afterclass_09",
    publishedAt: "2026-10-28 19:42",
    body: "最近几次看了 Late Checkout 的演出都很不错。\n\n想问问他们下学年还会不会继续有现场？感觉现在这个阵容已经挺稳定了。",
    likes: 163,
    replies: 43,
    views: 3892,
    comments: [
      {
        commentId: "forum_006_c01",
        userId: "bassline_17",
        body: "希望会有！呢个阵容真係几好听。",
        floor: 1,
      },
      {
        commentId: "forum_006_c02",
        userId: "polyumango",
        body: "我也想再看一次，尤其是圣诞场那种氛围。",
        floor: 2,
      },
      {
        commentId: "forum_006_c03",
        userId: "design_ki",
        body: "主唱毕业之后还会留在香港吗？",
        floor: 3,
      },
      {
        // 未经证实的论坛传闻：只作为一条普通留言出现，不设为已确认事实。
        commentId: "forum_006_c04",
        userId: "teaandrain",
        body: "听说她有考虑出国读研？前几天那个爆料贴不是提过，不过完全没实锤。",
        floor: 4,
        replyTo: 3,
      },
      {
        commentId: "forum_006_c05",
        userId: "hkafterclass",
        body: "未 confirm 啦，佢自己都冇公开讲过，唔好当消息传。",
        floor: 5,
        replyTo: 4,
      },
      {
        commentId: "forum_006_c06",
        userId: "mainland_days",
        body: "也可能只是考虑申请，最后去不去还不知道吧。",
        floor: 6,
        replyTo: 4,
      },
      {
        commentId: "forum_006_c07",
        userId: "harbourboy",
        body: "先唔好乱估啦，等佢自己讲啦。",
        floor: 7,
        replyTo: 4,
      },
    ],
  },
  {
    postId: "forum_007_hunghom_japanese_food",
    boardId: "board_hunghom",
    title: "红磡附近有没有适合聚餐的日料？",
    authorId: "hunghom_eat",
    publishedAt: "2026-11-02 18:26",
    body: "最近想在红磡附近找一家环境舒服一点的日料，最好适合几个人慢慢吃饭。\n\n不要太吵的，有没有人推荐？",
    likes: 72,
    replies: 19,
    views: 1837,
    comments: [
      {
        commentId: "forum_007_c01",
        userId: "citywalk_23",
        body: "黃埔嗰邊有唔少選擇，可以行一圈。",
        floor: 1,
      },
      {
        commentId: "forum_007_c02",
        userId: "mango_milk",
        body: "我觉得还是看预算，Omakase和普通日料差蛮多的。",
        floor: 2,
        replyTo: 1,
      },
      {
        commentId: "forum_007_c03",
        userId: "hkafterclass",
        body: "如果想慢慢食，最好提前book。",
        floor: 3,
        replyTo: 1,
      },
      {
        commentId: "forum_007_c04",
        userId: "mainland_student",
        body: "收藏了，最近也在找这附近的餐厅。",
        floor: 4,
      },
    ],
  },
  {
    postId: "forum_008_campus_week",
    boardId: "board_campus",
    title: "最近理大是不是特别多活动？",
    authorId: "redbrickcoffee",
    publishedAt: "2026-11-07 18:20",
    body: "最近感觉校园里活动特别多，音乐社、展览、各种分享会都撞在一起了。\n\n有没有人整理一下这周的活动？有点不知道先去哪个。",
    likes: 41,
    replies: 12,
    views: 968,
    comments: [
      {
        commentId: "forum_008_c01",
        userId: "polyumango",
        body: "设计系这周也有东西要交，已经忙晕了。",
        floor: 1,
      },
      {
        commentId: "forum_008_c02",
        userId: "afterclass_09",
        body: "我只想知道周末有冇音乐活动 😂",
        floor: 2,
      },
      {
        commentId: "forum_008_c03",
        userId: "hkafterclass",
        body: "我想去听歌，但最近真的好多 project。",
        floor: 3,
      },
      {
        commentId: "forum_008_c04",
        userId: "m0onlit_hk",
        body: "理大最近真係好热闹。",
        floor: 4,
      },
    ],
  },
];

export const POST_BY_ID: Record<string, ForumPost> = Object.fromEntries(
  FORUM_POSTS.map((p) => [p.postId, p]),
);

/**
 * 隐藏爆料帖：独立的隐藏搜索索引，不并入 FORUM_POSTS。
 *
 * - 不出现在首页、最新 / 热门排序、任何板块的帖子列表；
 * - 不进入 searchForumPosts 的全文索引，所以「乐队」「出国」「爆料」等词
 *   搜不到它，也不会因为正文含有敏感词而提前暴露；
 * - 只有左侧帖子搜索栏命中下面的别名时，才作为额外结果加入搜索结果。
 */
export const HIDDEN_RUMOR_POST_ID = "forum_hidden_009_rumor";

/** 命中任一别名即可找到隐藏帖；英文不区分大小写，中文按包含匹配。 */
export const HIDDEN_RUMOR_SEARCH_ALIASES = [
  "邝玲玲",
  "玲玲",
  "lingling",
  "主唱",
  "Late Checkout",
] as const;

/**
 * 单独搜索这些词不得返回隐藏帖。
 * 「换主唱」本身包含别名「主唱」，直接做包含匹配会误命中；因此匹配前先把
 * 禁止词作为整体片段剔除，剔除后仍含别名才允许加入结果。
 */
export const HIDDEN_RUMOR_BLOCKED_TERMS = [
  "乐队",
  "换主唱",
  "解散",
  "出国",
  "读研",
  "香港",
  "泰国",
  "爆料",
  "内部消息",
] as const;

export type HiddenForumPost = ForumPost & {
  /** 独立隐藏搜索索引，只由 matchesHiddenRumor 使用 */
  searchAliases: readonly string[];
};

export const FORUM_HIDDEN_POSTS: HiddenForumPost[] = [
  {
    postId: HIDDEN_RUMOR_POST_ID,
    boardId: "board_music",
    title: "【🍉】某支校园乐队明年可能要换主唱？",
    authorId: "backstage_22",
    displayAuthor: "Backstage",
    // 规格 4.4 要求搜索结果卡片显示这个板块文字；数据归属仍是 board_music。
    displayBoard: "吹水台/人物与校园活动",
    publishedAt: "2026-10-20 21:26",
    body:
      "先说在前面，不是完全没根据。\n\n" +
      "我有一点人脉，最近听到一个消息。\n\n" +
      "Late Checkout 明年可能不会维持现在这个阵容了。\n\n" +
      "不是普通成员变动，主要是主唱那边的安排。那位应该不用我点名，校内很多人认识，外面也有自己的工作和曝光度。\n\n" +
      "听说她明年可能不一定继续留在香港，似乎有海外进修或者其他发展安排。\n\n" +
      "具体是什么、是否已经定下来，我不清楚。\n\n" +
      "乐队目前可能在考虑找人接手主唱，或者直接就暂时停止活动。严重的话，也不排除直接散掉。\n\n" +
      "先说清楚，是听来的消息，不保熟。",
    likes: 486,
    replies: 137,
    views: 16842,
    tags: ["热门", "爆料", "未证实"],
    flame: true,
    searchAliases: [...HIDDEN_RUMOR_SEARCH_ALIASES],
    comments: [
      {
        commentId: "rumor_c01",
        userId: "citywalk_23",
        body: "如果真係有料，點解又唔敢講來源？",
        floor: 1,
      },
      {
        commentId: "rumor_c02",
        userId: "mainland_student",
        body: "@ 0号星球",
        floor: 2,
      },
      {
        commentId: "rumor_c03",
        userId: "lowend_17",
        body: "那位主唱不是中泰混血吗？她妈妈就是泰国人，考虑回那边也是情有可原吧。",
        floor: 3,
      },
      {
        commentId: "rumor_c04",
        userId: "hkafterclass",
        body: "佢自己都未講，唔好喺度講到似confirm咁。",
        floor: 4,
      },
      {
        commentId: "rumor_c05",
        userId: "stageleft",
        body: "外地进修不等于退出乐队吧，假期演出也有可能。",
        floor: 5,
      },
      {
        commentId: "rumor_c06",
        userId: "design_ki",
        body: "我觉得更像是有人听到一点消息，然后自己补全了后面的剧情。",
        floor: 6,
      },
      {
        commentId: "rumor_c07",
        userId: "harbourboy",
        body: "唔好每次有啲风声就当真，等本人讲啦。",
        floor: 7,
      },
      {
        commentId: "rumor_c08",
        userId: "backstage_22",
        body: "我只是分享听到的，具体来源不方便讲。你们信不信随意。",
        floor: 8,
      },
    ],
  },
];

export const HIDDEN_POST_BY_ID: Record<string, HiddenForumPost> =
  Object.fromEntries(FORUM_HIDDEN_POSTS.map((p) => [p.postId, p]));

/**
 * 独立隐藏搜索索引判定。公开帖子不受此函数影响，仍走 searchForumPosts 的
 * 标题 / 正文 / 发帖人全文检索。
 */
export function matchesHiddenRumor(query: string): boolean {
  let cleaned = query.trim().toLowerCase();
  if (!cleaned) return false;
  for (const term of HIDDEN_RUMOR_BLOCKED_TERMS)
    cleaned = cleaned.split(term.toLowerCase()).join(" ");
  return HIDDEN_RUMOR_SEARCH_ALIASES.some((alias) =>
    cleaned.includes(alias.toLowerCase()),
  );
}

export type ForumSort = "newest" | "hot";

/** 最新：按发布时间倒序；热门：按点赞数倒序，同赞数再按时间倒序。 */
export function sortForumPosts(posts: ForumPost[], sort: ForumSort): ForumPost[] {
  return [...posts].sort((a, b) => {
    if (sort === "hot" && a.likes !== b.likes) return b.likes - a.likes;
    return b.publishedAt.localeCompare(a.publishedAt);
  });
}

/** 帖子搜索：标题、正文、发帖人。 */
export function searchForumPosts(posts: ForumPost[], query: string): ForumPost[] {
  const q = query.trim().toLowerCase();
  if (!q) return posts;
  return posts.filter((p) =>
    `${p.title} ${p.body} ${p.authorId}`.toLowerCase().includes(q),
  );
}

/** 板块搜索：板块名称与简介。 */
export function searchForumBoards(boards: ForumBoard[], query: string): ForumBoard[] {
  const q = query.trim().toLowerCase();
  if (!q) return boards;
  return boards.filter((b) =>
    `${b.name} ${b.description}`.toLowerCase().includes(q),
  );
}

export function formatForumTime(value: string): string {
  return value.slice(5, 16);
}
