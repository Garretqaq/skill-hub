# 上传描述 + Git 信息刷新 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 上传技能时可手动设置描述（写入 manifest 与 plugin.json 并同步远程），并支持从远程 git 强制刷新拉取已有技能。

**Architecture:** 复用现有 `ingest`/`repo`/settings 分层。描述作为 `ingest` 的可选 opt 透传，覆盖包内描述并双写。新增 `syncFromRemoteIn(dir,url)` 纯核心（远程为准 `fetch`+`reset --hard FETCH_HEAD`）与 `syncFromRemote()` 包装（REPO_DIR + getRepoUrl），由「保存设置」自动调用及新增刷新路由手动调用。

**Tech Stack:** Next.js 16 (App Router, route handlers), TypeScript, vitest, git CLI via `execFileSync`。

## Global Constraints

- 新建/修改 `.ts` 文件头保留现有注释风格：`/** @author sgz @since 2026-07-04 */`（仅新建文件加，改动已有文件不动其头注释）。
- git 操作统一走 `repo.ts` 里的 `git(dir, args)` helper（`execFileSync('git', ...)`），不新引依赖。
- 遵循现有 `*In(dir, ...)` + 无后缀包装（读 REPO_DIR/settings）的双层模式，便于单测。
- 描述留空 = 沿用包内描述（保持当前行为），非空才覆盖。
- 刷新语义：远程为准，强制覆盖本地；无远程 / 空远程时安全跳过、不抛错。
- 测试运行：`npm test`（vitest run）；路由与 UI 改动用 `npm run build` 做类型校验。

---

### Task 1: ingest 支持描述覆盖

**Files:**
- Modify: `src/lib/ingest.ts`（`IngestOpts`/`ingest` opts 加 `description`；覆盖并写回 plugin.json）
- Test: `tests/ingest.test.ts`（追加用例）

**Interfaces:**
- Consumes: 无（现有 `ingest(repoDir, extractedDir, opts?)`）
- Produces: `ingest(repoDir, extractedDir, opts?: { name?; overwrite?; version?; description?: string })` —— `opts.description` 非空时，`marketplace.json` 条目与 `plugins/<name>/.claude-plugin/plugin.json` 两处 `description` 均为该值。

- [ ] **Step 1: 写失败测试**

在 `tests/ingest.test.ts` 末尾追加（沿用文件顶部已 import 的 `ingest`/`readMarketplace`/`fs`/`path`，及本文件已有的 `tmp`/`seedRepo` 辅助函数）：

```ts
test('description opt overrides package description in both manifest and plugin.json', () => {
  const repo = seedRepo()
  const src = tmp()
  const sk = path.join(src, 'my-skill')
  fs.mkdirSync(sk, { recursive: true })
  fs.writeFileSync(path.join(sk, 'SKILL.md'), '---\nname: my-skill\ndescription: pkg\n---\nbody')

  ingest(repo, src, { description: 'custom desc' })

  expect(readMarketplace(repo).plugins[0].description).toBe('custom desc')
  const pj = JSON.parse(
    fs.readFileSync(path.join(repo, 'plugins/my-skill/.claude-plugin/plugin.json'), 'utf8'),
  )
  expect(pj.description).toBe('custom desc')
})

test('empty/absent description opt keeps package description', () => {
  const repo = seedRepo()
  const src = tmp()
  const root = path.join(src, 'toolkit')
  fs.mkdirSync(path.join(root, '.claude-plugin'), { recursive: true })
  fs.writeFileSync(path.join(root, '.claude-plugin/plugin.json'),
    JSON.stringify({ name: 'toolkit', description: 'T', version: '1.0.0' }))
  fs.mkdirSync(path.join(root, 'skills/a'), { recursive: true })
  fs.writeFileSync(path.join(root, 'skills/a/SKILL.md'), '---\nname: a\n---\nx')

  ingest(repo, src) // 不传 description
  expect(readMarketplace(repo).plugins[0].description).toBe('T')
  const pj = JSON.parse(
    fs.readFileSync(path.join(repo, 'plugins/toolkit/.claude-plugin/plugin.json'), 'utf8'),
  )
  expect(pj.description).toBe('T')
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test -- ingest`
Expected: `description opt overrides...` FAIL（manifest 得到 `'pkg'` 而非 `'custom desc'`）。

- [ ] **Step 3: 实现覆盖 + plugin.json 双写**

在 `src/lib/ingest.ts` 的 `ingest` 签名加 `description`：

```ts
export function ingest(repoDir: string, extractedDir: string, opts?: { name?: string; overwrite?: boolean; version?: string; description?: string }): IngestResult {
```

在解析出 `description` 后（`if (found.kind === 'plugin') { ... } else { ... }` 这段之后、`if (!name) throw` 之前）加覆盖：

```ts
  if (opts?.description) description = opts.description // 非空时覆盖包内描述
```

plugin 类型写 plugin.json 处（当前只有 `pj.version = version`），补一行 description：

```ts
    const pj = JSON.parse(fs.readFileSync(pjPath, 'utf8'))
    pj.version = version
    pj.description = description // 与 manifest 保持一致
    fs.writeFileSync(pjPath, JSON.stringify(pj, null, 2) + '\n')
```

裸 skill 类型生成 plugin.json 处已用 `description` 变量（`JSON.stringify({ name, description, version }...)`），无需改动 —— 覆盖后的值自动生效。

- [ ] **Step 4: 运行确认通过**

Run: `npm test -- ingest`
Expected: 全部 PASS（含新增两条与原有用例）。

- [ ] **Step 5: 提交**

```bash
git add src/lib/ingest.ts tests/ingest.test.ts
git commit -m "feat: ingest 支持描述覆盖（双写 manifest 与 plugin.json）"
```

---

### Task 2: repo 新增 syncFromRemote

**Files:**
- Modify: `src/lib/repo.ts`（新增 `syncFromRemoteIn` 与 `syncFromRemote`）
- Test: `tests/repo.test.ts`（追加用例）

**Interfaces:**
- Consumes: 现有 `repo.ts` 内部 `git(dir, args)`、`ensureRepo`、`setRemoteUrlIn`；`settings.ts` 的 `getRepoUrl`；`config.ts` 的 `REPO_DIR`。
- Produces:
  - `syncFromRemoteIn(dir: string, url: string): void` —— 把 `dir` 的 origin 指向 `url`，远程有分支则 `fetch` + `reset --hard FETCH_HEAD` 覆盖本地；远程空则 no-op。
  - `syncFromRemote(): void` —— `ensureRepo()` 后，若 `getRepoUrl()` 有值则 `syncFromRemoteIn(REPO_DIR, url)`。

- [ ] **Step 1: 写失败测试**

在 `tests/repo.test.ts` 末尾追加（复用文件顶部 import 的 `execFileSync`/`fs`/`os`/`path`/`expect`/`test`，并把 `syncFromRemoteIn` 加进顶部的 `import { ... } from '@/lib/repo'`）：

```ts
// 造一个带一次提交的 bare 远程，返回其路径
function bareRemoteWithCommit(): string {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'shwork-'))
  execFileSync('git', ['init', '-q'], { cwd: work })
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: work })
  execFileSync('git', ['config', 'user.name', 't'], { cwd: work })
  fs.writeFileSync(path.join(work, 'remote-skill.txt'), 'from-remote')
  execFileSync('git', ['add', '-A'], { cwd: work })
  execFileSync('git', ['commit', '-q', '-m', 'remote init'], { cwd: work })
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'shbare-')) + '.git'
  execFileSync('git', ['clone', '-q', '--bare', work, bare])
  return bare
}

test('syncFromRemoteIn force-overwrites local from unrelated remote', () => {
  const remote = bareRemoteWithCommit()
  const local = gitRepo()
  fs.writeFileSync(path.join(local, 'local-only.txt'), 'local')
  commitAllIn(local, 'local init')

  syncFromRemoteIn(local, remote)

  expect(fs.readFileSync(path.join(local, 'remote-skill.txt'), 'utf8')).toBe('from-remote')
  expect(fs.existsSync(path.join(local, 'local-only.txt'))).toBe(false) // 本地被远程覆盖
})

test('syncFromRemoteIn is a safe no-op against an empty remote', () => {
  const emptyBare = fs.mkdtempSync(path.join(os.tmpdir(), 'shbareempty-')) + '.git'
  execFileSync('git', ['init', '-q', '--bare', emptyBare])
  const local = gitRepo()
  fs.writeFileSync(path.join(local, 'keep.txt'), 'keep')
  commitAllIn(local, 'local init')

  syncFromRemoteIn(local, emptyBare) // 不抛错

  expect(fs.readFileSync(path.join(local, 'keep.txt'), 'utf8')).toBe('keep') // 本地保留
})
```

> 顶部 import 需含 `commitAllIn`（已有）。`gitRepo`/`commitAllIn` 均为本文件已存在的辅助。

- [ ] **Step 2: 运行确认失败**

Run: `npm test -- repo`
Expected: FAIL —— `syncFromRemoteIn is not a function` / import 报错。

- [ ] **Step 3: 实现**

在 `src/lib/repo.ts` 末尾追加（`git`/`ensureRepo`/`setRemoteUrlIn`/`REPO_DIR`/`getRepoUrl` 均已在文件内可用）：

```ts
// 远程为准，强制拉取覆盖本地。远程空或历史不相干均安全处理。
export function syncFromRemoteIn(dir: string, url: string): void {
  setRemoteUrlIn(dir, url)                                  // 确保 origin 指向目标
  const heads = git(dir, ['ls-remote', '--heads', 'origin']).trim()
  if (!heads) return                                        // 远程无分支/提交，跳过
  git(dir, ['fetch', 'origin'])
  git(dir, ['reset', '--hard', 'FETCH_HEAD'])               // fetch origin 后 FETCH_HEAD 指向远程默认分支
}
export function syncFromRemote(): void {
  ensureRepo()                                              // .git 缺失时 clone（clone 即已同步）
  const url = getRepoUrl()
  if (!url) return                                          // 无远程（本地 init），跳过
  syncFromRemoteIn(REPO_DIR, url)
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npm test -- repo`
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add src/lib/repo.ts tests/repo.test.ts
git commit -m "feat: repo 新增 syncFromRemote（远程为准强制刷新）"
```

---

### Task 3: 接线 API 路由（上传描述 + 保存自动刷新 + 刷新路由）

**Files:**
- Modify: `src/app/api/skills/route.ts`（读 `description` 透传 ingest）
- Modify: `src/app/api/settings/route.ts`（PUT 内 setRemoteUrl 后、rename 前调 `syncFromRemote`）
- Create: `src/app/api/settings/refresh/route.ts`（POST：手动刷新，返回技能数）
- Test: 无单测（route handler）；用 `npm run build` 校验类型。

**Interfaces:**
- Consumes: Task 1 的 `ingest(..., { description })`；Task 2 的 `syncFromRemote()`；现有 `getUser`/`listPlugins`/`REPO_DIR`。
- Produces: `POST /api/skills` 接受 `description` 表单字段；`POST /api/settings/refresh` 返回 `{ count: number }` 或 `{ error, detail }`。

- [ ] **Step 1: skills 路由透传描述**

`src/app/api/skills/route.ts`，在读 `overwrite` 后加读 `description`：

```ts
  const overwrite = form.get('overwrite') === 'true'
  const description = form.get('description')
```

把 `ingest(...)` 调用改为：

```ts
    const res = ingest(REPO_DIR, tmp, {
      name: nameOverride ? String(nameOverride) : undefined,
      overwrite,
      description: description ? String(description) : undefined,
    })
```

- [ ] **Step 2: settings PUT 保存时自动刷新**

`src/app/api/settings/route.ts`，把顶部 import 的 `from '@/lib/repo'` 补上 `syncFromRemote`：

```ts
import { setRemoteUrl, ensureRepo, commitAll, push, headOf, resetTo, syncFromRemote } from '@/lib/repo'
```

在 `setRemoteUrl(getRepoUrl())` 的 try 块之后、市场名 rename 逻辑（`const newName = ...`）之前，插入自动刷新：

```ts
  try {
    syncFromRemote() // 保存后以远程为准拉取一次，rename 写在最新状态之上
  } catch (e) {
    return NextResponse.json({ error: 'refresh failed', detail: String(e) }, { status: 500 })
  }
```

- [ ] **Step 3: 新增刷新路由**

Create `src/app/api/settings/refresh/route.ts`:

```ts
/** @author sgz @since 2026-07-04 */
import { NextResponse } from 'next/server'
import { getUser } from '@/lib/session'
import { REPO_DIR } from '@/lib/config'
import { syncFromRemote } from '@/lib/repo'
import { listPlugins } from '@/lib/marketplace'

export async function POST() {
  if (!(await getUser())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    syncFromRemote()
  } catch (e) {
    return NextResponse.json({ error: 'refresh failed', detail: String(e) }, { status: 500 })
  }
  return NextResponse.json({ count: listPlugins(REPO_DIR).length })
}
```

- [ ] **Step 4: 类型校验**

Run: `npm run build`
Expected: 构建成功，无 TS 错误。

- [ ] **Step 5: 提交**

```bash
git add src/app/api/skills/route.ts src/app/api/settings/route.ts src/app/api/settings/refresh/route.ts
git commit -m "feat: 上传透传描述 + 保存自动刷新 + 刷新路由"
```

---

### Task 4: UI（上传描述框 + 设置刷新按钮）

**Files:**
- Modify: `src/app/_components/UploadForm.tsx`（描述 textarea）
- Modify: `src/app/_components/SettingsForm.tsx`（刷新按钮）
- Test: 无单测；`npm run build` 校验。

**Interfaces:**
- Consumes: Task 3 的 `POST /api/skills`（`description` 字段）、`POST /api/settings/refresh`（返回 `{ count }`）。
- Produces: 无（终端 UI）。

- [ ] **Step 1: UploadForm 加描述框**

`src/app/_components/UploadForm.tsx`：

state 加：
```ts
  const [description, setDescription] = useState('')
```

`handleSubmit` 内 `formData` 组装处（`if (overwrite) formData.append('overwrite', 'true')` 附近）加：
```ts
      if (description.trim()) formData.append('description', description.trim())
```

在「技能名称」那个 `<div className="space-y-2">…</div>` 之后、Overwrite 复选框之前，插入描述块（沿用同款样式）：
```tsx
            {/* Description Input */}
            <div className="space-y-2">
              <label htmlFor="skill-description" className="block text-sm font-medium text-zinc-300">
                描述 <span className="text-zinc-600">(可选)</span>
              </label>
              <textarea
                id="skill-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="留空则使用包内自带描述"
                className="w-full px-4 py-3 bg-zinc-900/50 border border-zinc-800 rounded-lg text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/20 transition-all duration-300 resize-none"
              />
            </div>
```

- [ ] **Step 2: SettingsForm 加刷新按钮**

`src/app/_components/SettingsForm.tsx`：

顶部已 import `useState`；补 `useRouter`：
```ts
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
```
组件内加：
```ts
  const router = useRouter()
  const [refreshing, setRefreshing] = useState(false)

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      const res = await fetch('/api/settings/refresh', { method: 'POST' })
      const d = await res.json()
      if (!res.ok) {
        alert(`刷新失败: ${d.detail || d.error}`)
        return
      }
      alert(`刷新成功，当前 ${d.count} 个技能`)
      router.refresh()
    } catch (err) {
      alert(`刷新失败: ${err}`)
    } finally {
      setRefreshing(false)
    }
  }
```

在 Actions 那一排（`保存` / `取消` 按钮所在的 `<div className="flex items-center gap-3 pt-4">`）里，`取消` 按钮之后加刷新按钮：
```tsx
              <button
                type="button"
                onClick={handleRefresh}
                disabled={loading || saving || refreshing}
                className="px-6 py-3 bg-zinc-800 text-zinc-300 rounded-lg font-medium hover:bg-zinc-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {refreshing ? '刷新中...' : '刷新'}
              </button>
```

- [ ] **Step 3: 构建校验**

Run: `npm run build`
Expected: 构建成功，无 TS/lint 错误。

- [ ] **Step 4: 手动验收（可选，需 dev 环境）**

Run: `npm run dev`，登录后：上传带描述的 zip → 列表/详情显示自定义描述；设置里配好远程后点「刷新」→ alert 技能数、列表出现远程技能。

- [ ] **Step 5: 提交**

```bash
git add src/app/_components/UploadForm.tsx src/app/_components/SettingsForm.tsx
git commit -m "feat: 上传描述输入框 + 设置刷新按钮"
```

---

## Self-Review

**Spec coverage:**
- 上传设置描述 → Task 1（覆盖+双写）+ Task 3 Step 1（透传）+ Task 4 Step 1（UI）✓
- 同步到远程 git → 描述随现有 commit+push（Task 1 不改推送链，`route.ts` 原逻辑保留）✓
- 远程为准强制覆盖刷新 → Task 2 `syncFromRemote` ✓
- 保存设置自动刷新 → Task 3 Step 2 ✓
- 独立刷新按钮 → Task 3 Step 3 + Task 4 Step 2 ✓
- 查看现有技能 → `page.tsx` force-dynamic + reset 覆盖后 router.refresh（Task 4）✓，无需改 page。

**Placeholder scan:** 无 TBD/TODO；所有代码步骤含完整代码。

**Type consistency:** `syncFromRemoteIn(dir,url)` / `syncFromRemote()` 命名 Task 2 定义、Task 3 引用一致；`ingest` 的 `description` opt Task 1 定义、Task 3 使用一致；刷新路由返回 `{ count }` 与 Task 4 消费一致。
