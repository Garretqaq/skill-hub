/** @author sgz @since 2026-07-04 */
import { NextRequest, NextResponse } from 'next/server'
import { parseProxyPath, buildUpstreamUrl } from '@/lib/githubProxy'
import { proxyDispatcherFor } from '@/lib/proxy'

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
  // duplex 与 dispatcher 都是 fetch 的 undici 扩展，标准 RequestInit 类型里没有，整体断言一次
  const init = {
    method: req.method,
    headers,
    // 本机也在墙内时，转发给 GitHub 的这一跳同样要过正向代理（socks 代理下为 undefined，即直连）
    dispatcher: proxyDispatcherFor(upstreamUrl),
    // GET/HEAD 不能带请求体，否则 undici 会抛错
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : req.body,
    redirect: 'follow',
    duplex: 'half',
  } as RequestInit
  const upstream = await fetch(upstreamUrl, init)

  const resHeaders = new Headers(upstream.headers)
  STRIP_HEADERS.forEach(h => resHeaders.delete(h))
  return new NextResponse(upstream.body, { status: upstream.status, headers: resHeaders })
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return proxy(req, (await ctx.params).path)
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return proxy(req, (await ctx.params).path)
}
