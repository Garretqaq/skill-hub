/** @author sgz @since 2026-07-05 */
import { execFileSync } from 'node:child_process'
import { expect, test } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ingest, previewEntries, hashPackageDir, discoverPackagesFromGit } from '@/lib/ingest'
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

test('overwrite adopts higher upstream package version (watched update)', () => {
  const repo = seedRepo()
  ingest(repo, mkSkill('a', 'v1', '2.6.5'))
  ingest(repo, mkSkill('a', 'v2', '2.11.0'), { overwrite: true })
  expect(pkgField(repo, 'a', 'version')).toBe('2.11.0')
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

// 构造带官网/文档等冗余目录的插件源
function mkFatPlugin(): string {
  const src = tmp()
  const root = path.join(src, 'fat')
  fs.mkdirSync(path.join(root, '.claude-plugin'), { recursive: true })
  fs.writeFileSync(path.join(root, '.claude-plugin/plugin.json'),
    JSON.stringify({ name: 'fat', description: 'F', version: '1.0.0' }))
  fs.mkdirSync(path.join(root, 'skills/a'), { recursive: true })
  fs.writeFileSync(path.join(root, 'skills/a/SKILL.md'), '---\nname: a\n---\nx')
  fs.mkdirSync(path.join(root, 'site/public'), { recursive: true })
  fs.writeFileSync(path.join(root, 'site/public/hero.png'), 'x'.repeat(2048))
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true })
  fs.writeFileSync(path.join(root, 'docs/guide.md'), 'g')
  return src
}
function treeHas(repo: string, p: string): boolean {
  const out = execFileSync('git', ['-C', repo, 'ls-tree', 'HEAD', '--', p]).toString()
  return out.trim().length > 0
}

test('ingest exclude 剔除包根顶层目录', () => {
  const repo = seedRepo()
  ingest(repo, mkFatPlugin(), { exclude: ['site', 'docs'] })
  expect(treeHas(repo, 'plugins/fat/skills/a/SKILL.md')).toBe(true)
  expect(treeHas(repo, 'plugins/fat/.claude-plugin/plugin.json')).toBe(true)
  expect(treeHas(repo, 'plugins/fat/site')).toBe(false)
  expect(treeHas(repo, 'plugins/fat/docs')).toBe(false)
})

test('ingest 不传 exclude 时全量导入（行为不变）', () => {
  const repo = seedRepo()
  ingest(repo, mkFatPlugin())
  expect(treeHas(repo, 'plugins/fat/site/public/hero.png')).toBe(true)
  expect(treeHas(repo, 'plugins/fat/docs/guide.md')).toBe(true)
})

test('ingest exclude 不能剔除包身份文件', () => {
  const repo = seedRepo()
  ingest(repo, mkFatPlugin(), { exclude: ['.claude-plugin', 'site'] })
  expect(treeHas(repo, 'plugins/fat/.claude-plugin/plugin.json')).toBe(true)
})

test('previewEntries 标记黑名单目录为不建议导入', () => {
  const root = path.join(mkFatPlugin(), 'fat')
  const entries = previewEntries(root)
  const by = Object.fromEntries(entries.map(e => [e.path, e]))
  expect(by['site'].suggested).toBe(false)
  expect(by['docs'].suggested).toBe(false)
  expect(by['skills'].suggested).toBe(true)
  expect(by['.claude-plugin'].suggested).toBe(true)
  expect(by['site'].size).toBeGreaterThan(2000) // 递归统计目录体积
  expect(entries[0].path).toBe('site') // 按体积降序
})

test('ingest 更新时沿用上次的 exclude（无需重新勾选）', () => {
  const repo = seedRepo()
  ingest(repo, mkFatPlugin(), { exclude: ['site', 'docs'] })
  expect(readMarketplace(repo).plugins[0].exclude).toEqual(['site', 'docs'])

  // 更新：不传 exclude，应复用 manifest 里记录的勾选
  ingest(repo, mkFatPlugin(), { overwrite: true })
  expect(treeHas(repo, 'plugins/fat/site')).toBe(false)
  expect(treeHas(repo, 'plugins/fat/docs')).toBe(false)
  expect(treeHas(repo, 'plugins/fat/skills/a/SKILL.md')).toBe(true)
  expect(readMarketplace(repo).plugins[0].exclude).toEqual(['site', 'docs'])
})

test('ingest 更新时显式传 exclude 可覆盖旧勾选', () => {
  const repo = seedRepo()
  ingest(repo, mkFatPlugin(), { exclude: ['site', 'docs'] })
  ingest(repo, mkFatPlugin(), { overwrite: true, exclude: ['site'] })
  expect(treeHas(repo, 'plugins/fat/docs/guide.md')).toBe(true) // docs 重新纳入
  expect(treeHas(repo, 'plugins/fat/site')).toBe(false)
  expect(readMarketplace(repo).plugins[0].exclude).toEqual(['site'])
})

test('ingest 更新时传空 exclude 表示全量导入', () => {
  const repo = seedRepo()
  ingest(repo, mkFatPlugin(), { exclude: ['site', 'docs'] })
  ingest(repo, mkFatPlugin(), { overwrite: true, exclude: [] })
  expect(treeHas(repo, 'plugins/fat/site/public/hero.png')).toBe(true)
  expect(readMarketplace(repo).plugins[0].exclude).toBeUndefined()
})

test('ingest 更新保留 origin 的行为不受 exclude 改动影响', () => {
  const repo = seedRepo()
  ingest(repo, mkFatPlugin(), { origin: 'o/r', exclude: ['site'] })
  ingest(repo, mkFatPlugin(), { overwrite: true })
  expect(readMarketplace(repo).plugins[0].origin).toBe('o/r')
})

// —— hashPackageDir：无版本包内容更新检测的哈希基元 ——
function mkTree(files: Record<string, string>): string {
  const dir = tmp()
  for (const [rel, body] of Object.entries(files)) {
    const p = path.join(dir, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, body)
  }
  return dir
}

test('hashPackageDir 相同内容得相同哈希', () => {
  const a = mkTree({ 'SKILL.md': 'x', 'a/b.txt': 'y' })
  const b = mkTree({ 'a/b.txt': 'y', 'SKILL.md': 'x' })  // 创建顺序不同
  expect(hashPackageDir(a)).toBe(hashPackageDir(b))
})

test('hashPackageDir 改一个文件哈希变', () => {
  const a = mkTree({ 'SKILL.md': 'x', 'a/b.txt': 'y' })
  const b = mkTree({ 'SKILL.md': 'x', 'a/b.txt': 'y2' })
  expect(hashPackageDir(a)).not.toBe(hashPackageDir(b))
})

test('hashPackageDir 增删文件哈希变', () => {
  const a = mkTree({ 'SKILL.md': 'x' })
  const b = mkTree({ 'SKILL.md': 'x', 'extra.txt': '' })
  expect(hashPackageDir(a)).not.toBe(hashPackageDir(b))
})

test('hashPackageDir 忽略 .git 目录', () => {
  const a = mkTree({ 'SKILL.md': 'x' })
  const b = mkTree({ 'SKILL.md': 'x', '.git/HEAD': 'ref: refs/heads/main' })
  expect(hashPackageDir(a)).toBe(hashPackageDir(b))
})

test('hashPackageDir 文件名参与哈希（同内容不同名不相等）', () => {
  const a = mkTree({ 'a.txt': 'same' })
  const b = mkTree({ 'b.txt': 'same' })
  expect(hashPackageDir(a)).not.toBe(hashPackageDir(b))
})

test('ingest 在 manifest entry 写入 sourceHash（供无版本包更新检测）', () => {
  const repo = seedRepo()
  ingest(repo, mkSkill('a', 'body'))
  const entry = readMarketplace(repo).plugins.find(p => p.name === 'a')
  expect(entry?.sourceHash).toMatch(/^[0-9a-f]{64}$/)
})

// discoverPackagesFromGit 测试（git 对象读取模式）
function gitRepo(setup: (dir: string) => void): string {
  const dir = tmp()
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 't'], { cwd: dir })
  setup(dir)
  execFileSync('git', ['add', '-A'], { cwd: dir })
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir })
  return dir
}

test('discoverPackagesFromGit 从 git 对象发现插件', () => {
  const repo = gitRepo(dir => {
    fs.mkdirSync(path.join(dir, 'plugins/alpha/.claude-plugin'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'plugins/alpha/.claude-plugin/plugin.json'),
      JSON.stringify({ name: 'alpha', description: 'alpha desc', version: '1.0.0' }))
  })
  const pkgs = discoverPackagesFromGit(repo)
  expect(pkgs).toHaveLength(1)
  expect(pkgs[0]).toMatchObject({ name: 'alpha', kind: 'plugin', description: 'alpha desc', version: '1.0.0', root: 'plugins/alpha' })
  expect(pkgs[0].contentHash).toMatch(/^[0-9a-f]{40}$/) // git tree SHA
})

test('discoverPackagesFromGit 从 git 对象发现 skill', () => {
  const repo = gitRepo(dir => {
    fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: my-skill\ndescription: skill desc\nversion: 2.0.0\n---\nbody')
  })
  const pkgs = discoverPackagesFromGit(repo)
  expect(pkgs).toHaveLength(1)
  expect(pkgs[0]).toMatchObject({ name: 'my-skill', kind: 'skill', description: 'skill desc', version: '2.0.0', root: '' })
  expect(pkgs[0].contentHash).toMatch(/^[0-9a-f]{40}$/)
})

test('discoverPackagesFromGit contentHash 是 git tree SHA', () => {
  const repo = gitRepo(dir => {
    fs.mkdirSync(path.join(dir, 'plugins/test/.claude-plugin'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'plugins/test/.claude-plugin/plugin.json'),
      JSON.stringify({ name: 'test', description: '' }))
    fs.writeFileSync(path.join(dir, 'plugins/test/file.txt'), 'content')
  })
  const pkg = discoverPackagesFromGit(repo)[0]
  // 验证 contentHash 是该目录的 tree SHA（通过 git rev-parse）
  const treeSha = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD:plugins/test']).toString().trim()
  expect(pkg.contentHash).toBe(treeSha)
})

test('discoverPackagesFromGit 引用型包 via marketplace.json', () => {
  const repo = gitRepo(dir => {
    fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true })
    fs.writeFileSync(path.join(dir, '.claude-plugin/marketplace.json'),
      JSON.stringify({ name: 'm', owner: { name: 'x' }, plugins: [
        { name: 'ref-pkg', source: { url: 'https://github.com/ext/pkg.git' }, description: 'ref desc', version: '3.0.0' }
      ]}))
  })
  const pkgs = discoverPackagesFromGit(repo)
  expect(pkgs).toHaveLength(1)
  expect(pkgs[0]).toMatchObject({ name: 'ref-pkg', kind: 'plugin', description: 'ref desc', version: '3.0.0', root: null, sourceUrl: 'https://github.com/ext/pkg.git' })
  expect(pkgs[0].contentHash).toBeUndefined() // 引用型包无 contentHash
})

test('discoverPackagesFromGit 本地包优先于同名引用型', () => {
  const repo = gitRepo(dir => {
    fs.mkdirSync(path.join(dir, 'plugins/shared/.claude-plugin'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'plugins/shared/.claude-plugin/plugin.json'),
      JSON.stringify({ name: 'shared', description: 'local', version: '1.0.0' }))
    fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true })
    fs.writeFileSync(path.join(dir, '.claude-plugin/marketplace.json'),
      JSON.stringify({ name: 'm', owner: { name: 'x' }, plugins: [
        { name: 'shared', source: { url: 'https://github.com/ext/shared.git' }, description: 'remote' }
      ]}))
  })
  const pkgs = discoverPackagesFromGit(repo)
  expect(pkgs).toHaveLength(1)
  expect(pkgs[0]).toMatchObject({ name: 'shared', description: 'local', root: 'plugins/shared' })
})

test('discoverPackagesFromGit 空仓库返回 []', () => {
  const dir = tmp()
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 't'], { cwd: dir })
  expect(discoverPackagesFromGit(dir)).toEqual([])
})
