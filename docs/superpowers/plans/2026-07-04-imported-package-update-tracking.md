# 已导入包的更新追踪 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让已导入本市场的包能感知源仓库的新版本，显示"有更新"，用户点击"更新"才把本地那份同步到源版本。

**Architecture:** 复用现有 `buildIndex()` 聚合监听库索引，按**包名**匹配本地已导入包（`listPlugins(REPO_DIR)`）与远程包，比对声明的 `version` 字段判定更新。更新动作用 `ingest(overwrite, version=源版本)` 把本地版本直接盖成源版本，闭环。全程手动，无自动更新。

**Tech Stack:** Next.js 16 (App Router)、TypeScript、vitest、node:child_process(git)、gray-matter。

## Global Constraints

- 新建 `.ts` 文件顶部注释 `/** @author sgz @since 2026-07-04 */`。
- 版本号形如 `\d+\.\d+\.\d+`（`src/lib/semver.ts` 的 `isValidVersion`），用 `compareVersions` 比较。
- `ingest()` 覆盖导入要求新版本严格大于当前本地版本；本方案传 `version=源版本`，由 `updateStatus` 保证源版本 > 本地版本，不会被拒。
- 源包无 `version` 或非法 → 视为无更新，**绝不误报**。
- 引用型包 `version` 取自监听库 `marketplace.json` 的 entry；缺失则检测不到（已知局限）。
- 测试用 `npx vitest run <file>`；测试通过 `process.chdir` 到临时目录隔离 `data/`。
- 不修改现有 import 路由；更新逻辑写在新 `/api/updates` 路由内（与 import 路由风格一致，路由层不写单测，逻辑闭环在 `updateStatus` + `ingest` 层测）。

---

### Task 1: discoverPackages 输出 version

**Files:**
- Modify: `src/lib/ingest.ts:163`（`DiscoveredPackage` 接口）、`:170-215`（三处 push）
- Test: `tests/discover.test.ts`

**Interfaces:**
- Produces: `DiscoveredPackage.version?: string`（文件包读 plugin.json/SKILL.md 的 `version`；引用包读 marketplace.json entry 的 `version`；缺失为 `undefined`）。

- [ ] **Step 1: 写失败测试**

在 `tests/discover.test.ts` 末尾追加：

```ts
test('discoverPackages 读出 version（文件包与引用包）', () => {
  const dir = tmp()
  plugin(dir, 'alpha') // plugin.json version 1.0.0
  fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.claude-plugin', 'marketplace.json'),
    JSON.stringify({
      name: 'm',
      plugins: [{ name: 'ref', source: { url: 'https://github.com/a/b.git' }, description: 'r', version: '2.3.4' }]
    }))
  const pkgs = discoverPackages(dir)
  expect(pkgs.find(p => p.name === 'alpha')?.version).toBe('1.0.0')
  expect(pkgs.find(p => p.name === 'ref')?.version).toBe('2.3.4')
})

test('discoverPackages 缺 version 时为 undefined', () => {
  const dir = tmp()
  const sk = path.join(dir, 'my-skill')
  fs.mkdirSync(sk, { recursive: true })
  fs.writeFileSync(path.join(sk, 'SKILL.md'), '---\nname: my-skill\n---\nx') // 无 version
  expect(discoverPackages(dir)[0].version).toBeUndefined()
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/discover.test.ts`
Expected: FAIL —两条新测试断言 `version` 为 `undefined`（字段尚不存在）。

- [ ] **Step 3: 实现**

`src/lib/ingest.ts` 中 `DiscoveredPackage` 接口加字段：

```ts
export interface DiscoveredPackage { name: string; kind: 'plugin' | 'skill'; description: string; root: string | null; sourceUrl?: string; version?: string }
```

plugin 分支 push（当前 `:171-178`）改为：

```ts
    if (kind === 'plugin') {
      const pj = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin/plugin.json'), 'utf8'))
      packages.push({
        name: toKebab(pj.name || path.basename(root)),
        kind,
        description: pj.description || '',
        root,
        sourceUrl: undefined,
        version: typeof pj.version === 'string' ? pj.version : undefined
      })
    } else {
      const fm = matter(fs.readFileSync(path.join(root, 'SKILL.md'), 'utf8')).data
      packages.push({
        name: toKebab(fm.name || path.basename(root)),
        kind,
        description: fm.description || '',
        root,
        sourceUrl: undefined,
        version: typeof fm.version === 'string' ? fm.version : undefined
      })
    }
```

引用包分支 push（当前 `:202-208`）改为：

```ts
            packages.push({
              name: kebabName,
              kind: 'plugin',
              description: entry.description || '',
              root: null,
              sourceUrl: entry.source.url,
              version: typeof entry.version === 'string' ? entry.version : undefined
            })
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/discover.test.ts`
Expected: PASS（全部）。

- [ ] **Step 5: 提交**

```bash
git add src/lib/ingest.ts tests/discover.test.ts
git commit -m "feat: discoverPackages 输出包 version 字段"
```

---

### Task 2: buildIndex 透传 version + updateStatus()

**Files:**
- Modify: `src/lib/watched.ts:9-13`（`IndexedPackage`）、`:98-107`（buildIndex push）、顶部 import
- Test: `tests/watched.test.ts`

**Interfaces:**
- Consumes: `DiscoveredPackage.version`（Task 1）、`listPlugins(repoDir)` from `./marketplace`（返回 `PluginEntry[]`，含 `version?`）、`isValidVersion`/`compareVersions` from `./semver`。
- Produces:
  - `IndexedPackage.version?: string`
  - `interface UpdateItem { name: string; kind: 'plugin' | 'skill'; localVersion: string; remoteVersion: string; repoId: string; source: string; sourceUrl?: string }`
  - `updateStatus(): UpdateItem[]` —仅返回远程版本严格高于本地的项。

- [ ] **Step 1: 写失败测试**

在 `tests/watched.test.ts` 末尾追加（复用文件顶部已有的 `remoteRepo`、`work`、`execFileSync`、`fs`、`path`）：

```ts
test('updateStatus：远程版本更高才算有更新，更新后闭环', async () => {
  const { cloneInto, refreshWatched, updateStatus } = await import('@/lib/watched')
  const { ingest } = await import('@/lib/ingest')
  const remote = remoteRepo('alpha')            // 远程 alpha v1.0.0
  const id = 'alpha-repo'
  cloneInto(remote, path.join(work, 'data/watched', id))
  fs.writeFileSync(path.join(work, 'data/watched.json'),
    JSON.stringify({ repos: [{ id, source: remote, url: remote, addedAt: 'x' }] }))

  // 本地导入到 data/marketplace（v1.0.0）
  const repoDir = path.join(work, 'data/marketplace')
  const cacheRoot = path.join(work, 'data/watched', id, 'plugins', 'alpha')
  ingest(repoDir, cacheRoot)
  expect(updateStatus()).toHaveLength(0)        // 版本相同，无更新

  // 远程升到 1.1.0 并刷新缓存
  fs.writeFileSync(path.join(remote, 'plugins/alpha/.claude-plugin/plugin.json'),
    JSON.stringify({ name: 'alpha', description: 'alpha desc', version: '1.1.0' }))
  execFileSync('git', ['commit', '-qam', 'bump'], { cwd: remote })
  refreshWatched(id)

  const ups = updateStatus()
  expect(ups).toHaveLength(1)
  expect(ups[0]).toMatchObject({ name: 'alpha', localVersion: '1.0.0', remoteVersion: '1.1.0', repoId: id })

  // 模拟点击更新：以 remoteVersion 覆盖导入 → 闭环
  ingest(repoDir, cacheRoot, { overwrite: true, version: '1.1.0' })
  expect(updateStatus()).toHaveLength(0)
})

test('updateStatus：远程包无 version 不误报', async () => {
  const { cloneInto, updateStatus } = await import('@/lib/watched')
  const { ingest } = await import('@/lib/ingest')
  const remote = remoteRepo('alpha')
  const id = 'alpha-repo'
  cloneInto(remote, path.join(work, 'data/watched', id))
  fs.writeFileSync(path.join(work, 'data/watched.json'),
    JSON.stringify({ repos: [{ id, source: remote, url: remote, addedAt: 'x' }] }))
  ingest(path.join(work, 'data/marketplace'), path.join(work, 'data/watched', id, 'plugins', 'alpha'))
  // 抹掉缓存里 alpha 的 version
  fs.writeFileSync(path.join(work, 'data/watched', id, 'plugins/alpha/.claude-plugin/plugin.json'),
    JSON.stringify({ name: 'alpha', description: 'alpha desc' }))
  expect(updateStatus()).toHaveLength(0)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/watched.test.ts`
Expected: FAIL — `updateStatus is not a function` / import 报错。

- [ ] **Step 3: 实现**

`src/lib/watched.ts` 顶部 import 增加：

```ts
import { discoverPackages } from './ingest'
import { normalizeSource } from './remote'
import { listPlugins } from './marketplace'
import { isValidVersion, compareVersions } from './semver'
```

（前两行已存在，只需新增后两行。）

`IndexedPackage` 接口加 `version`：

```ts
export interface IndexedPackage {
  repoId: string; source: string; url: string; market: string | null
  name: string; kind: 'plugin' | 'skill'; description: string
  sourceUrl?: string  // 引用型包的外部 git URL（本地包为 undefined）
  version?: string    // 源包声明的版本，缺失为 undefined
}
```

`buildIndex` 的 push（当前 `:98-107`）增加 version 透传：

```ts
      out.push({
        repoId: r.id,
        source: r.source,
        url: r.url,
        market,
        name: pkg.name,
        kind: pkg.kind,
        description: pkg.description,
        sourceUrl: pkg.sourceUrl,
        version: pkg.version
      })
```

在文件末尾追加 `updateStatus`：

```ts
export interface UpdateItem {
  name: string
  kind: 'plugin' | 'skill'
  localVersion: string
  remoteVersion: string
  repoId: string
  source: string
  sourceUrl?: string
}

// 已导入包 vs 监听库聚合索引，按 name 比对 version，仅返回远程版本更高者
export function updateStatus(): UpdateItem[] {
  const repoDir = path.resolve(process.env.MARKETPLACE_DIR || 'data/marketplace')
  const local = listPlugins(repoDir)

  // 远程按 name 取 version 最高者（同名多库时）
  const remote = new Map<string, IndexedPackage>()
  for (const p of buildIndex()) {
    if (!p.version || !isValidVersion(p.version)) continue
    const cur = remote.get(p.name)
    if (!cur || compareVersions(p.version, cur.version!) > 0) remote.set(p.name, p)
  }

  const out: UpdateItem[] = []
  for (const lp of local) {
    if (!lp.version || !isValidVersion(lp.version)) continue
    const r = remote.get(lp.name)
    if (!r) continue
    if (compareVersions(r.version!, lp.version) > 0) {
      out.push({
        name: lp.name, kind: r.kind, localVersion: lp.version,
        remoteVersion: r.version!, repoId: r.repoId, source: r.source, sourceUrl: r.sourceUrl,
      })
    }
  }
  return out
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/watched.test.ts`
Expected: PASS（含既有用例）。

- [ ] **Step 5: 提交**

```bash
git add src/lib/watched.ts tests/watched.test.ts
git commit -m "feat: IndexedPackage 透传 version + updateStatus 检测已导入包更新"
```

---

### Task 3: /api/updates 路由（查状态 + 执行更新）

**Files:**
- Create: `src/app/api/updates/route.ts`

**Interfaces:**
- Consumes: `updateStatus()`/`packageRoot()`/`cloneInto()` from `@/lib/watched`；`ingest`/`discoverPackages`/`toKebab` from `@/lib/ingest`；`ensureRepo`/`commitAll`/`push`/`headOf`/`resetTo` from `@/lib/repo`；`REPO_DIR`/`stripCreds` from `@/lib/config`；`normalizeSource` from `@/lib/remote`；`getUser` from `@/lib/session`。
- Produces:
  - `GET /api/updates` → `{ updates: UpdateItem[] }`
  - `POST /api/updates { name }` → `IngestResult` 或 `{ error }`

- [ ] **Step 1: 创建路由文件**

创建 `src/app/api/updates/route.ts`：

```ts
/** @author sgz @since 2026-07-04 */
import { NextRequest, NextResponse } from 'next/server'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getUser } from '@/lib/session'
import { REPO_DIR, stripCreds } from '@/lib/config'
import { ensureRepo, commitAll, push, headOf, resetTo } from '@/lib/repo'
import { ingest, discoverPackages, toKebab } from '@/lib/ingest'
import { normalizeSource } from '@/lib/remote'
import { packageRoot, cloneInto, updateStatus } from '@/lib/watched'

export async function GET() {
  if (!(await getUser())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  return NextResponse.json({ updates: updateStatus() })
}

export async function POST(req: NextRequest) {
  if (!(await getUser())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { name } = await req.json().catch(() => ({}))
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })

  const item = updateStatus().find(u => u.name === String(name))
  if (!item) return NextResponse.json({ error: 'no update available' }, { status: 404 })

  ensureRepo()
  const before = headOf()

  // 引用型包：临时克隆源仓库
  if (item.sourceUrl) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-upd-'))
    try {
      cloneInto(normalizeSource(item.sourceUrl), tmp)
      const pkg = discoverPackages(tmp).find(p => toKebab(p.name) === toKebab(item.name))
      if (!pkg || !pkg.root) {
        return NextResponse.json({ error: `package "${item.name}" not found in remote` }, { status: 404 })
      }
      const res = ingest(REPO_DIR, pkg.root, { overwrite: true, version: item.remoteVersion })
      commitAll(`update ${res.name} to ${item.remoteVersion} (from remote ${item.sourceUrl})`)
      try {
        push()
      } catch (e) {
        if (before) resetTo(before)
        return NextResponse.json({ error: 'push failed', detail: stripCreds(String(e)) }, { status: 500 })
      }
      return NextResponse.json(res)
    } catch (e) {
      return NextResponse.json({ error: stripCreds(String(e)) }, { status: 400 })
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  }

  // 监听库文件包：从缓存 root 覆盖导入
  const root = packageRoot(item.repoId, item.name)
  if (!root) return NextResponse.json({ error: 'source package not found; refresh the repo' }, { status: 404 })
  try {
    const res = ingest(REPO_DIR, root, { overwrite: true, version: item.remoteVersion })
    commitAll(`update ${res.name} to ${item.remoteVersion} (from ${item.repoId})`)
    try {
      push()
    } catch (e) {
      if (before) resetTo(before)
      return NextResponse.json({ error: 'push failed', detail: stripCreds(String(e)) }, { status: 500 })
    }
    return NextResponse.json(res)
  } catch (e) {
    return NextResponse.json({ error: stripCreds(String(e)) }, { status: 400 })
  }
}
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无报错（路由引用的所有符号在 Task 1/2 已定义）。

- [ ] **Step 3: 提交**

```bash
git add src/app/api/updates/route.ts
git commit -m "feat: /api/updates 路由查更新状态并执行更新"
```

---

### Task 4: 管理控制台显示更新角标与更新按钮

**Files:**
- Modify: `src/app/_components/AdminConsole.tsx`

**Interfaces:**
- Consumes: `GET /api/updates`、`POST /api/updates`、`UpdateItem` type from `@/lib/watched`。

- [ ] **Step 1: AdminConsole 拉取更新状态**

`src/app/_components/AdminConsole.tsx` 顶部改 import：

```ts
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { PluginEntry } from '@/lib/marketplace'
import type { UpdateItem } from '@/lib/watched'
import UploadForm from './UploadForm'
import SettingsForm from './SettingsForm'
import { useToast } from '@/lib/useToast'
import Toast from './Toast'
```

`AdminConsole` 组件体内，在 `const { toasts, hideToast, error } = useToast()` 处改为解构出 `success`，并新增更新状态拉取：

```ts
  const { toasts, hideToast, error, success } = useToast()
  const [updates, setUpdates] = useState<Record<string, UpdateItem>>({})

  const loadUpdates = useCallback(async () => {
    const res = await fetch('/api/updates')
    if (!res.ok) return
    const data = await res.json()
    const map: Record<string, UpdateItem> = {}
    for (const u of data.updates as UpdateItem[]) map[u.name] = u
    setUpdates(map)
  }, [])

  useEffect(() => { loadUpdates() }, [loadUpdates])

  const onChanged = useCallback(() => { router.refresh(); loadUpdates() }, [router, loadUpdates])
```

列表渲染处把 `AdminRow` 调用（当前 `:77`）改为传入 update 与回调：

```tsx
            <AdminRow
              key={plugin.name}
              plugin={plugin}
              update={updates[plugin.name]}
              onChanged={onChanged}
              onError={error}
              onSuccess={success}
            />
```

- [ ] **Step 2: AdminRow 渲染角标与更新按钮**

把 `AdminRow` 函数签名与内部改为：

```tsx
function AdminRow({ plugin, update, onChanged, onError, onSuccess }: {
  plugin: PluginEntry; update?: UpdateItem;
  onChanged: () => void; onError: (msg: string) => void; onSuccess: (msg: string) => void
}) {
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [updating, setUpdating] = useState(false)

  const handleDelete = async () => {
    if (!confirming) {
      setConfirming(true)
      return
    }
    setDeleting(true)
    try {
      const res = await fetch(`/api/skills/${plugin.name}`, { method: 'DELETE' })
      if (!res.ok) {
        onError(`删除失败: ${await res.text()}`)
        return
      }
      onChanged()
    } catch (err) {
      onError(`删除失败: ${err}`)
    } finally {
      setDeleting(false)
      setConfirming(false)
    }
  }

  const handleUpdate = async () => {
    setUpdating(true)
    try {
      const res = await fetch('/api/updates', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: plugin.name }),
      })
      if (!res.ok) { onError(`更新失败: ${await res.text()}`); return }
      onSuccess(`已更新 ${plugin.name} 到 v${update?.remoteVersion}`)
      onChanged()
    } finally {
      setUpdating(false)
    }
  }

  return (
    <div className="flex items-center gap-4 p-5 hover:bg-zinc-900/60 transition-colors">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-3">
          <Link
            href={`/skills/${plugin.name}`}
            className="text-lg font-semibold text-zinc-100 hover:text-cyan-400 transition-colors truncate"
          >
            {plugin.name}
          </Link>
          {update && (
            <span
              title="仅按版本号检测"
              className="px-2 py-0.5 text-xs font-medium bg-amber-500/10 text-amber-400 rounded border border-amber-500/30 whitespace-nowrap"
            >
              有更新 v{update.localVersion}→v{update.remoteVersion}
            </span>
          )}
          {plugin.tags?.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="hidden sm:inline px-2 py-0.5 text-xs font-medium bg-zinc-800/50 text-zinc-400 rounded border border-zinc-700/50"
            >
              {tag}
            </span>
          ))}
        </div>
        <p className="text-sm text-zinc-500 truncate mt-1">{plugin.description || '暂无描述'}</p>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        {update && (
          <button
            onClick={handleUpdate}
            disabled={updating}
            className="px-3 py-1.5 text-sm rounded-lg font-medium bg-amber-500/10 text-amber-400 border border-amber-500/30 hover:bg-amber-500/20 disabled:opacity-50 transition-colors"
          >
            {updating ? '更新中...' : '更新'}
          </button>
        )}
        <Link
          href={`/skills/${plugin.name}`}
          className="px-3 py-1.5 text-sm rounded-lg bg-zinc-800/50 text-zinc-300 border border-zinc-700 hover:bg-zinc-700/50 transition-colors"
        >
          查看
        </Link>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-all duration-300 disabled:opacity-50 ${
            confirming
              ? 'bg-red-500 text-white hover:bg-red-600'
              : 'bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20'
          }`}
        >
          {deleting ? '删除中...' : confirming ? '确认删除' : '删除'}
        </button>
        {confirming && !deleting && (
          <button
            onClick={() => setConfirming(false)}
            className="px-3 py-1.5 text-sm rounded-lg bg-zinc-800/50 text-zinc-400 border border-zinc-700 hover:bg-zinc-700/50 transition-colors"
          >
            取消
          </button>
        )}
      </div>
    </div>
  )
}
```

同时删除组件体内原来的 `const router = useRouter()` 后单独的 `onChanged` 缺失问题——确认 `router` 仍在 `AdminConsole` 顶部声明（`const router = useRouter()` 保留），删除掉列表里旧的 `onChanged={() => router.refresh()}` 写法（已被 Step 1 的 `onChanged` 替换）。

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无报错。

- [ ] **Step 4: 构建验证**

Run: `npx vitest run`
Expected: 全部测试 PASS（回归确认 Task 1/2 未破坏其它用例）。

手动验证（可选，需已配置 `.env` 与监听库）：`npm run dev` → 登录 → 添加一个监听库并导入某包 → 在源仓库 bump version 后到 `/admin/remote` 刷新 → 回 `/admin` 应见"有更新"角标，点"更新"后角标消失。

- [ ] **Step 5: 提交**

```bash
git add src/app/_components/AdminConsole.tsx
git commit -m "feat: 管理控制台显示已导入包更新角标与更新按钮"
```

---

## Self-Review

**Spec coverage:**
- 更新信号=版本字段 → Task 1（discoverPackages version）+ Task 2（updateStatus 比对）✅
- 不新增台账、按包名匹配 → Task 2 `updateStatus` 用 name 匹配 `buildIndex` vs `listPlugins` ✅
- 更新时本地版本盖成源版本（闭环，避开 bumpPatch 陷阱）→ Task 3 `ingest(version=remoteVersion)` + Task 2 闭环测试 ✅
- 刷新只拉信息、手动更新 → 复用现有 `refreshWatched`，更新仅 POST 触发 ✅
- 源无 version 不误报 → Task 2 `isValidVersion` 守卫 + 测试 ✅
- 引用型包走 sourceUrl 临时克隆 → Task 3 sourceUrl 分支 ✅
- push 失败回滚 → Task 3 `resetTo(before)` ✅
- 同名多库取最高 → Task 2 remote map 取 `compareVersions > 0` ✅
- 源已消失提示刷新 → Task 3 `packageRoot` 返回 null → 404 ✅
- UI 角标 + 更新按钮在管理控制台，注明"仅按版本号检测" → Task 4 `title` ✅

**Placeholder scan:** 无 TBD/TODO；每个代码步骤含完整代码。

**Type consistency:** `UpdateItem`/`updateStatus`/`IndexedPackage.version`/`DiscoveredPackage.version` 命名在 Task 1→4 一致；`ingest(opts.version)`、`compareVersions`、`isValidVersion`、`listPlugins(repoDir)` 均为现有签名。
