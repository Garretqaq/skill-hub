/** @author sgz @since 2026-07-04 */
const SEGMENT = /^(?!\.+$)[\w.-]+$/ // 仅允许安全字符；排除纯点号（. / ..）防止路径穿越

export interface ProxyTarget {
  owner: string
  repo: string
  rest: string
}

// /proxy 之后的路径段解析为 GitHub upstream 目标；owner/repo 校验失败返回 null
export function parseProxyPath(segments: string[]): ProxyTarget | null {
  const [owner, repoRaw, ...rest] = segments
  if (!owner || !repoRaw || !SEGMENT.test(owner)) return null
  const repo = repoRaw.replace(/\.git$/, '')
  if (!repo || !SEGMENT.test(repo)) return null
  return { owner, repo, rest: rest.join('/') }
}

export function buildUpstreamUrl(target: ProxyTarget, search: string): string {
  const restPath = target.rest ? `/${target.rest}` : ''
  return `https://github.com/${target.owner}/${target.repo}.git${restPath}${search}`
}
