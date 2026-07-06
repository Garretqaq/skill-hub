/** @author sgz @since 2026-07-06 */
import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/session'
import { REPO_DIR, stripCreds } from '@/lib/config'
import { syncFromRemote, headOf, push, resetTo } from '@/lib/repo'
import { reorderPlugins } from '@/lib/marketplace'

export async function PATCH(req: NextRequest) {
  if (!(await getUser())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const order = body?.order
  if (!Array.isArray(order) || !order.every((n: unknown) => typeof n === 'string')) {
    return NextResponse.json({ error: 'order (string[]) required' }, { status: 400 })
  }

  syncFromRemote() // 先与远程对齐，避免非快进被拒
  const before = headOf()
  try {
    reorderPlugins(REPO_DIR, order)
  } catch (e) {
    return NextResponse.json({ error: stripCreds(String(e)) }, { status: 400 })
  }
  try {
    push()
  } catch (e) {
    if (before) resetTo(before)
    return NextResponse.json({ error: 'push failed', detail: stripCreds(String(e)) }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
