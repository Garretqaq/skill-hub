/** @author sgz @since 2026-07-03 */
import path from 'node:path'

export const REPO_DIR = process.env.MARKETPLACE_DIR
  ? path.resolve(process.env.MARKETPLACE_DIR)
  : path.resolve('data/marketplace')
export const MARKETPLACE_NAME = process.env.MARKETPLACE_NAME || 'my-skills'
export const MARKETPLACE_REPO_URL = process.env.MARKETPLACE_REPO_URL || ''
export const ADMIN_USER = process.env.ADMIN_USER || ''
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || ''
export const AUTH_SECRET = process.env.AUTH_SECRET || 'dev-insecure-secret'

export function stripCreds(url: string): string {
  try {
    const u = new URL(url)
    u.username = ''
    u.password = ''
    return u.toString()
  } catch {
    return url
  }
}
