/** @author sgz @since 2026-07-03 */
import { cookies } from 'next/headers'
import { verifyToken } from './auth'
import { getAuthSecret } from './settings'

export const COOKIE = 'sh_session'

export async function getUser(): Promise<string | null> {
  const token = (await cookies()).get(COOKIE)?.value
  if (!token) return null
  return verifyToken(token, getAuthSecret())?.user ?? null
}

export async function requireUser(): Promise<string> {
  const user = await getUser()
  if (!user) throw new Response('unauthorized', { status: 401 })
  return user
}
