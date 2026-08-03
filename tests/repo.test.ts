/** @author sgz @since 2026-07-05 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, test, vi } from 'vitest'
import { headOf, resetToIn, syncFromRemoteIn } from '@/lib/repo'

// no-checkout 仓库：init + 初始提交 + 清空工作目录
function noCheckoutRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shrepo-'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 't'], { cwd: dir })
  fs.writeFileSync(path.join(dir, 'a.txt'), 'hi')
  execFileSync('git', ['add', '-A'], { cwd: dir })
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir })
  for (const f of fs.readdirSync(dir)) {
    if (f !== '.git') fs.rmSync(path.join(dir, f), { recursive: true, force: true })
  }
  return dir
}

// 用临时 work-tree 在 no-checkout 仓上做提交（测试辅助，模拟 withWorkTree）
function commitViaWorkTree(dir: string, file: string, content: string, msg: string): void {
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'shwt-'))
  execFileSync('git', ['--work-tree', wt, 'checkout', '-f', 'HEAD'], { cwd: dir })
  fs.mkdirSync(path.dirname(path.join(wt, file)), { recursive: true })
  fs.writeFileSync(path.join(wt, file), content)
  execFileSync('git', ['--work-tree', wt, 'add', '-A'], { cwd: dir })
  execFileSync('git', ['commit', '-q', '-m', msg], { cwd: dir })
  fs.rmSync(wt, { recursive: true, force: true })
}

function headTree(dir: string): string {
  return execFileSync('git', ['ls-tree', '-r', '--name-only', 'HEAD'], { cwd: dir }).toString()
}

test('resetToIn rolls back HEAD via reset --mixed, work dir stays empty', () => {
  const dir = noCheckoutRepo()
  const before = headOf(dir)!
  commitViaWorkTree(dir, 'plugins/x/a.txt', 'hi', 'add x')
  expect(headOf(dir)).not.toBe(before)
  resetToIn(dir, before)
  expect(headOf(dir)).toBe(before)
  expect(fs.existsSync(path.join(dir, 'plugins'))).toBe(false) // 工作目录仍空
  expect(headTree(dir)).not.toContain('plugins/x') // HEAD 已回滚
  // 仅 1 次提交（init）
  expect(execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: dir }).toString().trim()).toBe('1')
})

// 造一个带一次提交的 bare 远程
function bareRemoteWithCommit(): string {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'shwork-'))
  execFileSync('git', ['init', '-q'], { cwd: work })
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: work })
  execFileSync('git', ['config', 'user.name', 't'], { cwd: work })
  fs.writeFileSync(path.join(work, 'remote-skill.txt'), 'from-remote')
  execFileSync('git', ['add', '-A'], { cwd: work })
  execFileSync('git', ['commit', '-q', '-m', 'remote init'], { cwd: work })
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'shbare-')) + '.git'
  execFileSync('git', ['clone', '-q', '--bare', work, bare])
  return bare
}

function cloneNoCheckoutFrom(bare: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shclone-'))
  execFileSync('git', ['clone', '-q', '--no-checkout', bare, dir])
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 't'], { cwd: dir })
  return dir
}

function pushNewCommit(bare: string, file: string, content: string): void {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'shpush-'))
  execFileSync('git', ['clone', '-q', bare, work])
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: work })
  execFileSync('git', ['config', 'user.name', 't'], { cwd: work })
  fs.writeFileSync(path.join(work, file), content)
  execFileSync('git', ['add', '-A'], { cwd: work })
  execFileSync('git', ['commit', '-q', '-m', `add ${file}`], { cwd: work })
  execFileSync('git', ['push', '-q', 'origin', 'HEAD'], { cwd: work })
}

test('syncFromRemoteIn aligns HEAD to remote, work dir stays empty', () => {
  const remote = bareRemoteWithCommit()
  const local = cloneNoCheckoutFrom(remote)
  pushNewCommit(remote, 'new-skill.txt', 'v2')
  syncFromRemoteIn(local, remote)
  const tree = headTree(local)
  expect(tree).toContain('new-skill.txt')
  expect(tree).toContain('remote-skill.txt')
  expect(fs.existsSync(path.join(local, 'new-skill.txt'))).toBe(false) // 工作目录仍空
})

test('syncFromRemoteIn preserves local when it has unpushed commits (history unrelated)', () => {
  const remote = bareRemoteWithCommit()
  const local = noCheckoutRepo() // 本地 init，与远程历史不相干
  commitViaWorkTree(local, 'local-only.txt', 'local', 'local upload')
  const beforeHead = headOf(local)
  syncFromRemoteIn(local, remote)
  expect(headOf(local)).toBe(beforeHead) // 本地 HEAD 不变
  const tree = headTree(local)
  expect(tree).toContain('local-only.txt')
  expect(tree).not.toContain('remote-skill.txt')
})

test('syncFromRemoteIn is a safe no-op against an empty remote', () => {
  const emptyBare = fs.mkdtempSync(path.join(os.tmpdir(), 'shbareempty-')) + '.git'
  execFileSync('git', ['init', '-q', '--bare', emptyBare])
  const local = noCheckoutRepo()
  commitViaWorkTree(local, 'keep.txt', 'keep', 'local init')
  const beforeHead = headOf(local)
  syncFromRemoteIn(local, emptyBare)
  expect(headOf(local)).toBe(beforeHead)
})

// 源仓：两个提交，供浅克隆测试验证只拉到 1 个
function sourceRepoWithTwoCommits(): string {
  const dir = noCheckoutRepo()               // 已含 1 个提交
  commitViaWorkTree(dir, 'b.txt', 'second', 'second')
  return dir
}

test('ensureRepo: 首次浅克隆并返回 true，已存在时返回 false', async () => {
  const cwd = process.cwd()
  const src = sourceRepoWithTwoCommits()
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shensure-'))
  process.chdir(tmp)
  try {
    fs.mkdirSync(path.join(tmp, 'data'), { recursive: true })
    // file:// 而非裸路径：本地路径 clone 会忽略 --depth
    fs.writeFileSync(path.join(tmp, 'data', 'settings.json'),
      JSON.stringify({ repoUrl: `file://${fs.realpathSync(src)}` }))
    vi.resetModules()                        // DATA_DIR 在模块加载时定死，须重新 import
    const { ensureRepo } = await import('@/lib/repo')

    expect(ensureRepo()).toBe(true)          // 本次做了 clone → 调用方可省掉紧随的 fetch
    const repoDir = path.join(tmp, 'data', 'marketplace')
    expect(fs.existsSync(path.join(repoDir, '.git', 'shallow'))).toBe(true)
    expect(execFileSync('git', ['log', '--oneline'], { cwd: repoDir }).toString().trim().split('\n'))
      .toHaveLength(1)                       // --depth 1 生效，没拉第二个提交
    expect(fs.readdirSync(repoDir)).toEqual(['.git']) // --no-checkout：工作目录空

    expect(ensureRepo()).toBe(false)         // 已存在，不再 clone
  } finally {
    process.chdir(cwd)
    fs.rmSync(tmp, { recursive: true, force: true })
    fs.rmSync(src, { recursive: true, force: true })
  }
})
