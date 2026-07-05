/** @author sgz @since 2026-07-04 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { discoverPackages } from './ingest'
import { normalizeSource } from './remote'
import { listPlugins } from './marketplace'
import { isValidVersion, compareVersions } from './semver'
import { DATA_DIR, REPO_DIR } from './config'
import { withWorkTree } from './worktree'

export interface WatchedRepo { id: string; source: string; url: string; addedAt: string }
export interface IndexedPackage {
  repoId: string; source: string; url: string; market: string | null
  name: string; kind: 'plugin' | 'skill'; description: string
  sourceUrl?: string  // 引用型包的外部 git URL（本地包为 undefined）
  version?: string    // 源包声明的版本，缺失为 undefined
  localVersion?: string // 已导入本地市场的版本；未导入为 undefined
}

const storeFile = () => path.join(DATA_DIR, 'watched.json')
const cacheRoot = () => path.join(DATA_DIR, 'watched')
const cacheDir = (id: string) => path.join(cacheRoot(), id)

export function toId(source: string): string {
  const id = source.trim().replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '')
  // 防目录穿越与空 id：'.'/'..'/空 会让 cacheDir 逃逸或指向缓存根
  if (!id || id === '.' || id === '..') throw new Error(`invalid source for id: ${source}`)
  return id
}

function readAll(): WatchedRepo[] {
  try { return JSON.parse(fs.readFileSync(storeFile(), 'utf8')).repos ?? [] } catch { return [] }
}
function writeAll(repos: WatchedRepo[]): void {
  fs.mkdirSync(path.dirname(storeFile()), { recursive: true })
  fs.writeFileSync(storeFile(), JSON.stringify({ repos }, null, 2) + '\n')
}
export function listWatched(): WatchedRepo[] { return readAll() }

// 监听列表在市场仓库里的存放路径（Claude 只解析 .claude-plugin/，此路径不干扰其解析）
const WATCHED_IN_REPO = '.skill-hub/watched.json'

// 从市场仓库 HEAD 读监听列表；无该文件/无 HEAD 返回 null（区别于「读到空列表」）
function readWatchedFromRepo(): WatchedRepo[] | null {
  try {
    const out = execFileSync('git', ['-C', REPO_DIR, 'show', `HEAD:${WATCHED_IN_REPO}`], { stdio: ['ignore', 'pipe', 'pipe'] }).toString()
    return JSON.parse(out).repos ?? []
  } catch { return null }
}

// 把当前监听列表写进市场仓库并提交（在临时 work-tree 内，push 由调用方负责）
export function commitWatchedToRepo(): void {
  const repos = readAll()
  withWorkTree(REPO_DIR, wt => {
    const p = path.join(wt, WATCHED_IN_REPO)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, JSON.stringify({ repos }, null, 2) + '\n')
  }, `update watched list (${repos.length})`)
}

// 容器重建后本地 watched.json 缺失时，从市场仓库 HEAD 恢复列表并重建缓存克隆
export function restoreWatchedFromRepo(): void {
  if (fs.existsSync(storeFile())) return          // 本地已有，不覆盖
  const fromRepo = readWatchedFromRepo()
  if (!fromRepo || fromRepo.length === 0) return  // 仓库无记录，无需恢复
  writeAll(fromRepo)
  for (const r of fromRepo) {
    try { if (!fs.existsSync(cacheDir(r.id))) cloneInto(r.url, cacheDir(r.id)) }
    catch { /* 单个克隆失败不阻断其余恢复 */ }
  }
}

// 浅克隆到目标目录（已存在先删）；url 由调用方保证已规范化
// --recurse-submodules：市场用 submodule 引用包时（如 superpowers），拉取真实文件而非空 gitlink
export function cloneInto(url: string, dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(path.dirname(dir), { recursive: true })
  execFileSync('git', ['clone', '--depth', '1', '--recurse-submodules', url, dir], { stdio: ['ignore', 'pipe', 'pipe'] })
}

export function addWatched(source: string): WatchedRepo {
  const url = normalizeSource(source)
  const id = toId(source)
  const repos = readAll()
  const existing = repos.find(r => r.id === id)
  if (existing) {
    if (existing.source === source) throw new Error(`already watching: ${source}`)
    throw new Error(`source "${source}" 与已监听的 "${existing.source}" 冲突（生成相同 id "${id}"）`)
  }
  cloneInto(url, cacheDir(id))
  const repo: WatchedRepo = { id, source, url, addedAt: new Date().toISOString() }
  writeAll([...repos, repo])
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
    execFileSync('git', ['submodule', 'update', '--init', '--recursive', '--depth', '1'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] })
  } catch {
    cloneInto(repo.url, dir)
  }
}
// 逐个刷新，单个失败不影响其余；全部尝试后再抛聚合错误
export function refreshAll(): void {
  const errs: string[] = []
  for (const r of readAll()) {
    try { refreshWatched(r.id) } catch (e) { errs.push(`${r.id}: ${String(e)}`) }
  }
  if (errs.length) throw new Error(`refresh failed:\n${errs.join('\n')}`)
}

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
      out.push({
        repoId: r.id,
        source: r.source,
        url: r.url,
        market,
        name: pkg.name,
        kind: pkg.kind,
        description: pkg.description,
        sourceUrl: pkg.sourceUrl,  // 新增
        version: pkg.version
      })
    }
  }
  return out
}

// 本地市场已导入包的 name→version（现算 repoDir，理由同 updateStatus 注释）
function localVersionMap(): Map<string, string> {
  const repoDir = REPO_DIR
  const map = new Map<string, string>()
  for (const p of listPlugins(repoDir)) if (p.version) map.set(p.name, p.version)
  return map
}

export function search(q: string): IndexedPackage[] {
  const kw = q.trim().toLowerCase()
  const local = localVersionMap()
  const all = buildIndex().map(p => ({ ...p, localVersion: local.get(p.name) }))
  if (!kw) return all
  return all.filter(p => p.name.toLowerCase().includes(kw) || p.description.toLowerCase().includes(kw))
}

// 定位某监听库里指定 name 的包根目录（供导入用）
export function packageRoot(id: string, name: string): string | null {
  const dir = cacheDir(id)
  if (!fs.existsSync(dir)) return null
  return discoverPackages(dir).find(p => p.name === name)?.root ?? null
}

export interface UpdateItem {
  name: string
  kind: 'plugin' | 'skill'
  localVersion: string
  remoteVersion: string
  repoId: string
  source: string
  sourceUrl?: string
}

// 已导入包 vs 监听库聚合索引，按 name 比对 version，仅返回远程版本更高者
export function updateStatus(): UpdateItem[] {
  // ponytail: 不复用 config.ts 的 REPO_DIR 常量——它在模块加载时计算一次，
  // 而本文件其余路径（storeFile/cacheRoot 等）均按调用时的 cwd 现算，测试靠 chdir 隔离；
  // 复用会读到导入时的旧 cwd，导致测试失败。此处按同一惯例现算。
  const repoDir = REPO_DIR
  const local = listPlugins(repoDir)

  // 远程按 name 取 version 最高者（同名多库时）
  const remote = new Map<string, IndexedPackage>()
  for (const p of buildIndex()) {
    if (!p.version || !isValidVersion(p.version)) continue
    const cur = remote.get(p.name)
    if (!cur || compareVersions(p.version, cur.version!) > 0) remote.set(p.name, p)
  }

  const out: UpdateItem[] = []
  for (const lp of local) {
    if (!lp.version || !isValidVersion(lp.version)) continue
    const r = remote.get(lp.name)
    if (!r) continue
    if (compareVersions(r.version!, lp.version) > 0) {
      out.push({
        name: lp.name, kind: r.kind, localVersion: lp.version,
        remoteVersion: r.version!, repoId: r.repoId, source: r.source, sourceUrl: r.sourceUrl,
      })
    }
  }
  return out
}
