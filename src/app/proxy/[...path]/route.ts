/** @author sgz @since 2026-07-04 */
import { NextRequest, NextResponse } from 'next/server'
import { parseProxyPath, buildUpstreamUrl } from '@/lib/githubProxy'

// 这些 header 由 fetch/Next 按响应体重新计算，原样转发会导致长度/编码不匹配
const STRIP_HEADERS = ['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'host']

async function proxy(req: NextRequest, path: string[]) {
  const target = parseProxyPath(path)
  if (!target) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const headers = new Headers(req.headers)
  STRIP_HEADERS.forEach(h => headers.delete(h))
  // 强制上游走 git 协议 v0：v2 的多轮/分块响应流经 Next 转发时收尾异常，会导致 clone 卡死
  headers.delete('git-protocol')

  const upstream = await fetch(buildUpstreamUrl(target, req.nextUrl.search), {
    method: req.method,
    headers,
    // GET/HEAD 不能带请求体，否则 undici 会抛错
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : req.body,
    redirect: 'follow',
    // @ts-expect-error - duplex 是 fetch 标准的一部分，但 TS 类型定义还没跟上
    duplex: 'half',
  })

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
