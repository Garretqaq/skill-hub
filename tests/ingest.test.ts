import { afterEach, expect, test } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ingest } from '@/lib/ingest'
import { readMarketplace } from '@/lib/marketplace'

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sh-'))
}
function seedRepo(): string {
  const dir = tmp()
  fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true })
  fs.writeFileSync(
    path.join(dir, '.claude-plugin', 'marketplace.json'),
    JSON.stringify({ name: 'm', owner: { name: 'sgz' }, plugins: [] }),
  )
  return dir
}

test('ingest bare skill wraps into a plugin', () => {
  const repo = seedRepo()
  const src = tmp()
  const sk = path.join(src, 'my-skill')
  fs.mkdirSync(sk, { recursive: true })
  fs.writeFileSync(path.join(sk, 'SKILL.md'), '---\nname: my-skill\ndescription: d\n---\nbody')

  const res = ingest(repo, src)
  expect(res).toEqual({ name: 'my-skill', type: 'skill' })
  expect(fs.existsSync(path.join(repo, 'plugins/my-skill/.claude-plugin/plugin.json'))).toBe(true)
  expect(fs.existsSync(path.join(repo, 'plugins/my-skill/skills/my-skill/SKILL.md'))).toBe(true)
  const m = readMarketplace(repo)
  expect(m.plugins[0]).toMatchObject({ name: 'my-skill', source: './plugins/my-skill', description: 'd' })
})

test('ingest full plugin keeps structure', () => {
  const repo = seedRepo()
  const src = tmp()
  const root = path.join(src, 'toolkit')
  fs.mkdirSync(path.join(root, '.claude-plugin'), { recursive: true })
  fs.writeFileSync(path.join(root, '.claude-plugin/plugin.json'),
    JSON.stringify({ name: 'toolkit', description: 'T', version: '1.0.0' }))
  fs.mkdirSync(path.join(root, 'skills/a'), { recursive: true })
  fs.writeFileSync(path.join(root, 'skills/a/SKILL.md'), '---\nname: a\n---\nx')

  const res = ingest(repo, src)
  expect(res).toEqual({ name: 'toolkit', type: 'plugin' })
  expect(fs.existsSync(path.join(repo, 'plugins/toolkit/.claude-plugin/plugin.json'))).toBe(true)
  expect(readMarketplace(repo).plugins[0].name).toBe('toolkit')
})

test('duplicate name throws', () => {
  const repo = seedRepo()
  const src = tmp()
  const sk = path.join(src, 'dup')
  fs.mkdirSync(sk, { recursive: true })
  fs.writeFileSync(path.join(sk, 'SKILL.md'), '---\nname: dup\n---\nb')
  ingest(repo, src)
  expect(() => ingest(repo, src)).toThrow(/name exists/)
})

test('unrecognized package throws', () => {
  const repo = seedRepo()
  const src = tmp()
  fs.writeFileSync(path.join(src, 'readme.txt'), 'nothing here')
  expect(() => ingest(repo, src)).toThrow(/unrecognized/)
})
