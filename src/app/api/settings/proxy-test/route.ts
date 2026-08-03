/** @author sgz @since 2026-08-03 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/session'
import { stripCreds } from '@/lib/config'
import { validateProxyUrl, withProxyAuth, getProxyAuth } from '@/lib/proxy'

const execFileAsync = promisify(execFile)

// 探测目标：固定打 GitHub，测的就是真实拉取链路（ls-remote 只走一次握手，不落盘）
const PROBE_URL = 'https://github.com/git/git'
const TIMEOUT_MS = 8000

export async function POST(req: NextRequest) {
  if (!(await getUser())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { proxyUrl, proxyAuth } = await req.json()

  let proxy: string
  try {
    const base = validateProxyUrl(typeof proxyUrl === 'string' ? proxyUrl : '')
    if (!base) return NextResponse.json({ error: '未填写代理地址' }, { status: 400 })
    // 表单密码框留空时沿用已保存的凭据（与保存逻辑一致）
    proxy = withProxyAuth(base, (typeof proxyAuth === 'string' && proxyAuth.trim()) || getProxyAuth())
  } catch (e) {
    return NextResponse.json({ error: stripCreds(String(e)) }, { status: 400 })
  }

  // 用传入的代理直接探测，不过 noProxy 名单——这里测的是代理本身通不通
  const args = ['-c', `http.proxy=${proxy}`, '-c', `https.proxy=${proxy}`, 'ls-remote', PROBE_URL, 'HEAD']
  const started = Date.now()
  try {
    await execFileAsync('git', args, {
      timeout: TIMEOUT_MS,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, // 代理要认证时不要卡在交互提示上
    })
    return NextResponse.json({ ok: true, ms: Date.now() - started })
  } catch (e) {
    const err = e as { killed?: boolean; stderr?: string }
    const detail = err.killed ? `超时（>${TIMEOUT_MS}ms）` : (err.stderr || String(e)).trim()
    return NextResponse.json({ ok: false, detail: stripCreds(detail) }, { status: 502 })
  }
}
