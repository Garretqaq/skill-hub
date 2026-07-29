/** @author sgz @since 2026-07-03 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'
import { readMarketplace, type PluginEntry } from './marketplace'
import { withWorkTree } from './worktree'
import { isValidVersion, bumpPatch, compareVersions } from './semver'

export interface IngestResult { name: string; type: 'plugin' | 'skill' }

// 上游仓库里与插件运行无关、常撑大体积的顶层目录：预览时默认不勾选
const EXCLUDE_HINTS = new Set(['node_modules', '.github', 'site', 'docs', 'tests', 'test', 'examples', 'fixtures', '.next', 'dist'])
// 包的身份文件，永远导入
const KEEP_ALWAYS = new Set(['.claude-plugin', 'SKILL.md'])

export function toKebab(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

// 无版本包的内容指纹：递归遍历包目录，按 relpath 排序后折进 sha256（relpath + NUL + 字节）。
// 不套 exclude——哈希原始全量文件，使导入时的 sourceHash 与远程 discoverPackages 的 contentHash
// 输入一致、可比（见 docs/superpowers/specs 内的设计文档）。跳过 .git，避免包根即仓库根时结果不稳定。
export function hashPackageDir(root: string): string {
  const files: string[] = []
  const walk = (dir: string, rel: string): void => {
    for (const name of fs.readdirSync(dir)) {
      if (name === '.git') continue
      const relPath = rel ? `${rel}/${name}` : name
      if (fs.statSync(path.join(dir, name)).isDirectory()) walk(path.join(dir, name), relPath)
      else files.push(relPath)
    }
  }
  walk(root, '')
  files.sort()
  const h = createHash('sha256')
  for (const rel of files) {
    h.update(rel)
    h.update('\0')
    h.update(fs.readFileSync(path.join(root, rel)))
  }
  return h.digest('hex')
}

function dirSize(p: string): number {
  const st = fs.statSync(p)
  if (!st.isDirectory()) return st.size
  return fs.readdirSync(p).reduce((sum, n) => sum + dirSize(path.join(p, n)), 0)
}

export interface PreviewEntry { path: string; dir: boolean; size: number; suggested: boolean }

/** 列出包根顶层条目 + 体积，供导入前勾选。suggested=false 表示命中黑名单，默认不勾。 */
export function previewEntries(root: string): PreviewEntry[] {
  return fs.readdirSync(root)
    .filter(name => name !== '.git')
    .map(name => ({
      path: name,
      dir: fs.statSync(path.join(root, name)).isDirectory(),
      size: dirSize(path.join(root, name)),
      suggested: KEEP_ALWAYS.has(name) || !EXCLUDE_HINTS.has(name),
    }))
    .sort((a, b) => b.size - a.size)
}

// exclude 只在包根第一层生效（top=true），避免递归误伤同名子目录
function copyDir(src: string, dest: string, exclude?: Set<string>): void {
  fs.mkdirSync(dest, { recursive: true })
  for (const name of fs.readdirSync(src)) {
    if (name === '.git') continue // 跳过源克隆的 .git，避免目标成 gitlink
    if (exclude?.has(name) && !KEEP_ALWAYS.has(name)) continue
    const s = path.join(src, name), d = path.join(dest, name)
    if (fs.statSync(s).isDirectory()) copyDir(s, d)
    else fs.copyFileSync(s, d)
  }
}

/** 在 extractedDir 里找"包根"：含 plugin.json 或 SKILL.md 的目录。zip 常带单层外壳，故递归浅找。 */
function findRoot(dir: string): { root: string; kind: 'plugin' | 'skill' } | null {
  const stack = [dir]
  while (stack.length) {
    const cur = stack.shift()!
    if (fs.existsSync(path.join(cur, '.claude-plugin', 'plugin.json')))
      return { root: cur, kind: 'plugin' }
    if (fs.existsSync(path.join(cur, 'SKILL.md'))) return { root: cur, kind: 'skill' }
    for (const name of fs.readdirSync(cur)) {
      const full = path.join(cur, name)
      if (fs.statSync(full).isDirectory()) stack.push(full)
    }
  }
  return null
}

// git show + JSON.parse，失败（路径不存在）返回 null
function gitShowJson(repoDir: string, ref: string): any | null {
  try {
    return JSON.parse(execFileSync('git', ['-C', repoDir, 'show', ref], { stdio: ['ignore', 'pipe', 'pipe'] }).toString())
  } catch {
    return null
  }
}

// 检查 plugins/<name> 是否在 HEAD tree（替代原 fs.existsSync(dest)）
function pluginExistsInHead(repoDir: string, name: string): boolean {
  try {
    const out = execFileSync('git', ['-C', repoDir, 'ls-tree', 'HEAD', '--', `plugins/${name}`], { stdio: ['ignore', 'pipe', 'pipe'] }).toString()
    return out.trim().length > 0
  } catch {
    return false
  }
}

// 在 work-tree 里写 manifest 条目（读当前 HEAD 的 manifest，替换/新增条目，写到 wt）
function writeManifestEntry(repoDir: string, wt: string, entry: PluginEntry): void {
  const m = readMarketplace(repoDir) // 读当前 HEAD
  const idx = m.plugins.findIndex(x => x.name === entry.name)
  if (idx >= 0) m.plugins[idx] = entry // 覆盖：原位替换，保持 manifest 顺序
  else m.plugins.push(entry)
  const p = path.join(wt, '.claude-plugin', 'marketplace.json')
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify(m, null, 2) + '\n')
}

export function ingest(repoDir: string, extractedDir: string, opts?: { name?: string; overwrite?: boolean; version?: string; description?: string; displayName?: string; origin?: string; exclude?: string[] }): IngestResult {
  const found = findRoot(extractedDir)
  if (!found) throw new Error('unrecognized package: no plugin.json or SKILL.md')

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
  if (opts?.description) description = opts.description
  if (!name) throw new Error('unrecognized package: empty name')

  const existed = pluginExistsInHead(repoDir, name)
  if (existed && !opts?.overwrite) throw new Error(`name exists: ${name}`)

  if (opts?.version && !isValidVersion(opts.version)) {
    throw new Error(`invalid version: ${opts.version}`)
  }

  // 覆盖时读现有插件版本（从 HEAD），用于自增与防降级
  let currentVersion = ''
  if (existed) {
    const curPj = gitShowJson(repoDir, `HEAD:plugins/${name}/.claude-plugin/plugin.json`)
    if (curPj) currentVersion = typeof curPj.version === 'string' ? curPj.version : ''
  }

  // 版本决议
  let version: string
  if (existed) {
    const base = currentVersion && isValidVersion(currentVersion) ? currentVersion : '1.0.0'
    const fromPkg = pkgVersion && isValidVersion(pkgVersion) ? pkgVersion : ''
    // 上游版本比当前高就直接采用（监听仓库更新场景，如 2.6.5→2.11.0），否则自增 patch（重复导入同版本）
    version = opts?.version || (fromPkg && compareVersions(fromPkg, base) > 0 ? fromPkg : bumpPatch(base))
    if (compareVersions(version, base) <= 0) {
      throw new Error(`version must be higher than current: ${version} <= ${base}`)
    }
  } else {
    const fromPkg = pkgVersion && isValidVersion(pkgVersion) ? pkgVersion : ''
    version = opts?.version || fromPkg || '1.0.0'
  }

  const finalDescription = description
  const finalVersion = version
  // 覆盖导入时沿用上次的 exclude（若本次未显式提供），更新无需重新勾选
  const prevEntry = existed ? readMarketplace(repoDir).plugins.find(x => x.name === name) : undefined
  const finalExclude = opts?.exclude ?? prevEntry?.exclude
  const exclude = finalExclude?.length ? new Set(finalExclude) : undefined
  withWorkTree(repoDir, wt => {
    const dest = path.join(wt, 'plugins', name)
    if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true }) // 覆盖：删 work-tree 里旧目录

    if (found.kind === 'plugin') {
      copyDir(found.root, dest, exclude)
      const pjPath = path.join(dest, '.claude-plugin', 'plugin.json')
      const pj = JSON.parse(fs.readFileSync(pjPath, 'utf8'))
      pj.version = finalVersion
      pj.description = finalDescription
      fs.writeFileSync(pjPath, JSON.stringify(pj, null, 2) + '\n')
    } else {
      const skillDir = path.join(dest, 'skills', name)
      copyDir(found.root, skillDir, exclude)
      fs.mkdirSync(path.join(dest, '.claude-plugin'), { recursive: true })
      fs.writeFileSync(
        path.join(dest, '.claude-plugin', 'plugin.json'),
        JSON.stringify({ name, description: finalDescription, version: finalVersion }, null, 2) + '\n',
      )
    }

    writeManifestEntry(repoDir, wt, {
      name,
      source: `./plugins/${name}`,
      description: finalDescription,
      tags,
      version: finalVersion,
      displayName: opts?.displayName?.trim() || undefined,
      origin: opts?.origin?.trim() || prevEntry?.origin, // 覆盖导入时保留原 origin
      exclude: finalExclude?.length ? finalExclude : undefined,
      sourceHash: hashPackageDir(found.root), // 无版本包更新检测用；哈希原始源目录
    })
  }, `${opts?.overwrite ? 'update' : 'add'} ${name}`)

  return { name, type: found.kind }
}

export interface FoundRoot { root: string; kind: 'plugin' | 'skill' }

/** findRoot 的「收集全部」版：命中包根即不再下钻，避免插件内嵌 skills 被重复计数 */
export function findRoots(dir: string): FoundRoot[] {
  const out: FoundRoot[] = []
  // ponytail: 前置检查，目录不存在直接返回空（watched.test.ts 可能传不存在的缓存目录）
  if (!fs.existsSync(dir)) return out
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
    // ponytail: try-catch 防止 readdirSync 在目录被删时抛错
    try {
      for (const name of fs.readdirSync(cur)) {
        if (name === '.git') continue
        const full = path.join(cur, name)
        if (fs.statSync(full).isDirectory()) stack.push(full)
      }
    } catch {
      // 目录不存在或无权限，跳过
    }
  }
  return out
}

export interface DiscoveredPackage { name: string; kind: 'plugin' | 'skill'; description: string; root: string | null /** filesystem 模式：绝对路径；git 模式：tree-relative 路径（空串=仓库根）；引用型包：null */; sourceUrl?: string; version?: string; contentHash?: string }

// git-native 包发现：从 git 对象读取，无需工作树。
// root 字段存 tree-relative 路径（空串 = 仓库根），引用型包为 null。
export function discoverPackagesFromGit(repoDir: string): DiscoveredPackage[] {
  let allFiles: string[]
  try {
    const out = execFileSync('git', ['-C', repoDir, 'ls-tree', '-r', '--name-only', 'HEAD'],
      { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim()
    allFiles = out ? out.split('\n') : []
  } catch {
    return [] // 无 HEAD（空仓库）
  }

  // 从文件列表中提取候选包根（treePath + kind）
  const candidates: { treePath: string; kind: 'plugin' | 'skill' }[] = []
  for (const f of allFiles) {
    if (f === '.claude-plugin/plugin.json') {
      candidates.push({ treePath: '', kind: 'plugin' })
    } else if (f.endsWith('/.claude-plugin/plugin.json')) {
      candidates.push({ treePath: f.slice(0, f.length - '/.claude-plugin/plugin.json'.length), kind: 'plugin' })
    } else if (f === 'SKILL.md') {
      candidates.push({ treePath: '', kind: 'skill' })
    } else if (f.endsWith('/SKILL.md')) {
      candidates.push({ treePath: f.slice(0, f.length - '/SKILL.md'.length), kind: 'skill' })
    }
  }

  // 按深度排序（浅的先），排除嵌套在已收录根内的子路径（仿 findRoots 的不下钻语义）
  candidates.sort((a, b) => {
    const da = a.treePath === '' ? 0 : a.treePath.split('/').length
    const db = b.treePath === '' ? 0 : b.treePath.split('/').length
    return da - db
  })
  const roots: { treePath: string; kind: 'plugin' | 'skill' }[] = []
  for (const c of candidates) {
    const covered = roots.some(r =>
      r.treePath === c.treePath ||
      r.treePath === '' || // 仓库根已覆盖所有子路径
      c.treePath.startsWith(r.treePath + '/'),
    )
    if (!covered) roots.push(c)
  }

  // 从 git 对象读元数据，构建包条目
  const packages: DiscoveredPackage[] = []
  for (const { treePath, kind } of roots) {
    const gitRef = (rel: string) => treePath ? `HEAD:${treePath}/${rel}` : `HEAD:${rel}`

    // contentHash = 该包目录对应的 git tree SHA
    let contentHash: string | undefined
    try {
      const treeRef = treePath ? `HEAD:${treePath}` : 'HEAD:'
      const sha = execFileSync('git', ['-C', repoDir, 'rev-parse', treeRef],
        { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim()
      if (sha) contentHash = sha
    } catch { /* no contentHash */ }

    let name: string
    let description = ''
    let version: string | undefined

    if (kind === 'plugin') {
      let pj: any
      try {
        pj = JSON.parse(execFileSync('git', ['-C', repoDir, 'show', gitRef('.claude-plugin/plugin.json')],
          { stdio: ['ignore', 'pipe', 'pipe'] }).toString())
      } catch { continue } // ponytail: 静默跳过读取失败的包；升级路径：收集 errors[] 返回给调用方
      name = toKebab(pj.name || (treePath ? path.basename(treePath) : 'unknown'))
      description = pj.description || ''
      version = typeof pj.version === 'string' ? pj.version : undefined
    } else {
      let raw: string
      try {
        raw = execFileSync('git', ['-C', repoDir, 'show', gitRef('SKILL.md')],
          { stdio: ['ignore', 'pipe', 'pipe'] }).toString()
      } catch { continue } // ponytail: 静默跳过读取失败的包；升级路径：收集 errors[] 返回给调用方
      const fm = matter(raw).data
      name = toKebab((fm.name as string | undefined) || (treePath ? path.basename(treePath) : 'unknown'))
      description = (fm.description as string | undefined) || ''
      version = typeof fm.version === 'string' ? fm.version : undefined
    }

    packages.push({ name, kind, description, root: treePath, sourceUrl: undefined, version, contentHash })
  }

  // 引用型包：marketplace.json 中有 source.url 且本地无同名包的条目
  const localNames = new Set(packages.map(p => p.name))
  try {
    const marketplace = JSON.parse(
      execFileSync('git', ['-C', repoDir, 'show', 'HEAD:.claude-plugin/marketplace.json'],
        { stdio: ['ignore', 'pipe', 'pipe'] }).toString(),
    )
    if (Array.isArray(marketplace.plugins)) {
      for (const entry of marketplace.plugins) {
        if (entry.source?.url && entry.name) {
          const kebabName = toKebab(entry.name)
          if (localNames.has(kebabName)) continue
          packages.push({
            name: kebabName, kind: 'plugin', description: entry.description || '',
            root: null, sourceUrl: entry.source.url,
            version: typeof entry.version === 'string' ? entry.version : undefined,
          })
        }
      }
    }
  } catch { /* 无 marketplace.json 或格式错误，静默跳过 */ } // ponytail: 升级路径：收集 parse errors 供调用方诊断

  return packages
}

export function discoverPackages(dir: string): DiscoveredPackage[] {
  const packages: DiscoveredPackage[] = []

  for (const { root, kind } of findRoots(dir)) {
    if (kind === 'plugin') {
      const pj = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin/plugin.json'), 'utf8'))
      packages.push({
        name: toKebab(pj.name || path.basename(root)),
        kind, description: pj.description || '', root, sourceUrl: undefined,
        version: typeof pj.version === 'string' ? pj.version : undefined,
        contentHash: hashPackageDir(root),
      })
    } else {
      const fm = matter(fs.readFileSync(path.join(root, 'SKILL.md'), 'utf8')).data
      packages.push({
        name: toKebab(fm.name || path.basename(root)),
        kind, description: fm.description || '', root, sourceUrl: undefined,
        version: typeof fm.version === 'string' ? fm.version : undefined,
        contentHash: hashPackageDir(root),
      })
    }
  }

  // 解析 marketplace.json 中的引用型包（本地包优先）
  const localNames = new Set(packages.map(p => p.name))
  const marketplacePath = path.join(dir, '.claude-plugin', 'marketplace.json')
  if (fs.existsSync(marketplacePath)) {
    try {
      const marketplace = JSON.parse(fs.readFileSync(marketplacePath, 'utf8'))
      if (Array.isArray(marketplace.plugins)) {
        for (const entry of marketplace.plugins) {
          if (entry.source?.url && entry.name) {
            const kebabName = toKebab(entry.name)
            if (localNames.has(kebabName)) continue
            packages.push({
              name: kebabName, kind: 'plugin', description: entry.description || '',
              root: null, sourceUrl: entry.source.url,
              version: typeof entry.version === 'string' ? entry.version : undefined,
            })
          }
        }
      }
    } catch {
      // 畸形 marketplace.json 静默跳过
    }
  }

  return packages
}




