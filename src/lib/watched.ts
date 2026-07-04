/** @author sgz @since 2026-07-04 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { discoverPackages } from './ingest'
import { normalizeSource } from './remote'

export interface WatchedRepo { id: string; source: string; url: string; addedAt: string }
export interface IndexedPackage {
  repoId: string; source: string; url: string; market: string | null
  name: string; kind: 'plugin' | 'skill'; description: string
}

const storeFile = () => path.resolve('data/watched.json')
const cacheRoot = () => path.resolve('data/watched')
const cacheDir = (id: string) => path.join(cacheRoot(), id)

export function toId(source: string): string {
  return source.trim().replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '')
}

function readAll(): WatchedRepo[] {
  try { return JSON.parse(fs.readFileSync(storeFile(), 'utf8')).repos ?? [] } catch { return [] }
}
function writeAll(repos: WatchedRepo[]): void {
  fs.mkdirSync(path.dirname(storeFile()), { recursive: true })
  fs.writeFileSync(storeFile(), JSON.stringify({ repos }, null, 2) + '\n')
}
export function listWatched(): WatchedRepo[] { return readAll() }

// 浅克隆到目标目录（已存在先删）；url 由调用方保证已规范化
export function cloneInto(url: string, dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(path.dirname(dir), { recursive: true })
  execFileSync('git', ['clone', '--depth', '1', url, dir], { stdio: ['ignore', 'pipe', 'pipe'] })
}

export function addWatched(source: string): WatchedRepo {
  const url = normalizeSource(source)
  const id = toId(source)
  if (readAll().some(r => r.id === id)) throw new Error(`already watching: ${source}`)
  cloneInto(url, cacheDir(id))
  const repo: WatchedRepo = { id, source, url, addedAt: new Date().toISOString() }
  writeAll([...readAll(), repo])
  return repo
}

export function removeWatched(id: string): void {
  writeAll(readAll().filter(r => r.id !== id))
  fs.rmSync(cacheDir(id), { recursive: true, force: true })
}

// 手动刷新：fetch + reset 到远程 HEAD；缓存损坏/缺失时兜底重克隆
export function refreshWatched(id: string): void {
  const repo = readAll().find(r => r.id === id)
  if (!repo) throw new Error(`not watching: ${id}`)
  const dir = cacheDir(id)
  try {
    execFileSync('git', ['fetch', '--depth', '1', 'origin'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] })
    execFileSync('git', ['reset', '--hard', 'FETCH_HEAD'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] })
  } catch {
    cloneInto(repo.url, dir)
  }
}
export function refreshAll(): void { for (const r of readAll()) refreshWatched(r.id) }

function marketNameOf(id: string): string | null {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(cacheDir(id), '.claude-plugin/marketplace.json'), 'utf8'))
    return m.name || null
  } catch { return null }
}

// 聚合索引：现扫每个监听库的缓存克隆
export function buildIndex(): IndexedPackage[] {
  const out: IndexedPackage[] = []
  for (const r of readAll()) {
    const dir = cacheDir(r.id)
    if (!fs.existsSync(dir)) continue
    const market = marketNameOf(r.id)
    for (const pkg of discoverPackages(dir)) {
      out.push({ repoId: r.id, source: r.source, url: r.url, market, name: pkg.name, kind: pkg.kind, description: pkg.description })
    }
  }
  return out
}

export function search(q: string): IndexedPackage[] {
  const kw = q.trim().toLowerCase()
  const all = buildIndex()
  if (!kw) return all
  return all.filter(p => p.name.toLowerCase().includes(kw) || p.description.toLowerCase().includes(kw))
}

// 定位某监听库里指定 name 的包根目录（供导入用）
export function packageRoot(id: string, name: string): string | null {
  const dir = cacheDir(id)
  if (!fs.existsSync(dir)) return null
  return discoverPackages(dir).find(p => p.name === name)?.root ?? null
}
