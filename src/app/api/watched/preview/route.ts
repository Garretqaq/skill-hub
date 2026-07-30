/** @author sgz @since 2026-07-09 */
import { NextRequest, NextResponse } from 'next/server'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getUser } from '@/lib/session'
import { stripCreds } from '@/lib/config'
import { previewEntries } from '@/lib/ingest'
import { normalizeSource } from '@/lib/remote'
import { withExtractedPackage, withExtractedFromRepo, cloneInto } from '@/lib/watched'

export async function GET(req: NextRequest) {
  if (!(await getUser())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const sp = req.nextUrl.searchParams
  const id = sp.get('id'), name = sp.get('name'), sourceUrl = sp.get('sourceUrl')
  if (!id || !name) return NextResponse.json({ error: 'id and name required' }, { status: 400 })

  // 本地包：从 git 对象提取到临时目录列目录
  const entries = withExtractedPackage(id, name, root => previewEntries(root))
  if (entries) return NextResponse.json({ entries })

  // 引用型包：本地无缓存，临时克隆一次列目录后丢弃
  // ponytail: 克隆两次（预览 + 导入），慢了再加临时克隆缓存
  if (!sourceUrl) return NextResponse.json({ error: 'package not found' }, { status: 404 })
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-preview-'))
  try {
    cloneInto(normalizeSource(sourceUrl), tmp)
    const refEntries = withExtractedFromRepo(tmp, name, root => previewEntries(root))
    if (!refEntries) return NextResponse.json({ error: `package "${name}" not found in remote repository` }, { status: 404 })
    return NextResponse.json({ entries: refEntries })
  } catch (e) {
    return NextResponse.json({ error: stripCreds(String(e)) }, { status: 400 })
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}
