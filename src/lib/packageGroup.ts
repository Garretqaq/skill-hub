/** @author sgz @since 2026-07-05 */
import type { IndexedPackage } from './watched'

export interface PackageGroup { repoId: string; source: string; items: IndexedPackage[] }

// 按 repoId 归组，组顺序 = 各 repoId 在 results 中首次出现的顺序
export function groupPackagesByRepo(results: IndexedPackage[]): PackageGroup[] {
  const groups: PackageGroup[] = []
  const index = new Map<string, PackageGroup>()
  for (const pkg of results) {
    let group = index.get(pkg.repoId)
    if (!group) {
      group = { repoId: pkg.repoId, source: pkg.source, items: [] }
      index.set(pkg.repoId, group)
      groups.push(group)
    }
    group.items.push(pkg)
  }
  return groups
}
