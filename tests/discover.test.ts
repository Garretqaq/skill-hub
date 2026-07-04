/** @author sgz @since 2026-07-04 */
import { expect, test } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { findRoots, discoverPackages } from '@/lib/ingest'

function tmp(): string { return fs.mkdtempSync(path.join(os.tmpdir(), 'shdisc-')) }

function plugin(dir: string, name: string, withSkill = true) {
  const root = path.join(dir, 'plugins', name)
  fs.mkdirSync(path.join(root, '.claude-plugin'), { recursive: true })
  fs.writeFileSync(path.join(root, '.claude-plugin/plugin.json'),
    JSON.stringify({ name, description: `${name} desc`, version: '1.0.0' }))
  if (withSkill) {
    fs.mkdirSync(path.join(root, 'skills', name), { recursive: true })
    fs.writeFileSync(path.join(root, 'skills', name, 'SKILL.md'), `---\nname: ${name}\n---\nx`)
  }
}

test('findRoots 发现多个插件，且插件内嵌 skill 不被重复计数', () => {
  const dir = tmp()
  plugin(dir, 'alpha')
  plugin(dir, 'beta')
  const roots = findRoots(dir)
  expect(roots).toHaveLength(2)
  expect(roots.every(r => r.kind === 'plugin')).toBe(true)
})

test('findRoots 识别裸 skill 仓库', () => {
  const dir = tmp()
  const sk = path.join(dir, 'my-skill')
  fs.mkdirSync(sk, { recursive: true })
  fs.writeFileSync(path.join(sk, 'SKILL.md'), '---\nname: my-skill\n---\nx')
  const roots = findRoots(dir)
  expect(roots).toEqual([{ root: sk, kind: 'skill' }])
})

test('discoverPackages 读出 name/description', () => {
  const dir = tmp()
  plugin(dir, 'alpha')
  const pkgs = discoverPackages(dir)
  expect(pkgs).toHaveLength(1)
  expect(pkgs[0]).toMatchObject({ name: 'alpha', kind: 'plugin', description: 'alpha desc' })
  expect(fs.existsSync(path.join(pkgs[0].root, '.claude-plugin/plugin.json'))).toBe(true)
})
