/** @author sgz @since 2026-07-05 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

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

/**
 * 在 no-checkout 仓库上用临时 work-tree 执行写操作：
 * checkout HEAD 到 tmp → fn(tmp) → git --work-tree=tmp add -A → git commit -m message → 删 tmp
 * fn 只管改 tmp 里的文件，commit 由本函数统一负责。
 */
export function withWorkTree<T>(
  repoDir: string,
  fn: (workTree: string) => T,
  message: string,
): T {
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-wt-'))
  try {
    git(repoDir, ['--work-tree', wt, 'checkout', '-f', 'HEAD'])
    const result = fn(wt)
    git(repoDir, ['--work-tree', wt, 'add', '-A'])
    git(repoDir, ['commit', '-q', '-m', message])
    return result
  } finally {
    fs.rmSync(wt, { recursive: true, force: true })
  }
}
