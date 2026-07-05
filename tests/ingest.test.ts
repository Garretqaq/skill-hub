/** @author sgz @since 2026-07-05 */
import { execFileSync } from 'node:child_process'
import { expect, test } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ingest } from '@/lib/ingest'
import { readMarketplace } from '@/lib/marketplace'

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sh-'))
}
// no-checkout 仓库：init + 空 manifest 提交 + 清空工作目录
function seedRepo(): string {
  const dir = tmp()
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 't'], { cwd: dir })
  fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.claude-plugin', 'marketplace.json'),
    JSON.stringify({ name: 'm', owner: { name: 'sgz' }, plugins: [] }))
  execFileSync('git', ['add', '-A'], { cwd: dir })
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir })
  for (const f of fs.readdirSync(dir)) {
    if (f !== '.git') fs.rmSync(path.join(dir, f), { recursive: true, force: true })
  }
  return dir
}
// 从 HEAD 读取插件 plugin.json 的某个字段
function pkgField(repo: string, name: string, field: string): string {
  const s = execFileSync('git', ['-C', repo, 'show', `HEAD:plugins/${name}/.claude-plugin/plugin.json`]).toString()
  return JSON.parse(s)[field]
}
function pluginExists(repo: string, name: string): boolean {
  const out = execFileSync('git', ['-C', repo, 'ls-tree', 'HEAD', '--', `plugins/${name}`]).toString()
  return out.trim().length > 0
}
function mkSkill(name: string, body: string, version?: string): string {
  const src = tmp()
  const sk = path.join(src, name)
  fs.mkdirSync(sk, { recursive: true })
  const vLine = version ? `version: ${version}\n` : ''
  fs.writeFileSync(path.join(sk, 'SKILL.md'), `---\nname: ${name}\ndescription: d\n${vLine}---\n${body}`)
  return src
}

test('ingest bare skill wraps into a plugin', () => {
  const repo = seedRepo()
  const src = tmp()
  const sk = path.join(src, 'my-skill')
  fs.mkdirSync(sk, { recursive: true })
  fs.writeFileSync(path.join(sk, 'SKILL.md'), '---\nname: my-skill\ndescription: d\n---\nbody')
  const res = ingest(repo, src)
  expect(res).toEqual({ name: 'my-skill', type: 'skill' })
  expect(pluginExists(repo, 'my-skill')).toBe(true)
  const pj = execFileSync('git', ['-C', repo, 'show', 'HEAD:plugins/my-skill/.claude-plugin/plugin.json']).toString()
  expect(JSON.parse(pj).name).toBe('my-skill')
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
  expect(pluginExists(repo, 'toolkit')).toBe(true)
  expect(readMarketplace(repo).plugins[0].name).toBe('toolkit')
})

test('duplicate name throws', () => {
  const repo = seedRepo()
  const src = mkSkill('dup', 'b')
  ingest(repo, src)
  expect(() => ingest(repo, src)).toThrow(/name exists/)
})

test('overwrite replaces existing plugin instead of throwing', () => {
  const repo = seedRepo()
  const mk = (body: string) => mkSkill('dup', body)
  ingest(repo, mk('v1'))
  ingest(repo, mk('v2'), { overwrite: true })
  const skill = execFileSync('git', ['-C', repo, 'show', 'HEAD:plugins/dup/skills/dup/SKILL.md']).toString()
  expect(skill).toContain('v2')
  expect(readMarketplace(repo).plugins.filter(p => p.name === 'dup')).toHaveLength(1)
})

test('non-overwrite request to existing name throws name-exists even with non-increasing version', () => {
  const repo = seedRepo()
  const mk = (body: string) => mkSkill('dup2', body)
  ingest(repo, mk('v1'))
  expect(() => ingest(repo, mk('v2'), { version: '1.0.0' })).toThrow(/name exists/)
})

test('unrecognized package throws', () => {
  const repo = seedRepo()
  const src = tmp()
  fs.writeFileSync(path.join(src, 'readme.txt'), 'nothing here')
  expect(() => ingest(repo, src)).toThrow(/unrecognized/)
})

test('new bare skill without version defaults to 1.0.0', () => {
  const repo = seedRepo()
  ingest(repo, mkSkill('a', 'v1'))
  expect(pkgField(repo, 'a', 'version')).toBe('1.0.0')
  expect(readMarketplace(repo).plugins.find(p => p.name === 'a')?.version).toBe('1.0.0')
})

test('new skill uses form version when provided', () => {
  const repo = seedRepo()
  ingest(repo, mkSkill('a', 'v1'), { version: '2.5.0' })
  expect(pkgField(repo, 'a', 'version')).toBe('2.5.0')
})

test('overwrite with empty version bumps patch', () => {
  const repo = seedRepo()
  ingest(repo, mkSkill('a', 'v1'))
  ingest(repo, mkSkill('a', 'v2'), { overwrite: true })
  expect(pkgField(repo, 'a', 'version')).toBe('1.0.1')
})

test('overwrite with higher form version uses it', () => {
  const repo = seedRepo()
  ingest(repo, mkSkill('a', 'v1'))
  ingest(repo, mkSkill('a', 'v2'), { overwrite: true, version: '1.4.0' })
  expect(pkgField(repo, 'a', 'version')).toBe('1.4.0')
})

test('overwrite rejects non-increasing version', () => {
  const repo = seedRepo()
  ingest(repo, mkSkill('a', 'v1'), { version: '2.0.0' })
  expect(() => ingest(repo, mkSkill('a', 'v2'), { overwrite: true, version: '2.0.0' })).toThrow(/higher than current/)
  expect(() => ingest(repo, mkSkill('a', 'v2'), { overwrite: true, version: '1.0.0' })).toThrow(/higher than current/)
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
  expect(pkgField(repo, 'my-skill', 'description')).toBe('custom desc')
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

test('overwrite without displayName clears previous displayName', () => {
  const repo = seedRepo()
  const mk = () => mkSkill('dup', 'body')
  ingest(repo, mk(), { displayName: '旧展示名' })
  ingest(repo, mk(), { overwrite: true })
  expect(readMarketplace(repo).plugins[0].displayName).toBeUndefined()
})

test('ingest 跳过源 .git 目录，避免目标成 gitlink', () => {
  const repo = seedRepo()
  const src = tmp()
  fs.mkdirSync(path.join(src, '.claude-plugin'), { recursive: true })
  fs.writeFileSync(path.join(src, '.claude-plugin/plugin.json'),
    JSON.stringify({ name: 'pkg', description: 'd', version: '1.0.0' }))
  fs.mkdirSync(path.join(src, '.git'), { recursive: true })
  fs.writeFileSync(path.join(src, '.git', 'HEAD'), 'ref: refs/heads/main\n')
  const res = ingest(repo, src)
  expect(res).toEqual({ name: 'pkg', type: 'plugin' })
  expect(pluginExists(repo, 'pkg')).toBe(true)
  // 源 .git 未被带入 HEAD tree
  const tree = execFileSync('git', ['-C', repo, 'ls-tree', '-r', '--name-only', 'HEAD', '--', 'plugins/pkg']).toString()
  expect(tree).not.toContain('.git')
})


test('ingest 记录 origin 到 manifest，覆盖时未显式提供则保留原 origin', () => {
  const repo = seedRepo()
  // 首次导入带 origin
  ingest(repo, mkSkill('s', 'body', '1.0.0'), { origin: 'owner/repo' })
  expect(readMarketplace(repo).plugins[0].origin).toBe('owner/repo')
  // 覆盖导入不传 origin：保留原值
  ingest(repo, mkSkill('s', 'body2', '1.1.0'), { overwrite: true })
  expect(readMarketplace(repo).plugins[0].origin).toBe('owner/repo')
  // 覆盖导入传新 origin：更新
  ingest(repo, mkSkill('s', 'body3', '1.2.0'), { overwrite: true, origin: 'https://x/a/b.git' })
  expect(readMarketplace(repo).plugins[0].origin).toBe('https://x/a/b.git')
})

test('ingest 无 origin 时 manifest origin 为 undefined（本地上传）', () => {
  const repo = seedRepo()
  ingest(repo, mkSkill('local', 'body', '1.0.0'))
  expect(readMarketplace(repo).plugins[0].origin).toBeUndefined()
})
