/** @author sgz @since 2026-07-04 */
import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/session'
import { stripCreds } from '@/lib/config'
import { listWatched, search, addWatched, removeWatched, commitWatchedToRepo, restoreWatchedFromRepo, buildIndex } from '@/lib/watched'
import { ensureRepo, push, headOf, resetTo } from '@/lib/repo'

// 监听列表变更后同步进市场仓库并推送；push 失败回滚仓库提交但保留本地变更，仅回传告警
function syncWatched(): string | null {
  ensureRepo()
  const before = headOf()
  try {
    commitWatchedToRepo()
    push()
    return null
  } catch (e) {
    if (before) resetTo(before)
    return stripCreds(String(e))
  }
}

export async function GET(req: NextRequest) {
  if (!(await getUser())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  ensureRepo()
  restoreWatchedFromRepo() // 容器重建后本地列表缺失则从仓库恢复
  const q = new URL(req.url).searchParams.get('q') ?? ''
  // 每个监听库发现的包数量（未过滤，用于列表展示）
  const counts = new Map<string, number>()
  for (const p of buildIndex()) counts.set(p.repoId, (counts.get(p.repoId) ?? 0) + 1)
  const repos = listWatched().map(r => ({ ...r, packageCount: counts.get(r.id) ?? 0 }))
  return NextResponse.json({ repos, results: search(q) })
}

export async function POST(req: NextRequest) {
  if (!(await getUser())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { source } = await req.json().catch(() => ({}))
  if (!source) return NextResponse.json({ error: 'source required' }, { status: 400 })
  try {
    const repo = addWatched(String(source))
    const warning = syncWatched()
    return NextResponse.json({ ...repo, warning })
  } catch (e) {
    return NextResponse.json({ error: stripCreds(String(e)) }, { status: 400 })
  }
}

export async function DELETE(req: NextRequest) {
  if (!(await getUser())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await req.json().catch(() => ({}))
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  removeWatched(String(id))
  const warning = syncWatched()
  return NextResponse.json({ ok: true, warning })
}
