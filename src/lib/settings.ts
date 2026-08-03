/** @author sgz @since 2026-07-03 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { MARKETPLACE_REPO_URL, MARKETPLACE_NAME, REPO_DIR, DATA_DIR, stripCreds } from './config'
import { readMarketplace } from './marketplace'

interface Settings {
  repoUrl?: string     // 不含鉴权信息的仓库地址
  token?: string       // 单独保存的访问 token
  authSecret?: string  // 会话签名密钥，首次启动自动生成
  proxyUrl?: string    // 不含凭据的正向代理地址，空表示停用；实际读取见 proxy.ts:getProxyUrl
  proxyAuth?: string   // 代理认证 user:pass，单独保存不回显（同 token 的处理）
  noProxy?: string     // 逗号分隔的 host 名单，命中则该次出网不走代理
}

function settingsFile(): string {
  return path.join(DATA_DIR, 'settings.json')
}

function read(): Settings {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), 'utf8'))
  } catch {
    return {} // 文件不存在或损坏时回退默认
  }
}

// 供 git 使用的完整地址：把 token 注入到 base URL 的用户名位（与 .env 约定一致）
export function getRepoUrl(): string {
  const s = read()
  const base = s.repoUrl || MARKETPLACE_REPO_URL
  if (!base || !s.token) return base // 未配 base 或未单独配 token 时原样返回（env 可能自带 token）
  try {
    const u = new URL(base)
    u.username = s.token
    u.password = ''
    return u.toString()
  } catch {
    return base
  }
}

// 市场名的真实源是 manifest（Claude 解析 @market 用的就是它），仓库未建时回退 env 默认
export function getMarketName(): string {
  return readMarketplace(REPO_DIR).name || MARKETPLACE_NAME
}

// 供前端展示：base 地址脱敏返回，token / 代理认证只回传是否已配置
export function getSettings(): {
  repoUrl: string; hasToken: boolean; name: string
  proxyUrl: string; noProxy: string; hasProxyAuth: boolean
} {
  const s = read()
  return {
    repoUrl: s.repoUrl || stripCreds(MARKETPLACE_REPO_URL),
    hasToken: !!s.token,
    name: getMarketName(),
    proxyUrl: s.proxyUrl ?? stripCreds(process.env.PROXY_URL || ''),
    noProxy: s.noProxy ?? '',
    hasProxyAuth: !!s.proxyAuth,
  }
}

// 会话签名密钥：优先环境变量；否则从 settings.json 读取，没有则随机生成并持久化
let cachedSecret: string | undefined
export function getAuthSecret(): string {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET
  if (cachedSecret) return cachedSecret
  const s = read()
  if (s.authSecret) return (cachedSecret = s.authSecret)
  const secret = crypto.randomBytes(32).toString('base64url')
  const file = settingsFile()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ ...read(), authSecret: secret }, null, 2) + '\n')
  return (cachedSecret = secret)
}

// token / proxyAuth 留空表示保留原有，不覆盖；proxyUrl、noProxy 传空串即清空（= 停用代理）
// ponytail: 与 token 一样，没有"清除已存凭据"的入口；需要清时直接改 data/settings.json
export function saveSettings(
  repoUrl: string,
  token?: string,
  proxy?: { proxyUrl?: string; proxyAuth?: string; noProxy?: string },
): void {
  const file = settingsFile()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const next: Settings = { ...read(), repoUrl }
  if (token) next.token = token
  if (proxy?.proxyUrl !== undefined) next.proxyUrl = proxy.proxyUrl
  if (proxy?.noProxy !== undefined) next.noProxy = proxy.noProxy
  if (proxy?.proxyAuth) next.proxyAuth = proxy.proxyAuth
  fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n')
}
