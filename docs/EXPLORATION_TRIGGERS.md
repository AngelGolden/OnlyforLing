# 探索触发系统 · 事件记录规范（v1.0）

> 本规范对应《AFTER THE LAST SET｜探索触发系统设计 v1.0》。
> 所有剧情**仅由玩家的探索行为触发**，不依赖现实时间流逝。手机系统时间照常显示现实时间，但**不用于决定主线消息是否出现**。
> 全部能力复用 FoundPhone-Studio 现有运行框架（`src/engine.ts` / `src/schema.ts` / `src/Phone.tsx`），**无需另写独立模拟器，也不改公共引擎**。

---

## 1. 核心约束（对应设计 §1）

- **禁止**用现实时间推进剧情：`story:validate` 已拒绝 `delayMs`、`delay` 类型节点、`time` action（见 `scripts/story.mjs`）。
- 手机时钟由框架 `advance()` 以 1:1 现实流速显示，仅作视觉呈现，**不参与剧情判定**。
- 玩家每次打开时，锁屏时间 / 日期自动对齐真实系统时间（见 `src/Phone.tsx` 的 `clockFields()` / `freshRuntime()`），但那只是“捡到一部已有历史的手机”的呈现，与剧情解锁无关。

---

## 2. 触发器类型 → 框架字段（对应设计 §2）

框架的事件入口在 `src/Phone.tsx` 里派发，引擎在 `src/engine.ts` 的 `dispatch(work, runtime, event, target)` 匹配节点：

| 设计中的触发 | 框架 `event` | `target` 写法 | 触发时机 |
|---|---|---|---|
| A. 打开 App | `openApp` | App 的 `id`（如 `whatsapp`） | 玩家点开某个 App |
| A. 打开帖子 / 图片 / 备忘录 / 日历条目 | `read` | 该内容的 `item.id` | 玩家点开（阅读）该条目 |
| A. 查看附件 | `read` | 附件的 `item.id` | 玩家打开附件 |
| B. 点赞 | `variable` | `ui:<appId>:liked-<itemId>` | 切换点赞状态（走 `useSkinState`） |
| B. 提交评论 | `variable` | `ui:<appId>:replies-<itemId>` | 提交一条评论 |
| B. 收藏 | `variable` | `ui:<appId>:saved-<itemId>` | 切换收藏 |
| B. 展开评论 / 打开详情 | `read` | 该帖子的 `item.id` | 进入帖子详情即一次 `read` |
| B. 打开搜索结果 | `openApp` / `read` | 结果对应的 App 或条目 | 点击搜索结果 |

> 注意：默认 feed 的点赞（`liked-<id>`）、评论提交（`replies-<id>`）、收藏（`saved-<id>`）均已通过 `src/skinState.ts` 的 `useSkinState` 派发 `ui:` 事件，可直接作为触发器。展开评论 / 打开帖子本身就是一次 `read`。

---

## 3. Chat Episode（对应设计 §3）

**每个 Episode = 一组预先写好的 `hidden` 消息 + 一个解锁节点**。消息永远在 `story.json` 里由作者编写，框架**只解锁、不生成**任何内容。

- 消息写在对应 App 的 `data.<appId>` 数组里，标注 `"hidden": true`。
- 解锁节点的 `actions` 里写 `{ "type": "unlock", "key": "<消息id>" }`。
- 触发该节点后，对应消息才在聊天 / 列表中显示。
- 一次触发只解锁该 Episode 的消息，**不会**自动播放其他未解锁内容。
- **不一次性加载全部未来记录**：未解锁的 Episode 消息始终 `hidden`，玩家看不到。

### Episode 消息模板

```jsonc
// 写在 data.whatsapp（或对应 App）里
{
  "id": "wa-ep1-msg1",
  "title": "邝学姐 💙",          // 会话（联系人）名，需与已有会话同名才会归到同一对话
  "sender": "邝学姐 💙",
  "body": "（作者编写的消息正文）",
  "time": "2026-11-08 15:30",    // 作者指定的显示时间；若想“永远刚收到”可用 "@now"
  "hidden": true                 // ← 关键：未解锁前不可见
}
```

### Episode 解锁节点模板

```jsonc
{
  "id": "ev-ep1",
  "label": "Episode 1 解锁",
  "type": "event",
  "event": "read",               // 或 openApp / variable，见第 2 节
  "target": "ig-post-xyz",       // 触发目标：被阅读/打开/点赞的对象 id
  "conditions": [],              // 前置条件（复合触发见第 6 节）；无则空数组
  "logic": "and",
  "actions": [
    { "type": "unlock", "key": "wa-ep1-msg1" },
    { "type": "unlock", "key": "wa-ep1-msg2" },
    { "type": "notification", "value": "@whatsapp|now|邝学姐 💙|（新消息正文）|>whatsapp:邝学姐 💙" }
  ],
  "next": [],
  "once": true                   // true = 只触发一次（幂等）
}
```

> 一个 Episode 可包含多条消息（多次 `unlock`），也可包含多个解锁节点（分别由不同探索动作触发）。

---

## 4. 消息通知（对应设计 §4）

当探索触发新聊天包时：

- 解锁节点同时执行 `notification` action，向 WhatsApp（或对应 App）增加一条预设消息。
- 若 App 未打开，手机锁屏 / 通知中心显示真实系统通知（横幅）。
- 未读角标按通知数自动更新。
- **点击通知 → 进入对应聊天位置**（已实现：`SystemNotifications` 的 `onOpen` 会把 `>appId:会话名` 段传给 `Phone`，解锁后自动打开该 App 并定位会话；锁屏时先输密码再跳转）。

### 结构化通知格式

```
@appId|time|sender|body|>target
```

- `appId`：通知图标对应的 App（如 `whatsapp`）。
- `time`：通知时间；写 `now` 表示“永远刚收到”（运行时替换为真实时刻，与手机时钟一致）。
- `sender`：发件人 / 标题（也是点击后定位的会话名）。
- `body`：通知正文。
- `>target`（可选）：点击后跳转，形如 `>whatsapp:邝学姐 💙`（App id + 冒号 + 会话名）。省略时按 `appId:sender` 跳转。

> 通知正文与聊天记录必须保持一致：通知 `body` 应等于被解锁消息的 `body`，时间字段也保持一致（都用 `now` 或都用同一固定时间）。

---

## 5. 事件幂等性与持久化（对应设计 §5）

- **幂等**：节点 `"once": true` 时，引擎通过 `runtime.completed` 记录已触发节点，重复触发不产生重复消息。
- **持久化**：整个 `runtime`（含 `completed` / `unlocked` / `read` / `ui` 等）自动存入 IndexedDB（`src/persistence.ts` + `src/Phone.tsx`）。刷新或重新进入手机后，已解锁内容不丢失、不重复发送。
- 若某事件允许重复触发（如可反复查看的彩蛋），设 `"once": false`。

---

## 6. 复合探索触发（对应设计 §2C）

多个探索动作完成后解锁一个隐藏资料 / 聊天包：把每个动作设成一个“标志”，汇总到一个带 `conditions` 的节点。

- `conditions` 支持的作用域前缀：`read:`（读过某条目）、`visited:`（到过某 App）、`unlocked:`（已解锁某内容）、`completed:`（已完成某事件）、`ui:`（某交互变量）、或直接变量名。
- `logic`：`"and"`（全部满足）/`"or"`（任一满足）/`"not"`。
- 复合条件必须由作者预先指定，不能运行时自动推断。

### 复合触发示例（完成 A 且完成 B 才解锁）

```jsonc
{
  "id": "ev-combo",
  "label": "复合解锁：读过帖子 + 点过赞",
  "type": "event",
  "event": "read",                 // 最后一个完成动作；也可选 variable
  "target": "ig-post-xyz",
  "conditions": [
    { "key": "read:ig-post-xyz", "op": "eq", "value": true },
    { "key": "ui:instagram:liked-ig-post-xyz", "op": "eq", "value": true }
  ],
  "logic": "and",
  "actions": [ { "type": "unlock", "key": "wa-hidden-pack" } ],
  "next": [],
  "once": true
}
```

---

## 7. 自由探索与主线依赖（对应设计 §6）

- 不同 App 的探索事件相互独立，可任意顺序触发。
- 只有显式写进 `conditions` 的事件才构成前置限制；不要默认要求“按唯一顺序探索”。
- 阅读历史信息只改变玩家信息掌握程度，不改变人物已确定的心理 / 行为（剧情文本已定，不会因探索顺序而变）。

---

## 8. 固定剧本（对应设计 §7）

- 所有消息、帖子、评论、备忘录、图片说明、事件内容由作者预先编写。
- **不写 `choice` 类型节点**即无对话分支；探索顺序不改变故事结局。
- 事件触发器只负责解锁内容，**绝不生成**作者未编写的内容。

---

## 9. 事件记录字段映射（对应设计 §8）

设计稿的“事件记录建议”字段 → 框架节点字段：

| 设计字段 | 框架字段 | 说明 |
|---|---|---|
| `event_id` | 节点 `id` | 全局唯一 |
| `trigger_type` | 节点 `event` | `openApp` / `read` / `variable` |
| `trigger_target` | 节点 `target` | App id / item id / `ui:<app>:<key>` |
| `prerequisite_events` | 节点 `conditions` | 用 `completed:<event_id>` 等作用域表达 |
| `episode_id` | `actions[].key` | 被解锁的隐藏内容 / 聊天包 id |
| `once_only` | 节点 `once` | `true` 幂等 |
| `unlock_targets` | 节点 `next` | 后续节点 id（按需） |

### 最小事件记录模板（JSON）

```jsonc
{
  "id": "ev-<唯一>",
  "label": "人类可读说明",
  "type": "event",
  "event": "openApp | read | variable",
  "target": "<appId> | <itemId> | ui:<appId>:<key>",
  "conditions": [
    { "key": "completed:<前置event_id>", "op": "eq", "value": true }
  ],
  "logic": "and | or | not",
  "actions": [
    { "type": "unlock", "key": "<隐藏消息/内容 id>" },
    { "type": "notification", "value": "@<appId>|<time>|<sender>|<body>|>><appId>:<会话名>" }
  ],
  "next": [],
  "once": true
}
```

---

## 10. 验证清单（作者自检）

- [ ] 没有 `delayMs` / `delay` 节点，没有 `time` action（`story:validate` 会拦截）。
- [ ] 每个 Episode 的消息都标了 `"hidden": true`。
- [ ] 解锁节点的 `actions` 同时 `unlock` 消息 + `notification` 文案，二者一致。
- [ ] 需要幂等的节点 `once: true`；允许重复的 `once: false`。
- [ ] 复合条件都显式写在 `conditions` 里，并指定 `logic`。
- [ ] 不写 `choice` 节点（保持固定剧本）。
- [ ] 运行 `npm run story:validate && npm run story:test && npm run story:build` 全绿。
