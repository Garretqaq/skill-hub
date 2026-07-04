# 已导入包的更新追踪 — 设计

**日期**：2026-07-04
**作者**：sgz

## 背景

远程仓库监听（`data/watched/`）、克隆、手动刷新（`refreshWatched`：fetch + reset 到远程 HEAD）、跨库聚合索引、搜索、导入到本市场，均已实现。

缺口：包**导入到本市场后**（拷贝进 `data/marketplace`），源仓库若发布新版本，本地这份无法感知。需求：刷新监听库只拉取远程最新信息；本地已导入的包若远程有新版本，**显示"有更新"**；只有用户**点击"更新"**，本地那份才真正同步。**全程手动，无自动更新。**

## 关键约束（决定设计）

`ingest()` 覆盖导入时强制 `bumpPatch`（`ingest.ts:95`），本地版本会自增、偏离源版本。因此**不能**拿本地已导版本直接和源比对——否则更新一次后本地版本领先，会永远显示"有更新"。

解法：**更新动作把本地版本直接盖成源版本**（给 `ingest` 传 `opts.version = 源版本`），使 `本地版本 == 源版本` 闭环。

## 更新信号

比对**源包声明的 `version` 字段**（plugin.json 的 `version` / SKILL.md frontmatter 的 `version`；引用型包取监听库 marketplace.json entry 的 `version`）。

已知局限：源包若无 `version` 或从不打版本号，检测不到更新。这是"版本字段"方案的固有代价，已接受；UI 会注明。

## 方案：按包名匹配（不新增台账文件）

复用现有 `buildIndex()` 聚合索引，按**包名**匹配本地已导入包 vs 远程包。理由：市场包名本就是全局唯一标识（`ingest` 按 name 去重），复用现成基础设施，代码最少。

同名包出现在多个监听库时，取 `version` 最高者为源。

## 数据流

1. 刷新监听库（现有 `refreshWatched`）→ 缓存 `data/watched/<id>` 拉到远程最新信息。
2. 打开管理控制台本地包列表 → `GET /api/updates` → 后端 `buildIndex()` 得远程每个包当前 version + 位置；`listPlugins(REPO_DIR)` 得本地已导入包 version；按 name 匹配，`compareVersions(远程, 本地) > 0` → 标记有更新。
3. UI 在有更新的包上显示"有更新"角标 + "更新"按钮。
4. 点"更新" → `POST /api/updates {name}` → 定位源（缓存 root 或引用型 sourceUrl）→ `ingest(overwrite, version=远程版本)` → commit + push。本地版本盖成源版本，闭环。

## 组件与改动

### `src/lib/ingest.ts`
`discoverPackages` 的 `DiscoveredPackage` 增加 `version?: string`：
- 文件包：读 plugin.json `version` / SKILL.md frontmatter `version`。
- 引用包：读 marketplace.json entry 的 `version`。

### `src/lib/watched.ts`
- `IndexedPackage` 增加 `version?: string`（`buildIndex` 透传）。
- 新增 `updateStatus(): UpdateItem[]`，复用 `buildIndex()` + `listPlugins(REPO_DIR)`，仅返回有更新的项：
  ```ts
  interface UpdateItem {
    name: string
    kind: 'plugin' | 'skill'
    localVersion: string
    remoteVersion: string
    repoId: string        // 源监听库
    source: string        // 源显示名
    sourceUrl?: string    // 引用型包才有
  }
  ```
  逻辑：远程按 name 聚合取 version 最高者；对每个本地已导入包，若远程存在同名且 `compareVersions(remote, local) > 0` 则纳入。源包 version 缺失/非法 → 跳过（不误报）。

### `src/app/api/updates/route.ts`（新增）
- `GET` → 返回 `updateStatus()`。
- `POST {name}` → 由 `updateStatus()`/`buildIndex()` 定位该 name 的源（`repoId` + root，或 `sourceUrl`），走 import 路由现有克隆/回滚/push 逻辑，`ingest` 传 `version = remoteVersion`，commit + push。

### UI：`src/app/_components/AdminConsole.tsx`
本地包列表中，有更新的包显示"有更新 vX→vY"角标 + "更新"按钮；点击调 `POST /api/updates`，成功后 Toast 提示并刷新列表。角标处注明"仅按版本号检测"。

## 错误处理 / 边界

- 源包无 version 或非法 → 无法比较，视为无更新（**绝不误报**）。
- 引用型包 version 取自监听库 marketplace.json；缺失则检测不到（已知局限，UI 注明）。
- 引用型包的 version 与实际克隆内容分属独立维护：marketplace.json entry 写的版本号，和 clone 源仓库默认分支 HEAD 得到的实际内容，二者可能不一致（entry 标 v2.0.0 但 HEAD 内容实为 v1.5.0 等效），属已知局限而非 bug。
- `POST` push 失败 → `resetTo(before)` 回滚（复用现有 import 逻辑）。
- 同名包出现在多个监听库 → 取 version 最高者为源。
- 更新时源已消失（监听库被移除/缓存缺失）→ 返回 404，UI 提示先刷新/重新监听。

## 测试

- `updateStatus`：本地 1.0.0 + 远程 1.1.0 → 有更新；远程 1.0.0 → 无；远程无 version → 无；同名多库取最高。
- `discoverPackages` version 提取（plugin.json / SKILL.md / 引用型 entry）。
- 更新闭环：更新后本地版本 == 源版本，再查 `updateStatus` 该包不再出现。
