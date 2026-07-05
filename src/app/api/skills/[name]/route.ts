/** @author sgz @since 2026-07-03 */
import { NextRequest, NextResponse } from 'next/server'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { getUser } from '@/lib/session'
import { REPO_DIR, stripCreds } from '@/lib/config'
import { readMarketplace } from '@/lib/marketplace'
import { syncFromRemote, push, headOf, resetTo } from '@/lib/repo'
import { withWorkTree } from '@/lib/worktree'

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ name: string }> }) {
  if (!(await getUser())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { name } = await ctx.params

  syncFromRemote() // 先与远程对齐，避免 remote 领先时 push 非快进被拒；也让存在性判断基于最新状态

  // 检查 plugins/<name> 是否在 HEAD tree（no-checkout 下工作目录为空，不能用 fs.existsSync）
  let exists = false
  try {
    const out = execFileSync('git', ['-C', REPO_DIR, 'ls-tree', 'HEAD', '--', `plugins/${name}`], { stdio: ['ignore', 'pipe', 'pipe'] }).toString()
    exists = out.trim().length > 0
  } catch { /* 仓库无 HEAD 时视为不存在 */ }
  if (!exists) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const before = headOf() // 记录删除前状态，push 失败时回滚
  withWorkTree(REPO_DIR, wt => {
    fs.rmSync(path.join(wt, 'plugins', name), { recursive: true, force: true })
    const m = readMarketplace(REPO_DIR)
    m.plugins = m.plugins.filter(p => p.name !== name)
    fs.writeFileSync(path.join(wt, '.claude-plugin', 'marketplace.json'), JSON.stringify(m, null, 2) + '\n')
  }, `remove ${name}`)
  try {
    push()
  } catch (e) {
    if (before) resetTo(before)
    return NextResponse.json({ error: 'push failed', detail: stripCreds(String(e)) }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
