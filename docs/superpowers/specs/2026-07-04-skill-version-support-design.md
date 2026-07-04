# 技能/插件版本号支持 —— 设计文档

日期：2026-07-04
状态：已确认，待实现

## 背景

skill-hub 把上传的 ZIP 包 ingest 进 `data/marketplace` git 仓库：

- 每个插件目录 `plugins/<name>/.claude-plugin/plugin.json` 已有 `version` 字段，但裸 skill 被硬编码为 `1.0.0`，插件包则原样透传。
- manifest `.claude-plugin/marketplace.json` 的 entry（name/source/description/tags）**不含版本**。
- 覆盖上传 = 删旧目录 + 替换，**不追踪版本**。
- Claude Code 通过 git 仓库消费该 marketplace。

目标：支持版本号，能上传更新到新版本，且 Claude 能读到当前版本。

## 决策（已与用户确认）

1. **版本来源**：上传表单手填（可选，留空则有默认/自增规则）。
2. **历史版本**：不保留，只跟当前版本。覆盖上传即更新。
3. **防降级守卫**：加。覆盖时新版本 ≤ 当前版本则拒绝。
4. **UI 展示**：列表卡片 + 详情页都显示版本徽章。

## 数据模型

`version`（semver 字符串）成为一等字段，存两处：

- **canonical**：`plugins/<name>/.claude-plugin/plugin.json` 的 `version`。这是 Claude Code 插件系统**原生读取**的位置，保持准确即可让 `/plugin marketplace update` 后 Claude 读到新版本。消费端零改动。
- **镜像**：`marketplace.json` entry 增加 `PluginEntry.version?: string`，供列表/API/UI 直接展示，无需逐个读 plugin.json。

两处以 plugin.json 为准，manifest 只是冗余镜像。

## 上传 / 更新流程

- `UploadForm.tsx` 新增"版本号"输入框（可选，placeholder `1.0.0`）。
- `/api/skills` route 把 `version` 透传给 `ingest()`。
- `ingest(repoDir, extractedDir, opts)` 的 `opts` 增加 `version?: string`：
  - **新技能**：`version = opts.version || 包自带 version || '1.0.0'`
    - 裸 skill 无自带 version，落到 `1.0.0`。
    - 插件包可读 plugin.json 自带 version。
  - **覆盖更新**：`version = opts.version || bumpPatch(当前版本)`（留空自动 patch +1，如 `1.0.1 → 1.0.2`）。
    - "当前版本"读自现有 `plugins/<name>/.claude-plugin/plugin.json`。
  - **semver 校验**：正则校验格式，非法则 `throw`（返回 4xx，前端 alert）。
  - **防降级守卫**：覆盖时若新版本 ≤ 当前版本 → `throw`，报错信息说明需高于当前版本。
  - 最终 version 同时写入 `plugin.json`（覆盖其 version 字段）和 manifest entry。

### semver 小工具

不引依赖，几行 helper（放 `ingest.ts` 或独立 `src/lib/semver.ts`）：

- `parse("x.y.z") -> [x,y,z]`，非法返回 null。
- `bumpPatch(v) -> "x.y.(z+1)"`。
- `compare(a, b) -> -1|0|1`（逐段数值比较，用于防降级）。
- `isValid(v)`：正则 `^\d+\.\d+\.\d+$`（只支持 `x.y.z`，pre-release/build 元数据超范围，YAGNI）。

> ponytail: 只支持 `x.y.z` 三段数字，够用。若将来要 pre-release 标签再升级到完整 semver 库。

## 读取路径（Claude）

无需改消费端。plugin.json 的 version 保持准确 → Claude Code `/plugin marketplace update` 拉取后即读到新版本、可更新安装。

## UI 展示

- `PluginEntry` 增加 `version?: string`。
- **列表卡片** `SkillGrid.tsx`：每张卡加版本徽章（如 `v1.0.2`）。
- **详情页** `skills/[name]/page.tsx`：name/来源旁加版本徽章。
- 版本缺失（老数据无 version）时不显示徽章，避免报错。

## 改动文件

- `src/lib/marketplace.ts` —— `PluginEntry.version` 字段；`writeManifestEntry`/读取保留 version。
- `src/lib/ingest.ts` —— 接收 `opts.version`，semver 逻辑，写入 plugin.json + entry。
- （可选）`src/lib/semver.ts` —— semver 小工具。
- `src/app/api/skills/route.ts` —— 透传 `version`。
- `src/app/_components/UploadForm.tsx` —— 版本号输入框。
- `src/app/_components/SkillGrid.tsx` —— 列表卡片版本徽章。
- `src/app/skills/[name]/page.tsx` —— 详情页版本徽章。
- 对应 tests。

## 测试

- `ingest.test.ts`：
  - 新上传裸 skill 无表单版本 → `1.0.0`。
  - 新上传带表单版本 → 用表单值。
  - 覆盖 + 表单留空 → patch 自增。
  - 覆盖 + 表单高版本 → 用表单值。
  - 覆盖 + 表单 ≤ 当前版本 → 抛错（防降级）。
  - 非法 semver → 抛错。
  - version 同时写入 plugin.json 和 manifest entry。
- `marketplace.test.ts`：entry 携带 version，读回一致。
- （若拆 semver.ts）`semver.test.ts`：parse/bump/compare/isValid 边界。

## 非目标（YAGNI）

- 版本历史 / 多版本共存 / 安装指定版本 / 回滚。
- 完整 semver（pre-release、build 元数据、`^`/`~` 范围）。
- 自动 changelog。
