/** @author sgz @since 2026-07-04 */
import { NextRequest, NextResponse } from 'next/server'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getUser } from '@/lib/session'
import { REPO_DIR, stripCreds } from '@/lib/config'
import { syncFromRemote, push, headOf, resetTo } from '@/lib/repo'
import { ingest, discoverPackages, toKebab } from '@/lib/ingest'
import { normalizeSource } from '@/lib/remote'
import { withExtractedPackage, cloneInto, listWatched } from '@/lib/watched'

export async function POST(req: NextRequest) {
  if (!(await getUser())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id, name, sourceUrl, exclude } = await req.json().catch(() => ({}))
  if (!id || !name) return NextResponse.json({ error: 'id and name required' }, { status: 400 })
  const excludeList = Array.isArray(exclude) ? exclude.map(String) : undefined

  // 来源仓库：本地包记监听库 source，引用型包记其外部 sourceUrl
  const watched = listWatched().find(r => r.id === String(id))
  const origin = sourceUrl && typeof sourceUrl === 'string' ? String(sourceUrl) : watched?.source

  // 本地包：从 git 对象提取后导入；sourceHash 传远程 tree SHA（与 contentHash 同源可比）
  let localResult: unknown = null
  try {
    localResult = withExtractedPackage(String(id), String(name), (root, treeSha) => {
      syncFromRemote() // 先与远程对齐（含 ensureRepo），避免 remote 领先时 push 非快进被拒
      const before = headOf()
      const res = ingest(REPO_DIR, root, { overwrite: true, origin, exclude: excludeList, sourceHash: treeSha })
      try {
        push()
      } catch (e) {
        if (before) resetTo(before)
        throw new Error(`push failed: ${stripCreds(String(e))}`)
      }
      return res
    })
  } catch (e) {
    return NextResponse.json({ error: stripCreds(String(e)) }, { status: 400 })
  }
  if (localResult) return NextResponse.json(localResult)

  // 引用型包：本地无文件但提供了 sourceUrl，临时克隆导入
  if (sourceUrl && typeof sourceUrl === 'string') {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-ref-'))
    try {
      // 克隆远程仓库到临时目录
      cloneInto(normalizeSource(String(sourceUrl)), tmp)

      // 发现包根（引用型包的远程仓库应该是实际的 plugin/skill 仓库）
      const packages = discoverPackages(tmp)
      const pkg = packages.find(p => toKebab(p.name) === toKebab(String(name)))
      if (!pkg || !pkg.root) {
        return NextResponse.json({
          error: `package "${name}" not found in remote repository`
        }, { status: 404 })
      }

      // 导入（同本地包流程）
      syncFromRemote() // 先与远程对齐（含 ensureRepo），避免 remote 领先时 push 非快进被拒
      const before = headOf()
      const res = ingest(REPO_DIR, pkg.root, { overwrite: true, origin, exclude: excludeList })
      try {
        push()
      } catch (e) {
        if (before) resetTo(before)
        return NextResponse.json({
          error: 'push failed',
          detail: stripCreds(String(e))
        }, { status: 500 })
      }
      return NextResponse.json(res)
    } catch (e) {
      return NextResponse.json({
        error: stripCreds(String(e))
      }, { status: 400 })
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  }

  return NextResponse.json({ error: 'package not found' }, { status: 404 })
}
