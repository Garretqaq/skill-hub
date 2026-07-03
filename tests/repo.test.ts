import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { commitAllIn, resetHardIn } from '@/lib/repo'

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

test('commitAllIn is a no-op when nothing changed', () => {
  const dir = gitRepo()
  fs.writeFileSync(path.join(dir, 'a.txt'), 'hi')
  commitAllIn(dir, 'first')
  commitAllIn(dir, 'second') // no changes
  const count = execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: dir }).toString().trim()
  expect(count).toBe('1')
})
