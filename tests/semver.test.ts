import { expect, test } from 'vitest'
import { isValidVersion, bumpPatch, compareVersions } from '@/lib/semver'

test('isValidVersion accepts x.y.z only', () => {
  expect(isValidVersion('1.0.0')).toBe(true)
  expect(isValidVersion('10.20.30')).toBe(true)
  expect(isValidVersion('1.0')).toBe(false)
  expect(isValidVersion('1.0.0-beta')).toBe(false)
  expect(isValidVersion('v1.0.0')).toBe(false)
  expect(isValidVersion('')).toBe(false)
})

test('bumpPatch increments last segment', () => {
  expect(bumpPatch('1.0.0')).toBe('1.0.1')
  expect(bumpPatch('2.3.9')).toBe('2.3.10')
})

test('compareVersions compares numerically per segment', () => {
  expect(compareVersions('1.0.0', '1.0.1')).toBe(-1)
  expect(compareVersions('1.0.1', '1.0.0')).toBe(1)
  expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
  expect(compareVersions('1.2.0', '1.10.0')).toBe(-1) // 数值比较而非字符串
  expect(compareVersions('2.0.0', '1.9.9')).toBe(1)
})
