/** @author sgz @since 2026-07-04 */
const RE = /^\d+\.\d+\.\d+$/

export function isValidVersion(v: string): boolean {
  return RE.test(v)
}

function parse(v: string): [number, number, number] {
  const [a, b, c] = v.split('.').map(Number)
  return [a, b, c]
}

export function bumpPatch(v: string): string {
  const [a, b, c] = parse(v)
  return `${a}.${b}.${c + 1}`
}

export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = parse(a), pb = parse(b)
  for (let i = 0; i < 3; i++) {
    if (pa[i] < pb[i]) return -1
    if (pa[i] > pb[i]) return 1
  }
  return 0
}
