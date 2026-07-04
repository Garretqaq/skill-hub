/** @author sgz @since 2026-07-03 */
import path from 'node:path'

// ponytail: runtime getter instead of module-load const enables cwd-aware tests
export function REPO_DIR(): string {
  return process.env.MARKETPLACE_DIR
    ? path.resolve(process.env.MARKETPLACE_DIR)
    : path.resolve('data/marketplace')
}
export const MARKETPLACE_NAME = process.env.MARKETPLACE_NAME || 'my-skills'
export const MARKETPLACE_REPO_URL = process.env.MARKETPLACE_REPO_URL || ''
export const ADMIN_USER = process.env.ADMIN_USER || ''
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || ''
export const AUTH_SECRET = process.env.AUTH_SECRET || 'dev-insecure-secret'

export function stripCreds(s: string): string {
  // 先尝试作为完整 URL 处理
  try {
    const u = new URL(s)
    u.username = ''
    u.password = ''
    return u.toString()
  } catch {
    // 非纯 URL（如 git 错误消息）：替换消息中嵌入的 https://user:pass@host 或 https://token@host
    return s.replace(/https?:\/\/[^@\s]+@/g, 'https://')
  }
}
