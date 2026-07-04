/** @author sgz @since 2026-07-03 */
import fs from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'

export interface PluginEntry {
  name: string
  source: string
  description?: string
  tags?: string[]
}
export interface Marketplace {
  name: string
  owner: { name: string }
  plugins: PluginEntry[]
}
export interface PluginDetail {
  entry: PluginEntry
  skillMarkdown: string | null
  files: string[]
}

function manifestPath(repoDir: string): string {
  return path.join(repoDir, '.claude-plugin', 'marketplace.json')
}

export function readMarketplace(repoDir: string): Marketplace {
  const p = manifestPath(repoDir)
  if (!fs.existsSync(p)) return { name: '', owner: { name: '' }, plugins: [] }
  const m = JSON.parse(fs.readFileSync(p, 'utf8')) as Marketplace
  m.plugins ??= []
  return m
}

export function listPlugins(repoDir: string): PluginEntry[] {
  return readMarketplace(repoDir).plugins
}

export function writeMarketName(repoDir: string, name: string): void {
  const p = manifestPath(repoDir)
  const m = readMarketplace(repoDir)
  m.name = name
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify(m, null, 2) + '\n')
}

function walk(dir: string, base: string, out: string[]): void {
  for (const name of fs.readdirSync(dir).sort()) {
    if (name === '.git') continue
    const full = path.join(dir, name)
    const rel = path.relative(base, full)
    if (fs.statSync(full).isDirectory()) walk(full, base, out)
    else out.push(rel)
  }
}

export function getPluginDetail(repoDir: string, name: string): PluginDetail | null {
  const entry = listPlugins(repoDir).find(p => p.name === name)
  if (!entry) return null
  const pluginDir = path.join(repoDir, 'plugins', name)
  if (!fs.existsSync(pluginDir)) return null
  const files: string[] = []
  walk(pluginDir, pluginDir, files)
  const skillRel = files.find(f => /^skills\/[^/]+\/SKILL\.md$/.test(f))
  const skillMarkdown = skillRel
    ? matter(fs.readFileSync(path.join(pluginDir, skillRel), 'utf8')).content.trim() // 剥掉 YAML frontmatter，只展示正文
    : null
  return { entry, skillMarkdown, files }
}
