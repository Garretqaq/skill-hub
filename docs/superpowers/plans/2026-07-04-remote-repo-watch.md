# 远程仓库监听与聚合搜索 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让管理员登记远程 git 仓库、手动刷新、跨库搜索其中的 plugin/skill，并把命中的包一键导入本 hub 市场或查看其外部安装命令。

**Architecture:** 复用已解耦的 `ingest(repoDir, extractedDir)` —— 新增「发现多包」的纯函数与「监听仓库缓存」的 store，把每个监听仓库浅克隆到 `data/watched/<id>/`，搜索时现扫缓存构建聚合索引，导入时把缓存里的包根目录直接交给现有 `ingest`。UI 为独立路由 `/admin/remote`。

**Tech Stack:** Next.js 16 (app router)、TypeScript、node:child_process(git)、gray-matter、vitest。

## Global Constraints

- 新建 `.ts` 文件首行加 `/** @author sgz @since 2026-07-04 */`；注释用中文，贴合现有风格。
- 不新增第三方依赖。
- 所有 git 调用走 `execFileSync('git', [...])` 传参数组，禁止 shell 拼接。
- 所有对外返回的错误信息经 `stripCreds()`（`@/lib/config`）脱敏。
- 所有 API route 首行校验 `getUser()`（`@/lib/session`），未登录返回 401。
- 固定路径产物：`data/watched.json`（监听清单）、`data/watched/<id>/`（缓存克隆）。`/data` 已整体 gitignore，无需改 `.gitignore`。
- 测试隔离：涉及固定 `data/*` 路径的测试用 `process.chdir(tmp)`（同 `tests/settings.test.ts`）；涉及 git 的测试用本地仓库当「远程」（同 `tests/repo.test.ts`）。

---

### Task 1: 多包发现（findRoots / discoverPackages）

**Files:**
- Modify: `src/lib/ingest.ts`（在文件末尾追加，`findRoot`/`ingest` 保持不变）
- Test: `tests/discover.test.ts`

**Interfaces:**
- Consumes: `toKebab`（已在 `ingest.ts`）、`matter`（已 import）、`fs`/`path`（已 import）
- Produces:
  - `interface FoundRoot { root: string; kind: 'plugin' | 'skill' }`
  - `findRoots(dir: string): FoundRoot[]`
  - `interface DiscoveredPackage { name: string; kind: 'plugin' | 'skill'; description: string; root: string }`
  - `discoverPackages(dir: string): DiscoveredPackage[]`

- [ ] **Step 1: 写失败测试**

`tests/discover.test.ts`：

```ts
/** @author sgz @since 2026-07-04 */
import { expect, test } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { findRoots, discoverPackages } from '@/lib/ingest'

function tmp(): string { return fs.mkdtempSync(path.join(os.tmpdir(), 'shdisc-')) }

function plugin(dir: string, name: string, withSkill = true) {
  const root = path.join(dir, 'plugins', name)
  fs.mkdirSync(path.join(root, '.claude-plugin'), { recursive: true })
  fs.writeFileSync(path.join(root, '.claude-plugin/plugin.json'),
    JSON.stringify({ name, description: `${name} desc`, version: '1.0.0' }))
  if (withSkill) {
    fs.mkdirSync(path.join(root, 'skills', name), { recursive: true })
    fs.writeFileSync(path.join(root, 'skills', name, 'SKILL.md'), `---\nname: ${name}\n---\nx`)
  }
}

test('findRoots 发现多个插件，且插件内嵌 skill 不被重复计数', () => {
  const dir = tmp()
  plugin(dir, 'alpha')
  plugin(dir, 'beta')
  const roots = findRoots(dir)
  expect(roots).toHaveLength(2)
  expect(roots.every(r => r.kind === 'plugin')).toBe(true)
})

test('findRoots 识别裸 skill 仓库', () => {
  const dir = tmp()
  const sk = path.join(dir, 'my-skill')
  fs.mkdirSync(sk, { recursive: true })
  fs.writeFileSync(path.join(sk, 'SKILL.md'), '---\nname: my-skill\n---\nx')
  const roots = findRoots(dir)
  expect(roots).toEqual([{ root: sk, kind: 'skill' }])
})

test('discoverPackages 读出 name/description', () => {
  const dir = tmp()
  plugin(dir, 'alpha')
  const pkgs = discoverPackages(dir)
  expect(pkgs).toHaveLength(1)
  expect(pkgs[0]).toMatchObject({ name: 'alpha', kind: 'plugin', description: 'alpha desc' })
  expect(fs.existsSync(path.join(pkgs[0].root, '.claude-plugin/plugin.json'))).toBe(true)
})
```

- [ ] **Step 2: 运行确认失败**

Run: `JAVA_HOME= npx vitest run tests/discover.test.ts`
Expected: FAIL —— `findRoots`/`discoverPackages` 未导出（`SyntaxError` 或 `not a function`）

- [ ] **Step 3: 在 `src/lib/ingest.ts` 末尾追加实现**

```ts
export interface FoundRoot { root: string; kind: 'plugin' | 'skill' }

/** findRoot 的「收集全部」版：命中包根即不再下钻，避免插件内嵌 skills 被重复计数 */
export function findRoots(dir: string): FoundRoot[] {
  const out: FoundRoot[] = []
  const stack = [dir]
  while (stack.length) {
    const cur = stack.shift()!
    if (fs.existsSync(path.join(cur, '.claude-plugin', 'plugin.json'))) {
      out.push({ root: cur, kind: 'plugin' })
      continue
    }
    if (fs.existsSync(path.join(cur, 'SKILL.md'))) {
      out.push({ root: cur, kind: 'skill' })
      continue
    }
    for (const name of fs.readdirSync(cur)) {
      if (name === '.git') continue
      const full = path.join(cur, name)
      if (fs.statSync(full).isDirectory()) stack.push(full)
    }
  }
  return out
}

export interface DiscoveredPackage { name: string; kind: 'plugin' | 'skill'; description: string; root: string }

export function discoverPackages(dir: string): DiscoveredPackage[] {
  return findRoots(dir).map(({ root, kind }) => {
    if (kind === 'plugin') {
      const pj = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin/plugin.json'), 'utf8'))
      return { name: toKebab(pj.name || path.basename(root)), kind, description: pj.description || '', root }
    }
    const fm = matter(fs.readFileSync(path.join(root, 'SKILL.md'), 'utf8')).data
    return { name: toKebab(fm.name || path.basename(root)), kind, description: fm.description || '', root }
  })
}
```

- [ ] **Step 4: 运行确认通过**

Run: `JAVA_HOME= npx vitest run tests/discover.test.ts`
Expected: PASS（3 passed）

- [ ] **Step 5: 提交**

```bash
git add src/lib/ingest.ts tests/discover.test.ts
git commit -m "feat: ingest 支持多包发现 findRoots/discoverPackages"
```

---

### Task 2: 来源规范化（normalizeSource）

**Files:**
- Create: `src/lib/remote.ts`
- Test: `tests/remote.test.ts`

**Interfaces:**
- Produces: `normalizeSource(input: string): string` —— 返回可 clone 的 URL；非法来源抛 `Error`

- [ ] **Step 1: 写失败测试**

`tests/remote.test.ts`：

```ts
/** @author sgz @since 2026-07-04 */
import { expect, test } from 'vitest'
import { normalizeSource } from '@/lib/remote'

test('owner/repo 展开为 github URL', () => {
  expect(normalizeSource('obra/superpowers-marketplace'))
    .toBe('https://github.com/obra/superpowers-marketplace.git')
})

test('owner/repo.git 去重后缀', () => {
  expect(normalizeSource('a/b.git')).toBe('https://github.com/a/b.git')
})

test('完整 https URL 原样返回', () => {
  expect(normalizeSource('https://gitlab.com/x/y.git')).toBe('https://gitlab.com/x/y.git')
})

test('git@ ssh URL 原样返回', () => {
  expect(normalizeSource('git@github.com:x/y.git')).toBe('git@github.com:x/y.git')
})

test('拒绝本地路径', () => {
  expect(() => normalizeSource('/etc/passwd')).toThrow(/invalid source/)
  expect(() => normalizeSource('./secret')).toThrow(/invalid source/)
  expect(() => normalizeSource('~/x')).toThrow(/invalid source/)
})

test('拒绝 file://', () => {
  expect(() => normalizeSource('file:///etc')).toThrow(/invalid source/)
})

test('拒绝空来源', () => {
  expect(() => normalizeSource('  ')).toThrow(/empty source/)
})
```

- [ ] **Step 2: 运行确认失败**

Run: `JAVA_HOME= npx vitest run tests/remote.test.ts`
Expected: FAIL —— 模块 `@/lib/remote` 不存在

- [ ] **Step 3: 写实现**

`src/lib/remote.ts`：

```ts
/** @author sgz @since 2026-07-04 */
const SHORTHAND = /^[\w.-]+\/[\w.-]+$/ // owner/repo，恰好一个斜杠

// 把用户填的来源规范化为可 clone 的 URL；拒绝本地路径/file:// 防止 clone 本地任意目录
export function normalizeSource(input: string): string {
  const s = input.trim()
  if (!s) throw new Error('empty source')
  if (s.startsWith('file:') || s.startsWith('/') || s.startsWith('.') || s.startsWith('~')) {
    throw new Error(`invalid source: ${s}`)
  }
  if (SHORTHAND.test(s)) return `https://github.com/${s.replace(/\.git$/, '')}.git`
  if (/^https?:\/\//.test(s) || /^git@/.test(s) || /^ssh:\/\//.test(s)) return s
  throw new Error(`invalid source: ${s}`)
}
```

- [ ] **Step 4: 运行确认通过**

Run: `JAVA_HOME= npx vitest run tests/remote.test.ts`
Expected: PASS（7 passed）

- [ ] **Step 5: 提交**

```bash
git add src/lib/remote.ts tests/remote.test.ts
git commit -m "feat: 新增来源规范化 normalizeSource"
```

---

### Task 3: 监听仓库 store（CRUD + 缓存克隆 + 刷新 + 索引）

**Files:**
- Create: `src/lib/watched.ts`
- Test: `tests/watched.test.ts`

**Interfaces:**
- Consumes: `normalizeSource`（Task 2）、`discoverPackages`（Task 1）
- Produces:
  - `interface WatchedRepo { id: string; source: string; url: string; addedAt: string }`
  - `interface IndexedPackage { repoId: string; source: string; url: string; market: string | null; name: string; kind: 'plugin' | 'skill'; description: string }`
  - `toId(source: string): string`
  - `listWatched(): WatchedRepo[]`
  - `cloneInto(url: string, dir: string): void`
  - `addWatched(source: string): WatchedRepo`
  - `removeWatched(id: string): void`
  - `refreshWatched(id: string): void`
  - `refreshAll(): void`
  - `buildIndex(): IndexedPackage[]`
  - `search(q: string): IndexedPackage[]`
  - `packageRoot(id: string, name: string): string | null`

- [ ] **Step 1: 写失败测试**

`tests/watched.test.ts`：

```ts
/** @author sgz @since 2026-07-04 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'

let cwd: string
let work: string

beforeEach(() => {
  cwd = process.cwd()
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'shwatch-'))
  process.chdir(work) // 隔离固定路径 data/watched.json 与 data/watched/
})
afterEach(() => {
  process.chdir(cwd)
  fs.rmSync(work, { recursive: true, force: true })
})

// 造一个本地 git 仓库当「远程」，内含一个插件
function remoteRepo(pluginName: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shremote-'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 't'], { cwd: dir })
  const root = path.join(dir, 'plugins', pluginName)
  fs.mkdirSync(path.join(root, '.claude-plugin'), { recursive: true })
  fs.writeFileSync(path.join(root, '.claude-plugin/plugin.json'),
    JSON.stringify({ name: pluginName, description: `${pluginName} desc`, version: '1.0.0' }))
  fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.claude-plugin/marketplace.json'),
    JSON.stringify({ name: 'ext-market', owner: { name: 'x' }, plugins: [] }))
  execFileSync('git', ['add', '-A'], { cwd: dir })
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir })
  return dir
}

test('cloneInto 浅克隆到目标目录', async () => {
  const { cloneInto } = await import('@/lib/watched')
  const remote = remoteRepo('alpha')
  const dest = path.join(work, 'data/watched/alpha')
  cloneInto(remote, dest)
  expect(fs.existsSync(path.join(dest, 'plugins/alpha/.claude-plugin/plugin.json'))).toBe(true)
})

test('listWatched/removeWatched 走 data/watched.json；buildIndex+search 聚合并过滤', async () => {
  const { cloneInto, listWatched, removeWatched, buildIndex, search } = await import('@/lib/watched')
  const remote = remoteRepo('alpha')
  // 手工写入一条监听（addWatched 会拒绝本地路径，这里直接构造缓存与清单来测索引）
  const id = 'alpha-repo'
  cloneInto(remote, path.join(work, 'data/watched', id))
  fs.writeFileSync(path.join(work, 'data/watched.json'),
    JSON.stringify({ repos: [{ id, source: remote, url: remote, addedAt: '2026-07-04T00:00:00.000Z' }] }))

  expect(listWatched()).toHaveLength(1)
  const idx = buildIndex()
  expect(idx).toHaveLength(1)
  expect(idx[0]).toMatchObject({ repoId: id, name: 'alpha', kind: 'plugin', market: 'ext-market' })
  expect(search('alph')).toHaveLength(1)
  expect(search('zzz')).toHaveLength(0)

  removeWatched(id)
  expect(listWatched()).toHaveLength(0)
  expect(fs.existsSync(path.join(work, 'data/watched', id))).toBe(false)
})

test('refreshWatched 拉取远程新提交', async () => {
  const { cloneInto, refreshWatched, buildIndex } = await import('@/lib/watched')
  const remote = remoteRepo('alpha')
  const id = 'alpha-repo'
  cloneInto(remote, path.join(work, 'data/watched', id))
  fs.writeFileSync(path.join(work, 'data/watched.json'),
    JSON.stringify({ repos: [{ id, source: remote, url: remote, addedAt: 'x' }] }))

  // 远程新增一个插件并提交
  const root = path.join(remote, 'plugins', 'beta')
  fs.mkdirSync(path.join(root, '.claude-plugin'), { recursive: true })
  fs.writeFileSync(path.join(root, '.claude-plugin/plugin.json'),
    JSON.stringify({ name: 'beta', description: 'beta desc', version: '1.0.0' }))
  execFileSync('git', ['add', '-A'], { cwd: remote })
  execFileSync('git', ['commit', '-q', '-m', 'add beta'], { cwd: remote })

  refreshWatched(id)
  expect(buildIndex().map(p => p.name).sort()).toEqual(['alpha', 'beta'])
})

test('packageRoot 定位指定包根', async () => {
  const { cloneInto, packageRoot } = await import('@/lib/watched')
  const remote = remoteRepo('alpha')
  const id = 'alpha-repo'
  cloneInto(remote, path.join(work, 'data/watched', id))
  fs.writeFileSync(path.join(work, 'data/watched.json'),
    JSON.stringify({ repos: [{ id, source: remote, url: remote, addedAt: 'x' }] }))
  const root = packageRoot(id, 'alpha')
  expect(root && fs.existsSync(path.join(root, '.claude-plugin/plugin.json'))).toBe(true)
  expect(packageRoot(id, 'nope')).toBeNull()
})
```

- [ ] **Step 2: 运行确认失败**

Run: `JAVA_HOME= npx vitest run tests/watched.test.ts`
Expected: FAIL —— 模块 `@/lib/watched` 不存在

- [ ] **Step 3: 写实现**

`src/lib/watched.ts`：

```ts
/** @author sgz @since 2026-07-04 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { discoverPackages } from './ingest'
import { normalizeSource } from './remote'

export interface WatchedRepo { id: string; source: string; url: string; addedAt: string }
export interface IndexedPackage {
  repoId: string; source: string; url: string; market: string | null
  name: string; kind: 'plugin' | 'skill'; description: string
}

const storeFile = () => path.resolve('data/watched.json')
const cacheRoot = () => path.resolve('data/watched')
const cacheDir = (id: string) => path.join(cacheRoot(), id)

export function toId(source: string): string {
  return source.trim().replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '')
}

function readAll(): WatchedRepo[] {
  try { return JSON.parse(fs.readFileSync(storeFile(), 'utf8')).repos ?? [] } catch { return [] }
}
function writeAll(repos: WatchedRepo[]): void {
  fs.mkdirSync(path.dirname(storeFile()), { recursive: true })
  fs.writeFileSync(storeFile(), JSON.stringify({ repos }, null, 2) + '\n')
}
export function listWatched(): WatchedRepo[] { return readAll() }

// 浅克隆到目标目录（已存在先删）；url 由调用方保证已规范化
export function cloneInto(url: string, dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(path.dirname(dir), { recursive: true })
  execFileSync('git', ['clone', '--depth', '1', url, dir], { stdio: ['ignore', 'pipe', 'pipe'] })
}

export function addWatched(source: string): WatchedRepo {
  const url = normalizeSource(source)
  const id = toId(source)
  if (readAll().some(r => r.id === id)) throw new Error(`already watching: ${source}`)
  cloneInto(url, cacheDir(id))
  const repo: WatchedRepo = { id, source, url, addedAt: new Date().toISOString() }
  writeAll([...readAll(), repo])
  return repo
}

export function removeWatched(id: string): void {
  writeAll(readAll().filter(r => r.id !== id))
  fs.rmSync(cacheDir(id), { recursive: true, force: true })
}

// 手动刷新：fetch + reset 到远程 HEAD；缓存损坏/缺失时兜底重克隆
export function refreshWatched(id: string): void {
  const repo = readAll().find(r => r.id === id)
  if (!repo) throw new Error(`not watching: ${id}`)
  const dir = cacheDir(id)
  try {
    execFileSync('git', ['fetch', '--depth', '1', 'origin'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] })
    execFileSync('git', ['reset', '--hard', 'FETCH_HEAD'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] })
  } catch {
    cloneInto(repo.url, dir)
  }
}
export function refreshAll(): void { for (const r of readAll()) refreshWatched(r.id) }

function marketNameOf(id: string): string | null {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(cacheDir(id), '.claude-plugin/marketplace.json'), 'utf8'))
    return m.name || null
  } catch { return null }
}

// 聚合索引：现扫每个监听库的缓存克隆
export function buildIndex(): IndexedPackage[] {
  const out: IndexedPackage[] = []
  for (const r of readAll()) {
    const dir = cacheDir(r.id)
    if (!fs.existsSync(dir)) continue
    const market = marketNameOf(r.id)
    for (const pkg of discoverPackages(dir)) {
      out.push({ repoId: r.id, source: r.source, url: r.url, market, name: pkg.name, kind: pkg.kind, description: pkg.description })
    }
  }
  return out
}

export function search(q: string): IndexedPackage[] {
  const kw = q.trim().toLowerCase()
  const all = buildIndex()
  if (!kw) return all
  return all.filter(p => p.name.toLowerCase().includes(kw) || p.description.toLowerCase().includes(kw))
}

// 定位某监听库里指定 name 的包根目录（供导入用）
export function packageRoot(id: string, name: string): string | null {
  const dir = cacheDir(id)
  if (!fs.existsSync(dir)) return null
  return discoverPackages(dir).find(p => p.name === name)?.root ?? null
}
```

- [ ] **Step 4: 运行确认通过**

Run: `JAVA_HOME= npx vitest run tests/watched.test.ts`
Expected: PASS（5 passed）

- [ ] **Step 5: 提交**

```bash
git add src/lib/watched.ts tests/watched.test.ts
git commit -m "feat: 新增监听仓库 store（克隆/刷新/聚合索引/搜索）"
```

---

### Task 4: API routes（列表/搜索、加、删、刷新、导入）

**Files:**
- Create: `src/app/api/watched/route.ts`
- Create: `src/app/api/watched/refresh/route.ts`
- Create: `src/app/api/watched/import/route.ts`
- Test:（无 —— 现有代码库未对 route 做单测；逻辑已在 Task 1–3 的 lib 覆盖。route 仅做鉴权与薄封装，Task 6 手动验证）

**Interfaces:**
- Consumes: `getUser`（`@/lib/session`）、`stripCreds` `REPO_DIR`（`@/lib/config`）、`listWatched` `search` `addWatched` `removeWatched` `refreshWatched` `refreshAll` `packageRoot`（`@/lib/watched`）、`ensureRepo` `commitAll` `push` `headOf` `resetTo`（`@/lib/repo`）、`ingest`（`@/lib/ingest`）
- Produces: 
  - `GET  /api/watched?q=` → `{ repos: WatchedRepo[], results: IndexedPackage[] }`
  - `POST /api/watched {source}` → `WatchedRepo`
  - `DELETE /api/watched {id}` → `{ ok: true }`
  - `POST /api/watched/refresh {id?}` → `{ ok: true }`
  - `POST /api/watched/import {id, name}` → `IngestResult`

- [ ] **Step 1: 写 `src/app/api/watched/route.ts`**

```ts
/** @author sgz @since 2026-07-04 */
import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/session'
import { stripCreds } from '@/lib/config'
import { listWatched, search, addWatched, removeWatched } from '@/lib/watched'

export async function GET(req: NextRequest) {
  if (!(await getUser())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const q = new URL(req.url).searchParams.get('q') ?? ''
  return NextResponse.json({ repos: listWatched(), results: search(q) })
}

export async function POST(req: NextRequest) {
  if (!(await getUser())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { source } = await req.json().catch(() => ({}))
  if (!source) return NextResponse.json({ error: 'source required' }, { status: 400 })
  try {
    return NextResponse.json(addWatched(String(source)))
  } catch (e) {
    return NextResponse.json({ error: stripCreds(String(e)) }, { status: 400 })
  }
}

export async function DELETE(req: NextRequest) {
  if (!(await getUser())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await req.json().catch(() => ({}))
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  removeWatched(String(id))
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 2: 写 `src/app/api/watched/refresh/route.ts`**

```ts
/** @author sgz @since 2026-07-04 */
import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/session'
import { stripCreds } from '@/lib/config'
import { refreshWatched, refreshAll } from '@/lib/watched'

export async function POST(req: NextRequest) {
  if (!(await getUser())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await req.json().catch(() => ({}))
  try {
    if (id) refreshWatched(String(id)); else refreshAll()
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: stripCreds(String(e)) }, { status: 500 })
  }
}
```

- [ ] **Step 3: 写 `src/app/api/watched/import/route.ts`**

```ts
/** @author sgz @since 2026-07-04 */
import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/session'
import { REPO_DIR, stripCreds } from '@/lib/config'
import { ensureRepo, commitAll, push, headOf, resetTo } from '@/lib/repo'
import { ingest } from '@/lib/ingest'
import { packageRoot } from '@/lib/watched'

export async function POST(req: NextRequest) {
  if (!(await getUser())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id, name } = await req.json().catch(() => ({}))
  if (!id || !name) return NextResponse.json({ error: 'id and name required' }, { status: 400 })

  const root = packageRoot(String(id), String(name))
  if (!root) return NextResponse.json({ error: 'package not found' }, { status: 404 })

  ensureRepo()
  const before = headOf() // push 失败时回滚到此，同上传流
  try {
    const res = ingest(REPO_DIR, root, { overwrite: true })
    commitAll(`add ${res.name} (from ${id})`)
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

- [ ] **Step 4: 类型检查通过**

Run: `JAVA_HOME= npx tsc --noEmit`
Expected: 无错误输出（exit 0）

- [ ] **Step 5: 提交**

```bash
git add src/app/api/watched
git commit -m "feat: 远程监听 API（列表/搜索/加/删/刷新/导入）"
```

---

### Task 5: UI —— 独立路由 `/admin/remote`

**Files:**
- Create: `src/app/admin/remote/page.tsx`
- Create: `src/app/_components/RemoteRepos.tsx`
- Modify: `src/app/_components/AdminConsole.tsx`（头部动作区加「远程仓库」链接）
- Test:（无单测；Step 6 手动验证）

**Interfaces:**
- Consumes: `getUser`（`@/lib/auth`）、`/api/watched` 系列接口、`WatchedRepo`/`IndexedPackage` 类型（`@/lib/watched`）
- Produces: 页面 `/admin/remote`；`AdminConsole` 新增跳转入口

- [ ] **Step 1: 写页面 `src/app/admin/remote/page.tsx`**

```tsx
/**
 * @author sgz
 * @since 2026-07-04
 */
import { redirect } from 'next/navigation'
import { getUser } from '@/lib/auth'
import RemoteRepos from '@/app/_components/RemoteRepos'

export const dynamic = 'force-dynamic'
export const metadata = { title: '远程仓库 - Skill Hub' }

export default async function RemotePage() {
  const user = await getUser()
  if (!user) redirect('/login')

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-fuchsia-500/10 rounded-full blur-3xl" />
      </div>
      <div className="relative max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <RemoteRepos />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 写组件 `src/app/_components/RemoteRepos.tsx`**

```tsx
/**
 * @author sgz
 * @since 2026-07-04
 */
'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import type { WatchedRepo, IndexedPackage } from '@/lib/watched'

export default function RemoteRepos() {
  const [repos, setRepos] = useState<WatchedRepo[]>([])
  const [results, setResults] = useState<IndexedPackage[]>([])
  const [source, setSource] = useState('')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState<string | null>(null) // 当前进行中的动作标识

  // 拉取监听列表 + 搜索结果
  const load = useCallback(async (query: string) => {
    const res = await fetch(`/api/watched?q=${encodeURIComponent(query)}`)
    if (res.ok) {
      const data = await res.json()
      setRepos(data.repos)
      setResults(data.results)
    }
  }, [])

  useEffect(() => { load(q) }, [q, load])

  const addRepo = async () => {
    if (!source.trim()) return
    setBusy('add')
    try {
      const res = await fetch('/api/watched', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: source.trim() }),
      })
      if (!res.ok) { alert(`添加失败: ${await res.text()}`); return }
      setSource('')
      await load(q)
    } finally { setBusy(null) }
  }

  const removeRepo = async (id: string) => {
    setBusy(`rm:${id}`)
    try {
      await fetch('/api/watched', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      await load(q)
    } finally { setBusy(null) }
  }

  const refresh = async (id?: string) => {
    setBusy(id ? `refresh:${id}` : 'refresh:all')
    try {
      await fetch('/api/watched/refresh', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(id ? { id } : {}),
      })
      await load(q)
    } finally { setBusy(null) }
  }

  const doImport = async (pkg: IndexedPackage) => {
    setBusy(`import:${pkg.repoId}:${pkg.name}`)
    try {
      const res = await fetch('/api/watched/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: pkg.repoId, name: pkg.name }),
      })
      if (!res.ok) { alert(`导入失败: ${await res.text()}`); return }
      alert(`已导入 ${pkg.name} 到本市场`)
    } finally { setBusy(null) }
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-4xl font-bold text-zinc-100">远程仓库</h1>
          <p className="text-zinc-400">监听远程仓库，跨库搜索并导入技能。</p>
        </div>
        <Link href="/admin" className="px-5 py-2.5 bg-zinc-800 text-zinc-300 rounded-lg font-medium hover:bg-zinc-700 transition-colors">
          返回控制台
        </Link>
      </div>

      {/* 添加监听 */}
      <div className="flex gap-3">
        <input
          value={source}
          onChange={(e) => setSource(e.target.value)}
          placeholder="owner/repo 或完整 git URL"
          className="flex-1 px-4 py-3 bg-zinc-900/50 border border-zinc-800 rounded-lg text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-cyan-500/50"
        />
        <button
          onClick={addRepo}
          disabled={busy === 'add'}
          className="px-6 py-3 bg-cyan-500 text-white rounded-lg font-medium hover:bg-cyan-600 disabled:opacity-50 transition-colors"
        >
          {busy === 'add' ? '添加中...' : '添加监听'}
        </button>
      </div>

      {/* 监听列表 */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-zinc-100">监听仓库（{repos.length}）</h2>
          <button
            onClick={() => refresh()}
            disabled={!repos.length || busy === 'refresh:all'}
            className="px-3 py-1.5 text-sm rounded-lg bg-zinc-800/50 text-zinc-300 border border-zinc-700 hover:bg-zinc-700/50 disabled:opacity-50 transition-colors"
          >
            {busy === 'refresh:all' ? '刷新中...' : '全部刷新'}
          </button>
        </div>
        {repos.length === 0 ? (
          <p className="text-zinc-600 text-sm">还没有监听仓库。</p>
        ) : (
          <div className="divide-y divide-zinc-800 border border-zinc-800 rounded-xl overflow-hidden bg-zinc-900/40">
            {repos.map((r) => (
              <div key={r.id} className="flex items-center gap-3 p-4">
                <span className="flex-1 font-mono text-sm text-zinc-300 truncate">{r.source}</span>
                <button
                  onClick={() => refresh(r.id)}
                  disabled={busy === `refresh:${r.id}`}
                  className="px-3 py-1.5 text-sm rounded-lg bg-zinc-800/50 text-zinc-300 border border-zinc-700 hover:bg-zinc-700/50 disabled:opacity-50 transition-colors"
                >
                  {busy === `refresh:${r.id}` ? '刷新中' : '刷新'}
                </button>
                <button
                  onClick={() => removeRepo(r.id)}
                  disabled={busy === `rm:${r.id}`}
                  className="px-3 py-1.5 text-sm rounded-lg bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 disabled:opacity-50 transition-colors"
                >
                  移除
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 搜索 */}
      <div className="space-y-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索所有监听仓库里的技能…"
          className="w-full px-4 py-3 bg-zinc-900/50 border border-zinc-800 rounded-lg text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-cyan-500/50"
        />
        <div className="divide-y divide-zinc-800 border border-zinc-800 rounded-xl overflow-hidden bg-zinc-900/40">
          {results.length === 0 ? (
            <p className="p-4 text-zinc-600 text-sm">无结果。</p>
          ) : (
            results.map((pkg) => (
              <div key={`${pkg.repoId}:${pkg.name}`} className="p-4 space-y-2">
                <div className="flex items-center gap-3">
                  <span className="px-2 py-0.5 text-xs font-medium bg-zinc-800/50 text-zinc-400 rounded border border-zinc-700/50">{pkg.kind}</span>
                  <span className="text-lg font-semibold text-zinc-100 truncate">{pkg.name}</span>
                  <span className="text-xs text-zinc-500 truncate">{pkg.source}</span>
                  <button
                    onClick={() => doImport(pkg)}
                    disabled={busy === `import:${pkg.repoId}:${pkg.name}`}
                    className="ml-auto px-3 py-1.5 text-sm rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/20 disabled:opacity-50 transition-colors"
                  >
                    {busy === `import:${pkg.repoId}:${pkg.name}` ? '导入中' : '导入本市场'}
                  </button>
                </div>
                <p className="text-sm text-zinc-500 truncate">{pkg.description || '暂无描述'}</p>
                {/* 外部安装命令 */}
                <details className="text-sm">
                  <summary className="cursor-pointer text-zinc-400 hover:text-cyan-400">外部安装命令</summary>
                  <div className="mt-2 space-y-1 font-mono text-xs text-zinc-300">
                    <div>$ claude plugin marketplace add {pkg.url}</div>
                    <div>$ claude plugin install {pkg.name}{pkg.market ? `@${pkg.market}` : ''}</div>
                  </div>
                </details>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: 在 `AdminConsole.tsx` 头部动作区加入口**

在 `src/app/_components/AdminConsole.tsx` 里，`import Link from 'next/link'` 已存在。找到「设置」按钮那一段（`<button onClick={() => setShowSettings(true)} ...>设置</button>`），在它**之前**插入一个链接：

```tsx
          <Link
            href="/admin/remote"
            className="flex items-center gap-2 px-5 py-2.5 bg-zinc-800 text-zinc-300 rounded-lg font-medium hover:bg-zinc-700 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            远程仓库
          </Link>
```

- [ ] **Step 4: 类型检查通过**

Run: `JAVA_HOME= npx tsc --noEmit`
Expected: 无错误输出（exit 0）

- [ ] **Step 5: 全量测试通过**

Run: `JAVA_HOME= npx vitest run`
Expected: 全部 PASS（含既有测试 + 新增 discover/remote/watched）

- [ ] **Step 6: 手动验证（起服务）**

Run: `JAVA_HOME= npm run dev`，浏览器登录后：
1. 打开 `/admin`，点头部「远程仓库」→ 跳到 `/admin/remote`
2. 输入 `obra/superpowers-marketplace` → 「添加监听」→ 列表出现该仓库
3. 搜索关键词 → 结果列出跨库技能；展开「外部安装命令」看到 `marketplace add`/`install`
4. 点某结果「导入本市场」→ 提示导入成功；回 `/admin` 应看到新技能
5. 「刷新」「移除」按钮工作正常
Expected: 上述流程均正常

- [ ] **Step 7: 提交**

```bash
git add src/app/admin/remote src/app/_components/RemoteRepos.tsx src/app/_components/AdminConsole.tsx
git commit -m "feat: 远程仓库监听页 /admin/remote 与控制台入口"
```

---

## Self-Review

**Spec coverage：**
- 添加仓库监听 → Task 3 `addWatched` + Task 4 POST + Task 5 UI ✅
- 刷新（手动、单个/全部）→ Task 3 `refreshWatched`/`refreshAll` + Task 4 refresh + Task 5 ✅
- 跨库搜索 → Task 3 `buildIndex`/`search` + Task 4 GET + Task 5 ✅
- 结果两者都要（外部安装命令 + 导入本市场）→ Task 5 `<details>` 命令 + Task 4 import ✅
- 来源格式 owner/repo + 完整 URL → Task 2 `normalizeSource` ✅
- 仓库维度多包发现、内嵌 skill 不重复 → Task 1 `findRoots` ✅
- 导入复用 ingest + commit + push 回滚 → Task 4 import ✅
- 安全（拒本地路径、execFile、stripCreds、getUser）→ Task 2 + 全局约束 + 各 route ✅
- 独立路由 `/admin/remote` → Task 5 ✅
- 数据模型 `data/watched.json` + `data/watched/<id>/` → Task 3 ✅

**占位符扫描：** 无 TBD/TODO；每步含完整代码或确切命令。

**类型一致性：** `WatchedRepo`/`IndexedPackage`/`DiscoveredPackage`/`FoundRoot` 定义与各处引用一致；`packageRoot` 返回 `string | null`，import route 据此判空；`ingest(REPO_DIR, root, {overwrite:true})` 参数与现有签名一致。

**说明：** `.gitignore` 无需改动（`/data` 已整体忽略），spec 中「追加 data/watched/」一条在实现时省略。
