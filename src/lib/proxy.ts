/** @author sgz @since 2026-08-03 */
import fs from 'node:fs'
import path from 'node:path'
import { ProxyAgent, fetch as undiciFetch, type Dispatcher, type RequestInit } from 'undici'
import { DATA_DIR } from './config'

// git 与 fetch 都支持的代理协议；socks 仅 git 侧生效（undici ProxyAgent 不支持）
const ALLOWED_SCHEMES = ['http:', 'https:', 'socks5:', 'socks5h:']

// 校验并规范化用户填的代理地址；空串表示停用。含用户名密码的形式允许（网关式代理）
export function validateProxyUrl(input: string): string {
  const s = input.trim()
  if (!s) return ''
  let u: URL
  try { u = new URL(s) } catch { throw new Error(`invalid proxy url: ${s}`) }
  if (!ALLOWED_SCHEMES.includes(u.protocol.toLowerCase())) {
    throw new Error(`unsupported proxy scheme: ${u.protocol}（仅支持 http/https/socks5/socks5h）`)
  }
  return s
}

// noProxy 原始串 → host 列表；逗号分隔，去空、转小写
export function parseNoProxy(raw: string): string[] {
  return raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
}

// host 后缀匹配：example.com 命中 example.com 与 git.example.com；不匹配 notexample.com
export function matchNoProxy(host: string, list: string[]): boolean {
  const h = host.trim().toLowerCase().replace(/:\d+$/, '') // 忽略端口
  if (!h) return false
  return list.some(item => {
    const e = item.replace(/^\./, '') // 兼容 .example.com 写法
    return h === e || h.endsWith(`.${e}`)
  })
}

// 直接读 settings.json：不经 settings.ts，避免 settings ←→ proxy 循环依赖
function readSettings(): { proxyUrl?: string; noProxy?: string; proxyAuth?: string } {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'settings.json'), 'utf8'))
  } catch {
    return {}
  }
}

// 把单独保存的 user:pass 注入到代理地址的用户名/密码位（与 settings.ts:getRepoUrl 的 token 处理同构）
export function withProxyAuth(base: string, auth?: string): string {
  if (!base || !auth) return base
  try {
    const u = new URL(base)
    const i = auth.indexOf(':')
    u.username = i < 0 ? auth : auth.slice(0, i)
    u.password = i < 0 ? '' : auth.slice(i + 1)
    // toString() 会给无路径的地址补出尾斜杠（host:port/），代理地址不该带路径，去掉
    return u.pathname === '/' && !u.search && !u.hash ? u.toString().replace(/\/$/, '') : u.toString()
  } catch {
    return base
  }
}

export function getProxyUrl(): string {
  const s = readSettings()
  const base = (s.proxyUrl || process.env.PROXY_URL || '').trim()
  return withProxyAuth(base, s.proxyAuth)
}

// 已保存的代理认证，供测试端点在表单未重填密码时回退使用
export function getProxyAuth(): string | undefined {
  return readSettings().proxyAuth
}

export function getNoProxy(): string[] {
  return parseNoProxy(readSettings().noProxy || '')
}

// 该目标地址应使用的代理；未配代理 / 命中 noProxy / 非 http(s) 目标（如 ssh://、git@）返回 null
export function proxyFor(targetUrl: string): string | null {
  const proxy = getProxyUrl()
  if (!proxy) return null
  let host: string
  try {
    const u = new URL(targetUrl)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null // http.proxy 对 ssh 无效
    host = u.hostname
  } catch {
    return null // scp 式 git@host:path 等非 URL 形式，走不到 http 代理
  }
  return matchNoProxy(host, getNoProxy()) ? null : proxy
}

// 前插到 git 参数前的代理配置；-c 优先级高于 env，且 git 无 http.noProxy，故名单判断在此处做
export function proxyArgsFor(targetUrl: string): string[] {
  const proxy = proxyFor(targetUrl)
  if (!proxy) return []
  return ['-c', `http.proxy=${proxy}`, '-c', `https.proxy=${proxy}`]
}

// ProxyAgent 持有连接池，按代理地址缓存复用；地址变更时丢弃旧实例（不 close，交给 GC 与空闲超时）
let agentCache: { url: string; agent: ProxyAgent } | null = null

// 按代理设置发请求：自动挂 dispatcher，socks / 未配代理时直连。
// 必须用 undici 自带的 fetch —— 全局 fetch 来自 Node 内置的旧版 undici，
// 把本包 v8 的 ProxyAgent 传给它，handler API 对不上，会抛 UND_ERR_INVALID_ARG
// 对外维持标准 fetch 的形状，undici 只活在这个函数里，两次断言就是两个 fetch 实现的类型边界
export async function proxyFetch(url: string, init?: globalThis.RequestInit & { duplex?: 'half' }) {
  const res = await undiciFetch(url, { ...init, dispatcher: proxyDispatcherFor(url) } as RequestInit)
  return res as unknown as Response
}

// 供 fetch 的 dispatcher；socks 代理返回 undefined（undici 不支持，此时 /proxy 直连）
export function proxyDispatcherFor(targetUrl: string): Dispatcher | undefined {
  const proxy = proxyFor(targetUrl)
  if (!proxy) return undefined
  try {
    if (!/^https?:$/i.test(new URL(proxy).protocol)) return undefined // socks：undici 不支持，直连
  } catch {
    return undefined // settings.json 被手改成非法值时不阻断请求
  }
  if (agentCache?.url !== proxy) agentCache = { url: proxy, agent: new ProxyAgent(proxy) }
  return agentCache.agent
}
