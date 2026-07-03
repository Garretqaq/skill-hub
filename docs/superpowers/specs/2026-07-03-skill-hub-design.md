# Skill Hub（自用版）设计文档

日期：2026-07-03

## 1. 目标与本质

一个自用的网页应用，用来**管理一个 git 仓库形态的 Claude Code 插件市场（marketplace）**，并公开浏览其中的技能。

- 登录用户：上传、删除技能/插件。
- 匿名访客：浏览列表、看详情、拿安装命令。

git 仓库是**唯一事实来源**（single source of truth）。Hub 只做三件事：把上传规整进仓库、提交并 push、渲染浏览。不引入数据库，避免"数据库 vs 文件"双来源不同步。

分发方式沿用 Claude Code 官方机制：
```
claude plugin marketplace add <仓库 git 地址>
claude plugin install <name>@<市场名>
```
`marketplace add <git-url>` 会 clone 整个仓库，因此插件用 `./plugins/<name>` 相对路径引用即可，全部内容自包含在一个仓库里。

## 2. 技术栈

- Next.js（App Router）+ TypeScript + Tailwind CSS
- UI 用 frontend-design 技能打磨，追求精致、非通用 AI 风格
- 依赖尽量少：
  - `adm-zip` — 解压上传的 zip
  - `gray-matter` — 解析 SKILL.md 的 YAML frontmatter
  - `react-markdown` + `remark-gfm` — 渲染 SKILL.md 正文
- **git 操作直接 shell 调用系统 `git`（child_process），不引 git 库**
- **不引 SQLite，不引 auth 库**（鉴权用 Node `crypto` 手做）

## 3. 数据形态

本地工作副本：`./data/marketplace/`（首次运行时从 `MARKETPLACE_REPO_URL` clone；若为空仓库则初始化骨架）。

```
data/marketplace/
  .claude-plugin/
    marketplace.json          # 市场清单
  plugins/
    <name>/
      .claude-plugin/
        plugin.json           # 插件清单
      skills/
        <skill>/
          SKILL.md
          ...资源文件
```

### marketplace.json（清单，官方 schema）

```json
{
  "name": "<MARKETPLACE_NAME>",
  "owner": { "name": "<ADMIN_USER>" },
  "plugins": [
    {
      "name": "cc-test-toolkit",
      "source": "./plugins/cc-test-toolkit",
      "description": "……",
      "tags": ["test", "spring-boot"]
    }
  ]
}
```

- 列表页、搜索、tag 筛选**只读 marketplace.json 的 `plugins[]`**。
- `source` 用相对路径 `./plugins/<name>`（marketplace 经 git URL 添加时可正确解析）。
- `tags` 用于搜索/筛选；上传时从 frontmatter/plugin.json 提取，缺省为空数组。

### plugin.json（插件清单，官方 schema）

裸 skill 上传时由 Hub 自动生成：
```json
{ "name": "<name>", "description": "<来自 SKILL.md frontmatter>", "version": "1.0.0" }
```

## 4. 上传流程（两种，自动识别）

`POST /api/skills`（需登录），接收 zip：

1. 解压到临时目录。
2. **识别类型**：
   - 含 `.claude-plugin/plugin.json` → **完整 plugin 包**，原样落进 `plugins/<name>/`。
   - 只有 `SKILL.md`（或 `skills/<x>/SKILL.md`）→ **裸 skill 包**，Hub 生成 `plugin.json` 外壳，把技能放进 `plugins/<name>/skills/<skill>/`。
3. `name` 取自 plugin.json；裸 skill 取自 SKILL.md frontmatter 的 `name`，无则用 zip 文件名。规范为 kebab-case。
4. 冲突处理：若 `plugins/<name>/` 已存在，返回 409，提示改名或先删除。
5. 更新 `marketplace.json` 的 `plugins[]`（追加/更新对应条目：name、source、description、tags）。
6. `git add -A && git commit -m "add <name>" && git push`。
7. 失败回滚：push 失败则 `git reset --hard` 回退本地提交，返回错误。

### 校验
- 自实现最小校验：marketplace.json 是合法 JSON、plugin `name` kebab-case、无重复 name、source 无 `..`。
- 若环境中存在 `claude` CLI，额外跑 `claude plugin validate ./data/marketplace` 并把结果附在响应里；不存在则跳过，不阻塞。

## 5. 页面与接口

| 路径 | 访问 | 说明 |
|---|---|---|
| `/` | 公开 | 卡片网格 + 顶部搜索框 + tag 筛选；数据来自 marketplace.json，客户端过滤 |
| `/skills/[name]` | 公开 | 渲染该插件主 SKILL.md + 文件树；显示可复制的两行安装命令；登录后显示删除按钮 |
| `/login` | 公开 | 用户名+密码登录表单 |
| `POST /api/skills` | 登录 | 上传 zip |
| `DELETE /api/skills/[name]` | 登录 | 删除插件目录 + 清单条目 → commit → push |
| `POST /api/login` | 公开 | 校验凭证，签发 cookie |
| `POST /api/logout` | 公开 | 清除 cookie |

安装命令展示（详情页）：
```
claude plugin marketplace add <MARKETPLACE_REPO_URL 的公开形式>
claude plugin install <name>@<MARKETPLACE_NAME>
```

列表/详情为 Server Component，直接读本地 `./data/marketplace/` 文件系统。

## 6. 鉴权

单管理员，凭证来自环境变量，无用户表。

- `ADMIN_USER` + `ADMIN_PASSWORD`：登录需同时匹配。
- 密码用 `crypto.timingSafeEqual` 做常量时间比较，防时序攻击。用户名同样比较。
- **防爆破**：内存 Map 记录每个 IP 的失败次数与时间；同一 IP 连续失败 5 次，锁定 5 分钟。
- 登录成功：用 `crypto` HMAC 对 `{user, exp}` 签名，写入 httpOnly cookie（如 7 天有效）。
- 读接口/页面公开；写接口（上传、删除）校验 cookie，未通过返回 401。
- 前端未登录时隐藏上传/删除入口（后端仍强校验，前端只是体验）。

> ponytail: 内存限流足够单机自用；多实例部署再换共享存储。

## 7. 配置（环境变量）

| 变量 | 说明 |
|---|---|
| `ADMIN_USER` | 管理员用户名 |
| `ADMIN_PASSWORD` | 管理员密码 |
| `AUTH_SECRET` | HMAC 签名密钥 |
| `MARKETPLACE_REPO_URL` | 市场 git 仓库地址（含 push 令牌），首次 clone / push 用 |
| `MARKETPLACE_NAME` | 市场名（marketplace.json 的 `name`，即 `install x@<name>` 里的名字） |

## 8. 明确不做（YAGNI）

- 无数据库、无 ORM。
- 无用户注册/多用户/角色。
- 无版本管理、发布渠道、重命名迁移等高级 marketplace 特性。
- 不做在线编辑 SKILL.md 内容。
- 下载 zip 非核心；主分发路径是 CLI 安装命令（如需再加按需打包）。

## 9. 错误处理要点

- 上传：非法 zip / 无 SKILL.md 且无 plugin.json / name 冲突 / push 失败 —— 均返回明确错误码与信息，本地保持一致（失败回滚）。
- git 未配置远程或凭证无效：启动或首次操作时给出可读错误。
- 详情页对应目录缺失：404。

## 10. 验证标准（success criteria）

1. 起服务，用 `ADMIN_USER/ADMIN_PASSWORD` 登录成功；错误凭证 5 次后被锁。
2. 上传一个裸 skill zip → 列表出现该卡片 → 详情渲染 SKILL.md → `data/marketplace` 产生对应 commit。
3. 上传一个完整 plugin zip（如 cc-test-toolkit 结构）→ 原样入库并出现在列表。
4. 在另一台/目录跑 `claude plugin marketplace add <repo>` + `claude plugin install <name>@<market>` 能装上该插件。
5. 删除某插件 → 列表消失，marketplace.json 条目移除，产生删除 commit。
6. 匿名访客能浏览列表/详情、复制安装命令，但看不到也调不动上传/删除。
