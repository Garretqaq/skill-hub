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

test('overwrite replaces existing plugin instead of throwing', () => {
  const repo = seedRepo()
  const mk = (body: string) => {
    const src = tmp()
    const sk = path.join(src, 'dup')
    fs.mkdirSync(sk, { recursive: true })
    fs.writeFileSync(path.join(sk, 'SKILL.md'), `---\nname: dup\ndescription: d\n---\n${body}`)
    return src
  }
  ingest(repo, mk('v1'))
  ingest(repo, mk('v2'), { overwrite: true }) // 不抛错，覆盖
  const skill = fs.readFileSync(path.join(repo, 'plugins/dup/skills/dup/SKILL.md'), 'utf8')
  expect(skill).toContain('v2')
  expect(readMarketplace(repo).plugins.filter(p => p.name === 'dup')).toHaveLength(1) // 不重复
})

test('non-overwrite request to existing name throws name-exists even with a non-increasing version', () => {
  const repo = seedRepo()
  const mk = (body: string) => {
    const src = tmp()
    const sk = path.join(src, 'dup2')
    fs.mkdirSync(sk, { recursive: true })
    fs.writeFileSync(path.join(sk, 'SKILL.md'), `---\nname: dup2\ndescription: d\n---\n${body}`)
    return src
  }
  ingest(repo, mk('v1')) // creates dup2 @ 1.0.0
  expect(() => ingest(repo, mk('v2'), { version: '1.0.0' })) // no overwrite flag, version <= current
    .toThrow(/name exists/)
})

test('non-overwrite request to existing name throws name-exists even with malformed version', () => {
  const repo = seedRepo()
  const mk = (body: string) => {
    const src = tmp()
    const sk = path.join(src, 'dup3')
    fs.mkdirSync(sk, { recursive: true })
    fs.writeFileSync(path.join(sk, 'SKILL.md'), `---\nname: dup3\ndescription: d\n---\n${body}`)
    return src
  }
  ingest(repo, mk('v1'))
  expect(() => ingest(repo, mk('v2'), { version: 'abc' })) // no overwrite, invalid version
    .toThrow(/name exists/)
})

test('unrecognized package throws', () => {
  const repo = seedRepo()
  const src = tmp()
  fs.writeFileSync(path.join(src, 'readme.txt'), 'nothing here')
  expect(() => ingest(repo, src)).toThrow(/unrecognized/)
})

function pkgVersion(repo: string, name: string): string {
  const pj = JSON.parse(
    fs.readFileSync(path.join(repo, `plugins/${name}/.claude-plugin/plugin.json`), 'utf8'),
  )
  return pj.version
}
function mkSkill(name: string, body: string, version?: string): string {
  const src = tmp()
  const sk = path.join(src, name)
  fs.mkdirSync(sk, { recursive: true })
  const vLine = version ? `version: ${version}\n` : ''
  fs.writeFileSync(path.join(sk, 'SKILL.md'), `---\nname: ${name}\ndescription: d\n${vLine}---\n${body}`)
  return src
}

test('new bare skill without version defaults to 1.0.0', () => {
  const repo = seedRepo()
  ingest(repo, mkSkill('a', 'v1'))
  expect(pkgVersion(repo, 'a')).toBe('1.0.0')
  expect(readMarketplace(repo).plugins.find(p => p.name === 'a')?.version).toBe('1.0.0')
})

test('new skill uses form version when provided', () => {
  const repo = seedRepo()
  ingest(repo, mkSkill('a', 'v1'), { version: '2.5.0' })
  expect(pkgVersion(repo, 'a')).toBe('2.5.0')
  expect(readMarketplace(repo).plugins.find(p => p.name === 'a')?.version).toBe('2.5.0')
})

test('overwrite with empty version bumps patch', () => {
  const repo = seedRepo()
  ingest(repo, mkSkill('a', 'v1')) // 1.0.0
  ingest(repo, mkSkill('a', 'v2'), { overwrite: true })
  expect(pkgVersion(repo, 'a')).toBe('1.0.1')
})

test('overwrite with higher form version uses it', () => {
  const repo = seedRepo()
  ingest(repo, mkSkill('a', 'v1')) // 1.0.0
  ingest(repo, mkSkill('a', 'v2'), { overwrite: true, version: '1.4.0' })
  expect(pkgVersion(repo, 'a')).toBe('1.4.0')
})

test('overwrite rejects non-increasing version', () => {
  const repo = seedRepo()
  ingest(repo, mkSkill('a', 'v1'), { version: '2.0.0' })
  expect(() => ingest(repo, mkSkill('a', 'v2'), { overwrite: true, version: '2.0.0' }))
    .toThrow(/higher than current/)
  expect(() => ingest(repo, mkSkill('a', 'v2'), { overwrite: true, version: '1.0.0' }))
    .toThrow(/higher than current/)
})

test('invalid version string throws', () => {
  const repo = seedRepo()
  expect(() => ingest(repo, mkSkill('a', 'v1'), { version: 'abc' })).toThrow(/invalid version/)
})

test('description opt overrides package description in both manifest and plugin.json', () => {
  const repo = seedRepo()
  const src = tmp()
  const sk = path.join(src, 'my-skill')
  fs.mkdirSync(sk, { recursive: true })
  fs.writeFileSync(path.join(sk, 'SKILL.md'), '---\nname: my-skill\ndescription: pkg\n---\nbody')

  ingest(repo, src, { description: 'custom desc' })

  expect(readMarketplace(repo).plugins[0].description).toBe('custom desc')
  const pj = JSON.parse(
    fs.readFileSync(path.join(repo, 'plugins/my-skill/.claude-plugin/plugin.json'), 'utf8'),
  )
  expect(pj.description).toBe('custom desc')
})

test('empty/absent description opt keeps package description', () => {
  const repo = seedRepo()
  const src = tmp()
  const root = path.join(src, 'toolkit')
  fs.mkdirSync(path.join(root, '.claude-plugin'), { recursive: true })
  fs.writeFileSync(path.join(root, '.claude-plugin/plugin.json'),
    JSON.stringify({ name: 'toolkit', description: 'T', version: '1.0.0' }))
  fs.mkdirSync(path.join(root, 'skills/a'), { recursive: true })
  fs.writeFileSync(path.join(root, 'skills/a/SKILL.md'), '---\nname: a\n---\nx')

  ingest(repo, src) // 不传 description
  expect(readMarketplace(repo).plugins[0].description).toBe('T')
  const pj = JSON.parse(
    fs.readFileSync(path.join(repo, 'plugins/toolkit/.claude-plugin/plugin.json'), 'utf8'),
  )
  expect(pj.description).toBe('T')
})

test('displayName opt is stored in manifest when provided', () => {
  const repo = seedRepo()
  const src = tmp()
  const sk = path.join(src, 'my-skill')
  fs.mkdirSync(sk, { recursive: true })
  fs.writeFileSync(path.join(sk, 'SKILL.md'), '---\nname: my-skill\ndescription: d\n---\nbody')

  ingest(repo, src, { displayName: '我的技能' })

  expect(readMarketplace(repo).plugins[0].displayName).toBe('我的技能')
})

test('empty/absent displayName opt leaves field unset', () => {
  const repo = seedRepo()
  const src = tmp()
  const sk = path.join(src, 'my-skill')
  fs.mkdirSync(sk, { recursive: true })
  fs.writeFileSync(path.join(sk, 'SKILL.md'), '---\nname: my-skill\ndescription: d\n---\nbody')

  ingest(repo, src)

  expect(readMarketplace(repo).plugins[0].displayName).toBeUndefined()
})

test('overwrite without displayName clears previous displayName', () => {
  const repo = seedRepo()
  const mk = () => {
    const src = tmp()
    const sk = path.join(src, 'dup')
    fs.mkdirSync(sk, { recursive: true })
    fs.writeFileSync(path.join(sk, 'SKILL.md'), '---\nname: dup\ndescription: d\n---\nbody')
    return src
  }
  ingest(repo, mk(), { displayName: '旧展示名' })
  ingest(repo, mk(), { overwrite: true }) // 覆盖上传，本次不传 displayName

  expect(readMarketplace(repo).plugins[0].displayName).toBeUndefined()
})
