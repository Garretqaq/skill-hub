/** @author sgz @since 2026-07-03 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { setRemoteUrlIn } from '@/lib/repo'

function gitRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shset-'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  return dir
}
function originUrl(dir: string): string {
  return execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: dir }).toString().trim()
}

test('setRemoteUrlIn adds origin when missing, then updates it', () => {
  const dir = gitRepo()
  setRemoteUrlIn(dir, 'https://a@host/x.git') // add path
  expect(originUrl(dir)).toBe('https://a@host/x.git')
  setRemoteUrlIn(dir, 'https://b@host/y.git') // set-url path
  expect(originUrl(dir)).toBe('https://b@host/y.git')
})

test('settings: token injected into url, kept when re-saving without token', async () => {
  const cwd = process.cwd()
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shcfg-'))
  process.chdir(tmp)
  try {
    const { getRepoUrl, getSettings, saveSettings } = await import('@/lib/settings')
    expect(() => getRepoUrl()).not.toThrow() // 无 settings.json 时不报错

    saveSettings('https://host/o/r.git', 'tok123')
    expect(getRepoUrl()).toBe('https://tok123@host/o/r.git') // token 注入到用户名位
    expect(getSettings()).toMatchObject({ repoUrl: 'https://host/o/r.git', hasToken: true }) // 展示脱敏、不回传 token

    saveSettings('https://host/o/r2.git') // 改 base、token 留空
    expect(getRepoUrl()).toBe('https://tok123@host/o/r2.git') // 原 token 保留
  } finally {
    process.chdir(cwd)
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
