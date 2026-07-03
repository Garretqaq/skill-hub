/** @author sgz @since 2026-07-03 */
import fs from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'
import { readMarketplace, type PluginEntry } from './marketplace'

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

export function ingest(repoDir: string, extractedDir: string, opts?: { name?: string }): IngestResult {
  const found = findRoot(extractedDir)
  if (!found) throw new Error('unrecognized package: no plugin.json or SKILL.md')

  let name: string
  let description = ''
  let tags: string[] = []

  if (found.kind === 'plugin') {
    const pj = JSON.parse(fs.readFileSync(path.join(found.root, '.claude-plugin/plugin.json'), 'utf8'))
    name = toKebab(opts?.name || pj.name || path.basename(found.root))
    description = pj.description || ''
    tags = pj.tags || pj.keywords || []
  } else {
    const fm = matter(fs.readFileSync(path.join(found.root, 'SKILL.md'), 'utf8')).data
    name = toKebab(opts?.name || fm.name || path.basename(found.root))
    description = fm.description || ''
    tags = fm.tags || []
  }
  if (!name) throw new Error('unrecognized package: empty name')

  const dest = path.join(repoDir, 'plugins', name)
  if (fs.existsSync(dest)) throw new Error(`name exists: ${name}`)

  if (found.kind === 'plugin') {
    copyDir(found.root, dest)
  } else {
    // 裸 skill：包壳成 plugins/<name>/skills/<name>/ + plugin.json
    const skillDir = path.join(dest, 'skills', name)
    copyDir(found.root, skillDir)
    fs.mkdirSync(path.join(dest, '.claude-plugin'), { recursive: true })
    fs.writeFileSync(
      path.join(dest, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name, description, version: '1.0.0' }, null, 2) + '\n',
    )
  }

  writeManifestEntry(repoDir, {
    name,
    source: `./plugins/${name}`,
    description,
    tags,
  })
  return { name, type: found.kind }
}
