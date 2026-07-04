# 技能展示名称 设计文档

## 背景

技能条目 `PluginEntry` 目前只有 `name`：一个 kebab-case 技术标识符，同时承担目录名、URL（`/skills/[name]`）、安装命令中的名字，并直接作为列表卡片标题、详情页标题展示。上传表单只有一个"技能名称"输入框，控制的就是这个技术 `name`。

用户希望在新增技能时，能填写一个独立的、人类可读的"展示名称"，用于 UI 展示，与用作目录名/URL 的技术 `name` 分离。

## 数据模型

`PluginEntry`（`src/lib/marketplace.ts`）新增可选字段：

```ts
export interface PluginEntry {
  name: string
  source: string
  description?: string
  tags?: string[]
  version?: string
  displayName?: string
}
```

写入 `.claude-plugin/marketplace.json`。留空时不写入该字段（`undefined`），所有展示处按 `entry.displayName || entry.name` 兜底。老技能（无 `displayName`）无需迁移。

## ingest 逻辑

`ingest()`（`src/lib/ingest.ts`）新增 `opts.displayName`：trim 后直接作为条目的 `displayName`；留空则不设置。

与 `description` 字段行为一致：每次上传（包括覆盖上传）都会用本次传入值重建整个 manifest 条目，不读取/合并旧条目的 `displayName`。

**行为影响（已与用户确认，接受）：** 覆盖上传时若本次表单没填展示名称，旧的展示名称会被清空，回退为技术 `name`。也就是说每次覆盖上传都要重新填写才能保留展示名称。

## 上传接口与表单

- `src/app/api/skills/route.ts`：从 formData 读取 `displayName`，透传给 `ingest(opts)`。
- `src/app/_components/UploadForm.tsx`：
  - 新增"展示名称"输入框（可选），placeholder："留空则使用技能标识"。
  - 现有"技能名称"字段改名为"技能标识"，placeholder 改为"留空则使用文件名（用于目录名/URL）"，避免两个名称字段撞名造成混淆。

## 展示逻辑

- `src/app/_components/SkillGrid.tsx`：
  - 卡片标题改为 `plugin.displayName || plugin.name`。
  - 搜索过滤同时匹配 `displayName`（原来只匹配 `name`/`description`）。
- `src/app/skills/[name]/page.tsx`：
  - 详情页 H1 改为 `detail.entry.displayName || detail.entry.name`。
  - `generateMetadata` 改为调用 `getPluginDetail` 取 entry，`<title>` 同样使用 `entry.displayName || entry.name`。

## 测试

- `tests/ingest.test.ts`：新增用例——传 `displayName` 时写入 manifest 对应字段；不传时字段不出现在写入的 JSON 中。
- 覆盖上传场景：验证不传 `displayName` 会清空旧值（回退技术 name）。
