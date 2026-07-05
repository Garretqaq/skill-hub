/** @author sgz @since 2026-07-03 */
import path from 'node:path'

// 所有运行时数据的根目录：Docker 里设为挂载卷 /data，本地默认 ./data
export const DATA_DIR = path.resolve(process.env.DATA_DIR || 'data')
export const REPO_DIR = process.env.MARKETPLACE_DIR
  ? path.resolve(process.env.MARKETPLACE_DIR)
  : path.join(DATA_DIR, 'marketplace')
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
