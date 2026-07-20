/**
 * @author sgz
 * @since 2026-07-04
 */
'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import type { WatchedRepo, IndexedPackage } from '@/lib/watched'
import type { PreviewEntry } from '@/lib/ingest'
import { groupPackagesByRepo } from '@/lib/packageGroup'
import { isValidVersion, compareVersions } from '@/lib/semver'
import { useToast } from '@/lib/useToast'
import Toast from './Toast'

type WatchedRow = WatchedRepo & { packageCount?: number }

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

// 包身份文件恒被导入，弹窗里锁定勾选（与 ingest.ts 的 KEEP_ALWAYS 对齐）
const KEEP_ALWAYS = new Set(['.claude-plugin', 'SKILL.md'])

function humanSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

// 已导入本地市场：有版本或有导入时源哈希（无版本包 localVersion 为空，靠 localSourceHash 判定）
function isImported(pkg: IndexedPackage): boolean {
  return pkg.localVersion != null || pkg.localSourceHash != null
}

// 有更新：已导入本地，且远程与本地版本均合法、远程更高
function hasUpdate(pkg: IndexedPackage): boolean {
  if (!isImported(pkg)) return false // 未导入本地
  const versioned = !!pkg.version && !!pkg.localVersion
    && isValidVersion(pkg.version) && isValidVersion(pkg.localVersion)
  if (versioned) return compareVersions(pkg.version!, pkg.localVersion!) > 0
  // 兜底：至少一侧无合法版本，用内容哈希比对
  return !!pkg.localSourceHash && !!pkg.contentHash && pkg.localSourceHash !== pkg.contentHash
}

export default function RemoteRepos() {
  const [repos, setRepos] = useState<WatchedRow[]>([])
  const [results, setResults] = useState<IndexedPackage[]>([])
  const [source, setSource] = useState('')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState<string | null>(null) // 当前进行中的动作标识
  const [preview, setPreview] = useState<{ pkg: IndexedPackage; entries: PreviewEntry[]; checked: Set<string> } | null>(null)
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
      const res = await fetch('/api/watched/refresh', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(id ? { id } : {}),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { error(`刷新失败: ${data.error || res.statusText}`); return }
      await load(q)
      if (id) success('已刷新 1 个仓库')
      else if (data.total === 0) info('没有监听仓库可刷新')
      else success(`已刷新 ${data.ok}/${data.total} 个仓库`)
      if (data.failed?.length) error(`${data.failed.length} 个仓库刷新失败:\n${data.failed.join('\n')}`)
    } catch (e) {
      error(`刷新失败: ${e}`)
    } finally { setBusy(null) }
  }

  // exclude 省略时后端沿用上次导入的勾选结果
  const doImport = async (pkg: IndexedPackage, exclude?: string[]) => {
    setBusy(`import:${pkg.repoId}:${pkg.name}`)
    try {
      const res = await fetch('/api/watched/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: pkg.repoId, name: pkg.name,
          sourceUrl: pkg.sourceUrl, // 引用型包会有 sourceUrl，本地包为 undefined（API 会忽略）
          exclude,
        }),
      })
      if (!res.ok) { error(`${isImported(pkg) ? '更新' : '导入'}失败: ${await res.text()}`); return }
      setPreview(null)
      success(`已${isImported(pkg) ? '更新' : '导入'} ${pkg.name}${isImported(pkg) ? '' : ' 到本市场'}`)
      await load(q) // 刷新 localVersion，按钮切到「更新」/置灰
    } finally { setBusy(null) }
  }

  // 首次导入弹窗勾选；更新沿用上次的勾选，直接导入
  const startImport = async (pkg: IndexedPackage) => {
    if (isImported(pkg)) return doImport(pkg)

    setBusy(`import:${pkg.repoId}:${pkg.name}`)
    try {
      const qs = new URLSearchParams({ id: pkg.repoId, name: pkg.name })
      if (pkg.sourceUrl) qs.set('sourceUrl', pkg.sourceUrl) // 引用型包需临时克隆才能列目录
      const res = await fetch(`/api/watched/preview?${qs}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { error(`读取包内容失败: ${data.error || res.statusText}`); return }
      const entries: PreviewEntry[] = data.entries
      setPreview({ pkg, entries, checked: new Set(entries.filter(e => e.suggested).map(e => e.path)) })
    } finally { setBusy(null) }
  }

  const confirmImport = () => {
    if (!preview) return
    const { pkg, entries, checked } = preview
    return doImport(pkg, entries.filter(e => !checked.has(e.path)).map(e => e.path))
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
              const updatable = group.items.filter(hasUpdate).length
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
                    {updatable > 0 && (
                      <span className="ml-auto px-2 py-0.5 text-xs font-medium bg-emerald-500/10 text-emerald-400 rounded border border-emerald-500/30 whitespace-nowrap flex-shrink-0">
                        {updatable} 个可更新
                      </span>
                    )}
                    <span className={`text-xs text-zinc-500 flex-shrink-0 ${updatable > 0 ? '' : 'ml-auto'}`}>{group.items.length} 个技能</span>
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
                        const imported = isImported(pkg) // 已导入本地市场
                        const busyKey = busy === `import:${pkg.repoId}:${pkg.name}`
                        const canUpdate = hasUpdate(pkg)
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
                                  onClick={() => startImport(pkg)}
                                  disabled={busyKey || !canUpdate}
                                  title={canUpdate
                                    ? (pkg.version ? `更新到 ${pkg.version}` : '内容有更新')
                                    : (pkg.localVersion ? `已是最新版本 ${pkg.localVersion}` : '已是最新')}
                                  className="ml-auto px-3 py-1.5 text-sm rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                >
                                  {busyKey ? '更新中' : '更新'}
                                </button>
                              ) : (
                                <button
                                  onClick={() => startImport(pkg)}
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

      {/* 导入内容勾选 */}
      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setPreview(null)}>
          <div className="w-full max-w-lg max-h-[80vh] flex flex-col bg-zinc-900 border border-zinc-800 rounded-xl" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-zinc-800">
              <div className="flex items-center gap-3">
                <h3 className="text-lg font-bold text-zinc-100">选择导入内容</h3>
                <div className="ml-auto flex gap-2 text-xs">
                  <button
                    onClick={() => setPreview(p => p && { ...p, checked: new Set(p.entries.map(e => e.path)) })}
                    className="px-2.5 py-1 rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors"
                  >
                    全选
                  </button>
                  <button
                    // 身份文件恒选中，取消全选时保留
                    onClick={() => setPreview(p => p && { ...p, checked: new Set(p.entries.map(e => e.path).filter(n => KEEP_ALWAYS.has(n))) })}
                    className="px-2.5 py-1 rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors"
                  >
                    取消全选
                  </button>
                  <button
                    onClick={() => setPreview(p => p && { ...p, checked: new Set(p.entries.filter(e => e.suggested).map(e => e.path)) })}
                    className="px-2.5 py-1 rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors"
                  >
                    恢复推荐
                  </button>
                </div>
              </div>
              <p className="text-sm text-zinc-500 mt-1">
                {preview.pkg.name} · 已自动取消勾选官网、文档、测试等与插件运行无关的目录
              </p>
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-zinc-800/60">
              {preview.entries.map(e => {
                const locked = KEEP_ALWAYS.has(e.path)
                return (
                  <label key={e.path} className={`flex items-center gap-3 px-5 py-2.5 ${locked ? 'opacity-60' : 'cursor-pointer hover:bg-zinc-800/30'}`}>
                    <input
                      type="checkbox" disabled={locked} checked={preview.checked.has(e.path)}
                      onChange={() => setPreview(p => {
                        if (!p) return p
                        const checked = new Set(p.checked)
                        if (checked.has(e.path)) checked.delete(e.path); else checked.add(e.path)
                        return { ...p, checked }
                      })}
                      className="w-4 h-4 accent-cyan-500"
                    />
                    <span className="font-mono text-sm text-zinc-300 truncate">{e.path}{e.dir ? '/' : ''}</span>
                    <span className="ml-auto text-xs text-zinc-500 flex-shrink-0">{humanSize(e.size)}</span>
                  </label>
                )
              })}
            </div>
            <div className="flex items-center gap-3 p-5 border-t border-zinc-800">
              <span className="text-sm text-zinc-400">
                预计导入 {humanSize(preview.entries.filter(e => preview.checked.has(e.path)).reduce((s, e) => s + e.size, 0))}
              </span>
              <button onClick={() => setPreview(null)} className="ml-auto px-4 py-2 text-sm rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors">
                取消
              </button>
              <button
                onClick={confirmImport}
                disabled={busy === `import:${preview.pkg.repoId}:${preview.pkg.name}`}
                className="px-4 py-2 text-sm rounded-lg bg-cyan-500 text-white font-medium hover:bg-cyan-600 disabled:opacity-50 transition-colors"
              >
                {busy === `import:${preview.pkg.repoId}:${preview.pkg.name}` ? '导入中...' : '确认导入'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast 通知 */}
      {toasts.map(toast => (
        <Toast key={toast.id} message={toast.message} type={toast.type} onClose={() => hideToast(toast.id)} />
      ))}
    </div>
  )
}
