/** @author sgz @since 2026-07-04 */
import { NextRequest, NextResponse } from 'next/server'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getUser } from '@/lib/session'
import { REPO_DIR, stripCreds } from '@/lib/config'
import { syncFromRemote, commitAll, push, headOf, resetTo } from '@/lib/repo'
import { ingest, discoverPackages, toKebab } from '@/lib/ingest'
import { normalizeSource } from '@/lib/remote'
import { packageRoot, cloneInto, updateStatus } from '@/lib/watched'

export async function GET() {
  if (!(await getUser())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  return NextResponse.json({ updates: updateStatus() })
}

export async function POST(req: NextRequest) {
  if (!(await getUser())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { name } = await req.json().catch(() => ({}))
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })

  const item = updateStatus().find(u => u.name === String(name))
  if (!item) return NextResponse.json({ error: 'no update available' }, { status: 404 })

  syncFromRemote() // 先与远程对齐（含 ensureRepo），避免 remote 领先时 push 非快进被拒
  const before = headOf()

  // 引用型包：临时克隆源仓库
  if (item.sourceUrl) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-upd-'))
    try {
      cloneInto(normalizeSource(item.sourceUrl), tmp)
      const pkg = discoverPackages(tmp).find(p => toKebab(p.name) === toKebab(item.name))
      if (!pkg || !pkg.root) {
        return NextResponse.json({ error: `package "${item.name}" not found in remote` }, { status: 404 })
      }
      const res = ingest(REPO_DIR, pkg.root, { overwrite: true, version: item.remoteVersion })
      commitAll(`update ${res.name} to ${item.remoteVersion} (from remote ${item.sourceUrl})`)
      try {
        push()
      } catch (e) {
        if (before) resetTo(before)
        return NextResponse.json({ error: 'push failed', detail: stripCreds(String(e)) }, { status: 500 })
      }
      return NextResponse.json(res)
    } catch (e) {
      return NextResponse.json({ error: stripCreds(String(e)) }, { status: 400 })
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  }

  // 监听库文件包：从缓存 root 覆盖导入
  const root = packageRoot(item.repoId, item.name)
  if (!root) return NextResponse.json({ error: 'source package not found; refresh the repo' }, { status: 404 })
  try {
    const res = ingest(REPO_DIR, root, { overwrite: true, version: item.remoteVersion })
    commitAll(`update ${res.name} to ${item.remoteVersion} (from ${item.repoId})`)
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
