/** @author sgz @since 2026-07-03 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'
import { withWorkTree } from './worktree'

export interface PluginEntry {
  name: string
  source: string
  description?: string
  tags?: string[]
  version?: string
  displayName?: string
  origin?: string  // 导入来源仓库（监听库 source / 引用型包 sourceUrl）；手动上传为 undefined
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

// git show <ref>，失败（无 HEAD / 路径不存在）返回 null
function gitShow(repoDir: string, ref: string): string | null {
  try {
    return execFileSync('git', ['-C', repoDir, 'show', ref], { stdio: ['ignore', 'pipe', 'pipe'] }).toString()
  } catch {
    return null
  }
}

function manifestPath(): string {
  return '.claude-plugin/marketplace.json'
}

export function readMarketplace(repoDir: string): Marketplace {
  const content = gitShow(repoDir, `HEAD:${manifestPath()}`)
  if (!content) return { name: '', owner: { name: '' }, plugins: [] }
  const m = JSON.parse(content) as Marketplace
  m.plugins ??= []
  return m
}

export function listPlugins(repoDir: string): PluginEntry[] {
  return readMarketplace(repoDir).plugins
}

export function writeMarketName(repoDir: string, name: string): void {
  withWorkTree(repoDir, wt => {
    const m = readMarketplace(repoDir) // 读当前 HEAD
    m.name = name
    const p = path.join(wt, '.claude-plugin', 'marketplace.json')
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, JSON.stringify(m, null, 2) + '\n')
  }, `rename marketplace to ${name}`)
}

export function getPluginDetail(repoDir: string, name: string): PluginDetail | null {
  const entry = listPlugins(repoDir).find(p => p.name === name)
  if (!entry) return null
  let tree: string
  try {
    tree = execFileSync('git', ['-C', repoDir, 'ls-tree', '-r', '--name-only', 'HEAD', '--', `plugins/${name}`], { stdio: ['ignore', 'pipe', 'pipe'] }).toString()
  } catch {
    return null
  }
  const prefix = `plugins/${name}/`
  const files = tree.split('\n').map(s => s.trim()).filter(Boolean)
    .filter(f => f.startsWith(prefix)).map(f => f.slice(prefix.length))
  // 说明文档优先级：skills 子目录（真正的技能文档）> 插件根目录（README/SKILL）。
  // 插件型仓库（如 claude-hud）无 skills 目录、README 在根，故需回退到根目录，否则详情页无「技能说明」
  const docRel =
    files.find(f => /^skills\/[^/]+\/README\.md$/i.test(f)) ??
    files.find(f => /^skills\/[^/]+\/SKILL\.md$/i.test(f)) ??
    files.find(f => /^README\.md$/i.test(f)) ??
    files.find(f => /^SKILL\.md$/i.test(f))
  let skillMarkdown: string | null = null
  if (docRel) {
    const raw = gitShow(repoDir, `HEAD:plugins/${name}/${docRel}`)
    if (raw) skillMarkdown = matter(raw).content.trim()
  }
  return { entry, skillMarkdown, files }
}
