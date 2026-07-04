/** @author sgz @since 2026-07-03 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { commitAllIn, resetHardIn, headOf, resetToIn } from '@/lib/repo'

function gitRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shrepo-'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 't'], { cwd: dir })
  return dir
}

test('commitAllIn commits new files', () => {
  const dir = gitRepo()
  fs.writeFileSync(path.join(dir, 'a.txt'), 'hi')
  commitAllIn(dir, 'add a')
  const log = execFileSync('git', ['log', '--oneline'], { cwd: dir }).toString()
  expect(log).toContain('add a')
})

test('resetHardIn drops uncommitted changes', () => {
  const dir = gitRepo()
  fs.writeFileSync(path.join(dir, 'a.txt'), 'hi')
  commitAllIn(dir, 'add a')
  fs.writeFileSync(path.join(dir, 'a.txt'), 'changed')
  resetHardIn(dir)
  expect(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8')).toBe('hi')
})

test('resetToIn undoes a later commit AND its files (retryable after failed push)', () => {
  const dir = gitRepo()
  fs.writeFileSync(path.join(dir, 'base.txt'), 'base')
  commitAllIn(dir, 'init')
  const before = headOf(dir)!            // 上传前状态
  fs.mkdirSync(path.join(dir, 'plugins', 'x'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'plugins', 'x', 'a.txt'), 'hi')
  commitAllIn(dir, 'add x')              // 模拟上传提交
  resetToIn(dir, before)                 // 模拟 push 失败回滚
  expect(fs.existsSync(path.join(dir, 'plugins', 'x'))).toBe(false) // 文件已移除 → 可重新上传
  expect(execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: dir }).toString().trim()).toBe('1')
})

test('commitAllIn is a no-op when nothing changed', () => {
  const dir = gitRepo()
  fs.writeFileSync(path.join(dir, 'a.txt'), 'hi')
  commitAllIn(dir, 'first')
  commitAllIn(dir, 'second') // no changes
  const count = execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: dir }).toString().trim()
  expect(count).toBe('1')
})
