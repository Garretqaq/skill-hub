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

export function stripCreds(s: string): string {
  // 先尝试作为完整 URL 处理。必须校验 host：'error: Command failed: ...' 这类错误消息
  // 会被 Node 当成 scheme 为 'error:' 的合法 URL 解析，host 为空，清 username 毫无作用，
  // 结果原样返回、凭据全泄露——所以 host 为空时必须落到下面的正则分支。
  try {
    const u = new URL(s)
    if (!u.host) throw new Error('not a network url')
    u.username = ''
    u.password = ''
    return u.toString()
  } catch {
    // 非纯 URL（如 git 错误消息）：替换消息中嵌入的 <scheme>://user:pass@host。
    // 协议不限于 http(s)——代理地址可能是 socks5://user:pass@host，同样不能泄露
    return s.replace(/([a-z][a-z0-9+.-]*:\/\/)[^@\s/]+@/gi, '$1')
  }
}
