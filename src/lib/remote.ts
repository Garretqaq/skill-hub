/** @author sgz @since 2026-07-04 */
const SHORTHAND = /^[\w.-]+\/[\w.-]+$/ // owner/repo，恰好一个斜杠

// 把用户填的来源规范化为可 clone 的 URL；拒绝本地路径/file:// 防止 clone 本地任意目录
export function normalizeSource(input: string): string {
  const s = input.trim()
  if (!s) throw new Error('empty source')
  if (s.startsWith('file:') || s.startsWith('/') || s.startsWith('.') || s.startsWith('~')) {
    throw new Error(`invalid source: ${s}`)
  }
  if (SHORTHAND.test(s)) return `https://github.com/${s.replace(/\.git$/, '')}.git`
  if (/^https?:\/\//.test(s) || /^git@/.test(s) || /^ssh:\/\//.test(s)) return s
  throw new Error(`invalid source: ${s}`)
}
