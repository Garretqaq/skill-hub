/** @author sgz @since 2026-07-03 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { REPO_DIR, MARKETPLACE_NAME } from './config'
import { getRepoUrl } from './settings'

// 容器内以 root 运行且无全局 git 身份，注入 committer/author 身份避免 commit 报 "Author identity unknown"
const GIT_IDENTITY = {
  GIT_AUTHOR_NAME: 'skill-hub', GIT_AUTHOR_EMAIL: 'skill-hub@localhost',
  GIT_COMMITTER_NAME: 'skill-hub', GIT_COMMITTER_EMAIL: 'skill-hub@localhost',
}
function git(dir: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...GIT_IDENTITY },
  }).toString()
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
export function headOf(dir: string = REPO_DIR): string | null {
  try { return git(dir, ['rev-parse', 'HEAD']).trim() } catch { return null } // 未有提交时无 HEAD
}
// 回滚到某次提交（含工作区），push 失败时撤销刚生成的提交与其文件
export function resetToIn(dir: string, head: string): void {
  git(dir, ['reset', '--hard', head])
}
export function resetTo(head: string): void { resetToIn(REPO_DIR, head) }

export function ensureRepo(): void {
  if (!fs.existsSync(path.join(REPO_DIR, '.git'))) {
    fs.mkdirSync(path.dirname(REPO_DIR), { recursive: true })
    const url = getRepoUrl()
    if (url) {
      execFileSync('git', ['clone', url, REPO_DIR], { stdio: 'inherit' })
    } else {
      git(REPO_DIR, ['init', '-q'])
    }
  }
  const manifest = path.join(REPO_DIR, '.claude-plugin', 'marketplace.json')
  if (!fs.existsSync(manifest)) {
    fs.mkdirSync(path.dirname(manifest), { recursive: true })
    fs.writeFileSync(manifest, JSON.stringify(
      { name: MARKETPLACE_NAME, owner: { name: 'sgz' }, plugins: [] }, null, 2) + '\n')
  }
  // 保证有基础提交：这样上传 push 失败时可安全 reset 回上一状态，而非留下无法回滚的根提交
  if (!headOf()) commitAllIn(REPO_DIR, 'init marketplace')
}
export function commitAll(message: string): void { commitAllIn(REPO_DIR, message) }
export function push(): void {
  if (!getRepoUrl()) return // 无远程（本地 init）时跳过
  git(REPO_DIR, ['push', '-u', 'origin', 'HEAD']) // -u 兼容后配远程、无上游追踪的情况
}

export function setRemoteUrlIn(dir: string, url: string): void {
  const remotes = git(dir, ['remote']).split('\n').map(s => s.trim())
  if (remotes.includes('origin')) {
    git(dir, ['remote', 'set-url', 'origin', url])
  } else {
    git(dir, ['remote', 'add', 'origin', url])
  }
}
// 运行时切换远程：仓库已存在时改 origin，未 clone 时留给下次 ensureRepo
export function setRemoteUrl(url: string): void {
  if (!fs.existsSync(path.join(REPO_DIR, '.git'))) return
  setRemoteUrlIn(REPO_DIR, url)
}

// 远程为准拉取覆盖本地；但本地有未推送提交时保留本地。远程空或历史不相干均安全处理。
export function syncFromRemoteIn(dir: string, url: string): void {
  setRemoteUrlIn(dir, url)                                     // 确保 origin 指向目标
  const heads = git(dir, ['ls-remote', '--heads', 'origin']).trim()
  if (!heads) return                                           // 远程无分支/提交，跳过
  git(dir, ['fetch', 'origin'])
  const ahead = git(dir, ['rev-list', 'FETCH_HEAD..HEAD']).trim() // 本地领先远程的（未推送）提交
  if (ahead) return                                            // 有未推送改动则保留本地，避免首次配置远程时静默覆盖
  git(dir, ['reset', '--hard', 'FETCH_HEAD'])                  // 无本地独有提交时才以远程覆盖
  git(dir, ['clean', '-fd'])                                   // 清理未追踪残留，使覆盖完整
}
export function syncFromRemote(): void {
  ensureRepo()                                              // .git 缺失时 clone（clone 即已同步）
  const url = getRepoUrl()
  if (!url) return                                          // 无远程（本地 init），跳过
  syncFromRemoteIn(REPO_DIR, url)
}
