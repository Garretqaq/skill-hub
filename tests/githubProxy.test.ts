/** @author sgz @since 2026-07-04 */
import { expect, test } from 'vitest'
import { parseProxyPath, buildUpstreamUrl } from '@/lib/githubProxy'

test('解析 owner/repo/info/refs', () => {
  const target = parseProxyPath(['Garretqaq', 'plugins-market', 'info', 'refs'])
  expect(target).toEqual({ owner: 'Garretqaq', repo: 'plugins-market', rest: 'info/refs' })
})

test('repo 段去除 .git 后缀', () => {
  const target = parseProxyPath(['a', 'b.git', 'git-upload-pack'])
  expect(target?.repo).toBe('b')
})

test('缺少 repo 段返回 null', () => {
  expect(parseProxyPath(['a'])).toBeNull()
})

test('非法字符返回 null', () => {
  expect(parseProxyPath(['a', '..'])).toBeNull()
  expect(parseProxyPath(['..', 'b'])).toBeNull()
  expect(parseProxyPath(['a', 'b c'])).toBeNull()
})

test('构造 upstream URL 附带 query string', () => {
  const target = parseProxyPath(['a', 'b', 'info', 'refs'])!
  expect(buildUpstreamUrl(target, '?service=git-upload-pack'))
    .toBe('https://github.com/a/b.git/info/refs?service=git-upload-pack')
})

test('无 rest 时不附加多余斜杠', () => {
  const target = parseProxyPath(['a', 'b'])!
  expect(buildUpstreamUrl(target, '')).toBe('https://github.com/a/b.git')
})
