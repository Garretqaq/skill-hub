/** @author sgz @since 2026-07-03 */
import { NextRequest, NextResponse } from 'next/server'
import { checkCredentials, signToken, isLocked, recordFailure, clearFailures } from '@/lib/auth'
import { getAuthSecret } from '@/lib/settings'
import { COOKIE } from '@/lib/session'

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'local'
  if (isLocked(ip)) return NextResponse.json({ error: 'locked' }, { status: 429 })
  const { user, pass } = await req.json().catch(() => ({}))
  if (!checkCredentials(String(user ?? ''), String(pass ?? ''))) {
    recordFailure(ip)
    return NextResponse.json({ error: 'invalid' }, { status: 401 })
  }
  clearFailures(ip)
  const res = NextResponse.json({ ok: true })
  res.cookies.set(COOKIE, signToken(user, getAuthSecret()), {
    httpOnly: true, sameSite: 'lax', path: '/', maxAge: 7 * 24 * 3600,
  })
  return res
}
