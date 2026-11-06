# AFTER THE LAST SET

本故事为香港理工大学校园 AU，当前阶段仅包含机主与「鄺學姐 💙」的 WhatsApp 私聊。

## 本地预览

```bash
STORY_FILE=stories/after-the-last-set/story.json npm run story:validate
STORY_FILE=stories/after-the-last-set/story.json npm run story:test
STORY_FILE=stories/after-the-last-set/story.json npm run story:preview
```

手机解锁密码：`0511`。当前不包含自定义壁纸、头像、真实照片、微信、群聊、Instagram 或跨 App 事件。

## 本次修复

- 图片消息使用 `meta.mediaTitle` 保留各自说明。
- WhatsApp 聊天按日期显示分隔条。
- 不在机主可见聊天中暴露角色全名。
- 项目级原生修复位于 `src/AppSkins.tsx`。
