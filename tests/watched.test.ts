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

// 造一个本地 git 仓库当「远程」，内含一个插件；manifest 可选覆盖（引用型包场景）
function remoteRepo(pluginName: string, manifest?: object): string {
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
    JSON.stringify(manifest ?? { name: 'ext-market', owner: { name: 'x' }, plugins: [] }))
  execFileSync('git', ['add', '-A'], { cwd: dir })
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir })
  return dir
}

// 在 remote 仓库里改文件并提交（no-checkout 下内容变更须走 commit 才可见）
function commitTo(remote: string, files: Record<string, string>, msg = 'change'): void {
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(remote, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, content)
  }
  execFileSync('git', ['add', '-A'], { cwd: remote })
  execFileSync('git', ['commit', '-q', '-m', msg], { cwd: remote })
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

// 初始化带指定 plugin 条目的 no-checkout 市场仓库（供更新检测边界测试）
function initMarketWith(dir: string, plugins: object[]): void {
  fs.mkdirSync(dir, { recursive: true })
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 't'], { cwd: dir })
  fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.claude-plugin/marketplace.json'),
    JSON.stringify({ name: 'mine', owner: { name: 'x' }, plugins }))
  execFileSync('git', ['add', '-A'], { cwd: dir })
  execFileSync('git', ['commit', '-q', '-m', 'seed'], { cwd: dir })
  execFileSync('git', ['reset', '--mixed', 'HEAD'], { cwd: dir }) // no-checkout
  for (const f of fs.readdirSync(dir)) {
    if (f !== '.git') fs.rmSync(path.join(dir, f), { recursive: true, force: true })
  }
}

test('cloneInto 浅克隆到目标目录（no-checkout：无工作树，对象在 .git）', async () => {
  const { cloneInto } = await import('@/lib/watched')
  const remote = remoteRepo('alpha')
  const dest = path.join(work, 'data/watched/alpha')
  cloneInto(remote, dest)
  // 文件在 git 对象里可达
  expect(() => execFileSync('git', ['-C', dest, 'cat-file', '-e', 'HEAD:plugins/alpha/.claude-plugin/plugin.json'])).not.toThrow()
  // 但工作树是空的（只有 .git）
  expect(fs.readdirSync(dest)).toEqual(['.git'])
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

  await refreshWatched(id)
  expect(buildIndex().map(p => p.name).sort()).toEqual(['alpha', 'beta'])
})

test('withExtractedPackage 提取包文件到临时目录，回调后清理', async () => {
  const { cloneInto, withExtractedPackage } = await import('@/lib/watched')
  const remote = remoteRepo('alpha')
  const id = 'alpha-repo'
  cloneInto(remote, path.join(work, 'data/watched', id))
  fs.writeFileSync(path.join(work, 'data/watched.json'),
    JSON.stringify({ repos: [{ id, source: remote, url: remote, addedAt: 'x' }] }))

  let seenDir = ''
  const treeSha = withExtractedPackage(id, 'alpha', (root, sha) => {
    seenDir = root
    // 回调内包文件已落地
    expect(fs.existsSync(path.join(root, '.claude-plugin/plugin.json'))).toBe(true)
    return sha
  })
  expect(treeSha).toMatch(/^[0-9a-f]{40}$/)   // 带回远程 tree SHA
  expect(fs.existsSync(seenDir)).toBe(false)  // 临时目录已清理
  expect(withExtractedPackage(id, 'nope', () => 'x')).toBeNull()
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

  // refreshAll 返回计数：坏库计入 failed，不影响其余
  const r = await refreshAll()
  expect(r).toMatchObject({ total: 2, ok: 1 })
  expect(r.failed).toHaveLength(1)
  expect(r.failed[0]).toContain('fake')

  // 但 validId 应该已经刷新成功
  const { buildIndex } = await import('@/lib/watched')
  const idx = buildIndex()
  expect(idx.filter(p => p.repoId === validId).map(p => p.name).sort()).toEqual(['alpha', 'beta'])
})

test('buildIndex 包含引用型包的 sourceUrl', async () => {
  const { cloneInto, buildIndex } = await import('@/lib/watched')
  const remote = remoteRepo('alpha', {
    name: 'test-market',
    plugins: [{ name: 'external-pkg', source: { url: 'https://github.com/ext/pkg.git' }, description: 'ext' }],
  })
  const id = 'market-with-refs'

  cloneInto(remote, path.join(work, 'data/watched', id))

  fs.writeFileSync(path.join(work, 'data/watched.json'),
    JSON.stringify({ repos: [{ id, source: remote, url: remote, addedAt: 'x' }] }))

  const idx = buildIndex()
  const local = idx.find(p => p.name === 'alpha')
  const ref = idx.find(p => p.name === 'external-pkg')

  expect(local).toMatchObject({ repoId: id, name: 'alpha', kind: 'plugin', sourceUrl: undefined })
  expect(ref).toMatchObject({ repoId: id, name: 'external-pkg', kind: 'plugin', sourceUrl: 'https://github.com/ext/pkg.git' })
})

test('withExtractedPackage 对引用型包返回 null', async () => {
  const { cloneInto, withExtractedPackage } = await import('@/lib/watched')
  const id = 'local-vs-ref'
  // marketplace.json 须在 remote 里 commit，no-checkout 下只从 git 对象读
  const remote = remoteRepo('alpha', {
    name: 'test-market',
    plugins: [{ name: 'ref-only', source: { url: 'https://github.com/ext/pkg.git' }, description: '' }],
  })
  cloneInto(remote, path.join(work, 'data/watched', id))
  fs.writeFileSync(path.join(work, 'data/watched.json'),
    JSON.stringify({ repos: [{ id, source: remote, url: remote, addedAt: 'x' }] }))

  expect(withExtractedPackage(id, 'alpha', () => 'ok')).toBe('ok')      // 本地包
  expect(withExtractedPackage(id, 'ref-only', () => 'ok')).toBeNull()   // 引用型包无本地文件
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

  // 本地导入到 data/marketplace（v1.0.0）：走 withExtractedPackage，同路由真实路径
  const { withExtractedPackage } = await import('@/lib/watched')
  withExtractedPackage(id, 'alpha', (root, sha) => ingest(repoDir, root, { sourceHash: sha }))
  expect(updateStatus()).toHaveLength(0)        // 版本相同，无更新

  // 远程升到 1.1.0 并刷新缓存
  commitTo(remote, {
    'plugins/alpha/.claude-plugin/plugin.json': JSON.stringify({ name: 'alpha', description: 'alpha desc', version: '1.1.0' }),
  }, 'bump')
  await refreshWatched(id)

  const ups = updateStatus()
  expect(ups).toHaveLength(1)
  expect(ups[0]).toMatchObject({ name: 'alpha', localVersion: '1.0.0', remoteVersion: '1.1.0', repoId: id })

  // 模拟点击更新：以 remoteVersion 覆盖导入 → 闭环
  withExtractedPackage(id, 'alpha', (root, sha) => ingest(repoDir, root, { overwrite: true, version: '1.1.0', sourceHash: sha }))
  expect(updateStatus()).toHaveLength(0)
})

test('updateStatus：无版本包内容未变，哈希兜底不误报', async () => {
  const { cloneInto, updateStatus } = await import('@/lib/watched')
  const { ingest } = await import('@/lib/ingest')
  const { withExtractedPackage } = await import('@/lib/watched')
  const remote = remoteRepo('alpha')
  const id = 'alpha-repo'
  // 上游无版本：先在 remote 抹掉 version 并提交，再克隆
  commitTo(remote, {
    'plugins/alpha/.claude-plugin/plugin.json': JSON.stringify({ name: 'alpha', description: 'alpha desc' }),
  }, 'drop version')
  cloneInto(remote, path.join(work, 'data/watched', id))
  fs.writeFileSync(path.join(work, 'data/watched.json'),
    JSON.stringify({ repos: [{ id, source: remote, url: remote, addedAt: 'x' }] }))
  const repoDir = path.join(work, 'data/marketplace')
  initMarketRepo(repoDir)
  withExtractedPackage(id, 'alpha', (root, sha) => ingest(repoDir, root, { sourceHash: sha }))
  // 内容未再变动 → sourceHash == contentHash（同为 tree SHA）→ 不报
  expect(updateStatus()).toHaveLength(0)
})

test('updateStatus：无版本包内容变更，哈希兜底报 content 更新', async () => {
  const { cloneInto, updateStatus } = await import('@/lib/watched')
  const { ingest } = await import('@/lib/ingest')
  const { withExtractedPackage, refreshWatched } = await import('@/lib/watched')
  const remote = remoteRepo('alpha')
  const id = 'alpha-repo'
  commitTo(remote, {
    'plugins/alpha/.claude-plugin/plugin.json': JSON.stringify({ name: 'alpha', description: 'alpha desc' }),
  }, 'drop version')                                    // 无版本
  cloneInto(remote, path.join(work, 'data/watched', id))
  fs.writeFileSync(path.join(work, 'data/watched.json'),
    JSON.stringify({ repos: [{ id, source: remote, url: remote, addedAt: 'x' }] }))
  const repoDir = path.join(work, 'data/marketplace')
  initMarketRepo(repoDir)
  withExtractedPackage(id, 'alpha', (root, sha) => ingest(repoDir, root, { sourceHash: sha })) // sourceHash = tree(S0)
  commitTo(remote, { 'plugins/alpha/NEW.md': 'new content' }, 'add file')  // 上游内容变更（仍无版本）
  await refreshWatched(id)
  const ups = updateStatus()
  expect(ups).toHaveLength(1)
  expect(ups[0]).toMatchObject({ name: 'alpha', reason: 'content' })
})

test('updateStatus：远程版本非法（非 semver）时不按版本比对，走内容兜底', async () => {
  const { cloneInto, updateStatus } = await import('@/lib/watched')
  const { ingest } = await import('@/lib/ingest')
  const remote = remoteRepo('alpha')
  const id = 'alpha-repo'
  cloneInto(remote, path.join(work, 'data/watched', id))
  fs.writeFileSync(path.join(work, 'data/watched.json'),
    JSON.stringify({ repos: [{ id, source: remote, url: remote, addedAt: 'x' }] }))
  const repoDir = path.join(work, 'data/marketplace')
  initMarketRepo(repoDir)
  const { withExtractedPackage, refreshWatched } = await import('@/lib/watched')
  withExtractedPackage(id, 'alpha', (root, sha) => ingest(repoDir, root, { sourceHash: sha }))
  // 远程 version 改为非法字符串（内容随之变化）
  commitTo(remote, {
    'plugins/alpha/.claude-plugin/plugin.json': JSON.stringify({ name: 'alpha', description: 'alpha desc', version: 'abc' }),
  }, 'bad version')
  await refreshWatched(id)
  const ups = updateStatus()
  // 非法版本不被当作版本更新；因内容已变，按内容哈希兜底报 content
  expect(ups).toHaveLength(1)
  expect(ups[0].reason).toBe('content')
})

test('updateStatus：引用型包无版本时不报（无内容哈希可比）', async () => {
  const { cloneInto, updateStatus } = await import('@/lib/watched')
  // remote 里挂一个引用型包 external-pkg（无 version，root=null → 无 contentHash）
  const remote = remoteRepo('alpha', {
    name: 'm', plugins: [{ name: 'external-pkg', source: { url: 'https://x/pkg.git' }, description: 'e' }],
  })
  const id = 'market-with-refs'
  cloneInto(remote, path.join(work, 'data/watched', id))
  fs.writeFileSync(path.join(work, 'data/watched.json'),
    JSON.stringify({ repos: [{ id, source: remote, url: remote, addedAt: 'x' }] }))
  // 本地已导入 external-pkg（带 sourceHash），远程引用型无 contentHash → 兜底不成立
  initMarketWith(path.join(work, 'data/marketplace'),
    [{ name: 'external-pkg', source: './plugins/external-pkg', version: '1.0.0', sourceHash: 'deadbeef' }])
  expect(updateStatus()).toHaveLength(0)
})

test('updateStatus：存量本地包无 sourceHash 时不报也不崩', async () => {
  const { cloneInto, updateStatus } = await import('@/lib/watched')
  const remote = remoteRepo('alpha')
  const id = 'alpha-repo'
  // 上游无版本（走内容兜底路径），但本地条目缺 sourceHash（存量导入）
  commitTo(remote, {
    'plugins/alpha/.claude-plugin/plugin.json': JSON.stringify({ name: 'alpha', description: 'alpha desc' }),
  }, 'drop version')
  cloneInto(remote, path.join(work, 'data/watched', id))
  fs.writeFileSync(path.join(work, 'data/watched.json'),
    JSON.stringify({ repos: [{ id, source: remote, url: remote, addedAt: 'x' }] }))
  initMarketWith(path.join(work, 'data/marketplace'),
    [{ name: 'alpha', source: './plugins/alpha', version: '1.0.0' }]) // 无 sourceHash
  expect(() => updateStatus()).not.toThrow()
  expect(updateStatus()).toHaveLength(0)
})

test('updateStatus：同名包跨多个监听库时取最高版本', async () => {
  const { cloneInto, updateStatus, withExtractedPackage } = await import('@/lib/watched')
  const { ingest } = await import('@/lib/ingest')
  const repoLow = remoteRepo('shared')   // shared v1.0.0
  const repoHigh = remoteRepo('shared')  // 另一个远程库同样有 shared，先建后升到 v2.0.0
  commitTo(repoHigh, {
    'plugins/shared/.claude-plugin/plugin.json': JSON.stringify({ name: 'shared', description: 'shared desc', version: '2.0.0' }),
  }, 'bump')

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
  withExtractedPackage(idLow, 'shared', (root, sha) => ingest(repoDir, root, { sourceHash: sha }))

  const ups = updateStatus()
  expect(ups).toHaveLength(1)
  expect(ups[0]).toMatchObject({ name: 'shared', localVersion: '1.0.0', remoteVersion: '2.0.0' })
})

test('commitWatchedToRepo + restoreWatchedFromRepo：列表随市场仓库持久化并恢复', async () => {
  const { cloneInto, commitWatchedToRepo, restoreWatchedFromRepo, listWatched } = await import('@/lib/watched')
  const remote = remoteRepo('alpha')
  const id = 'alpha-repo'
  cloneInto(remote, path.join(work, 'data/watched', id))

  const repoDir = path.join(work, 'data/marketplace')
  initMarketRepo(repoDir)

  // 写本地监听并提交进市场仓库
  fs.writeFileSync(path.join(work, 'data/watched.json'),
    JSON.stringify({ repos: [{ id, source: remote, url: remote, addedAt: 'x' }] }))
  commitWatchedToRepo()
  // 提交进了 HEAD:.skill-hub/watched.json
  const inRepo = execFileSync('git', ['-C', repoDir, 'show', 'HEAD:.skill-hub/watched.json']).toString()
  expect(JSON.parse(inRepo).repos[0].id).toBe(id)

  // 模拟容器重建：删本地列表与缓存，restore 应从仓库恢复并重建缓存克隆
  fs.rmSync(path.join(work, 'data/watched.json'))
  fs.rmSync(path.join(work, 'data/watched', id), { recursive: true, force: true })
  await restoreWatchedFromRepo()
  expect(listWatched().map(r => r.id)).toEqual([id])
  // no-checkout：缓存克隆已重建，文件在 git 对象里可达（工作树为空）
  expect(() => execFileSync('git', ['-C', path.join(work, 'data/watched', id), 'cat-file', '-e', 'HEAD:plugins/alpha/.claude-plugin/plugin.json'])).not.toThrow()
})

test('restoreWatchedFromRepo：本地已有列表时不覆盖', async () => {
  const { restoreWatchedFromRepo, listWatched } = await import('@/lib/watched')
  const repoDir = path.join(work, 'data/marketplace')
  initMarketRepo(repoDir)
  // 本地已有一条监听
  fs.writeFileSync(path.join(work, 'data/watched.json'),
    JSON.stringify({ repos: [{ id: 'keep', source: 'a/b', url: 'https://x/a/b.git', addedAt: 'x' }] }))
  await restoreWatchedFromRepo()
  expect(listWatched().map(r => r.id)).toEqual(['keep']) // 未被仓库空列表覆盖
})

test('buildIndex 缓存：removeWatched 后再次 buildIndex 反映变更（防陈旧）', async () => {
  const { cloneInto, removeWatched, buildIndex } = await import('@/lib/watched')
  const remote = remoteRepo('alpha')
  const id = 'alpha-repo'
  cloneInto(remote, path.join(work, 'data/watched', id))
  fs.writeFileSync(path.join(work, 'data/watched.json'),
    JSON.stringify({ repos: [{ id, source: remote, url: remote, addedAt: 'x' }] }))

  expect(buildIndex()).toHaveLength(1) // 先构建，填充缓存
  removeWatched(id)                    // 应使缓存失效
  expect(buildIndex()).toHaveLength(0) // 若未失效会返回陈旧的 1
})

test('refreshAll 后 buildIndex 反映远程新提交（缓存失效 + 并行）', async () => {
  const { cloneInto, refreshAll, buildIndex } = await import('@/lib/watched')
  const remote = remoteRepo('alpha')
  const id = 'alpha-repo'
  cloneInto(remote, path.join(work, 'data/watched', id))
  fs.writeFileSync(path.join(work, 'data/watched.json'),
    JSON.stringify({ repos: [{ id, source: remote, url: remote, addedAt: 'x' }] }))

  expect(buildIndex().map(p => p.name)).toEqual(['alpha']) // 填充缓存

  const root = path.join(remote, 'plugins', 'beta')
  fs.mkdirSync(path.join(root, '.claude-plugin'), { recursive: true })
  fs.writeFileSync(path.join(root, '.claude-plugin/plugin.json'),
    JSON.stringify({ name: 'beta', description: 'beta desc', version: '1.0.0' }))
  execFileSync('git', ['add', '-A'], { cwd: remote })
  execFileSync('git', ['commit', '-q', '-m', 'add beta'], { cwd: remote })

  await refreshAll()
  expect(buildIndex().map(p => p.name).sort()).toEqual(['alpha', 'beta']) // 若缓存未失效仍是 ['alpha']
})

test('groupPackagesByRepo：按 repoId 归组，保留首次出现顺序，且不聚合非相邻的同 repoId', async () => {
  const { groupPackagesByRepo } = await import('@/lib/watched')
  const mk = (repoId: string, name: string): any => ({
    repoId, source: `src-${repoId}`, url: `url-${repoId}`, market: null,
    name, kind: 'skill', description: `${name} desc`,
  })
  const results = [
    mk('repoB', 'b1'),
    mk('repoA', 'a1'),
    mk('repoB', 'b2'),
    mk('repoA', 'a2'),
  ]
  const groups = groupPackagesByRepo(results)
  expect(groups.map(g => g.repoId)).toEqual(['repoB', 'repoA'])
  expect(groups[0].source).toBe('src-repoB')
  expect(groups[0].items.map((p: any) => p.name)).toEqual(['b1', 'b2'])
  expect(groups[1].items.map((p: any) => p.name)).toEqual(['a1', 'a2'])
})

test('groupPackagesByRepo：空数组返回空分组', async () => {
  const { groupPackagesByRepo } = await import('@/lib/watched')
  expect(groupPackagesByRepo([])).toEqual([])
})

// 引用型包导入/预览走「临时克隆 + 从 git 对象提取」，克隆同为 no-checkout；
// 这条路径此前无覆盖，cloneInto 改 --no-checkout 时曾静默失效（恒 404）
test('withExtractedFromRepo：对任意 no-checkout 克隆提取包（引用型包路径）', async () => {
  const { cloneInto, withExtractedFromRepo } = await import('@/lib/watched')
  const remote = remoteRepo('alpha')
  const tmpClone = path.join(work, 'tmp-ref-clone')
  cloneInto(remote, tmpClone)                       // 同引用型包路径：no-checkout 克隆
  expect(fs.readdirSync(tmpClone)).toEqual(['.git']) // 工作树确实为空

  const got = withExtractedFromRepo(tmpClone, 'alpha', (root, sha) => ({
    hasManifest: fs.existsSync(path.join(root, '.claude-plugin/plugin.json')),
    sha,
  }))
  expect(got?.hasManifest).toBe(true)               // 文件提取成功
  expect(got?.sha).toMatch(/^[0-9a-f]{40}$/)        // 带回 tree SHA，供 ingest 记为 sourceHash
  expect(withExtractedFromRepo(tmpClone, 'nope', () => 'x')).toBeNull()
})

test('withExtractedFromRepo：ingest 记录的 sourceHash 与远程 contentHash 同源可比', async () => {
  const { cloneInto, withExtractedFromRepo, buildIndex } = await import('@/lib/watched')
  const { ingest } = await import('@/lib/ingest')
  const { listPlugins } = await import('@/lib/marketplace')
  const remote = remoteRepo('alpha')
  const id = 'alpha-repo'
  cloneInto(remote, path.join(work, 'data/watched', id))
  fs.writeFileSync(path.join(work, 'data/watched.json'),
    JSON.stringify({ repos: [{ id, source: remote, url: remote, addedAt: 'x' }] }))
  const repoDir = path.join(work, 'data/marketplace')
  initMarketRepo(repoDir)

  withExtractedFromRepo(path.join(work, 'data/watched', id), 'alpha',
    (root, sha) => ingest(repoDir, root, { sourceHash: sha }))

  // 导入记录的 sourceHash 应等于索引里该包的 contentHash（否则无版本包会永久误报更新）
  const local = listPlugins(repoDir).find(p => p.name === 'alpha')
  const remotePkg = buildIndex().find(p => p.name === 'alpha')
  expect(local?.sourceHash).toBe(remotePkg?.contentHash)
})
