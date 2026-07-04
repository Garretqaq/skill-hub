/** @author sgz @since 2026-07-04 */
import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/session'
import { stripCreds } from '@/lib/config'
import { listWatched, search, addWatched, removeWatched } from '@/lib/watched'

export async function GET(req: NextRequest) {
  if (!(await getUser())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const q = new URL(req.url).searchParams.get('q') ?? ''
  return NextResponse.json({ repos: listWatched(), results: search(q) })
}

export async function POST(req: NextRequest) {
  if (!(await getUser())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { source } = await req.json().catch(() => ({}))
  if (!source) return NextResponse.json({ error: 'source required' }, { status: 400 })
  try {
    return NextResponse.json(addWatched(String(source)))
  } catch (e) {
    return NextResponse.json({ error: stripCreds(String(e)) }, { status: 400 })
  }
}

export async function DELETE(req: NextRequest) {
  if (!(await getUser())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await req.json().catch(() => ({}))
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  removeWatched(String(id))
  return NextResponse.json({ ok: true })
}
