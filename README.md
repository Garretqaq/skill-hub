<div align="center">

# Skill Hub

**自托管的 Claude Code 技能市场：一个 git 仓库，公开浏览、一键安装。**

<img src="assets/banner.webp" alt="Skill Hub — 自托管的 Claude Code 技能市场" width="100%">

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-black.svg)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6.svg)](https://www.typescriptlang.org)

</div>

---

## 这是什么

Skill Hub 是一个自用的网页应用，用来管理**一个 git 仓库形态的 Claude Code 插件市场**，并公开浏览其中的技能。

登录用户可以上传、删除技能；匿名访客可以浏览列表、看详情、复制安装命令。git 仓库是唯一事实来源——Hub 只做三件事：把上传规整进仓库、提交并 push、渲染浏览。**不引数据库**，避免"数据库 vs 文件"双来源不同步。

分发完全沿用 Claude Code 官方机制：

```bash
/plugin marketplace add <仓库 git 地址>
/plugin install <name>@<市场名>
```

## 为什么需要它

Claude Code 的插件靠 git 仓库分发，但仓库本身不适合浏览：看不到技能列表、读不到 `SKILL.md`、拿不到现成的安装命令，上传新技能还得手动拼目录结构、写 `marketplace.json`、再 commit push。

Skill Hub 把这段体验补齐：一个页面浏览所有技能、点进去读文档、复制即用的安装命令；上传一个 zip 就自动规整进仓库并 push。国内访问 GitHub 慢时，还内置了代理加速地址。

## 你会得到什么

- **公开浏览** — 技能网格 + 详情页，直接渲染 `SKILL.md`，无需 clone 仓库。
- **一键安装** — 每个技能给出 `marketplace add` 与 `install` 命令，附 GitHub 代理加速地址，点击即复制。
- **上传即入库** — 上传 skill 的 zip，自动解析 frontmatter、规整目录、写清单、commit & push，无需手动改仓库。
- **远程仓库监听** — 关注上游 skill 仓库，检测版本更新并可一键导入。
- **零数据库** — git 仓库是唯一事实来源；鉴权用 Node `crypto` 手做，不引 auth 库。

## 工作方式

首次启动时从 `MARKETPLACE_REPO_URL` clone 一份工作副本到 `./data/marketplace/`（空仓库则初始化骨架）。上传的技能解压后按官方 schema 写入 `plugins/<name>/skills/<skill>/`，更新 `marketplace.json`，然后 commit 并 push 回远程。浏览页从这份本地副本实时读取，因此列表始终等于仓库真实内容。

## 快速开始

### 本地运行

```bash
cp .env.example .env      # 填好 ADMIN_PASSWORD、AUTH_SECRET、MARKETPLACE_REPO_URL
npm install
npm run dev               # http://localhost:3000
```

### Docker

```bash
docker build -t skill-hub .
docker run -p 3000:3000 --env-file .env -v $(pwd)/data:/data skill-hub
```

### Docker Compose（推荐）

新建 `docker-compose.yml`，环境变量直接写在 `environment:` 里：

```yaml
services:
  skill-hub:
    image: registry.cn-hangzhou.aliyuncs.com/dato/skill-hub:latest
    # 想用本地源码构建而非拉镜像，注释掉上面的 image，改用：
    # build: .
    container_name: skill-hub
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      ADMIN_USER: admin
      ADMIN_PASSWORD: change-me
      AUTH_SECRET: long-random-string
    volumes:
      # 运行时数据（marketplace 克隆、被监听仓库、访问 token），务必持久化
      - ./data:/data
```

一条命令部署：

```bash
docker compose up -d      # http://localhost:3000
```

常用运维：

```bash
docker compose logs -f    # 查看日志
docker compose pull && docker compose up -d   # 更新到最新镜像
docker compose down       # 停止并移除容器（./data 保留）
```

> `data/` 目录持有克隆的市场仓库和访问 token，务必挂载持久化卷，且**不要提交到版本控制**（已在 `.gitignore` 中）。

## 配置

| 环境变量 | 说明 |
|----------|------|
| `ADMIN_USER` | 管理员用户名 |
| `ADMIN_PASSWORD` | 管理员密码 |
| `AUTH_SECRET` | 会话签名密钥，填一段长随机串 |
| `MARKETPLACE_REPO_URL` | 市场 git 仓库地址（含 token 的写权限地址） |
| `MARKETPLACE_NAME` | 市场名称，用于安装命令 `install <name>@<市场名>` |

## 技术栈

Next.js 16（App Router）· React 19 · TypeScript · Tailwind CSS 4。依赖刻意保持精简：`adm-zip` 解压上传、`gray-matter` 解析 frontmatter、`react-markdown` + `remark-gfm` 渲染文档；git 操作直接 `child_process` 调用系统 `git`。

## 测试

```bash
npm test        # vitest run
```

## 许可证

[MIT](./LICENSE)

## 关于作者

由 [@Garretqaq](https://github.com/Garretqaq) 开发。
