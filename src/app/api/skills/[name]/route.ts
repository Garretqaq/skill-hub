/** @author sgz @since 2026-07-03 */
import { NextRequest, NextResponse } from 'next/server'
import fs from 'node:fs'
import path from 'node:path'
import { getUser } from '@/lib/session'
import { REPO_DIR } from '@/lib/config'
import { readMarketplace } from '@/lib/marketplace'
import { commitAll, push, resetHard } from '@/lib/repo'

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ name: string }> }) {
  if (!(await getUser())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { name } = await ctx.params

  const pluginDir = path.join(REPO_DIR, 'plugins', name)
  if (!fs.existsSync(pluginDir)) return NextResponse.json({ error: 'not found' }, { status: 404 })

  fs.rmSync(pluginDir, { recursive: true, force: true })
  const manifest = path.join(REPO_DIR, '.claude-plugin', 'marketplace.json')
  const m = readMarketplace(REPO_DIR)
  m.plugins = m.plugins.filter(p => p.name !== name)
  fs.writeFileSync(manifest, JSON.stringify(m, null, 2) + '\n')

  commitAll(`remove ${name}`)
  try {
    push()
  } catch (e) {
    resetHard()
    return NextResponse.json({ error: 'push failed', detail: String(e) }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
