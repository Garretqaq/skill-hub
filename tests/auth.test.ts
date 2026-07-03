/** @author sgz @since 2026-07-03 */
import { expect, test, vi, beforeEach } from 'vitest'
import { signToken, verifyToken, isLocked, recordFailure, clearFailures, checkCredentials } from '@/lib/auth'

const SECRET = 'test-secret'

test('sign then verify round-trips the user', () => {
  const t = signToken('alice', SECRET)
  expect(verifyToken(t, SECRET)).toEqual({ user: 'alice' })
})

test('verify rejects tampered token', () => {
  const t = signToken('alice', SECRET)
  expect(verifyToken(t + 'x', SECRET)).toBeNull()
})

test('verify rejects wrong secret', () => {
  const t = signToken('alice', SECRET)
  expect(verifyToken(t, 'other')).toBeNull()
})

test('verify rejects expired token', () => {
  const t = signToken('alice', SECRET, -1000) // already expired
  expect(verifyToken(t, SECRET)).toBeNull()
})

test('lockout after 5 failures, cleared on success', () => {
  const ip = '1.2.3.4'
  clearFailures(ip)
  for (let i = 0; i < 4; i++) recordFailure(ip)
  expect(isLocked(ip)).toBe(false)
  recordFailure(ip)
  expect(isLocked(ip)).toBe(true)
  clearFailures(ip)
  expect(isLocked(ip)).toBe(false)
})

beforeEach(() => {
  vi.resetModules()
})

test('checkCredentials with correct credentials', async () => {
  vi.stubEnv('ADMIN_USER', 'admin')
  vi.stubEnv('ADMIN_PASSWORD', 'password')
  const { checkCredentials: check } = await import('@/lib/auth')
  expect(check('admin', 'password')).toBe(true)
  vi.unstubAllEnvs()
})

test('checkCredentials with wrong username', async () => {
  vi.stubEnv('ADMIN_USER', 'admin')
  vi.stubEnv('ADMIN_PASSWORD', 'password')
  const { checkCredentials: check } = await import('@/lib/auth')
  expect(check('wrong', 'password')).toBe(false)
  vi.unstubAllEnvs()
})

test('checkCredentials with wrong password', async () => {
  vi.stubEnv('ADMIN_USER', 'admin')
  vi.stubEnv('ADMIN_PASSWORD', 'password')
  const { checkCredentials: check } = await import('@/lib/auth')
  expect(check('admin', 'wrong')).toBe(false)
  vi.unstubAllEnvs()
})

test('checkCredentials with empty credentials', async () => {
  vi.stubEnv('ADMIN_USER', '')
  vi.stubEnv('ADMIN_PASSWORD', '')
  const { checkCredentials: check } = await import('@/lib/auth')
  expect(check('', '')).toBe(false)
  vi.unstubAllEnvs()
})
