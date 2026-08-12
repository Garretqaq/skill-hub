/** @author sgz @since 2026-07-04 */
import { NextRequest, NextResponse } from 'next/server'
import { parseProxyPath, buildUpstreamUrl } from '@/lib/githubProxy'
import { proxyFetch } from '@/lib/proxy'

// 这些 header 由 fetch/Next 按响应体重新计算，原样转发会导致长度/编码不匹配
const STRIP_HEADERS = ['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'host']

async function proxy(req: NextRequest, path: string[]) {
  const target = parseProxyPath(path)
  if (!target) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const headers = new Headers(req.headers)
  STRIP_HEADERS.forEach(h => headers.delete(h))
  // 强制上游走 git 协议 v0：v2 的多轮/分块响应流经 Next 转发时收尾异常，会导致 clone 卡死
  headers.delete('git-protocol')

  const upstreamUrl = buildUpstreamUrl(target, req.nextUrl.search)
  // 本机也在墙内时，转发给 GitHub 的这一跳同样要过正向代理，见 proxyFetch
  const upstream = await proxyFetch(upstreamUrl, {
    method: req.method,
    // 传 entries 而非 Headers 实例：两侧 Headers 来自不同 undici 版本，实例校验对不上
    headers: [...headers],
    // GET/HEAD 不能带请求体，否则 undici 会抛错
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : req.body,
    redirect: 'follow',
    duplex: 'half',
  })

  const resHeaders = new Headers([...upstream.headers])
  STRIP_HEADERS.forEach(h => resHeaders.delete(h))
  return new NextResponse(upstream.body, { status: upstream.status, headers: resHeaders })
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return proxy(req, (await ctx.params).path)
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return proxy(req, (await ctx.params).path)
}
