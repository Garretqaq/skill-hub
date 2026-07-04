/** @author sgz @since 2026-07-04 */
import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/session'
import { REPO_DIR, stripCreds } from '@/lib/config'
import { ensureRepo, commitAll, push, headOf, resetTo } from '@/lib/repo'
import { ingest } from '@/lib/ingest'
import { packageRoot } from '@/lib/watched'

export async function POST(req: NextRequest) {
  if (!(await getUser())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id, name } = await req.json().catch(() => ({}))
  if (!id || !name) return NextResponse.json({ error: 'id and name required' }, { status: 400 })

  const root = packageRoot(String(id), String(name))
  if (!root) return NextResponse.json({ error: 'package not found' }, { status: 404 })

  ensureRepo()
  const before = headOf() // push 失败时回滚到此，同上传流
  try {
    const res = ingest(REPO_DIR, root, { overwrite: true })
    commitAll(`add ${res.name} (from ${id})`)
    try {
      push()
    } catch (e) {
      if (before) resetTo(before)
      return NextResponse.json({ error: 'push failed', detail: stripCreds(String(e)) }, { status: 500 })
    }
    return NextResponse.json(res)
  } catch (e) {
    return NextResponse.json({ error: stripCreds(String(e)) }, { status: 400 })
  }
}
