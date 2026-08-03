/** @author sgz @since 2026-07-03 */
import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/session'
import { REPO_DIR, stripCreds } from '@/lib/config'
import { getSettings, saveSettings, getRepoUrl, getMarketName } from '@/lib/settings'
import { validateProxyUrl } from '@/lib/proxy'
import { writeMarketName } from '@/lib/marketplace'
import { setRemoteUrl, ensureRepo, push, headOf, resetTo, syncFromRemote } from '@/lib/repo'

export async function GET() {
  if (!(await getUser())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  return NextResponse.json(getSettings()) // { repoUrl（脱敏）, hasToken, name }
}

export async function PUT(req: NextRequest) {
  if (!(await getUser())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { repoUrl, token, name, proxyUrl, proxyAuth, noProxy } = await req.json()
  const url = typeof repoUrl === 'string' ? repoUrl.trim() : ''
  if (!url) return NextResponse.json({ error: 'repoUrl required' }, { status: 400 })

  let proxy: { proxyUrl?: string; proxyAuth?: string; noProxy?: string } | undefined
  try {
    proxy = {
      proxyUrl: typeof proxyUrl === 'string' ? validateProxyUrl(proxyUrl) : undefined,
      proxyAuth: typeof proxyAuth === 'string' ? proxyAuth.trim() : undefined,
      noProxy: typeof noProxy === 'string' ? noProxy.trim() : undefined,
    }
  } catch (e) {
    return NextResponse.json({ error: 'invalid proxy', detail: stripCreds(String(e)) }, { status: 400 })
  }

  // 代理先落盘：下面的 syncFromRemote 要用新代理出网
  saveSettings(url, typeof token === 'string' ? token.trim() : undefined, proxy)
  try {
    setRemoteUrl(getRepoUrl()) // 用注入 token 后的完整地址更新 origin
  } catch (e) {
    return NextResponse.json({ error: 'set remote failed', detail: stripCreds(String(e)) }, { status: 500 })
  }

  try {
    syncFromRemote() // 保存后以远程为准拉取一次，rename 写在最新状态之上
  } catch (e) {
    return NextResponse.json({ error: 'refresh failed', detail: stripCreds(String(e)) }, { status: 500 })
  }

  // 市场名写入 manifest 并同步到远程（Claude 解析 @market 的真实源）
  const newName = typeof name === 'string' ? name.trim() : ''
  if (newName && newName !== getMarketName()) {
    ensureRepo()
    const before = headOf()
    writeMarketName(REPO_DIR, newName)
    try {
      push()
    } catch (e) {
      if (before) resetTo(before)
      return NextResponse.json({ error: 'push failed', detail: stripCreds(String(e)) }, { status: 500 })
    }
  }
  return NextResponse.json(getSettings())
}
