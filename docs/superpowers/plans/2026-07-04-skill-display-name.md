# 技能展示名称 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 上传技能时新增可选的"展示名称"（`displayName`），与用作目录名/URL 的技术 `name` 分离，UI 展示统一优先用 `displayName`。

**Architecture:** 在 `PluginEntry` 上加一个可选字段 `displayName`，`ingest()` 接收并写入 manifest；上传表单新增对应输入框；列表卡片、搜索、详情页标题都改为 `entry.displayName || entry.name` 的 fallback 读取方式。

**Tech Stack:** Next.js (App Router) + TypeScript，vitest 做单元测试，无组件测试框架（本仓库对 React 组件/路由无现成测试，保持一致不新增）。

## Global Constraints

- `displayName` 留空时不写入 manifest（`undefined`），所有展示处按 `entry.displayName || entry.name` 兜底。
- `ingest()` 每次上传（含覆盖）都用本次传入值重建整条 manifest 条目，不读取/合并旧条目的 `displayName`——覆盖上传若本次未填，旧展示名称会被清空。这是已确认的预期行为，不是 bug。
- 不新增测试框架/组件测试基建；`route.ts`、`UploadForm.tsx`、`SkillGrid.tsx`、`page.tsx` 的改动用 `npx tsc --noEmit` 类型检查 + 手动跑 dev server 验证，与本仓库现状一致。

---

### Task 1: 数据模型 + ingest 写入 displayName

**Files:**
- Modify: `src/lib/marketplace.ts:6-12` (PluginEntry interface)
- Modify: `src/lib/ingest.ts:48` (ingest 签名), `src/lib/ingest.ts:127-133` (writeManifestEntry 调用)
- Test: `tests/ingest.test.ts`

**Interfaces:**
- Produces: `PluginEntry.displayName?: string`；`ingest(repoDir, extractedDir, opts?: { name?, overwrite?, version?, description?, displayName? }): IngestResult`（`IngestResult` 不变）

- [ ] **Step 1: 写失败的测试**

在 `tests/ingest.test.ts` 末尾（第 202 行 `})` 之后）追加：

```ts
test('displayName opt is stored in manifest when provided', () => {
  const repo = seedRepo()
  const src = tmp()
  const sk = path.join(src, 'my-skill')
  fs.mkdirSync(sk, { recursive: true })
  fs.writeFileSync(path.join(sk, 'SKILL.md'), '---\nname: my-skill\ndescription: d\n---\nbody')

  ingest(repo, src, { displayName: '我的技能' })

  expect(readMarketplace(repo).plugins[0].displayName).toBe('我的技能')
})

test('empty/absent displayName opt leaves field unset', () => {
  const repo = seedRepo()
  const src = tmp()
  const sk = path.join(src, 'my-skill')
  fs.mkdirSync(sk, { recursive: true })
  fs.writeFileSync(path.join(sk, 'SKILL.md'), '---\nname: my-skill\ndescription: d\n---\nbody')

  ingest(repo, src)

  expect(readMarketplace(repo).plugins[0].displayName).toBeUndefined()
})

test('overwrite without displayName clears previous displayName', () => {
  const repo = seedRepo()
  const mk = () => {
    const src = tmp()
    const sk = path.join(src, 'dup')
    fs.mkdirSync(sk, { recursive: true })
    fs.writeFileSync(path.join(sk, 'SKILL.md'), '---\nname: dup\ndescription: d\n---\nbody')
    return src
  }
  ingest(repo, mk(), { displayName: '旧展示名' })
  ingest(repo, mk(), { overwrite: true }) // 覆盖上传，本次不传 displayName

  expect(readMarketplace(repo).plugins[0].displayName).toBeUndefined()
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- tests/ingest.test.ts`
Expected: 新增的 3 个用例中至少前两个 FAIL（`displayName` 属性目前不存在于 `PluginEntry`/`ingest` 逻辑，TS 编译会报错或断言失败）。

- [ ] **Step 3: 实现最小改动**

`src/lib/marketplace.ts:6-12`，把：

```ts
export interface PluginEntry {
  name: string
  source: string
  description?: string
  tags?: string[]
  version?: string
}
```

改为：

```ts
export interface PluginEntry {
  name: string
  source: string
  description?: string
  tags?: string[]
  version?: string
  displayName?: string
}
```

`src/lib/ingest.ts:48`，把：

```ts
export function ingest(repoDir: string, extractedDir: string, opts?: { name?: string; overwrite?: boolean; version?: string; description?: string }): IngestResult {
```

改为：

```ts
export function ingest(repoDir: string, extractedDir: string, opts?: { name?: string; overwrite?: boolean; version?: string; description?: string; displayName?: string }): IngestResult {
```

`src/lib/ingest.ts:127-133`，把：

```ts
  writeManifestEntry(repoDir, {
    name,
    source: `./plugins/${name}`,
    description,
    tags,
    version,
  })
```

改为：

```ts
  writeManifestEntry(repoDir, {
    name,
    source: `./plugins/${name}`,
    description,
    tags,
    version,
    displayName: opts?.displayName?.trim() || undefined,
  })
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- tests/ingest.test.ts`
Expected: 全部 PASS（含原有用例）。

- [ ] **Step 5: 提交**

```bash
git add src/lib/marketplace.ts src/lib/ingest.ts tests/ingest.test.ts
git commit -m "feat: ingest 支持写入技能展示名称 displayName"
```

---

### Task 2: 上传接口透传 displayName

**Files:**
- Modify: `src/app/api/skills/route.ts:16-34`

**Interfaces:**
- Consumes: `ingest(repoDir, extractedDir, opts?: { ...; displayName?: string })`（Task 1 产出）

- [ ] **Step 1: 修改 route.ts**

`src/app/api/skills/route.ts:16-20`，把：

```ts
  const file = form.get('file')
  const nameOverride = form.get('name')
  const overwrite = form.get('overwrite') === 'true'
  const version = form.get('version')
  const description = form.get('description')
```

改为：

```ts
  const file = form.get('file')
  const nameOverride = form.get('name')
  const overwrite = form.get('overwrite') === 'true'
  const version = form.get('version')
  const description = form.get('description')
  const displayName = form.get('displayName')
```

`src/app/api/skills/route.ts:29-34`，把：

```ts
    const res = ingest(REPO_DIR, tmp, {
      name: nameOverride ? String(nameOverride) : undefined,
      overwrite,
      version: version ? String(version).trim() : undefined,
      description: description ? String(description) : undefined,
    })
```

改为：

```ts
    const res = ingest(REPO_DIR, tmp, {
      name: nameOverride ? String(nameOverride) : undefined,
      overwrite,
      version: version ? String(version).trim() : undefined,
      description: description ? String(description) : undefined,
      displayName: displayName ? String(displayName).trim() : undefined,
    })
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无报错。

- [ ] **Step 3: 提交**

```bash
git add src/app/api/skills/route.ts
git commit -m "feat: 上传接口透传展示名称"
```

---

### Task 3: 上传表单新增展示名称输入框

**Files:**
- Modify: `src/app/_components/UploadForm.tsx:14-22` (state), `src/app/_components/UploadForm.tsx:58-69` (submit), `src/app/_components/UploadForm.tsx:179-192` (JSX)

**Interfaces:**
- Consumes: `POST /api/skills` 的 formData 新增可选字段 `displayName`（Task 2 产出）

- [ ] **Step 1: 新增 state**

`src/app/_components/UploadForm.tsx:14-18`，把：

```tsx
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [version, setVersion] = useState('')
  const [description, setDescription] = useState('')
  const [uploading, setUploading] = useState(false)
```

改为：

```tsx
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [version, setVersion] = useState('')
  const [description, setDescription] = useState('')
  const [uploading, setUploading] = useState(false)
```

- [ ] **Step 2: submit 时带上 displayName**

`src/app/_components/UploadForm.tsx:64-68`，把：

```tsx
      const formData = new FormData()
      formData.append('file', file)
      if (name.trim()) formData.append('name', name.trim())
      if (version.trim()) formData.append('version', version.trim())
      if (description.trim()) formData.append('description', description.trim())
```

改为：

```tsx
      const formData = new FormData()
      formData.append('file', file)
      if (name.trim()) formData.append('name', name.trim())
      if (displayName.trim()) formData.append('displayName', displayName.trim())
      if (version.trim()) formData.append('version', version.trim())
      if (description.trim()) formData.append('description', description.trim())
```

- [ ] **Step 3: 新增输入框 + 给已有"技能名称"字段改名，避免和新字段混淆**

`src/app/_components/UploadForm.tsx:179-192`，把：

```tsx
            {/* Name Input */}
            <div className="space-y-2">
              <label htmlFor="skill-name" className="block text-sm font-medium text-zinc-300">
                技能名称 <span className="text-zinc-600">(可选)</span>
              </label>
              <input
                id="skill-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="留空则使用文件名"
                className="w-full px-4 py-3 bg-zinc-900/50 border border-zinc-800 rounded-lg text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/20 transition-all duration-300"
              />
            </div>
```

改为：

```tsx
            {/* Display Name Input */}
            <div className="space-y-2">
              <label htmlFor="skill-display-name" className="block text-sm font-medium text-zinc-300">
                展示名称 <span className="text-zinc-600">(可选)</span>
              </label>
              <input
                id="skill-display-name"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="留空则使用技能标识"
                className="w-full px-4 py-3 bg-zinc-900/50 border border-zinc-800 rounded-lg text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/20 transition-all duration-300"
              />
            </div>

            {/* Name Input */}
            <div className="space-y-2">
              <label htmlFor="skill-name" className="block text-sm font-medium text-zinc-300">
                技能标识 <span className="text-zinc-600">(可选)</span>
              </label>
              <input
                id="skill-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="留空则使用文件名（用于目录名/URL）"
                className="w-full px-4 py-3 bg-zinc-900/50 border border-zinc-800 rounded-lg text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/20 transition-all duration-300"
              />
            </div>
```

- [ ] **Step 4: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无报错。

- [ ] **Step 5: 手动验证**

Run: `npm run dev`，打开首页，点击"上传技能"，确认表单里"展示名称"在"技能标识"上方、两个字段都能正常输入且互不影响；提交一个 zip 包并填写展示名称，上传成功。

- [ ] **Step 6: 提交**

```bash
git add src/app/_components/UploadForm.tsx
git commit -m "feat: 上传表单新增展示名称输入框"
```

---

### Task 4: 列表卡片标题与搜索使用展示名称

**Files:**
- Modify: `src/app/_components/SkillGrid.tsx:31-37` (搜索过滤), `src/app/_components/SkillGrid.tsx:132-135` (卡片标题)

**Interfaces:**
- Consumes: `PluginEntry.displayName?: string`（Task 1 产出）

- [ ] **Step 1: 搜索过滤同时匹配 displayName**

`src/app/_components/SkillGrid.tsx:31-37`，把：

```tsx
    if (search.trim()) {
      const term = search.toLowerCase()
      result = result.filter(p =>
        p.name.toLowerCase().includes(term) ||
        p.description?.toLowerCase().includes(term)
      )
    }
```

改为：

```tsx
    if (search.trim()) {
      const term = search.toLowerCase()
      result = result.filter(p =>
        p.name.toLowerCase().includes(term) ||
        p.displayName?.toLowerCase().includes(term) ||
        p.description?.toLowerCase().includes(term)
      )
    }
```

- [ ] **Step 2: 卡片标题优先展示 displayName**

`src/app/_components/SkillGrid.tsx:132-135`，把：

```tsx
                      <h3 className="text-xl font-bold text-zinc-100 group-hover:text-cyan-400 transition-colors duration-300 line-clamp-1">
                        {plugin.name}
                      </h3>
```

改为：

```tsx
                      <h3 className="text-xl font-bold text-zinc-100 group-hover:text-cyan-400 transition-colors duration-300 line-clamp-1">
                        {plugin.displayName || plugin.name}
                      </h3>
```

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无报错。

- [ ] **Step 4: 手动验证**

Run: `npm run dev`，上传一个带展示名称的技能，确认首页卡片标题显示的是展示名称而不是技能标识；用展示名称的关键字搜索能搜到该卡片。

- [ ] **Step 5: 提交**

```bash
git add src/app/_components/SkillGrid.tsx
git commit -m "feat: 技能列表卡片标题与搜索支持展示名称"
```

---

### Task 5: 详情页标题与页面 title 使用展示名称

**Files:**
- Modify: `src/app/skills/[name]/page.tsx:21-24` (generateMetadata), `src/app/skills/[name]/page.tsx:63-65` (H1)

**Interfaces:**
- Consumes: `getPluginDetail(repoDir, name): PluginDetail | null`（含 `entry.displayName?: string`，Task 1 产出）

- [ ] **Step 1: generateMetadata 使用展示名称**

`src/app/skills/[name]/page.tsx:21-24`，把：

```tsx
export async function generateMetadata({ params }: PageProps) {
  const { name } = await params
  return { title: `${name} - Skill Hub` }
}
```

改为：

```tsx
export async function generateMetadata({ params }: PageProps) {
  const { name } = await params
  const detail = getPluginDetail(REPO_DIR, name)
  const title = detail?.entry.displayName || name
  return { title: `${title} - Skill Hub` }
}
```

- [ ] **Step 2: 详情页 H1 使用展示名称**

`src/app/skills/[name]/page.tsx:63-65`，把：

```tsx
                <h1 className="text-4xl md:text-5xl font-bold text-zinc-100 leading-tight">
                  {detail.entry.name}
                </h1>
```

改为：

```tsx
                <h1 className="text-4xl md:text-5xl font-bold text-zinc-100 leading-tight">
                  {detail.entry.displayName || detail.entry.name}
                </h1>
```

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无报错。

- [ ] **Step 4: 手动验证**

Run: `npm run dev`，打开一个带展示名称的技能详情页，确认页面标题（浏览器 tab）和正文 H1 都显示展示名称；打开一个没有展示名称的老技能详情页，确认回退显示技能标识（`entry.name`），不报错。

- [ ] **Step 5: 提交**

```bash
git add src/app/skills/[name]/page.tsx
git commit -m "feat: 技能详情页标题支持展示名称"
```
