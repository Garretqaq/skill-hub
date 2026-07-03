/** @author sgz @since 2026-07-03 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { REPO_DIR, MARKETPLACE_REPO_URL, MARKETPLACE_NAME } from './config'

function git(dir: string, args: string[]): string {
  return execFileSync('git', args, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] }).toString()
}
function hasChanges(dir: string): boolean {
  return git(dir, ['status', '--porcelain']).trim().length > 0
}

export function commitAllIn(dir: string, message: string): void {
  git(dir, ['add', '-A'])
  if (!hasChanges(dir)) return
  git(dir, ['commit', '-q', '-m', message])
}
export function resetHardIn(dir: string): void {
  git(dir, ['reset', '--hard', 'HEAD'])
}

export function ensureRepo(): void {
  if (fs.existsSync(path.join(REPO_DIR, '.git'))) return
  fs.mkdirSync(path.dirname(REPO_DIR), { recursive: true })
  if (MARKETPLACE_REPO_URL) {
    execFileSync('git', ['clone', MARKETPLACE_REPO_URL, REPO_DIR], { stdio: 'inherit' })
  } else {
    git(REPO_DIR, ['init', '-q'])
  }
  const manifest = path.join(REPO_DIR, '.claude-plugin', 'marketplace.json')
  if (!fs.existsSync(manifest)) {
    fs.mkdirSync(path.dirname(manifest), { recursive: true })
    fs.writeFileSync(manifest, JSON.stringify(
      { name: MARKETPLACE_NAME, owner: { name: 'sgz' }, plugins: [] }, null, 2) + '\n')
  }
}
export function commitAll(message: string): void { commitAllIn(REPO_DIR, message) }
export function resetHard(): void { resetHardIn(REPO_DIR) }
export function push(): void { git(REPO_DIR, ['push']) }
