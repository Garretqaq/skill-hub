/** @author sgz @since 2026-07-03 */
import { expect, test } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readMarketplace, listPlugins, getPluginDetail } from '@/lib/marketplace'

const REPO = path.resolve('tests/fixtures/repo')

test('reads marketplace name and plugins', () => {
  const m = readMarketplace(REPO)
  expect(m.name).toBe('fx-market')
  expect(listPlugins(REPO).map(p => p.name)).toEqual(['hello-skill'])
})

test('detail returns SKILL.md body and file list', () => {
  const d = getPluginDetail(REPO, 'hello-skill')!
  expect(d.entry.name).toBe('hello-skill')
  expect(d.skillMarkdown).toBe('Hello body.') // 已剥离 YAML frontmatter，只剩正文
  expect(d.files).toContain('skills/hello/SKILL.md')
})

test('detail returns null for unknown plugin', () => {
  expect(getPluginDetail(REPO, 'nope')).toBeNull()
})

test('missing marketplace file yields empty skeleton', () => {
  const m = readMarketplace(path.resolve('tests/fixtures/does-not-exist'))
  expect(m.plugins).toEqual([])
})

test('PluginEntry carries version through read/write', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-mkt-'))
  fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true })
  fs.writeFileSync(
    path.join(dir, '.claude-plugin', 'marketplace.json'),
    JSON.stringify({
      name: 'm', owner: { name: 'sgz' },
      plugins: [{ name: 'x', source: './plugins/x', version: '1.2.3' }],
    }),
  )
  const m = readMarketplace(dir)
  expect(m.plugins[0].version).toBe('1.2.3')
})
