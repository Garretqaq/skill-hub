/** @author sgz @since 2026-07-04 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

let cwd: string
let work: string
let originalDataDir: string | undefined

beforeEach(() => {
  cwd = process.cwd()
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'shwatch-'))
  // ponytail: 保存原环境变量，设置测试专用 DATA_DIR，防止模块缓存的 DATA_DIR 路径不匹配
  originalDataDir = process.env.DATA_DIR
  process.env.DATA_DIR = path.join(work, 'data')
  process.chdir(work) // 隔离固定路径 data/watched.json 与 data/watched/
  // ponytail: 清除模块缓存，确保 config.ts 的 DATA_DIR 基于新 env 重新计算
  vi.resetModules()
})
afterEach(() => {
  process.chdir(cwd)
  if (originalDataDir !== undefined) process.env.DATA_DIR = originalDataDir
  else delete process.env.DATA_DIR
  fs.rmSync(work, { recursive: true, force: true })
})

// 造一个本地 git 仓库当「远程」，内含一个插件
function remoteRepo(pluginName: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shremote-'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 't'], { cwd: dir })
  const root = path.join(dir, 'plugins', pluginName)
  fs.mkdirSync(path.join(root, '.claude-plugin'), { recursive: true })
  fs.writeFileSync(path.join(root, '.claude-plugin/plugin.json'),
    JSON.stringify({ name: pluginName, description: `${pluginName} desc`, version: '1.0.0' }))
  fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.claude-plugin/marketplace.json'),
    JSON.stringify({ name: 'ext-market', owner: { name: 'x' }, plugins: [] }))
  execFileSync('git', ['add', '-A'], { cwd: dir })
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir })
  return dir
}

// ponytail: 初始化空的 no-checkout 市场仓库（供 ingest/withWorkTree 使用）
function initMarketRepo(dir: string): void {
  fs.mkdirSync(dir, { recursive: true })
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 't'], { cwd: dir })
  fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.claude-plugin/marketplace.json'),
    JSON.stringify({ name: 'mine', owner: { name: 'x' }, plugins: [] }))
  execFileSync('git', ['add', '-A'], { cwd: dir })
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir })
  execFileSync('git', ['reset', '--mixed', 'HEAD'], { cwd: dir }) // no-checkout
  // 清空工作目录（除 .git）
  for (const f of fs.readdirSync(dir)) {
    if (f !== '.git') fs.rmSync(path.join(dir, f), { recursive: true, force: true })
  }
}

test('cloneInto 浅克隆到目标目录', async () => {
  const { cloneInto } = await import('@/lib/watched')
  const remote = remoteRepo('alpha')
  const dest = path.join(work, 'data/watched/alpha')
  cloneInto(remote, dest)
  expect(fs.existsSync(path.join(dest, 'plugins/alpha/.claude-plugin/plugin.json'))).toBe(true)
})

test('cloneInto 递归 submodule：市场以子模块引用包时拉取真实文件', async () => {
  const { cloneInto } = await import('@/lib/watched')
  const inner = remoteRepo('superpowers') // 被引用的真实包仓库
  // 市场仓库：把 inner 作为 plugins/superpowers 子模块引入
  const market = fs.mkdtempSync(path.join(os.tmpdir(), 'shmarket-'))
  execFileSync('git', ['init', '-q'], { cwd: market })
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: market })
  execFileSync('git', ['config', 'user.name', 't'], { cwd: market })
  execFileSync('git', ['-c', 'protocol.file.allow=always', 'submodule', 'add', inner, 'plugins/superpowers'], { cwd: market })
  execFileSync('git', ['commit', '-q', '-m', 'add submodule'], { cwd: market })

  const dest = path.join(work, 'data/watched/market')
  // file:// 子模块默认被 git 禁用；仅测试放行（真实 https 子模块不受影响）
  process.env.GIT_CONFIG_COUNT = '1'
  process.env.GIT_CONFIG_KEY_0 = 'protocol.file.allow'
  process.env.GIT_CONFIG_VALUE_0 = 'always'
  try {
    cloneInto(market, dest)
  } finally {
    delete process.env.GIT_CONFIG_COUNT
    delete process.env.GIT_CONFIG_KEY_0
    delete process.env.GIT_CONFIG_VALUE_0
  }
  // gitlink 被展开成真实文件：plugins/superpowers 内应含子模块自己的 plugins/superpowers/...
  expect(fs.existsSync(path.join(dest, 'plugins/superpowers/plugins/superpowers/.claude-plugin/plugin.json'))).toBe(true)
})

test('listWatched/removeWatched 走 data/watched.json；buildIndex+search 聚合并过滤', async () => {
  const { cloneInto, listWatched, removeWatched, buildIndex, search } = await import('@/lib/watched')
  const remote = remoteRepo('alpha')
  // 手工写入一条监听（addWatched 会拒绝本地路径，这里直接构造缓存与清单来测索引）
  const id = 'alpha-repo'
  cloneInto(remote, path.join(work, 'data/watched', id))
  fs.writeFileSync(path.join(work, 'data/watched.json'),
    JSON.stringify({ repos: [{ id, source: remote, url: remote, addedAt: '2026-07-04T00:00:00.000Z' }] }))

  expect(listWatched()).toHaveLength(1)
  const idx = buildIndex()
  expect(idx).toHaveLength(1)
  expect(idx[0]).toMatchObject({ repoId: id, name: 'alpha', kind: 'plugin', market: 'ext-market' })
  expect(search('alph')).toHaveLength(1)
  expect(search('zzz')).toHaveLength(0)

  removeWatched(id)
  expect(listWatched()).toHaveLength(0)
  expect(fs.existsSync(path.join(work, 'data/watched', id))).toBe(false)
})

test('search 标注 localVersion：已导入本地市场的包带本地版本', async () => {
  const { cloneInto, search } = await import('@/lib/watched')
  const remote = remoteRepo('alpha') // 远程 alpha v1.0.0
  const id = 'alpha-repo'
  cloneInto(remote, path.join(work, 'data/watched', id))
  fs.writeFileSync(path.join(work, 'data/watched.json'),
    JSON.stringify({ repos: [{ id, source: remote, url: remote, addedAt: 'x' }] }))

  // 未导入：localVersion 缺失
  expect(search('alpha')[0].localVersion).toBeUndefined()

  // 造一个本地市场 no-checkout 仓库，alpha 已导入为 v1.0.0
  const repoDir = path.join(work, 'data/marketplace')
  fs.mkdirSync(repoDir, { recursive: true })
  execFileSync('git', ['init', '-q'], { cwd: repoDir })
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: repoDir })
  execFileSync('git', ['config', 'user.name', 't'], { cwd: repoDir })
  fs.mkdirSync(path.join(repoDir, '.claude-plugin'), { recursive: true })
  fs.writeFileSync(path.join(repoDir, '.claude-plugin/marketplace.json'),
    JSON.stringify({ name: 'mine', owner: { name: 'x' }, plugins: [{ name: 'alpha', source: './plugins/alpha', version: '1.0.0' }] }))
  execFileSync('git', ['add', '-A'], { cwd: repoDir })
  execFileSync('git', ['commit', '-q', '-m', 'add alpha'], { cwd: repoDir })
  execFileSync('git', ['reset', '--mixed', 'HEAD'], { cwd: repoDir }) // no-checkout 模式
  // ponytail: 清空工作目录（除 .git）
  for (const f of fs.readdirSync(repoDir)) {
    if (f !== '.git') fs.rmSync(path.join(repoDir, f), { recursive: true, force: true })
  }
  expect(search('alpha')[0].localVersion).toBe('1.0.0')
})

test('refreshWatched 拉取远程新提交', async () => {
  const { cloneInto, refreshWatched, buildIndex } = await import('@/lib/watched')
  const remote = remoteRepo('alpha')
  const id = 'alpha-repo'
  cloneInto(remote, path.join(work, 'data/watched', id))
  fs.writeFileSync(path.join(work, 'data/watched.json'),
    JSON.stringify({ repos: [{ id, source: remote, url: remote, addedAt: 'x' }] }))

  // 远程新增一个插件并提交
  const root = path.join(remote, 'plugins', 'beta')
  fs.mkdirSync(path.join(root, '.claude-plugin'), { recursive: true })
  fs.writeFileSync(path.join(root, '.claude-plugin/plugin.json'),
    JSON.stringify({ name: 'beta', description: 'beta desc', version: '1.0.0' }))
  execFileSync('git', ['add', '-A'], { cwd: remote })
  execFileSync('git', ['commit', '-q', '-m', 'add beta'], { cwd: remote })

  refreshWatched(id)
  expect(buildIndex().map(p => p.name).sort()).toEqual(['alpha', 'beta'])
})

test('packageRoot 定位指定包根', async () => {
  const { cloneInto, packageRoot } = await import('@/lib/watched')
  const remote = remoteRepo('alpha')
  const id = 'alpha-repo'
  cloneInto(remote, path.join(work, 'data/watched', id))
  fs.writeFileSync(path.join(work, 'data/watched.json'),
    JSON.stringify({ repos: [{ id, source: remote, url: remote, addedAt: 'x' }] }))
  const root = packageRoot(id, 'alpha')
  expect(root && fs.existsSync(path.join(root, '.claude-plugin/plugin.json'))).toBe(true)
  expect(packageRoot(id, 'nope')).toBeNull()
})

test('toId 拒绝目录穿越与空 id', async () => {
  const { toId } = await import('@/lib/watched')
  expect(toId('owner/repo')).toBe('owner_repo')
  expect(toId('a.b-c')).toBe('a.b-c')
  expect(() => toId('..')).toThrow(/invalid source/)
  expect(() => toId('.')).toThrow(/invalid source/)
  expect(() => toId('///')).toThrow(/invalid source/)
})

test('toId 不同 source 可能产生相同 id（碰撞）', async () => {
  const { toId } = await import('@/lib/watched')
  expect(toId('a/b')).toBe('a_b')
  expect(toId('a_b')).toBe('a_b')
  expect(toId('a/b')).toBe(toId('a_b'))
})

test('refreshAll 容错：单个失败不影响其余，全部尝试后抛聚合错误', async () => {
  const { cloneInto, refreshAll } = await import('@/lib/watched')
  const remote = remoteRepo('alpha')
  const validId = 'valid-repo'
  const brokenId = 'broken-repo'

  // 造一个正常的缓存
  cloneInto(remote, path.join(work, 'data/watched', validId))

  // 手写两条监听：一个正常，一个缓存目录缺失
  fs.writeFileSync(path.join(work, 'data/watched.json'),
    JSON.stringify({
      repos: [
        { id: validId, source: remote, url: remote, addedAt: 'x' },
        { id: brokenId, source: 'fake', url: 'fake', addedAt: 'x' }
      ]
    }))

  // 远程新增一个插件并提交
  const root = path.join(remote, 'plugins', 'beta')
  fs.mkdirSync(path.join(root, '.claude-plugin'), { recursive: true })
  fs.writeFileSync(path.join(root, '.claude-plugin/plugin.json'),
    JSON.stringify({ name: 'beta', description: 'beta desc', version: '1.0.0' }))
  execFileSync('git', ['add', '-A'], { cwd: remote })
  execFileSync('git', ['commit', '-q', '-m', 'add beta'], { cwd: remote })

  // refreshAll 应该抛聚合错误
  expect(() => refreshAll()).toThrow(/refresh failed/)

  // 但 validId 应该已经刷新成功
  const { buildIndex } = await import('@/lib/watched')
  const idx = buildIndex()
  expect(idx.filter(p => p.repoId === validId).map(p => p.name).sort()).toEqual(['alpha', 'beta'])
})

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

test('packageRoot 对引用型包返回 null', async () => {
  const { cloneInto, packageRoot } = await import('@/lib/watched')
  const remote = remoteRepo('alpha')
  const id = 'local-vs-ref'

  cloneInto(remote, path.join(work, 'data/watched', id))
  const cacheDir = path.join(work, 'data/watched', id)
  fs.mkdirSync(path.join(cacheDir, '.claude-plugin'), { recursive: true })
  fs.writeFileSync(path.join(cacheDir, '.claude-plugin', 'marketplace.json'),
    JSON.stringify({
      name: 'test-market',
      plugins: [{ name: 'ref-only', source: { url: 'https://github.com/ext/pkg.git' }, description: '' }]
    }))
  fs.writeFileSync(path.join(work, 'data/watched.json'),
    JSON.stringify({ repos: [{ id, source: remote, url: remote, addedAt: 'x' }] }))

  expect(packageRoot(id, 'alpha')).toBeTruthy() // 本地包
  expect(packageRoot(id, 'ref-only')).toBeNull() // 引用型包
})

test('updateStatus：远程版本更高才算有更新，更新后闭环', async () => {
  const { cloneInto, refreshWatched, updateStatus } = await import('@/lib/watched')
  const { ingest } = await import('@/lib/ingest')
  const remote = remoteRepo('alpha')            // 远程 alpha v1.0.0
  const id = 'alpha-repo'
  cloneInto(remote, path.join(work, 'data/watched', id))
  fs.writeFileSync(path.join(work, 'data/watched.json'),
    JSON.stringify({ repos: [{ id, source: remote, url: remote, addedAt: 'x' }] }))

  // 初始化本地市场 no-checkout 仓库
  const repoDir = path.join(work, 'data/marketplace')
  initMarketRepo(repoDir)

  // 本地导入到 data/marketplace（v1.0.0）
  const cacheRoot = path.join(work, 'data/watched', id, 'plugins', 'alpha')
  ingest(repoDir, cacheRoot)
  expect(updateStatus()).toHaveLength(0)        // 版本相同，无更新

  // 远程升到 1.1.0 并刷新缓存
  fs.writeFileSync(path.join(remote, 'plugins/alpha/.claude-plugin/plugin.json'),
    JSON.stringify({ name: 'alpha', description: 'alpha desc', version: '1.1.0' }))
  execFileSync('git', ['commit', '-qam', 'bump'], { cwd: remote })
  refreshWatched(id)

  const ups = updateStatus()
  expect(ups).toHaveLength(1)
  expect(ups[0]).toMatchObject({ name: 'alpha', localVersion: '1.0.0', remoteVersion: '1.1.0', repoId: id })

  // 模拟点击更新：以 remoteVersion 覆盖导入 → 闭环
  ingest(repoDir, cacheRoot, { overwrite: true, version: '1.1.0' })
  expect(updateStatus()).toHaveLength(0)
})

test('updateStatus：远程包无 version 不误报', async () => {
  const { cloneInto, updateStatus } = await import('@/lib/watched')
  const { ingest } = await import('@/lib/ingest')
  const remote = remoteRepo('alpha')
  const id = 'alpha-repo'
  cloneInto(remote, path.join(work, 'data/watched', id))
  fs.writeFileSync(path.join(work, 'data/watched.json'),
    JSON.stringify({ repos: [{ id, source: remote, url: remote, addedAt: 'x' }] }))
  const repoDir = path.join(work, 'data/marketplace')
  initMarketRepo(repoDir)
  ingest(repoDir, path.join(work, 'data/watched', id, 'plugins', 'alpha'))
  // 抹掉缓存里 alpha 的 version
  fs.writeFileSync(path.join(work, 'data/watched', id, 'plugins/alpha/.claude-plugin/plugin.json'),
    JSON.stringify({ name: 'alpha', description: 'alpha desc' }))
  expect(updateStatus()).toHaveLength(0)
})

test('updateStatus：远程版本非法（非 semver）不误报', async () => {
  const { cloneInto, updateStatus } = await import('@/lib/watched')
  const { ingest } = await import('@/lib/ingest')
  const remote = remoteRepo('alpha')
  const id = 'alpha-repo'
  cloneInto(remote, path.join(work, 'data/watched', id))
  fs.writeFileSync(path.join(work, 'data/watched.json'),
    JSON.stringify({ repos: [{ id, source: remote, url: remote, addedAt: 'x' }] }))
  const repoDir = path.join(work, 'data/marketplace')
  initMarketRepo(repoDir)
  ingest(repoDir, path.join(work, 'data/watched', id, 'plugins', 'alpha'))
  // 远程 version 是格式非法的字符串（非缺失，而是不满足 \d+\.\d+\.\d+）
  fs.writeFileSync(path.join(work, 'data/watched', id, 'plugins/alpha/.claude-plugin/plugin.json'),
    JSON.stringify({ name: 'alpha', description: 'alpha desc', version: 'abc' }))
  expect(updateStatus()).toHaveLength(0)
})

test('updateStatus：同名包跨多个监听库时取最高版本', async () => {
  const { cloneInto, updateStatus } = await import('@/lib/watched')
  const { ingest } = await import('@/lib/ingest')
  const repoLow = remoteRepo('shared')   // shared v1.0.0
  const repoHigh = remoteRepo('shared')  // 另一个远程库同样有 shared，先建后升到 v2.0.0
  fs.writeFileSync(path.join(repoHigh, 'plugins/shared/.claude-plugin/plugin.json'),
    JSON.stringify({ name: 'shared', description: 'shared desc', version: '2.0.0' }))
  execFileSync('git', ['commit', '-qam', 'bump'], { cwd: repoHigh })

  const idLow = 'shared-low'
  const idHigh = 'shared-high'
  cloneInto(repoLow, path.join(work, 'data/watched', idLow))
  cloneInto(repoHigh, path.join(work, 'data/watched', idHigh))
  fs.writeFileSync(path.join(work, 'data/watched.json'),
    JSON.stringify({
      repos: [
        { id: idLow, source: repoLow, url: repoLow, addedAt: 'x' },
        { id: idHigh, source: repoHigh, url: repoHigh, addedAt: 'x' },
      ]
    }))

  // 本地导入 shared@1.0.0（低于两个远程版本）
  const repoDir = path.join(work, 'data/marketplace')
  initMarketRepo(repoDir)
  ingest(repoDir, path.join(work, 'data/watched', idLow, 'plugins', 'shared'))

  const ups = updateStatus()
  expect(ups).toHaveLength(1)
  expect(ups[0]).toMatchObject({ name: 'shared', localVersion: '1.0.0', remoteVersion: '2.0.0' })
})
