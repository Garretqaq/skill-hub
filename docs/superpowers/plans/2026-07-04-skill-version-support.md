# 技能/插件版本号支持 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让上传技能/插件时可手填版本号，覆盖上传即更新版本（防降级），版本写进 plugin.json 供 Claude 读取，并在列表/详情页展示。

**Architecture:** version 以 `plugins/<name>/.claude-plugin/plugin.json` 的 `version` 为 canonical（Claude Code 原生读取处），并镜像进 `marketplace.json` 的 entry 供 UI 直接展示。上传表单加版本号输入框，透传到 `ingest()`，由其做 semver 校验、留空自增/默认、防降级判断，最终同时写入 plugin.json 与 manifest entry。

**Tech Stack:** Next.js（本项目定制版）、TypeScript、vitest、gray-matter、adm-zip。

## Global Constraints

- 新建 `.ts` 文件头加注释 `/** @author sgz @since 2026-07-04 */`（沿用现有文件风格）。
- 版本只支持三段数字 `x.y.z`（正则 `^\d+\.\d+\.\d+$`）；不支持 pre-release/build 元数据（YAGNI）。
- 不引入新依赖；semver 逻辑手写。
- 不保留历史版本；覆盖上传即更新当前版本。
- 遇到写文件的目录用 `fs.mkdirSync(..., { recursive: true })`，沿用现有 ingest 风格。
- 测试用 vitest，路径别名 `@/` 指向 `src/`。

---

### Task 1: semver 小工具

**Files:**
- Create: `src/lib/semver.ts`
- Test: `tests/semver.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `isValidVersion(v: string): boolean`
  - `bumpPatch(v: string): string` —— 输入须为合法版本，返回 patch+1
  - `compareVersions(a: string, b: string): -1 | 0 | 1` —— 逐段数值比较，须为合法版本

- [ ] **Step 1: Write the failing test**

`tests/semver.test.ts`:

```typescript
import { expect, test } from 'vitest'
import { isValidVersion, bumpPatch, compareVersions } from '@/lib/semver'

test('isValidVersion accepts x.y.z only', () => {
  expect(isValidVersion('1.0.0')).toBe(true)
  expect(isValidVersion('10.20.30')).toBe(true)
  expect(isValidVersion('1.0')).toBe(false)
  expect(isValidVersion('1.0.0-beta')).toBe(false)
  expect(isValidVersion('v1.0.0')).toBe(false)
  expect(isValidVersion('')).toBe(false)
})

test('bumpPatch increments last segment', () => {
  expect(bumpPatch('1.0.0')).toBe('1.0.1')
  expect(bumpPatch('2.3.9')).toBe('2.3.10')
})

test('compareVersions compares numerically per segment', () => {
  expect(compareVersions('1.0.0', '1.0.1')).toBe(-1)
  expect(compareVersions('1.0.1', '1.0.0')).toBe(1)
  expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
  expect(compareVersions('1.2.0', '1.10.0')).toBe(-1) // 数值比较而非字符串
  expect(compareVersions('2.0.0', '1.9.9')).toBe(1)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/semver.test.ts`
Expected: FAIL —— `@/lib/semver` 模块不存在 / 函数未定义。

- [ ] **Step 3: Write minimal implementation**

`src/lib/semver.ts`:

```typescript
/** @author sgz @since 2026-07-04 */
const RE = /^\d+\.\d+\.\d+$/

export function isValidVersion(v: string): boolean {
  return RE.test(v)
}

function parse(v: string): [number, number, number] {
  const [a, b, c] = v.split('.').map(Number)
  return [a, b, c]
}

export function bumpPatch(v: string): string {
  const [a, b, c] = parse(v)
  return `${a}.${b}.${c + 1}`
}

export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = parse(a), pb = parse(b)
  for (let i = 0; i < 3; i++) {
    if (pa[i] < pb[i]) return -1
    if (pa[i] > pb[i]) return 1
  }
  return 0
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/semver.test.ts`
Expected: PASS（3 个 test 全绿）。

- [ ] **Step 5: Commit**

```bash
git add src/lib/semver.ts tests/semver.test.ts
git commit -m "feat: semver 小工具（校验/patch自增/比较）"
```

---

### Task 2: marketplace `PluginEntry` 增加 version 字段

**Files:**
- Modify: `src/lib/marketplace.ts:6-11`（`PluginEntry` 接口）
- Test: `tests/marketplace.test.ts`（追加一条）

**Interfaces:**
- Consumes: 无
- Produces: `PluginEntry` 新增可选字段 `version?: string`；`writeManifestEntry`（在 ingest.ts）写入的 entry 若含 version 则被 `readMarketplace` 原样读回（无需改 read 逻辑，JSON 透传）。

- [ ] **Step 1: Write the failing test**

在 `tests/marketplace.test.ts` 末尾追加：

```typescript
test('PluginEntry carries version through read/write', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-mkt-'))
  fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true })
  fs.writeFileSync(
    path.join(dir, '.claude-plugin', 'marketplace.json'),
    JSON.stringify({
      name: 'm', owner: { name: 'sgz' },
      plugins: [{ name: 'x', source: './plugins/x', version: '1.2.3' }],
    }),
  )
  const m = readMarketplace(dir)
  expect(m.plugins[0].version).toBe('1.2.3')
})
```

> 注意：确认 `tests/marketplace.test.ts` 顶部已 import `fs`/`os`/`path`/`readMarketplace`。若缺 import 则补上：
> `import fs from 'node:fs'` / `import os from 'node:os'` / `import path from 'node:path'` / `import { readMarketplace } from '@/lib/marketplace'`。

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/marketplace.test.ts`
Expected: FAIL —— TypeScript 报 `version` 不存在于 `PluginEntry`，或断言失败（`version` 为 `undefined`，取决于编译）。

- [ ] **Step 3: Write minimal implementation**

`src/lib/marketplace.ts`，在 `PluginEntry` 接口加字段：

```typescript
export interface PluginEntry {
  name: string
  source: string
  description?: string
  tags?: string[]
  version?: string
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/marketplace.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/marketplace.ts tests/marketplace.test.ts
git commit -m "feat: PluginEntry 增加 version 字段"
```

---

### Task 3: ingest 支持 version（校验/默认/自增/防降级 + 写两处）

**Files:**
- Modify: `src/lib/ingest.ts`
- Test: `tests/ingest.test.ts`（追加多条）

**Interfaces:**
- Consumes:
  - `isValidVersion`, `bumpPatch`, `compareVersions`（Task 1）
  - `PluginEntry.version`（Task 2）
- Produces:
  - `ingest(repoDir, extractedDir, opts?)` 的 `opts` 增加 `version?: string`。
  - 版本决议规则：
    - 新技能：`opts.version || 包自带 version || '1.0.0'`
    - 覆盖：`opts.version || bumpPatch(当前版本)`；当前版本读自现有 `plugins/<name>/.claude-plugin/plugin.json` 的 `version`（缺失则视为 `'1.0.0'`）。
    - `opts.version` 非法 semver → `throw new Error('invalid version: ...')`。
    - 覆盖且最终版本 `compareVersions(new, current) <= 0` → `throw new Error('version must be higher than current: ...')`。
  - 最终 version 写入 `plugins/<name>/.claude-plugin/plugin.json` 的 `version` 字段，并放入 manifest entry 的 `version`。

- [ ] **Step 1: Write the failing tests**

在 `tests/ingest.test.ts` 顶部 import 追加：

```typescript
import { bumpPatch } from '@/lib/semver' // 若测试里未直接用可省略；此处仅示意，可不加
```

（实际下面测试不依赖 semver import，可不加该行。）在文件末尾追加：

```typescript
function pkgVersion(repo: string, name: string): string {
  const pj = JSON.parse(
    fs.readFileSync(path.join(repo, `plugins/${name}/.claude-plugin/plugin.json`), 'utf8'),
  )
  return pj.version
}
function mkSkill(name: string, body: string, version?: string): string {
  const src = tmp()
  const sk = path.join(src, name)
  fs.mkdirSync(sk, { recursive: true })
  const vLine = version ? `version: ${version}\n` : ''
  fs.writeFileSync(path.join(sk, 'SKILL.md'), `---\nname: ${name}\ndescription: d\n${vLine}---\n${body}`)
  return src
}

test('new bare skill without version defaults to 1.0.0', () => {
  const repo = seedRepo()
  ingest(repo, mkSkill('a', 'v1'))
  expect(pkgVersion(repo, 'a')).toBe('1.0.0')
  expect(readMarketplace(repo).plugins.find(p => p.name === 'a')?.version).toBe('1.0.0')
})

test('new skill uses form version when provided', () => {
  const repo = seedRepo()
  ingest(repo, mkSkill('a', 'v1'), { version: '2.5.0' })
  expect(pkgVersion(repo, 'a')).toBe('2.5.0')
  expect(readMarketplace(repo).plugins.find(p => p.name === 'a')?.version).toBe('2.5.0')
})

test('overwrite with empty version bumps patch', () => {
  const repo = seedRepo()
  ingest(repo, mkSkill('a', 'v1')) // 1.0.0
  ingest(repo, mkSkill('a', 'v2'), { overwrite: true })
  expect(pkgVersion(repo, 'a')).toBe('1.0.1')
})

test('overwrite with higher form version uses it', () => {
  const repo = seedRepo()
  ingest(repo, mkSkill('a', 'v1')) // 1.0.0
  ingest(repo, mkSkill('a', 'v2'), { overwrite: true, version: '1.4.0' })
  expect(pkgVersion(repo, 'a')).toBe('1.4.0')
})

test('overwrite rejects non-increasing version', () => {
  const repo = seedRepo()
  ingest(repo, mkSkill('a', 'v1'), { version: '2.0.0' })
  expect(() => ingest(repo, mkSkill('a', 'v2'), { overwrite: true, version: '2.0.0' }))
    .toThrow(/higher than current/)
  expect(() => ingest(repo, mkSkill('a', 'v2'), { overwrite: true, version: '1.0.0' }))
    .toThrow(/higher than current/)
})

test('invalid version string throws', () => {
  const repo = seedRepo()
  expect(() => ingest(repo, mkSkill('a', 'v1'), { version: 'abc' })).toThrow(/invalid version/)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/ingest.test.ts`
Expected: 新增 6 条 FAIL（version 未写入 / 无校验 / 无防降级）。已有 5 条应仍 PASS。

- [ ] **Step 3: Write minimal implementation**

修改 `src/lib/ingest.ts`：

3a. 顶部 import：

```typescript
import { isValidVersion, bumpPatch, compareVersions } from './semver'
```

3b. 在 `found.kind` 分支内解析出 `pkgVersion`（包自带版本）。把现有解析块改为同时取 version：

```typescript
  let name: string
  let description = ''
  let tags: string[] = []
  let pkgVersion = ''

  if (found.kind === 'plugin') {
    const pj = JSON.parse(fs.readFileSync(path.join(found.root, '.claude-plugin/plugin.json'), 'utf8'))
    name = toKebab(opts?.name || pj.name || path.basename(found.root))
    description = pj.description || ''
    tags = pj.tags || pj.keywords || []
    pkgVersion = typeof pj.version === 'string' ? pj.version : ''
  } else {
    const fm = matter(fs.readFileSync(path.join(found.root, 'SKILL.md'), 'utf8')).data
    name = toKebab(opts?.name || fm.name || path.basename(found.root))
    description = fm.description || ''
    tags = fm.tags || []
    pkgVersion = typeof fm.version === 'string' ? fm.version : ''
  }
  if (!name) throw new Error('unrecognized package: empty name')

  if (opts?.version && !isValidVersion(opts.version)) {
    throw new Error(`invalid version: ${opts.version}`)
  }
```

3c. 在 `const dest = ...` 之后、删除旧目录之前，读出当前版本并决议最终版本。把现有的 dest/overwrite 块替换为：

```typescript
  const dest = path.join(repoDir, 'plugins', name)
  const existed = fs.existsSync(dest)

  // 覆盖时读现有插件版本，用于自增与防降级
  let currentVersion = ''
  if (existed) {
    const curPjPath = path.join(dest, '.claude-plugin', 'plugin.json')
    if (fs.existsSync(curPjPath)) {
      const curPj = JSON.parse(fs.readFileSync(curPjPath, 'utf8'))
      currentVersion = typeof curPj.version === 'string' ? curPj.version : ''
    }
  }

  // 版本决议
  let version: string
  if (existed) {
    const base = currentVersion && isValidVersion(currentVersion) ? currentVersion : '1.0.0'
    version = opts?.version || bumpPatch(base)
    if (compareVersions(version, base) <= 0) {
      throw new Error(`version must be higher than current: ${version} <= ${base}`)
    }
  } else {
    const fromPkg = pkgVersion && isValidVersion(pkgVersion) ? pkgVersion : ''
    version = opts?.version || fromPkg || '1.0.0'
  }

  if (existed) {
    if (!opts?.overwrite) throw new Error(`name exists: ${name}`)
    fs.rmSync(dest, { recursive: true, force: true }) // 覆盖：先删旧目录，manifest 条目由下方替换
  }
```

> 说明：把原来 `if (fs.existsSync(dest))` 的 overwrite/throw 判断挪到版本决议之后，因为决议需要先读旧 plugin.json。`existed` 已缓存存在性；删除动作仅在 `opts.overwrite` 为真时执行。非覆盖且已存在时先做版本决议再抛 `name exists` —— 这不改变对外行为（仍抛 `name exists`），因为版本决议在 `existed` 分支不依赖被删的目录。

3d. 写 plugin.json 时带上决议后的 version。裸 skill 分支：

```typescript
  if (found.kind === 'plugin') {
    copyDir(found.root, dest)
    // 用决议后的 version 覆盖插件自带 plugin.json 的 version
    const pjPath = path.join(dest, '.claude-plugin', 'plugin.json')
    const pj = JSON.parse(fs.readFileSync(pjPath, 'utf8'))
    pj.version = version
    fs.writeFileSync(pjPath, JSON.stringify(pj, null, 2) + '\n')
  } else {
    // 裸 skill：包壳成 plugins/<name>/skills/<name>/ + plugin.json
    const skillDir = path.join(dest, 'skills', name)
    copyDir(found.root, skillDir)
    fs.mkdirSync(path.join(dest, '.claude-plugin'), { recursive: true })
    fs.writeFileSync(
      path.join(dest, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name, description, version }, null, 2) + '\n',
    )
  }
```

3e. manifest entry 带 version：

```typescript
  writeManifestEntry(repoDir, {
    name,
    source: `./plugins/${name}`,
    description,
    tags,
    version,
  })
```

3f. 更新 `opts` 类型签名：

```typescript
export function ingest(repoDir: string, extractedDir: string, opts?: { name?: string; overwrite?: boolean; version?: string }): IngestResult {
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/ingest.test.ts`
Expected: 全部 PASS（原 5 条 + 新 6 条）。特别确认原 `overwrite replaces existing plugin` 仍绿（现在会写 version=1.0.1，不影响其 SKILL.md 断言）。

- [ ] **Step 5: Run full suite**

Run: `npx vitest run`
Expected: 所有测试 PASS。

- [ ] **Step 6: Commit**

```bash
git add src/lib/ingest.ts tests/ingest.test.ts
git commit -m "feat: ingest 支持版本号（校验/默认/自增/防降级）"
```

---

### Task 4: API route 透传 version

**Files:**
- Modify: `src/app/api/skills/route.ts:17-28`

**Interfaces:**
- Consumes: `ingest(..., { ..., version })`（Task 3）
- Produces: 上传接口读取 form 字段 `version`（可选），透传给 `ingest`。

> 无独立单测（route 依赖 next/adm-zip，本项目未建 route 层测试）。集成靠 Task 3 的 ingest 单测 + 手工验证覆盖。

- [ ] **Step 1: 读取并透传 version 字段**

在 `src/app/api/skills/route.ts` 的 form 解析处加一行，并透传：

```typescript
  const form = await req.formData()
  const file = form.get('file')
  const nameOverride = form.get('name')
  const overwrite = form.get('overwrite') === 'true'
  const version = form.get('version')
  if (!(file instanceof File)) return NextResponse.json({ error: 'file required' }, { status: 400 })
```

并把 ingest 调用改为：

```typescript
    const res = ingest(REPO_DIR, tmp, {
      name: nameOverride ? String(nameOverride) : undefined,
      overwrite,
      version: version ? String(version).trim() : undefined,
    })
```

- [ ] **Step 2: 类型检查通过**

Run: `npx tsc --noEmit`
Expected: 无报错（version 为 `string | undefined`，符合 Task 3 的 opts 类型）。

- [ ] **Step 3: Commit**

```bash
git add src/app/api/skills/route.ts
git commit -m "feat: 上传接口透传 version 字段"
```

---

### Task 5: 上传表单加版本号输入框

**Files:**
- Modify: `src/app/_components/UploadForm.tsx`

**Interfaces:**
- Consumes: `POST /api/skills` 的 `version` 字段（Task 4）
- Produces: 表单新增可选"版本号"输入，提交时以 `version` 加入 FormData。

- [ ] **Step 1: 加 version state**

在 `UploadForm` 顶部 state 区（`const [overwrite, ...]` 附近）加：

```typescript
  const [version, setVersion] = useState('')
```

- [ ] **Step 2: 提交时带上 version**

在 `handleSubmit` 的 FormData 组装处（`if (overwrite) ...` 附近）加：

```typescript
      if (name.trim()) formData.append('name', name.trim())
      if (version.trim()) formData.append('version', version.trim())
      if (overwrite) formData.append('overwrite', 'true')
```

- [ ] **Step 3: 加输入框 UI**

在"技能名称"输入块（`{/* Name Input */}` 那个 `div` 结束标签 `</div>` 之后）插入版本号输入块，复用同款 class：

```tsx
            {/* Version Input */}
            <div className="space-y-2">
              <label htmlFor="skill-version" className="block text-sm font-medium text-zinc-300">
                版本号 <span className="text-zinc-600">(可选，如 1.0.0)</span>
              </label>
              <input
                id="skill-version"
                type="text"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                placeholder="留空：新技能默认 1.0.0，覆盖则自动 +1"
                className="w-full px-4 py-3 bg-zinc-900/50 border border-zinc-800 rounded-lg text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/20 transition-all duration-300"
              />
            </div>
```

- [ ] **Step 4: 类型检查 + 构建冒烟**

Run: `npx tsc --noEmit`
Expected: 无报错。

- [ ] **Step 5: Commit**

```bash
git add src/app/_components/UploadForm.tsx
git commit -m "feat: 上传表单新增版本号输入框"
```

---

### Task 6: 列表卡片 + 详情页展示版本徽章

**Files:**
- Modify: `src/app/_components/SkillGrid.tsx`（列表卡片，Header 区）
- Modify: `src/app/skills/[name]/page.tsx`（详情页 Header 区）

**Interfaces:**
- Consumes: `PluginEntry.version`（Task 2）
- Produces: version 存在时在卡片标题旁 / 详情页 name 旁显示 `v<version>` 徽章；缺失则不渲染。

- [ ] **Step 1: 列表卡片加徽章**

`src/app/_components/SkillGrid.tsx`，把标题行 `<h3>...</h3>` 与其后的箭头 svg 之间的结构改为：标题 + 版本徽章 一组，箭头保持右侧。将现有 Header 块改为：

```tsx
                  {/* Header */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <h3 className="text-xl font-bold text-zinc-100 group-hover:text-cyan-400 transition-colors duration-300 line-clamp-1">
                        {plugin.name}
                      </h3>
                      {plugin.version && (
                        <span className="flex-shrink-0 px-2 py-0.5 text-xs font-mono font-medium bg-fuchsia-500/10 text-fuchsia-400 border border-fuchsia-500/30 rounded">
                          v{plugin.version}
                        </span>
                      )}
                    </div>
                    <svg className="w-5 h-5 text-zinc-600 group-hover:text-cyan-400 group-hover:translate-x-1 group-hover:-translate-y-1 transition-all duration-300 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                    </svg>
                  </div>
```

- [ ] **Step 2: 详情页加徽章**

`src/app/skills/[name]/page.tsx`，把标题 `<h1>` 块改为标题 + 版本徽章一行。将现有：

```tsx
              <h1 className="text-4xl md:text-5xl font-bold text-zinc-100 leading-tight">
                {detail.entry.name}
              </h1>
```

改为：

```tsx
              <div className="flex items-center gap-4 flex-wrap">
                <h1 className="text-4xl md:text-5xl font-bold text-zinc-100 leading-tight">
                  {detail.entry.name}
                </h1>
                {detail.entry.version && (
                  <span className="px-3 py-1 text-sm font-mono font-medium bg-fuchsia-500/10 text-fuchsia-400 border border-fuchsia-500/30 rounded-lg">
                    v{detail.entry.version}
                  </span>
                )}
              </div>
```

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无报错。

- [ ] **Step 4: 手工冒烟（可选，需 dev server）**

Run: `npm run dev`，浏览器打开首页与某技能详情页，确认已带 version 的条目显示 `v1.0.0` 徽章，无 version 的老条目不显示徽章、页面不报错。

> 现有 `data/marketplace` 里的条目无 version 字段，属正常，徽章不显示即符合预期。要看到徽章可上传一个新技能或覆盖上传一次。

- [ ] **Step 5: Commit**

```bash
git add src/app/_components/SkillGrid.tsx src/app/skills/[name]/page.tsx
git commit -m "feat: 列表与详情页展示版本徽章"
```

---

## Self-Review

**Spec coverage：**
- 版本来源=表单手填 → Task 4/5（form 字段 + 输入框）✅
- 只跟当前版本、覆盖即更新 → Task 3 覆盖分支 ✅
- canonical 写 plugin.json、镜像 manifest entry → Task 3 (3d/3e) + Task 2 ✅
- Claude 能读 → plugin.json version 保持准确（Task 3），消费端零改动 ✅
- 留空默认 1.0.0 / 覆盖自增 → Task 3 版本决议 ✅
- semver 校验 + 防降级守卫 → Task 1 + Task 3 ✅
- 列表 + 详情徽章 → Task 6 ✅
- 测试覆盖 → Task 1/2/3 各带单测 ✅
- 非目标（历史版本/完整 semver）未实现 ✅

**Placeholder scan：** 无 TBD/TODO；所有代码步骤含完整代码。Task 3 Step1 里那行示意 import 已注明"可不加"，非占位。

**Type consistency：** `isValidVersion`/`bumpPatch`/`compareVersions`（Task 1）在 Task 3 调用签名一致；`PluginEntry.version`（Task 2）在 Task 3/6 使用一致；`ingest` opts `version?: string`（Task 3）与 Task 4 透传类型一致。
