import { expect, test } from 'vitest'
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
  expect(d.skillMarkdown).toContain('Hello body.')
  expect(d.files).toContain('skills/hello/SKILL.md')
})

test('detail returns null for unknown plugin', () => {
  expect(getPluginDetail(REPO, 'nope')).toBeNull()
})

test('missing marketplace file yields empty skeleton', () => {
  const m = readMarketplace(path.resolve('tests/fixtures/does-not-exist'))
  expect(m.plugins).toEqual([])
})
