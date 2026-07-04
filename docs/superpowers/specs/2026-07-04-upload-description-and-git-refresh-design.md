# 上传描述 + Git 信息刷新 设计文档

日期：2026-07-04

## 背景

当前上传技能时，描述只能从包内 `plugin.json` / `SKILL.md` 读出并写入 `marketplace.json`，上传者无法手动设置；`ensureRepo()` 仅在 `data/repo/.git` 不存在时 clone 远程，一旦本地仓库已存在，切换远程地址后不会拉取远程已有技能，也没有任何「刷新」入口。

本设计新增两个能力：
1. **上传时设置描述** —— 上传者可填写描述覆盖包内描述，同步到远程 git。
2. **Git 信息刷新** —— 配置远程仓库后能拉取远程已有技能显示到 hub。

## 决策

- 刷新语义：**远程为准，强制覆盖本地**（本地上传都会立即 push，本地不该有未推送改动，直接覆盖最安全）。
- 描述写入：**同时写** `marketplace.json` 条目与 `plugins/<name>/.claude-plugin/plugin.json`。
- 刷新触发：**保存设置时自动刷新 + 独立「刷新」按钮**，两者都要。

---

## 第 1 块：上传时设置描述

改动链路：`UploadForm` → `POST /api/skills` → `ingest()`

### UploadForm.tsx
- 在「技能名称」输入框下方新增可选的**描述 textarea**。
- 留空 = 沿用包内描述（保持当前行为）；提交时非空才 `formData.append('description', ...)`。

### POST /api/skills (route.ts)
- 从 `formData` 读 `description`，透传给 `ingest` 的 opts：
  ```ts
  const description = form.get('description')
  ingest(REPO_DIR, tmp, {
    name: nameOverride ? String(nameOverride) : undefined,
    overwrite,
    description: description ? String(description) : undefined,
  })
  ```

### ingest() (ingest.ts)
- opts 增加 `description?: string`。
- 解析出包描述后，若 `opts.description` 非空则覆盖：
  ```ts
  if (opts?.description) description = opts.description
  ```
  （放在读取 `description = pj.description || ''` / `fm.description || ''` 之后）
- 写回两处：
  - **plugin 类型**：copy 后写 `plugin.json` 时，除已有的 `pj.version = version`，再加 `pj.description = description`。
  - **裸 skill 类型**：生成的 `plugin.json` 本就带 `description`，直接使用覆盖后的值（无需额外改动，`description` 变量已是最终值）。
  - `writeManifestEntry` 已用 `description` 变量，自动生效。
- 提交/推送不变：随现有 `commitAll(`${overwrite ? 'update' : 'add'} ${res.name}`)` + `push()` 同步远程。

---

## 第 2 块：Git 信息刷新

### 新函数 syncFromRemote() (repo.ts)

```ts
// 远程为准，强制拉取覆盖本地。无远程或空远程时安全跳过。
export function syncFromRemote(): void {
  ensureRepo()                                   // .git 不存在时 clone，clone 本身即已同步
  if (!getRepoUrl()) return                      // 无远程地址（本地 init），跳过
  const heads = git(REPO_DIR, ['ls-remote', '--heads', 'origin']).trim()
  if (!heads) return                             // 远程无任何分支/提交，避免空仓 reset 失败
  git(REPO_DIR, ['fetch', 'origin'])
  git(REPO_DIR, ['reset', '--hard', 'FETCH_HEAD'])  // 覆盖本地，历史接到远程之后，后续 push 可 fast-forward
}
```

> 用 `FETCH_HEAD` 而非固定分支名：`git fetch origin`（无 refspec）后 FETCH_HEAD 指向远程默认分支，reset 到它即完成覆盖。

### 触发点 1：保存设置时自动刷新 —— PUT /api/settings (route.ts)
- 在 `setRemoteUrl(getRepoUrl())` 之后、市场名 rename 逻辑**之前**调用 `syncFromRemote()`。
- 顺序保证：先以远程状态覆盖本地，rename 再写在最新状态之上并 push。

### 触发点 2：独立刷新按钮 —— 新增 POST /api/settings/refresh (route.ts)
- 鉴权（`getUser()`）后调 `syncFromRemote()`，返回 `{ count }`（当前技能数 `listPlugins(REPO_DIR).length`）。
- 失败返回 `{ error, detail }`，500。

### SettingsForm.tsx
- 新增「刷新」按钮：`POST /api/settings/refresh` → 成功后 alert 技能数、`router.refresh()`；失败 alert 错误。
- 与「保存」「取消」并列。

### 页面生效
- `page.tsx` 已是 `force-dynamic` 且每次读 `listPlugins`；reset 覆盖本地 + 页面刷新即显示远程技能，无需额外改动。

---

## 涉及文件

| 文件 | 改动 |
|------|------|
| `src/lib/ingest.ts` | opts 加 `description`，覆盖并写回 plugin.json |
| `src/lib/repo.ts` | 新增 `syncFromRemote()` |
| `src/app/api/skills/route.ts` | 读 `description` 透传 ingest |
| `src/app/api/settings/route.ts` | PUT 内加自动刷新；新增 POST refresh 处理 |
| `src/app/_components/UploadForm.tsx` | 描述 textarea |
| `src/app/_components/SettingsForm.tsx` | 刷新按钮 |

## 测试

- `ingest`：传 `description` 覆盖，断言 `marketplace.json` 条目与 `plugins/<name>/.claude-plugin/plugin.json` 两处 description 一致；不传时沿用包内描述。
- `syncFromRemote`：本地 init 空仓 + 一个带提交的「远程」bare 仓，reset 后本地技能被远程覆盖；无远程 / 空远程时不抛错、无副作用。

## 范围外（YAGNI）

- 不支持编辑已有技能的描述（仅上传时设置）。
- 不改 `SKILL.md` frontmatter（裸 skill 的描述以生成的 plugin.json 为准）。
- 不做冲突合并 / 保留本地未推送改动（远程为准）。
