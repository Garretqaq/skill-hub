# 引用型包自动克隆导入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** 让用户可以直接在 UI 点击「导入本市场」按钮导入引用型包（当前只显示外部安装命令）。系统自动从 sourceUrl 克隆远程仓库到临时目录，发现包根，导入到本地 marketplace，最后清理临时目录。

**User Story:** 用户监听 `obra/superpowers-marketplace`，搜索结果显示 `superpowers` (引用)，点击「导入本市场」，系统自动克隆 `https://github.com/obra/superpowers.git`，发现其包根，导入成功。

**Architecture:** 
- API 层：`/api/watched/import` 接受可选的 `sourceUrl` 参数；当 `packageRoot` 返回 null（引用型包）且 `sourceUrl` 存在时，走"临时克隆 → 发现 → 导入"分支
- 临时克隆：复用 `cloneInto` 逻辑，目标目录用 `fs.mkdtempSync`，finally 清理
- UI 层：移除引用型包的 disabled 状态，调用 import 时传 `pkg.sourceUrl`

**Tech Stack:** Next.js 16 (app router)、TypeScript、execFileSync (git clone)、vitest。

## Global Constraints

- 不新增第三方依赖（git clone 用 Node.js execFileSync）。
- 所有 git 调用用 execFileSync 数组参数（防注入）。
- 错误消息经 `stripCreds()` 脱敏。
- 临时目录必须在 finally 块清理（即使失败）。
- 中文注释，保持现有文件头部。
- 测试：手动验证（真实 git clone 难以 mock）。

---

## Task 1: 扩展 import API 支持引用型包自动克隆

**Files:**
- Modify: `src/app/api/watched/import/route.ts`（扩展 POST handler 处理 sourceUrl）
- No new tests (manual verification only — git clone 需要网络)

**Interfaces:**
- Consumes: `cloneInto`（已存在 `src/lib/watched.ts`），`discoverPackages`（已存在 `src/lib/ingest.ts`）
- Produces: API 接受 `{id, name, sourceUrl?}`；sourceUrl 存在且 packageRoot 返回 null 时，临时克隆 sourceUrl → 发现包根 → ingest

- [ ] **Step 1: 修改 POST handler 接受 sourceUrl**

在 `src/app/api/watched/import/route.ts` line 11，扩展请求体解析：

```ts
const { id, name, sourceUrl } = await req.json().catch(() => ({}))
if (!id || !name) return NextResponse.json({ error: 'id and name required' }, { status: 400 })
```

- [ ] **Step 2: 检测引用型包并走临时克隆分支**

在 line 14-15 之后，修改逻辑：

```ts
const root = packageRoot(String(id), String(name))

// 引用型包：packageRoot 返回 null 但提供了 sourceUrl，临时克隆导入
if (!root && sourceUrl && typeof sourceUrl === 'string') {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-ref-'))
  try {
    // 克隆远程仓库到临时目录
    cloneInto(String(sourceUrl), tmp)
    
    // 发现包根（引用型包的远程仓库应该是实际的 plugin/skill 仓库）
    const packages = discoverPackages(tmp)
    const pkg = packages.find(p => toKebab(p.name) === toKebab(String(name)))
    if (!pkg || !pkg.root) {
      return NextResponse.json({ 
        error: `package "${name}" not found in remote repository` 
      }, { status: 404 })
    }
    
    // 导入（同本地包流程）
    ensureRepo()
    const before = headOf()
    const res = ingest(REPO_DIR, pkg.root, { overwrite: true })
    commitAll(`add ${res.name} (from remote ${sourceUrl})`)
    try {
      push()
    } catch (e) {
      if (before) resetTo(before)
      return NextResponse.json({ 
        error: 'push failed', 
        detail: stripCreds(String(e)) 
      }, { status: 500 })
    }
    return NextResponse.json(res)
  } catch (e) {
    return NextResponse.json({ 
      error: stripCreds(String(e)) 
    }, { status: 400 })
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

// 本地包或引用型包但未提供 sourceUrl：走原逻辑
if (!root) return NextResponse.json({ error: 'package not found' }, { status: 404 })

// 本地包导入（原逻辑不变）
ensureRepo()
const before = headOf()
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
```

**需要新增的 import：**
```ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { cloneInto } from '@/lib/watched'
import { discoverPackages, toKebab } from '@/lib/ingest'
```

**关键点：**
- `cloneInto(sourceUrl, tmp)` 可能抛异常（网络失败、无效 URL、认证失败）→ catch 块处理
- `discoverPackages(tmp)` 返回空数组或找不到匹配 name → 返回 404
- `pkg.root` 可能是 null（如果远程仓库也是个 marketplace 索引）→ 返回 404，不递归克隆
- finally 块保证 tmp 清理，即使 push 失败

- [ ] **Step 3: TypeScript 类型检查通过**

Run: `JAVA_HOME= npx tsc --noEmit`
Expected: 无错误（exit 0）

- [ ] **Step 4: 提交**

```bash
git add src/app/api/watched/import/route.ts
git commit -m "feat: import API 支持引用型包自动克隆"
```

**Manual verification (defer to Task 2 after UI change):**
- 监听 `obra/superpowers-marketplace`
- 搜索 `superpowers` (引用)
- 点「导入本市场」→ 应成功导入（自动克隆 obra/superpowers）

---

## Task 2: UI 移除引用型包 disabled 并传 sourceUrl

**Files:**
- Modify: `src/app/_components/RemoteRepos.tsx`（移除 `disabled={isReference}`，调用 import 时传 `sourceUrl`）
- No new tests (UI 交互，manual verification)

**Interfaces:**
- Consumes: `pkg.sourceUrl`（Task 1 前已存在，来自 IndexedPackage）
- Produces: UI 所有包均可点击导入；引用型包传 sourceUrl 给 API

- [ ] **Step 1: 修改导入按钮逻辑**

在 `src/app/_components/RemoteRepos.tsx` 的搜索结果渲染（约 line 172），修改 disabled 条件和 onClick：

**当前代码（约 line 172-180）：**
```tsx
<button
  onClick={() => doImport(pkg)}
  disabled={isReference || busy === `import:${pkg.repoId}:${pkg.name}`}
  title={isReference ? '引用型包无法直接导入，请使用外部安装命令' : ''}
  className="ml-auto px-3 py-1.5 text-sm rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
>
  {busy === `import:${pkg.repoId}:${pkg.name}` ? '导入中' : '导入本市场'}
</button>
```

**修改为：**
```tsx
<button
  onClick={() => doImport(pkg)}
  disabled={busy === `import:${pkg.repoId}:${pkg.name}`}
  title={isReference ? '将自动从远程克隆导入' : ''}
  className="ml-auto px-3 py-1.5 text-sm rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
>
  {busy === `import:${pkg.repoId}:${pkg.name}` ? '导入中' : '导入本市场'}
</button>
```

移除 `disabled={isReference ||`，tooltip 改为提示"将自动克隆"。

- [ ] **Step 2: 修改 doImport 函数传 sourceUrl**

定位 `doImport` 函数（约 line 40-60），修改 fetch body：

**当前代码（约 line 50）：**
```ts
const doImport = async (pkg: IndexedPackage) => {
  setBusy(`import:${pkg.repoId}:${pkg.name}`)
  try {
    const res = await fetch('/api/watched/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: pkg.repoId, name: pkg.name }),
    })
    // ...
  } finally {
    setBusy(null)
  }
}
```

**修改 body 为：**
```ts
body: JSON.stringify({ 
  id: pkg.repoId, 
  name: pkg.name,
  sourceUrl: pkg.sourceUrl  // 引用型包会有 sourceUrl，本地包为 undefined（API 会忽略）
}),
```

- [ ] **Step 3: TypeScript 类型检查通过**

Run: `JAVA_HOME= npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: 全量测试通过**

Run: `JAVA_HOME= npx vitest run`
Expected: 所有测试 PASS（UI 改动不影响既有测试）

- [ ] **Step 5: 提交**

```bash
git add src/app/_components/RemoteRepos.tsx
git commit -m "feat: UI 支持引用型包导入，自动克隆远程仓库"
```

- [ ] **Step 6: 手动验证（浏览器）**

Run: `JAVA_HOME= npm run dev`，浏览器登录后：
1. `/admin/remote` 添加监听 `obra/superpowers-marketplace` → 列表出现该仓库
2. 搜索（留空查全部）→ 结果列出引用型包，如 `superpowers` (引用)
3. 点 `superpowers` 的「导入本市场」→ 按钮显示"导入中"
4. 等待（首次克隆可能需 10-30 秒）→ 成功提示 "已导入"
5. 回 `/admin` → 插件列表应显示 `superpowers`
6. 尝试导入一个不存在的引用型包（修改 marketplace.json mock）→ 应返回 404 错误
7. 尝试导入一个无效 sourceUrl 的引用型包 → 应返回 git clone 错误

---

## Self-Review

**Spec coverage：**
- API 接受 sourceUrl → Task 1 ✅
- 临时克隆 → 发现 → 导入 → 清理 → Task 1 ✅
- UI 移除 disabled，传 sourceUrl → Task 2 ✅
- 手动验证端到端流程 → Task 2 Step 6 ✅

**测试覆盖：**
- 无自动化测试（git clone 需要网络，mock 成本高）
- 手动验证涵盖：成功路径（引用型包导入）、失败路径（包不存在、git 失败）

**类型一致性：**
- `IndexedPackage.sourceUrl?: string` 已存在（前一个功能）
- API 接受 `sourceUrl?: string`，类型匹配

**安全性：**
- sourceUrl 来自 watched 仓库的 marketplace.json（用户已信任的来源）
- git clone 用 execFileSync 数组参数（防注入）
- 错误消息经 stripCreds 脱敏
- 临时目录 finally 清理

**向后兼容：**
- 本地包流程不变（sourceUrl undefined 时走原逻辑）
- API 的 sourceUrl 参数可选，既有客户端不传也不影响

**边缘情况：**
- 引用型包的远程仓库本身是个 marketplace 索引（没有实际文件）→ `pkg.root` 为 null，返回 404
- 同名本地包 + 引用型包：前一个功能已去重（本地包优先），不会同时出现
- 网络失败、clone 超时：catch 块捕获，返回 400 + 脱敏错误
- push 失败：与本地包相同，回滚 commit

**说明：** 无自动化测试是因为 git clone 需要真实网络和远程仓库，mock execFileSync 会绕过真实行为。手动验证足够（upload 功能也是手动验证为主）。
