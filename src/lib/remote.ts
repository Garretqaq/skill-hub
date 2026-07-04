/** @author sgz @since 2026-07-04 */
const SHORTHAND = /^[\w.-]+\/[\w.-]+$/ // owner/repo，恰好一个斜杠

// 把用户填的来源规范化为可 clone 的 URL；拒绝本地路径/file:// 防止 clone 本地任意目录
export function normalizeSource(input: string): string {
  const s = input.trim()
  if (!s) throw new Error('empty source')
  // ponytail: 协议检查大小写不敏感，防止 FILE:// 等变体绕过本地路径检查
  const lower = s.toLowerCase()
  if (lower.startsWith('file:') || s.startsWith('/') || s.startsWith('.') || s.startsWith('~')) {
    throw new Error(`invalid source: ${s}`)
  }
  if (SHORTHAND.test(s)) return `https://github.com/${s.replace(/\.git$/, '')}.git`
  // 协议检查支持大小写变体（git 协议不区分大小写）
  if (/^https?:\/\//i.test(s) || /^git@/i.test(s) || /^ssh:\/\//i.test(s)) return s
  throw new Error(`invalid source: ${s}`)
}
