/** @author sgz @since 2026-07-05 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { withWorkTree } from '@/lib/worktree'

// 建一个 no-checkout 仓库：init + 初始提交 + 清空工作目录
function noCheckoutRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shwt-'))
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

test('withWorkTree commits changes via temp work-tree, leaves repo work dir empty', () => {
  const repo = noCheckoutRepo()
  withWorkTree(repo, wt => {
    fs.writeFileSync(path.join(wt, 'b.txt'), 'new')
  }, 'add b')
  const tree = execFileSync('git', ['ls-tree', '-r', '--name-only', 'HEAD'], { cwd: repo }).toString()
  expect(tree).toContain('b.txt')
  expect(tree).toContain('a.txt')
  expect(fs.existsSync(path.join(repo, 'b.txt'))).toBe(false) // 仓库工作目录仍空
  const log = execFileSync('git', ['log', '--oneline'], { cwd: repo }).toString()
  expect(log).toContain('add b')
})

test('withWorkTree cleans up temp dir even on error', () => {
  const repo = noCheckoutRepo()
  const beforeCount = fs.readdirSync(os.tmpdir()).filter(n => n.startsWith('sh-wt-')).length
  expect(() => withWorkTree(repo, () => { throw new Error('boom') }, 'x')).toThrow('boom')
  const afterCount = fs.readdirSync(os.tmpdir()).filter(n => n.startsWith('sh-wt-')).length
  expect(afterCount).toBe(beforeCount) // 临时目录已清理
})

test('withWorkTree can modify existing file and commit', () => {
  const repo = noCheckoutRepo()
  withWorkTree(repo, wt => {
    fs.writeFileSync(path.join(wt, 'a.txt'), 'changed')
  }, 'modify a')
  const content = execFileSync('git', ['show', 'HEAD:a.txt'], { cwd: repo }).toString()
  expect(content).toBe('changed')
})
