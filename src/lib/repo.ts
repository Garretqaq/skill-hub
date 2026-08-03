/** @author sgz @since 2026-07-03 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { REPO_DIR, MARKETPLACE_NAME } from './config'
import { getRepoUrl } from './settings'
import { proxyArgsFor } from './proxy'

// 容器内以 root 运行且无全局 git 身份，注入 committer/author 身份避免 commit 报 "Author identity unknown"
const GIT_IDENTITY = {
  GIT_AUTHOR_NAME: 'skill-hub', GIT_AUTHOR_EMAIL: 'skill-hub@localhost',
  GIT_COMMITTER_NAME: 'skill-hub', GIT_COMMITTER_EMAIL: 'skill-hub@localhost',
}
// execFileSync 抛出的 Error.message 只有 "Command failed: <cmd>"，git 真正的原因在 stderr 里。
// 不拼进来的话，接口只能返回一条没有诊断价值的命令回显。（调用方仍需 stripCreds 脱敏）
function withStderr(e: unknown): Error {
  const err = e as { stderr?: Buffer | string; message?: string }
  const detail = err.stderr ? String(err.stderr).trim() : ''
  return new Error(detail ? `${err.message ?? String(e)}\n${detail}` : String(e))
}

// net 传目标远程地址表示这条命令要出网，据此决定是否前插 -c http.proxy（见 proxy.ts）
function git(dir: string, args: string[], net?: string): string {
  try {
    return execFileSync('git', [...(net ? proxyArgsFor(net) : []), ...args], {
      cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...GIT_IDENTITY },
    }).toString()
  } catch (e) {
    throw withStderr(e)
  }
}

// 清空工作目录（保留 .git），用于迁移旧式工作副本 + 首次提交后回到 no-checkout 形态
function clearWorkTree(dir: string): void {
  for (const name of fs.readdirSync(dir)) {
    if (name === '.git') continue
    fs.rmSync(path.join(dir, name), { recursive: true, force: true })
  }
}

// 迁移旧式工作副本到 no-checkout：工作目录有 plugins/ 时，对齐 index 后清空工作目录
function migrateToNoCheckout(dir: string): void {
  if (!fs.existsSync(path.join(dir, 'plugins'))) return
  git(dir, ['reset', '--mixed', 'HEAD']) // 对齐 index 到 HEAD，避免后续误操作
  clearWorkTree(dir)
}

export function headOf(dir: string = REPO_DIR): string | null {
  try { return git(dir, ['rev-parse', 'HEAD']).trim() } catch { return null } // 未有提交时无 HEAD
}

// push 失败时回滚到某次提交：reset --mixed 移动 HEAD + 重置 index，no-checkout 下工作目录本就空
export function resetToIn(dir: string, head: string): void {
  git(dir, ['reset', '--mixed', head])
}
export function resetTo(head: string): void { resetToIn(REPO_DIR, head) }

// 返回值表示本次是否新克隆了仓库：克隆结果即远程最新，调用方可省掉紧随其后的 fetch
export function ensureRepo(): boolean {
  let cloned = false
  if (!fs.existsSync(path.join(REPO_DIR, '.git'))) {
    fs.mkdirSync(path.dirname(REPO_DIR), { recursive: true })
    const url = getRepoUrl()
    if (url) {
      // --depth 1：本应用从不读历史（读走 git show HEAD:/ls-tree HEAD），浅克隆省掉首次保存的大头。
      // 不用 --filter=blob:none——no-checkout 架构下每次 git show 都会回源取 blob，
      // 且 withWorkTree 的 checkout 会一次性把 blob 全拉回来，收益还回去了。
      // 用 pipe 而非 inherit：失败原因要能随接口返回，否则只能去翻容器日志
      try {
        execFileSync('git', [...proxyArgsFor(url), 'clone', '--depth', '1', '--no-checkout', url, REPO_DIR],
          { stdio: ['ignore', 'pipe', 'pipe'] })
        cloned = true
      } catch (e) {
        throw withStderr(e)
      }
    } else {
      git(REPO_DIR, ['init', '-q'])
    }
  }
  migrateToNoCheckout(REPO_DIR) // 旧式工作副本（有 plugins/）迁移到 no-checkout
  // 首次提交（init 或 clone 空仓库）：无 HEAD，withWorkTree 无法 checkout，直接工作目录写 + add + commit + 清空
  if (!headOf()) {
    fs.mkdirSync(path.join(REPO_DIR, '.claude-plugin'), { recursive: true })
    fs.writeFileSync(path.join(REPO_DIR, '.claude-plugin', 'marketplace.json'),
      JSON.stringify({ name: MARKETPLACE_NAME, owner: { name: 'sgz' }, plugins: [] }, null, 2) + '\n')
    git(REPO_DIR, ['add', '-A'])
    git(REPO_DIR, ['commit', '-q', '-m', 'init marketplace'])
    clearWorkTree(REPO_DIR)
  }
  return cloned
}

export function push(): void {
  const url = getRepoUrl()
  if (!url) return // 无远程（本地 init）时跳过
  git(REPO_DIR, ['push', '-u', 'origin', 'HEAD'], url) // -u 兼容后配远程、无上游追踪的情况
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

// 远程为准拉取覆盖本地；但本地有未推送提交时保留本地。no-checkout：reset --mixed 不 checkout 工作目录。
export function syncFromRemoteIn(dir: string, url: string): void {
  setRemoteUrlIn(dir, url)                                           // 确保 origin 指向目标
  const heads = git(dir, ['ls-remote', '--heads', 'origin'], url).trim()
  if (!heads) return                                                 // 远程无分支/提交，跳过
  git(dir, ['fetch', 'origin'], url)
  let branch = 'master'
  try { branch = git(dir, ['symbolic-ref', '--short', 'HEAD']).trim() || 'master' } catch { /* detached/无 HEAD 时兜底 master */ }
  const upstream = `origin/${branch}`
  let ahead: string
  try {
    ahead = git(dir, ['rev-list', `${upstream}..HEAD`]).trim()       // 本地领先远程的（未推送）提交
  } catch {
    ahead = '1' // 历史不相干（无共同祖先）时 rev-list 报错，视为有本地独有提交，保留本地
  }
  if (ahead) return                                                  // 有未推送改动则保留本地
  git(dir, ['reset', '--mixed', upstream])                           // 移动分支引用 + 重置 index，不动工作目录
}
export function syncFromRemote(): void {
  if (ensureRepo()) return                                  // 本次刚 clone，已是远程最新，无需再 ls-remote+fetch
  const url = getRepoUrl()
  if (!url) return                                          // 无远程（本地 init），跳过
  syncFromRemoteIn(REPO_DIR, url)
}
