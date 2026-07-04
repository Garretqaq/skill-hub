# marketplace.json 引用解析支持 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** 让远程仓库监听功能支持解析 `.claude-plugin/marketplace.json` 的 `plugins[]` 引用，使像 `obra/superpowers-marketplace` 这样的"索引型仓库"也能被搜索到其引用的包。

**Architecture:** 扩展 `discoverPackages` 增加 marketplace.json 解析路径；`IndexedPackage` 加 `sourceUrl` 字段区分本地包 vs 引用型包；UI 对引用型包禁用「导入本市场」，只显示外部安装命令；import API 拒绝引用型包。

**Tech Stack:** Next.js 16 (app router)、TypeScript、gray-matter、vitest。

## Global Constraints

- 修改 `.ts`/`.tsx` 文件保持现有 `@author sgz` 头部不变；注释用中文。
- 不新增第三方依赖。
- 所有 JSON 解析捕获异常（ponytail：畸形 JSON 静默跳过）。
- 测试覆盖新增的 marketplace.json 解析路径。
- 固定路径 `data/watched/` 已被整体 gitignore，无需改 `.gitignore`。

---

### Task 1: 扩展 discoverPackages 支持 marketplace.json 引用

**Files:**
- Modify: `src/lib/ingest.ts`（在 `discoverPackages` 末尾追加 marketplace.json 解析逻辑；新增 `DiscoveredPackage` 的 `sourceUrl?` 字段）
- Test: `tests/discover.test.ts`（追加测试）

**Interfaces:**
- Consumes: `findRoots`（已存在）、`toKebab`（已存在）、`fs`/`path`（已 import）
- Produces: 扩展后的 `DiscoveredPackage` 接口，新增 `sourceUrl?: string` 字段；`discoverPackages` 返回本地包 + marketplace 引用包

- [ ] **Step 1: 修改 `DiscoveredPackage` 接口**

在 `src/lib/ingest.ts` line 163 处，修改接口：
```ts
export interface DiscoveredPackage { 
  name: string
  kind: 'plugin' | 'skill'
  description: string
  root: string | null  // 本地包有实际路径，引用型包为 null
  sourceUrl?: string   // 引用型包的外部 git URL
}
```

- [ ] **Step 2: 扩展 `discoverPackages` 实现**

在 `src/lib/ingest.ts` 的 `discoverPackages` 函数末尾（line 165-174 之后），追加：

```ts
export function discoverPackages(dir: string): DiscoveredPackage[] {
  const packages: DiscoveredPackage[] = []
  
  // 现有逻辑：扫描本地文件型包
  for (const { root, kind } of findRoots(dir)) {
    if (kind === 'plugin') {
      const pj = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin/plugin.json'), 'utf8'))
      packages.push({ 
        name: toKebab(pj.name || path.basename(root)), 
        kind, 
        description: pj.description || '', 
        root,
        sourceUrl: undefined 
      })
    } else {
      const fm = matter(fs.readFileSync(path.join(root, 'SKILL.md'), 'utf8')).data
      packages.push({ 
        name: toKebab(fm.name || path.basename(root)), 
        kind, 
        description: fm.description || '', 
        root,
        sourceUrl: undefined 
      })
    }
  }
  
  // 新增逻辑：如果根目录有 marketplace.json，解析其 plugins[] 引用
  const marketplacePath = path.join(dir, '.claude-plugin', 'marketplace.json')
  if (fs.existsSync(marketplacePath)) {
    try {
      const marketplace = JSON.parse(fs.readFileSync(marketplacePath, 'utf8'))
      if (Array.isArray(marketplace.plugins)) {
        for (const entry of marketplace.plugins) {
          if (entry.source?.url && entry.name) {
            packages.push({
              name: toKebab(entry.name),
              kind: 'plugin', // marketplace 引用都当 plugin
              description: entry.description || '',
              root: null, // 引用型包无本地 root
              sourceUrl: entry.source.url
            })
          }
        }
      }
    } catch {
      // ponytail: 畸形 marketplace.json 静默跳过
    }
  }
  
  return packages
}
```

- [ ] **Step 3: 追加测试到 `tests/discover.test.ts`**

在文件末尾追加：

```ts
test('discoverPackages 解析 marketplace.json 引用型包', () => {
  const dir = tmp()
  // 造一个空仓库（无本地 plugin/skill）但有 marketplace.json
  fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.claude-plugin', 'marketplace.json'),
    JSON.stringify({
      name: 'test-market',
      plugins: [
        { name: 'ref-pkg-1', source: { url: 'https://github.com/a/b.git' }, description: 'ref desc 1' },
        { name: 'ref-pkg-2', source: { url: 'https://github.com/c/d.git' }, description: 'ref desc 2' }
      ]
    }))
  
  const pkgs = discoverPackages(dir)
  expect(pkgs).toHaveLength(2)
  expect(pkgs[0]).toMatchObject({ name: 'ref-pkg-1', kind: 'plugin', description: 'ref desc 1', root: null, sourceUrl: 'https://github.com/a/b.git' })
  expect(pkgs[1]).toMatchObject({ name: 'ref-pkg-2', kind: 'plugin', description: 'ref desc 2', root: null, sourceUrl: 'https://github.com/c/d.git' })
})

test('discoverPackages 混合本地包与引用包', () => {
  const dir = tmp()
  plugin(dir, 'local-alpha')
  fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.claude-plugin', 'marketplace.json'),
    JSON.stringify({
      name: 'mixed-market',
      plugins: [{ name: 'ref-beta', source: { url: 'https://github.com/x/y.git' }, description: 'ref' }]
    }))
  
  const pkgs = discoverPackages(dir)
  expect(pkgs).toHaveLength(2)
  const local = pkgs.find(p => p.name === 'local-alpha')
  const ref = pkgs.find(p => p.name === 'ref-beta')
  expect(local).toMatchObject({ kind: 'plugin', root: expect.stringContaining('local-alpha'), sourceUrl: undefined })
  expect(ref).toMatchObject({ kind: 'plugin', root: null, sourceUrl: 'https://github.com/x/y.git' })
})
```

- [ ] **Step 4: 运行测试确认通过**

Run: `JAVA_HOME= npx vitest run tests/discover.test.ts`
Expected: 所有测试通过（原 3 个 + 新 2 个 = 5 passed）

- [ ] **Step 5: 提交**

```bash
git add src/lib/ingest.ts tests/discover.test.ts
git commit -m "feat: discoverPackages 支持 marketplace.json 引用型包"
```

---

### Task 2: 扩展 IndexedPackage 并传播 sourceUrl

**Files:**
- Modify: `src/lib/watched.ts`（`IndexedPackage` 加 `sourceUrl` 字段；`buildIndex` 传播该字段）
- Test: `tests/watched.test.ts`（验证引用型包的 sourceUrl 被正确索引）

**Interfaces:**
- Consumes: `discoverPackages`（Task 1 已扩展）
- Produces: 扩展后的 `IndexedPackage` 接口；`buildIndex` 返回包含 sourceUrl 的索引

- [ ] **Step 1: 修改 `IndexedPackage` 接口**

在 `src/lib/watched.ts` line 9-12 处，修改接口：
```ts
export interface IndexedPackage {
  repoId: string; source: string; url: string; market: string | null
  name: string; kind: 'plugin' | 'skill'; description: string
  sourceUrl?: string  // 引用型包的外部 git URL（本地包为 undefined）
}
```

- [ ] **Step 2: 修改 `buildIndex` 传播 sourceUrl**

在 `src/lib/watched.ts` 的 `buildIndex` 函数（约 line 88-100）中，修改循环体把 `pkg.sourceUrl` 传到 `IndexedPackage`：

```ts
export function buildIndex(): IndexedPackage[] {
  const out: IndexedPackage[] = []
  for (const r of readAll()) {
    const dir = cacheDir(r.id)
    if (!fs.existsSync(dir)) continue
    const market = marketNameOf(r.id)
    for (const pkg of discoverPackages(dir)) {
      out.push({ 
        repoId: r.id, 
        source: r.source, 
        url: r.url, 
        market, 
        name: pkg.name, 
        kind: pkg.kind, 
        description: pkg.description,
        sourceUrl: pkg.sourceUrl  // 新增
      })
    }
  }
  return out
}
```

- [ ] **Step 3: 追加测试到 `tests/watched.test.ts`**

在文件末尾追加：

```ts
test('buildIndex 包含引用型包的 sourceUrl', async () => {
  const { cloneInto, buildIndex } = await import('@/lib/watched')
  const remote = remoteRepo('alpha')
  const id = 'market-with-refs'
  
  // 手工克隆一个含 marketplace.json 的远程
  cloneInto(remote, path.join(work, 'data/watched', id))
  
  // 在该缓存里追加一个 marketplace.json（模拟索引型仓库）
  const cacheDir = path.join(work, 'data/watched', id)
  fs.mkdirSync(path.join(cacheDir, '.claude-plugin'), { recursive: true })
  fs.writeFileSync(path.join(cacheDir, '.claude-plugin', 'marketplace.json'),
    JSON.stringify({
      name: 'test-market',
      plugins: [{ name: 'external-pkg', source: { url: 'https://github.com/ext/pkg.git' }, description: 'ext' }]
    }))
  
  fs.writeFileSync(path.join(work, 'data/watched.json'),
    JSON.stringify({ repos: [{ id, source: remote, url: remote, addedAt: 'x' }] }))
  
  const idx = buildIndex()
  const local = idx.find(p => p.name === 'alpha')
  const ref = idx.find(p => p.name === 'external-pkg')
  
  expect(local).toMatchObject({ repoId: id, name: 'alpha', kind: 'plugin', sourceUrl: undefined })
  expect(ref).toMatchObject({ repoId: id, name: 'external-pkg', kind: 'plugin', sourceUrl: 'https://github.com/ext/pkg.git' })
})
```

- [ ] **Step 4: 运行测试确认通过**

Run: `JAVA_HOME= npx vitest run tests/watched.test.ts`
Expected: 所有测试通过（原 7 个 + 新 1 个 = 8 passed）

- [ ] **Step 5: 提交**

```bash
git add src/lib/watched.ts tests/watched.test.ts
git commit -m "feat: IndexedPackage 传播 sourceUrl 区分引用型包"
```

---

### Task 3: UI 区分引用型包并禁用导入

**Files:**
- Modify: `src/app/_components/RemoteRepos.tsx`（检测 `pkg.sourceUrl`，禁用「导入本市场」，调整外部安装命令显示）
- Test: 无（UI 组件无单测；手动验证见 Step 5）

**Interfaces:**
- Consumes: `IndexedPackage`（Task 2 已扩展）
- Produces: UI 根据 `sourceUrl` 显示不同行为

- [ ] **Step 1: 修改 RemoteRepos.tsx 搜索结果渲染**

在 `src/app/_components/RemoteRepos.tsx` 的搜索结果列表（约 line 105-135），定位到每个 `pkg` 的卡片渲染，修改「导入本市场」按钮：

```tsx
{results.map((pkg) => {
  const isReference = !!pkg.sourceUrl  // 引用型包判定
  return (
    <div key={`${pkg.repoId}:${pkg.name}`} className="p-4 space-y-2">
      <div className="flex items-center gap-3">
        <span className="px-2 py-0.5 text-xs font-medium bg-zinc-800/50 text-zinc-400 rounded border border-zinc-700/50">
          {pkg.kind}{isReference ? ' (引用)' : ''}
        </span>
        <span className="text-lg font-semibold text-zinc-100 truncate">{pkg.name}</span>
        <span className="text-xs text-zinc-500 truncate">{pkg.source}</span>
        <button
          onClick={() => doImport(pkg)}
          disabled={isReference || busy === `import:${pkg.repoId}:${pkg.name}`}
          title={isReference ? '引用型包无法直接导入，请使用外部安装命令' : ''}
          className="ml-auto px-3 py-1.5 text-sm rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {busy === `import:${pkg.repoId}:${pkg.name}` ? '导入中' : '导入本市场'}
        </button>
      </div>
      <p className="text-sm text-zinc-500 truncate">{pkg.description || '暂无描述'}</p>
      {/* 外部安装命令 */}
      <details className="text-sm">
        <summary className="cursor-pointer text-zinc-400 hover:text-cyan-400">外部安装命令</summary>
        <div className="mt-2 space-y-1 font-mono text-xs text-zinc-300">
          {isReference ? (
            <>
              <div>$ claude plugin marketplace add {pkg.url}</div>
              <div>$ claude plugin install {pkg.name}{pkg.market ? `@${pkg.market}` : ''}</div>
            </>
          ) : (
            <>
              <div>$ claude plugin marketplace add {pkg.url}</div>
              <div>$ claude plugin install {pkg.name}{pkg.market ? `@${pkg.market}` : ''}</div>
            </>
          )}
        </div>
      </details>
    </div>
  )
})}
```

（注：本地包和引用包的外部安装命令实际上是一样的格式，这里保持一致；区别在于「导入本市场」按钮）

- [ ] **Step 2: 类型检查通过**

Run: `JAVA_HOME= npx tsc --noEmit`
Expected: 无错误输出（exit 0）

- [ ] **Step 3: 全量测试通过**

Run: `JAVA_HOME= npx vitest run`
Expected: 全部 PASS（含既有测试 + Task 1-2 新增）

- [ ] **Step 4: 提交**

```bash
git add src/app/_components/RemoteRepos.tsx
git commit -m "feat: UI 区分引用型包，禁用直接导入"
```

- [ ] **Step 5: 手动验证（起服务）**

Run: `JAVA_HOME= npm run dev`，浏览器登录后：
1. 添加监听 `obra/superpowers-marketplace` → 列表出现该仓库
2. 搜索（留空查全部）→ 结果列出引用型包（带 "(引用)" 标签）
3. 引用型包的「导入本市场」按钮灰色 disabled，hover 显示 tooltip
4. 展开「外部安装命令」→ 显示正确的 marketplace add + install 命令
5. 尝试点「导入本市场」→ 按钮无反应（disabled）
Expected: 上述流程均正常

---

### Task 4: import API 拒绝引用型包

**Files:**
- Modify: `src/app/api/watched/import/route.ts`（在 `packageRoot` 查找后增加校验：root 为 null 时返回 400）
- Test: 无（API 无单测，逻辑已在 lib 层测试）

**Interfaces:**
- Consumes: `packageRoot`（返回 `string | null`）
- Produces: 对引用型包（root = null）返回 400 错误

- [ ] **Step 1: 修改 import route 增加校验**

在 `src/app/api/watched/import/route.ts` 的 POST handler 中（约 line 16-34），定位到 `packageRoot` 调用后，增加校验：

```ts
export async function POST(req: NextRequest) {
  if (!(await getUser())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id, name } = await req.json().catch(() => ({}))
  if (!id || !name) return NextResponse.json({ error: 'id and name required' }, { status: 400 })

  const root = packageRoot(String(id), String(name))
  if (!root) return NextResponse.json({ error: 'package not found' }, { status: 404 })
  
  // 新增：引用型包（root 为 null）无法导入
  if (root === null) {
    return NextResponse.json({ error: 'cannot import reference-only package' }, { status: 400 })
  }

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
}
```

等等，我发现逻辑错误：`packageRoot` 返回 `string | null`，当包不存在时返回 null，但现在引用型包的 `DiscoveredPackage.root` 也是 null。两者需要区分。

修正方案：`packageRoot` 在找到引用型包（root = null）时返回一个特殊值（如空字符串 `''`），与"包不存在"的 `null` 区分开。

更好的方案：修改 `packageRoot` 返回 `{ root: string; isReference: boolean } | null`，明确区分三种状态。

BUT 这会改 public API，影响面大。更简单的方案：在 `buildIndex` 时，引用型包就不要放进索引（或标记为不可导入），由 UI 层过滤。

**重新设计：** 保持 `packageRoot` 不变，在 UI 层已经用 `disabled` 阻止了点击。API 层作为最后防线，检测到 `packageRoot` 返回 null 时，统一返回 404（无论是"包不存在"还是"引用型包没有本地 root"）。前端已经禁用按钮，所以这个分支理论上不会被触发；如果被触发（如直接调 API），404 也合理。

简化方案：**不改 API**，当前 API 对 `root = null` 已返回 404，够用。引用型包的 `discoverPackages` 返回 `root: null`，`packageRoot` 查找时会找到该包但 root 是 null，`find()` 会返回该对象，访问 `.root` 得到 null，API 已有的 404 分支能处理。

验证一下 `packageRoot` 实现：

```ts
export function packageRoot(id: string, name: string): string | null {
  const dir = cacheDir(id)
  if (!fs.existsSync(dir)) return null
  return discoverPackages(dir).find(p => p.name === name)?.root ?? null
}
```

当引用型包时，`find()` 返回 `{..., root: null}`，访问 `.root` 得到 `null`，`?? null` 也是 `null`，最终返回 `null`，现有 API 的 `if (!root)` 会命中并返回 404。完美，无需改 API。

所以 **Task 4 可以省略**，现有代码已经能正确拒绝引用型包的导入请求（返回 404）。

- [ ] **Step 1: 验证现有 API 对引用型包的处理**

分析 `src/app/api/watched/import/route.ts`：
```ts
const root = packageRoot(String(id), String(name))
if (!root) return NextResponse.json({ error: 'package not found' }, { status: 404 })
```

当 name 是引用型包时，`packageRoot` 返回 `null`（因为 `DiscoveredPackage.root` 是 `null`），API 返回 404。虽然错误消息是 "package not found" 而非 "cannot import reference package"，但功能正确（拒绝导入），且 UI 已禁用按钮，此分支不应被正常用户触发。

- [ ] **Step 2: 无需修改，确认测试通过**

Run: `JAVA_HOME= npx tsc --noEmit && JAVA_HOME= npx vitest run`
Expected: tsc 干净，全量测试通过

- [ ] **Step 3: 标记为"无需改动"**

此任务实际上是验证任务，现有代码已满足需求，无需提交。

---

## Self-Review

**Spec coverage：**
- discoverPackages 解析 marketplace.json → Task 1 ✅
- IndexedPackage 加 sourceUrl → Task 2 ✅
- UI 禁用引用型包导入 → Task 3 ✅
- API 拒绝引用型包 → Task 4（现有代码已满足）✅

**测试覆盖：**
- marketplace.json 引用解析（纯引用、混合本地+引用）→ Task 1 ✅
- buildIndex 传播 sourceUrl → Task 2 ✅
- UI 手动验证 → Task 3 Step 5 ✅

**类型一致性：** `DiscoveredPackage.root` 从 `string` 改为 `string | null`；`sourceUrl?` 新增字段；`IndexedPackage.sourceUrl?` 对应。

**向后兼容：** 现有本地包的 `root` 仍是字符串，`sourceUrl` 为 `undefined`；新增引用型包不影响既有逻辑。

**说明：** Task 4 简化为验证现有 API 已能拒绝引用型包（返回 404），无需改动。
