/** @author sgz @since 2026-07-05 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { readMarketplace, listPlugins, getPluginDetail, writeMarketName } from '@/lib/marketplace'

interface SeedPlugin { name: string; skillBody?: string; readmeBody?: string; description?: string }

// 建一个 no-checkout 仓库：init + 提交 manifest+plugins + 清空工作目录
function seedNoCheckout(plugins: SeedPlugin[] = [], marketName = 'fx-market'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shmkt-'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 't'], { cwd: dir })
  fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true })
  const entries = plugins.map(p => ({
    name: p.name, source: `./plugins/${p.name}`, description: p.description ?? 'hi',
  }))
  fs.writeFileSync(path.join(dir, '.claude-plugin', 'marketplace.json'),
    JSON.stringify({ name: marketName, owner: { name: 'sgz' }, plugins: entries }, null, 2))
  for (const p of plugins) {
    const sk = path.join(dir, 'plugins', p.name, 'skills', p.name)
    fs.mkdirSync(sk, { recursive: true })
    fs.writeFileSync(path.join(sk, 'SKILL.md'), `---\nname: ${p.name}\n---\n${p.skillBody ?? 'body'}`)
    if (p.readmeBody) fs.writeFileSync(path.join(sk, 'README.md'), `---\nname: ${p.name}\n---\n${p.readmeBody}`)
  }
  execFileSync('git', ['add', '-A'], { cwd: dir })
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir })
  for (const f of fs.readdirSync(dir)) {
    if (f !== '.git') fs.rmSync(path.join(dir, f), { recursive: true, force: true })
  }
  return dir
}

test('reads marketplace name and plugins', () => {
  const repo = seedNoCheckout([{ name: 'hello-skill' }])
  const m = readMarketplace(repo)
  expect(m.name).toBe('fx-market')
  expect(listPlugins(repo).map(p => p.name)).toEqual(['hello-skill'])
})

test('detail returns SKILL.md body and file list', () => {
  const repo = seedNoCheckout([{ name: 'hello-skill', skillBody: 'Hello body.' }])
  const d = getPluginDetail(repo, 'hello-skill')!
  expect(d.entry.name).toBe('hello-skill')
  expect(d.skillMarkdown).toBe('Hello body.')
  expect(d.files).toContain('skills/hello-skill/SKILL.md')
})

test('detail prefers README.md over SKILL.md', () => {
  const repo = seedNoCheckout([{ name: 'x', skillBody: 'skill body', readmeBody: 'readme body' }])
  const d = getPluginDetail(repo, 'x')!
  expect(d.skillMarkdown).toBe('readme body')
})

test('detail returns null for unknown plugin', () => {
  const repo = seedNoCheckout([{ name: 'hello-skill' }])
  expect(getPluginDetail(repo, 'nope')).toBeNull()
})

test('missing marketplace (empty repo with no HEAD) yields empty skeleton', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shmkt-'))
  execFileSync('git', ['init', '-q'], { cwd: dir }) // 无提交，无 HEAD
  const m = readMarketplace(dir)
  expect(m.plugins).toEqual([])
})

test('writeMarketName updates name in HEAD, work dir stays empty', () => {
  const repo = seedNoCheckout([{ name: 'x' }])
  writeMarketName(repo, 'new-name')
  expect(readMarketplace(repo).name).toBe('new-name')
  expect(fs.existsSync(path.join(repo, '.claude-plugin'))).toBe(false) // 工作目录仍空
})

test('PluginEntry carries version', () => {
  const repo = seedNoCheckout([])
  // 手动造一个带 version 的 manifest 提交
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'shwt-'))
  execFileSync('git', ['--work-tree', wt, 'checkout', '-f', 'HEAD'], { cwd: repo })
  fs.writeFileSync(path.join(wt, '.claude-plugin', 'marketplace.json'),
    JSON.stringify({ name: 'm', owner: { name: 'sgz' }, plugins: [{ name: 'x', source: './plugins/x', version: '1.2.3' }] }, null, 2))
  execFileSync('git', ['--work-tree', wt, 'add', '-A'], { cwd: repo })
  execFileSync('git', ['commit', '-q', '-m', 'v'], { cwd: repo })
  fs.rmSync(wt, { recursive: true, force: true })
  expect(readMarketplace(repo).plugins[0].version).toBe('1.2.3')
})
