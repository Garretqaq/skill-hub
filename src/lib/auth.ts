/** @author sgz @since 2026-07-03 */
import crypto from 'node:crypto'
import { ADMIN_USER, ADMIN_PASSWORD } from './config'

function b64url(buf: Buffer): string {
  return buf.toString('base64url')
}
function hmac(data: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(data).digest('base64url')
}
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a), bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return crypto.timingSafeEqual(ab, bb)
}

const DEFAULT_TTL = 7 * 24 * 3600 * 1000

export function signToken(user: string, secret: string, ttlMs = DEFAULT_TTL): string {
  const payload = b64url(Buffer.from(JSON.stringify({ user, exp: Date.now() + ttlMs })))
  return `${payload}.${hmac(payload, secret)}`
}

export function verifyToken(token: string, secret: string): { user: string } | null {
  const [payload, sig] = token.split('.')
  if (!payload || !sig) return null
  if (!safeEqual(sig, hmac(payload, secret))) return null
  try {
    const { user, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString())
    if (typeof exp !== 'number' || exp < Date.now()) return null
    return { user }
  } catch {
    return null
  }
}

export function checkCredentials(user: string, pass: string): boolean {
  if (!ADMIN_USER || !ADMIN_PASSWORD) return false
  // 两个比较都做，避免短路泄露用户名是否正确
  const okUser = safeEqual(user, ADMIN_USER)
  const okPass = safeEqual(pass, ADMIN_PASSWORD)
  return okUser && okPass
}

// 内存防爆破：单机自用足够
const LIMIT = 5
const WINDOW_MS = 5 * 60 * 1000
const attempts = new Map<string, { count: number; until: number }>()

export function recordFailure(ip: string): void {
  const rec = attempts.get(ip)
  const now = Date.now()
  if (!rec || now > rec.until) {
    attempts.delete(ip) // 清理旧记录
    attempts.set(ip, { count: 1, until: now + WINDOW_MS })
  } else {
    rec.count++
    rec.until = now + WINDOW_MS
  }
}
export function isLocked(ip: string): boolean {
  const rec = attempts.get(ip)
  return !!rec && Date.now() <= rec.until && rec.count >= LIMIT
}
export function clearFailures(ip: string): void {
  attempts.delete(ip)
}

export async function getUser(): Promise<{ username: string } | null> {
  const { cookies } = await import('next/headers')
  const { getAuthSecret } = await import('./settings')
  const token = (await cookies()).get('sh_session')?.value // 与登录接口写入的 COOKIE 名一致
  if (!token) return null
  const payload = verifyToken(token, getAuthSecret())
  if (!payload) return null
  return { username: payload.user }
}
