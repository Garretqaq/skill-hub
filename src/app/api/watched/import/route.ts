/** @author sgz @since 2026-07-04 */
import { NextRequest, NextResponse } from 'next/server'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getUser } from '@/lib/session'
import { REPO_DIR, stripCreds } from '@/lib/config'
import { syncFromRemote, push, headOf, resetTo } from '@/lib/repo'
import { ingest } from '@/lib/ingest'
import { normalizeSource } from '@/lib/remote'
import { withExtractedPackage, withExtractedFromRepo, cloneInto, listWatched } from '@/lib/watched'

export async function POST(req: NextRequest) {
  if (!(await getUser())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id, name, sourceUrl, exclude } = await req.json().catch(() => ({}))
  if (!id || !name) return NextResponse.json({ error: 'id and name required' }, { status: 400 })
  const excludeList = Array.isArray(exclude) ? exclude.map(String) : undefined

  // 来源仓库：本地包记监听库 source，引用型包记其外部 sourceUrl
  const watched = listWatched().find(r => r.id === String(id))
  const origin = sourceUrl && typeof sourceUrl === 'string' ? String(sourceUrl) : watched?.source

  syncFromRemote() // 先与远程对齐（含 ensureRepo），避免 remote 领先时 push 非快进被拒
  const before = headOf()

  // 提取包文件并 ingest；sourceHash 传源仓库的 git tree SHA（与 contentHash 同源可比）
  const doIngest = (root: string, treeSha?: string) =>
    ingest(REPO_DIR, root, { overwrite: true, origin, exclude: excludeList, sourceHash: treeSha })

  let res
  try {
    // 本地包：直接从监听库缓存的 git 对象提取
    res = withExtractedPackage(String(id), String(name), doIngest)

    // 引用型包：本地无文件，临时克隆其外部仓库后同样从 git 对象提取
    if (!res && sourceUrl && typeof sourceUrl === 'string') {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-ref-'))
      try {
        cloneInto(normalizeSource(String(sourceUrl)), tmp)
        res = withExtractedFromRepo(tmp, String(name), doIngest)
        if (!res) return NextResponse.json({ error: `package "${name}" not found in remote repository` }, { status: 404 })
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true })
      }
    }
  } catch (e) {
    return NextResponse.json({ error: stripCreds(String(e)) }, { status: 400 })
  }
  if (!res) return NextResponse.json({ error: 'package not found' }, { status: 404 })

  try {
    push()
  } catch (e) {
    if (before) resetTo(before)
    return NextResponse.json({ error: 'push failed', detail: stripCreds(String(e)) }, { status: 500 })
  }
  return NextResponse.json(res)
}
