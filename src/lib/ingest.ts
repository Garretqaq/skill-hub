/** @author sgz @since 2026-07-03 */
import fs from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'
import { readMarketplace, type PluginEntry } from './marketplace'
import { isValidVersion, bumpPatch, compareVersions } from './semver'

export interface IngestResult { name: string; type: 'plugin' | 'skill' }

export function toKebab(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function copyDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true })
  for (const name of fs.readdirSync(src)) {
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

function writeManifestEntry(repoDir: string, entry: PluginEntry): void {
  const p = path.join(repoDir, '.claude-plugin', 'marketplace.json')
  const m = readMarketplace(repoDir)
  m.plugins = m.plugins.filter(x => x.name !== entry.name)
  m.plugins.push(entry)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify(m, null, 2) + '\n')
}

export function ingest(repoDir: string, extractedDir: string, opts?: { name?: string; overwrite?: boolean; version?: string; description?: string; displayName?: string }): IngestResult {
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
  if (opts?.description) description = opts.description // 非空时覆盖包内描述
  if (!name) throw new Error('unrecognized package: empty name')

  const dest = path.join(repoDir, 'plugins', name)
  const existed = fs.existsSync(dest)
  if (existed && !opts?.overwrite) throw new Error(`name exists: ${name}`)

  if (opts?.version && !isValidVersion(opts.version)) {
    throw new Error(`invalid version: ${opts.version}`)
  }

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
    fs.rmSync(dest, { recursive: true, force: true }) // 覆盖：先删旧目录，manifest 条目由下方替换
  }

  if (found.kind === 'plugin') {
    copyDir(found.root, dest)
    // 用决议后的 version 覆盖插件自带 plugin.json 的 version
    const pjPath = path.join(dest, '.claude-plugin', 'plugin.json')
    const pj = JSON.parse(fs.readFileSync(pjPath, 'utf8'))
    pj.version = version
    pj.description = description // 与 manifest 保持一致
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

  writeManifestEntry(repoDir, {
    name,
    source: `./plugins/${name}`,
    description,
    tags,
    version,
    displayName: opts?.displayName?.trim() || undefined,
  })
  return { name, type: found.kind }
}

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

export interface DiscoveredPackage { name: string; kind: 'plugin' | 'skill'; description: string; root: string | null; sourceUrl?: string }

export function discoverPackages(dir: string): DiscoveredPackage[] {
  const packages: DiscoveredPackage[] = []

  // 扫描本地文件型包
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
            if (localNames.has(kebabName)) continue // ponytail: 本地包优先，跳过同名引用
            packages.push({
              name: kebabName,
              kind: 'plugin',
              description: entry.description || '',
              root: null,
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
