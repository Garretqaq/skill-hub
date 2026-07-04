# 远程仓库监听与聚合搜索 — 设计文档

- 作者：sgz
- 日期：2026-07-04
- 状态：已确认，待实现

## 背景与目标

现有 skill-hub 的入库来源只有「本地 ZIP 上传」（`UploadForm` → `POST /api/skills` → `ingest()`）。
本功能新增一条来源：**远程 git 仓库**。

参考 Claude Code 的 `plugin marketplace add <repo>` + `plugin install <name>@<market>` 心智，管理员可以：

1. **添加仓库监听**：登记若干远程仓库到持久化的监听列表
2. **刷新仓库来源**：手动重新拉取监听仓库，更新本地缓存
3. **跨库搜索**：在所有监听仓库发现的 plugin/skill 中按关键词搜索
4. **结果去向（两者都要）**：
   - 查看该包**外部仓库自己的**安装命令（`marketplace add` + `install`）
   - 一键**导入本 hub 市场**（复制进 `data/marketplace`、commit、push）

## 关键决策

| 决策 | 结论 | 理由 |
|---|---|---|
| 来源格式 | GitHub 简写 `owner/repo` + 完整 git URL | 覆盖示例与任意 git 主机；不做分支/tag/token（保持简单） |
| 仓库粒度 | 按「仓库维度」，一个仓库可能含多个 plugin/skill | 单插件仓库是「恰好 1 个」的特例 |
| 结果去向 | 外部安装命令 + 导入本市场，两者都要 | — |
| 刷新方式 | 手动按钮（每库一个 + 全部刷新） | 自动定时需引入 cron/轮询，明显更重，留后续 |
| UI 位置 | 独立路由 `/admin/remote` | 有仓库列表+刷新+搜索+结果三块，塞进 modal 会挤 |
| 聚合索引 | 搜索时现扫缓存克隆，不落盘 | 管理员低频操作，文件遍历快；慢了再缓存 |
| 导入/发现的克隆 | 复用监听仓库的常驻缓存克隆，无临时二次 clone | 监听模型天然持有缓存，导入直接从缓存目录取包根 |

## 数据模型与存储

- **监听清单** `data/watched.json`

  ```json
  {
    "repos": [
      {
        "id": "obra__superpowers-marketplace",
        "source": "obra/superpowers-marketplace",
        "url": "https://github.com/obra/superpowers-marketplace.git",
        "addedAt": "2026-07-04T00:00:00.000Z"
      }
    ]
  }
  ```

  - `source`：用户填的原始值
  - `url`：规范化后的可 clone 地址
  - `id`：由 source 派生的安全目录名（用作缓存目录名，需去除路径分隔符等）

- **本地缓存** `data/watched/<id>/`：每个监听仓库的浅克隆（`--depth 1`，默认分支）
- `.gitignore` 追加 `data/watched/`，避免缓存克隆被主仓库追踪

## 复用点（核心逻辑几乎不新增）

`ingest(repoDir, extractedDir, opts)` 已把「解包目录 → 入库」解耦。因此：

- **发现**：对缓存克隆目录跑发现逻辑得到包清单
- **导入**：把「该包在缓存克隆里的根目录」当作 `extractedDir` 传给现有 `ingest()`，逐个复用，`ingest` 本身零改动（其内部 `findRoot` 指向单个包根时立即命中）

需要给 `src/lib/ingest.ts` 新增两个纯函数：

- `findRoots(dir): { root: string; kind: 'plugin' | 'skill' }[]`
  现有 `findRoot` 的「收集全部」版：递归查找所有含 `.claude-plugin/plugin.json`（插件根）或 `SKILL.md`（技能根）的目录，**命中即不再向下钻**（保证插件内嵌的 `skills/*/SKILL.md` 不被当作独立 skill 重复计数）。
- `discoverPackages(dir): { name, kind, description, root }[]`
  对每个 root 读出元信息（plugin 读 `plugin.json`，skill 读 `SKILL.md` frontmatter），复用 `ingest` 里已有的解析约定。

## 组件与文件清单

新增/改动：

- `src/lib/ingest.ts`（改）：新增 `findRoots`、`discoverPackages`；`ingest` 不变
- `src/lib/remote.ts`（新，小）：`normalizeSource(input): { url }` —— `owner/repo` 展开为 `https://github.com/owner/repo.git`；完整 URL 原样返回；**拒绝本地路径 / `file://`**
- `src/lib/watched.ts`（新）：`data/watched.json` 的读写（list/add/remove）、克隆/刷新（`execFileSync` git，非 shell）、`buildIndex()`（对每个监听仓库 `discoverPackages` 后拍平，附 `repoId/source/url`）
- `src/app/api/watched/route.ts`（新）：`GET`（列表 + 索引，`?q=` 过滤）、`POST`（加监听）、`DELETE`（删监听 + 删缓存目录）
- `src/app/api/watched/refresh/route.ts`（新）：`POST {id?}`，无 id 刷新全部
- `src/app/api/watched/import/route.ts`（新）：`POST {id, name}`，从缓存克隆取包根 → `ingest` → `commitAll` → `push`（push 失败 `resetTo` 回滚，与现有上传流一致）
- `src/app/admin/remote/page.tsx`（新）：服务端页，鉴权后渲染客户端组件
- `src/app/_components/RemoteRepos.tsx`（新）：客户端组件，含
  - 添加仓库输入框
  - 监听仓库列表（每行：source、刷新、移除）+「全部刷新」
  - 搜索框（跨库）
  - 结果列表（每行：来源徽标、name、kind、description，动作「导入本市场」+「安装命令」）
- `src/app/_components/AdminConsole.tsx`（改）：头部加「远程仓库」按钮，跳转 `/admin/remote`
- 「安装命令」展示复用 `InstallCommands` 的样式（指向外部仓库的 `marketplace add <url>` + `install <name>@<外部市场名>`；外部市场名取该仓库 `.claude-plugin/marketplace.json` 的 `name`，缺失则回退提示按仓库 URL 安装）

## 数据流

**添加监听**：`POST /api/watched {source}` → `normalizeSource` 校验 → 浅克隆到 `data/watched/<id>/` → 写 `data/watched.json`

**刷新**：`POST /api/watched/refresh {id?}` → 对目标缓存 `git fetch` + `reset --hard`（失败则重新 clone 兜底）

**搜索**：`GET /api/watched?q=kw` → `buildIndex()` 扫所有缓存 → 按 name/description 过滤

**导入本市场**：`POST /api/watched/import {id, name}` → 从 `data/watched/<id>/` 定位该包根 → `ingest(REPO_DIR, 包根, {overwrite:true})` → `commitAll` → `push`（失败回滚）

## 错误处理

- 导入按包**逐个**返回结果，不做整批 all-or-nothing（一个失败不拖垮其余）
- 版本冲突（覆盖时新版本不高于现有）由现有 `ingest` 抛错，前端按包提示
- push 失败：`resetTo(before)` 回滚刚生成的 commit 与文件，返回 `stripCreds` 脱敏后的错误
- clone/refresh 失败：返回脱敏错误，不影响其他监听仓库

## 安全

- `normalizeSource` 拒绝本地路径 / `file://`，防止 clone 本地任意目录
- 所有 git 调用走 `execFileSync` 传参数组（非 shell），无命令注入
- 所有对外错误信息经 `stripCreds` 脱敏
- 所有接口复用 `getUser()` 鉴权（未登录 401）

## 测试（vitest，沿用 `tests/fixtures` 风格）

- `findRoots`：多包发现；插件内嵌 skill **不**被重复计数；单插件/单 skill 仓库正确识别
- `normalizeSource`：`owner/repo` 正确展开；完整 URL 原样；拒绝本地路径 / `file://`

## 明确不做（YAGNI）

- 分支 / tag / 私有 token（先只公开仓库、默认分支）
- 自动定时刷新（cron/轮询）
- 索引落盘缓存
- 监听仓库的删除级联到已导入本市场的包（导入是一次性复制，互不绑定）
