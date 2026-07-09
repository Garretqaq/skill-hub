/** @author sgz @since 2026-07-04 */
import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/session'
import { stripCreds } from '@/lib/config'
import { refreshWatched, refreshAll } from '@/lib/watched'

export async function POST(req: NextRequest) {
  if (!(await getUser())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await req.json().catch(() => ({}))
  try {
    if (id) {
      await refreshWatched(String(id))
      return NextResponse.json({ total: 1, ok: 1, failed: [] })
    }
    const result = await refreshAll()
    return NextResponse.json({ ...result, failed: result.failed.map(stripCreds) })
  } catch (e) {
    return NextResponse.json({ error: stripCreds(String(e)) }, { status: 500 })
  }
}
