/** @author sgz @since 2026-07-03 */
import fs from 'node:fs'
import path from 'node:path'
import { MARKETPLACE_REPO_URL, MARKETPLACE_NAME, REPO_DIR, DATA_DIR, stripCreds } from './config'
import { readMarketplace } from './marketplace'

interface Settings {
  repoUrl?: string // 不含鉴权信息的仓库地址
  token?: string   // 单独保存的访问 token
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

// 供前端展示：base 地址脱敏返回，token 只回传是否已配置
export function getSettings(): { repoUrl: string; hasToken: boolean; name: string } {
  const s = read()
  return {
    repoUrl: s.repoUrl || stripCreds(MARKETPLACE_REPO_URL),
    hasToken: !!s.token,
    name: getMarketName(),
  }
}

// token 留空表示保留原有，不覆盖
export function saveSettings(repoUrl: string, token?: string): void {
  const file = settingsFile()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const next: Settings = { ...read(), repoUrl }
  if (token) next.token = token
  fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n')
}
