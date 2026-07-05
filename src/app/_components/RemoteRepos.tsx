/**
 * @author sgz
 * @since 2026-07-04
 */
'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import type { WatchedRepo, IndexedPackage, PackageGroup } from '@/lib/watched'
import { isValidVersion, compareVersions } from '@/lib/semver'
import { useToast } from '@/lib/useToast'
import Toast from './Toast'

type WatchedRow = WatchedRepo & { packageCount?: number }

// 注：与 src/lib/watched.ts 的 groupPackagesByRepo 逻辑一致，但在此本地重实现——
// 该组件是 'use client'，若从 '@/lib/watched' 做值导入会把其传递依赖的
// node:child_process / node:fs 等服务端专属模块一并打入浏览器包，
// 导致 Turbopack dev/build 报 "chunking context does not support external modules" 而彻底崩溃。
// 这里只做纯函数的按 repoId 归组，不依赖任何服务端能力，故本地复制以保持浏览器可打包。
function groupPackagesByRepo(results: IndexedPackage[]): PackageGroup[] {
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

// 与后端 normalizeSource 对齐的前端预校验：owner/repo 简写或 http(s)/git@/ssh URL
function validateSource(s: string): string | null {
  const v = s.trim()
  if (!v) return '请输入仓库地址'
  const lower = v.toLowerCase()
  if (lower.startsWith('file:') || v.startsWith('/') || v.startsWith('.') || v.startsWith('~')) {
    return '不支持本地路径，请填 owner/repo 或 git URL'
  }
  if (/^[\w.-]+\/[\w.-]+$/.test(v)) return null
  if (/^https?:\/\//i.test(v) || /^git@/i.test(v) || /^ssh:\/\//i.test(v)) return null
  return '格式无法识别，请填 owner/repo 或完整 git URL'
}

// 来源类型标签：GitHub 简写 / 完整 URL 的 host
function sourceLabel(source: string): string {
  if (/^[\w.-]+\/[\w.-]+$/.test(source.trim())) return 'GitHub'
  const scp = source.match(/^git@([^:]+):/)
  if (scp) return scp[1]
  try { return new URL(source).host } catch { return 'git' }
}

export default function RemoteRepos() {
  const [repos, setRepos] = useState<WatchedRow[]>([])
  const [results, setResults] = useState<IndexedPackage[]>([])
  const [source, setSource] = useState('')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState<string | null>(null) // 当前进行中的动作标识
  const [expanded, setExpanded] = useState<Set<string>>(new Set()) // 用户手动展开的组（repoId）
  const { toasts, hideToast, success, error, info } = useToast()

  // 输入非空时即时校验，给出格式提示
  const sourceError = useMemo(() => (source.trim() ? validateSource(source) : null), [source])

  const groups = useMemo(() => groupPackagesByRepo(results), [results])
  const hasQuery = q.trim() !== ''

  const toggleGroup = (repoId: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(repoId)) next.delete(repoId)
      else next.add(repoId)
      return next
    })
  }

  // 拉取监听列表 + 搜索结果
  const load = useCallback(async (query: string) => {
    const res = await fetch(`/api/watched?q=${encodeURIComponent(query)}`)
    if (res.ok) {
      const data = await res.json()
      setRepos(data.repos)
      setResults(data.results)
    }
  }, [])

  useEffect(() => { load(q) }, [q, load])

  const addRepo = async () => {
    const err = validateSource(source)
    if (err) { error(err); return }
    setBusy('add')
    try {
      const res = await fetch('/api/watched', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: source.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { error(`添加失败: ${data.error || res.statusText}`); return }
      success('已添加监听')
      if (data.warning) info(`已添加，但同步到远程仓库失败: ${data.warning}`)
      setSource('')
      await load(q)
    } catch (e) {
      error(`添加失败: ${e}`)
    } finally { setBusy(null) }
  }

  const removeRepo = async (id: string) => {
    setBusy(`rm:${id}`)
    try {
      const res = await fetch('/api/watched', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      const data = await res.json().catch(() => ({}))
      if (data.warning) info(`已移除，但同步到远程仓库失败: ${data.warning}`)
      await load(q)
    } finally { setBusy(null) }
  }

  const refresh = async (id?: string) => {
    setBusy(id ? `refresh:${id}` : 'refresh:all')
    try {
      await fetch('/api/watched/refresh', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(id ? { id } : {}),
      })
      await load(q)
    } finally { setBusy(null) }
  }

  const doImport = async (pkg: IndexedPackage) => {
    setBusy(`import:${pkg.repoId}:${pkg.name}`)
    try {
      const res = await fetch('/api/watched/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: pkg.repoId, name: pkg.name, sourceUrl: pkg.sourceUrl /* 引用型包会有 sourceUrl，本地包为 undefined（API 会忽略） */ }),
      })
      if (!res.ok) { error(`${pkg.localVersion ? '更新' : '导入'}失败: ${await res.text()}`); return }
      success(`已${pkg.localVersion ? '更新' : '导入'} ${pkg.name}${pkg.localVersion ? '' : ' 到本市场'}`)
      await load(q) // 刷新 localVersion，按钮切到「更新」/置灰
    } finally { setBusy(null) }
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-4xl font-bold text-zinc-100">远程仓库</h1>
          <p className="text-zinc-400">监听远程仓库，跨库搜索并导入技能。</p>
        </div>
        <Link href="/admin" className="px-5 py-2.5 bg-zinc-800 text-zinc-300 rounded-lg font-medium hover:bg-zinc-700 transition-colors">
          返回控制台
        </Link>
      </div>

      {/* 添加监听 */}
      <div className="space-y-2">
        <div className="flex gap-3">
          <input
            value={source}
            onChange={(e) => setSource(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !sourceError && busy !== 'add') addRepo() }}
            placeholder="owner/repo 或完整 git URL"
            className={`flex-1 px-4 py-3 bg-zinc-900/50 border rounded-lg text-zinc-100 placeholder:text-zinc-600 focus:outline-none transition-colors ${
              sourceError ? 'border-red-500/50 focus:border-red-500/70' : 'border-zinc-800 focus:border-cyan-500/50'
            }`}
          />
          <button
            onClick={addRepo}
            disabled={busy === 'add' || !!sourceError || !source.trim()}
            className="px-6 py-3 bg-cyan-500 text-white rounded-lg font-medium hover:bg-cyan-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {busy === 'add' ? '添加中...' : '添加监听'}
          </button>
        </div>
        {sourceError && <p className="text-sm text-red-400">{sourceError}</p>}
      </div>

      {/* 监听列表 */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-zinc-100">监听仓库（{repos.length}）</h2>
          <button
            onClick={() => refresh()}
            disabled={!repos.length || busy === 'refresh:all'}
            className="px-3 py-1.5 text-sm rounded-lg bg-zinc-800/50 text-zinc-300 border border-zinc-700 hover:bg-zinc-700/50 disabled:opacity-50 transition-colors"
          >
            {busy === 'refresh:all' ? '刷新中...' : '全部刷新'}
          </button>
        </div>
        {repos.length === 0 ? (
          <p className="text-zinc-600 text-sm">还没有监听仓库。</p>
        ) : (
          <div className="divide-y divide-zinc-800 border border-zinc-800 rounded-xl overflow-hidden bg-zinc-900/40">
            {repos.map((r) => (
              <div key={r.id} className="flex items-center gap-3 p-4">
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 text-xs font-medium bg-zinc-800/60 text-zinc-400 rounded border border-zinc-700/50 flex-shrink-0">
                      {sourceLabel(r.source)}
                    </span>
                    <span className="font-mono text-sm text-zinc-300 truncate">{r.source}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-zinc-500">
                    <span>{r.packageCount ?? 0} 个包</span>
                    <span className="text-zinc-700">·</span>
                    <span>添加于 {new Date(r.addedAt).toLocaleDateString('zh-CN')}</span>
                  </div>
                </div>
                <button
                  onClick={() => refresh(r.id)}
                  disabled={busy === `refresh:${r.id}`}
                  className="px-3 py-1.5 text-sm rounded-lg bg-zinc-800/50 text-zinc-300 border border-zinc-700 hover:bg-zinc-700/50 disabled:opacity-50 transition-colors flex-shrink-0"
                >
                  {busy === `refresh:${r.id}` ? '刷新中' : '刷新'}
                </button>
                <button
                  onClick={() => removeRepo(r.id)}
                  disabled={busy === `rm:${r.id}`}
                  className="px-3 py-1.5 text-sm rounded-lg bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 disabled:opacity-50 transition-colors flex-shrink-0"
                >
                  移除
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 搜索 */}
      <div className="space-y-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索所有监听仓库里的技能…"
          className="w-full px-4 py-3 bg-zinc-900/50 border border-zinc-800 rounded-lg text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-cyan-500/50"
        />
        {groups.length === 0 ? (
          <p className="p-4 text-zinc-600 text-sm border border-zinc-800 rounded-xl bg-zinc-900/40">无结果。</p>
        ) : (
          <div className="space-y-3">
            {groups.map((group) => {
              const isOpen = hasQuery || expanded.has(group.repoId)
              return (
                <div key={group.repoId} className="border border-zinc-800 rounded-xl overflow-hidden bg-zinc-900/40">
                  <button
                    onClick={() => toggleGroup(group.repoId)}
                    className="w-full flex items-center gap-3 p-4 text-left hover:bg-zinc-800/30 transition-colors"
                  >
                    <span className="px-2 py-0.5 text-xs font-medium bg-zinc-800/60 text-zinc-400 rounded border border-zinc-700/50 flex-shrink-0">
                      {sourceLabel(group.source)}
                    </span>
                    <span className="font-mono text-sm text-zinc-300 truncate">{group.source}</span>
                    <span className="ml-auto text-xs text-zinc-500 flex-shrink-0">{group.items.length} 个技能</span>
                    <svg
                      className={`w-4 h-4 text-zinc-500 flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {isOpen && (
                    <div className="divide-y divide-zinc-800 border-t border-zinc-800">
                      {group.items.map((pkg) => {
                        const isReference = !!pkg.sourceUrl // 引用型包判定
                        const imported = pkg.localVersion != null // 已导入本地市场
                        const busyKey = busy === `import:${pkg.repoId}:${pkg.name}`
                        // 有更新：远程与本地版本均合法且远程更高
                        const hasUpdate = imported && !!pkg.version && isValidVersion(pkg.version)
                          && isValidVersion(pkg.localVersion!) && compareVersions(pkg.version, pkg.localVersion!) > 0
                        return (
                          <div key={`${pkg.repoId}:${pkg.name}`} className="p-4 space-y-2">
                            <div className="flex items-center gap-3">
                              <span className="px-2 py-0.5 text-xs font-medium bg-zinc-800/50 text-zinc-400 rounded border border-zinc-700/50">
                                {pkg.kind}{isReference ? ' (引用)' : ''}
                              </span>
                              <span className="text-lg font-semibold text-zinc-100 truncate">{pkg.name}</span>
                              <span className="text-xs text-zinc-500 truncate">{pkg.source}</span>
                              {imported ? (
                                <button
                                  onClick={() => doImport(pkg)}
                                  disabled={busyKey || !hasUpdate}
                                  title={hasUpdate ? `更新到 ${pkg.version}` : `已是最新版本 ${pkg.localVersion}`}
                                  className="ml-auto px-3 py-1.5 text-sm rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                >
                                  {busyKey ? '更新中' : '更新'}
                                </button>
                              ) : (
                                <button
                                  onClick={() => doImport(pkg)}
                                  disabled={busyKey}
                                  title={isReference ? '将自动从远程克隆导入' : ''}
                                  className="ml-auto px-3 py-1.5 text-sm rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                >
                                  {busyKey ? '导入中' : '导入本市场'}
                                </button>
                              )}
                            </div>
                            <p className="text-sm text-zinc-500 truncate">{pkg.description || '暂无描述'}</p>
                            {/* 外部安装命令 */}
                            <details className="text-sm">
                              <summary className="cursor-pointer text-zinc-400 hover:text-cyan-400">外部安装命令</summary>
                              <div className="mt-2 space-y-1 font-mono text-xs text-zinc-300">
                                <div>$ claude plugin marketplace add {pkg.url}</div>
                                <div>$ claude plugin install {pkg.name}{pkg.market ? `@${pkg.market}` : ''}</div>
                              </div>
                            </details>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Toast 通知 */}
      {toasts.map(toast => (
        <Toast key={toast.id} message={toast.message} type={toast.type} onClose={() => hideToast(toast.id)} />
      ))}
    </div>
  )
}
