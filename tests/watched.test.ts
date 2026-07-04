/** @author sgz @since 2026-07-04 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'

let cwd: string
let work: string

beforeEach(() => {
  cwd = process.cwd()
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'shwatch-'))
  process.chdir(work) // 隔离固定路径 data/watched.json 与 data/watched/
})
afterEach(() => {
  process.chdir(cwd)
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

test('cloneInto 浅克隆到目标目录', async () => {
  const { cloneInto } = await import('@/lib/watched')
  const remote = remoteRepo('alpha')
  const dest = path.join(work, 'data/watched/alpha')
  cloneInto(remote, dest)
  expect(fs.existsSync(path.join(dest, 'plugins/alpha/.claude-plugin/plugin.json'))).toBe(true)
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
