/** @author sgz @since 2026-07-04 */
import { expect, test } from 'vitest'
import { normalizeSource } from '@/lib/remote'

test('owner/repo 展开为 github URL', () => {
  expect(normalizeSource('obra/superpowers-marketplace'))
    .toBe('https://github.com/obra/superpowers-marketplace.git')
})

test('owner/repo.git 去重后缀', () => {
  expect(normalizeSource('a/b.git')).toBe('https://github.com/a/b.git')
})

test('完整 https URL 原样返回', () => {
  expect(normalizeSource('https://gitlab.com/x/y.git')).toBe('https://gitlab.com/x/y.git')
})

test('git@ ssh URL 原样返回', () => {
  expect(normalizeSource('git@github.com:x/y.git')).toBe('git@github.com:x/y.git')
})

test('拒绝本地路径', () => {
  expect(() => normalizeSource('/etc/passwd')).toThrow(/invalid source/)
  expect(() => normalizeSource('./secret')).toThrow(/invalid source/)
  expect(() => normalizeSource('~/x')).toThrow(/invalid source/)
})

test('拒绝 file://', () => {
  expect(() => normalizeSource('file:///etc')).toThrow(/invalid source/)
})

test('拒绝空来源', () => {
  expect(() => normalizeSource('  ')).toThrow(/empty source/)
})

test('拒绝大小写变体 file://', () => {
  expect(() => normalizeSource('FILE:///etc')).toThrow(/invalid source/)
  expect(() => normalizeSource('File:///x')).toThrow(/invalid source/)
})

test('ssh:// URL 原样返回', () => {
  expect(normalizeSource('ssh://git@github.com/x/y.git')).toBe('ssh://git@github.com/x/y.git')
})

test('大写 HTTPS 协议原样返回', () => {
  expect(normalizeSource('HTTPS://github.com/a/b.git')).toBe('HTTPS://github.com/a/b.git')
})
