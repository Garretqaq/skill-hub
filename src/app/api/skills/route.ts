/** @author sgz @since 2026-07-03 */
import { NextRequest, NextResponse } from 'next/server'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import AdmZip from 'adm-zip'
import { getUser } from '@/lib/session'
import { REPO_DIR } from '@/lib/config'
import { ensureRepo, commitAll, push, headOf, resetTo } from '@/lib/repo'
import { ingest } from '@/lib/ingest'

export async function POST(req: NextRequest) {
  if (!(await getUser())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const form = await req.formData()
  const file = form.get('file')
  const nameOverride = form.get('name')
  const overwrite = form.get('overwrite') === 'true'
  const version = form.get('version')
  if (!(file instanceof File)) return NextResponse.json({ error: 'file required' }, { status: 400 })

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-upload-'))
  try {
    const buf = Buffer.from(await file.arrayBuffer())
    new AdmZip(buf).extractAllTo(tmp, true)
    ensureRepo()
    const before = headOf() // ensureRepo 保证有基础提交，push 失败时回滚到此
    const res = ingest(REPO_DIR, tmp, {
      name: nameOverride ? String(nameOverride) : undefined,
      overwrite,
      version: version ? String(version).trim() : undefined,
    })
    commitAll(`${overwrite ? 'update' : 'add'} ${res.name}`)
    try {
      push()
    } catch (e) {
      if (before) resetTo(before)
      return NextResponse.json({ error: 'push failed', detail: String(e) }, { status: 500 })
    }
    return NextResponse.json(res)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 })
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}
