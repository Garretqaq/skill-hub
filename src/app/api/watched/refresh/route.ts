/** @author sgz @since 2026-07-04 */
import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/session'
import { stripCreds } from '@/lib/config'
import { refreshWatched, refreshAll } from '@/lib/watched'

export async function POST(req: NextRequest) {
  if (!(await getUser())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await req.json().catch(() => ({}))
  try {
    if (id) await refreshWatched(String(id)); else await refreshAll()
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: stripCreds(String(e)) }, { status: 500 })
  }
}
