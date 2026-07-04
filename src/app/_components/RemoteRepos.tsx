/**
 * @author sgz
 * @since 2026-07-04
 */
'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import type { WatchedRepo, IndexedPackage } from '@/lib/watched'

export default function RemoteRepos() {
  const [repos, setRepos] = useState<WatchedRepo[]>([])
  const [results, setResults] = useState<IndexedPackage[]>([])
  const [source, setSource] = useState('')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState<string | null>(null) // 当前进行中的动作标识

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
    if (!source.trim()) return
    setBusy('add')
    try {
      const res = await fetch('/api/watched', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: source.trim() }),
      })
      if (!res.ok) { alert(`添加失败: ${await res.text()}`); return }
      setSource('')
      await load(q)
    } finally { setBusy(null) }
  }

  const removeRepo = async (id: string) => {
    setBusy(`rm:${id}`)
    try {
      await fetch('/api/watched', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
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
        body: JSON.stringify({ id: pkg.repoId, name: pkg.name }),
      })
      if (!res.ok) { alert(`导入失败: ${await res.text()}`); return }
      alert(`已导入 ${pkg.name} 到本市场`)
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
      <div className="flex gap-3">
        <input
          value={source}
          onChange={(e) => setSource(e.target.value)}
          placeholder="owner/repo 或完整 git URL"
          className="flex-1 px-4 py-3 bg-zinc-900/50 border border-zinc-800 rounded-lg text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-cyan-500/50"
        />
        <button
          onClick={addRepo}
          disabled={busy === 'add'}
          className="px-6 py-3 bg-cyan-500 text-white rounded-lg font-medium hover:bg-cyan-600 disabled:opacity-50 transition-colors"
        >
          {busy === 'add' ? '添加中...' : '添加监听'}
        </button>
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
                <span className="flex-1 font-mono text-sm text-zinc-300 truncate">{r.source}</span>
                <button
                  onClick={() => refresh(r.id)}
                  disabled={busy === `refresh:${r.id}`}
                  className="px-3 py-1.5 text-sm rounded-lg bg-zinc-800/50 text-zinc-300 border border-zinc-700 hover:bg-zinc-700/50 disabled:opacity-50 transition-colors"
                >
                  {busy === `refresh:${r.id}` ? '刷新中' : '刷新'}
                </button>
                <button
                  onClick={() => removeRepo(r.id)}
                  disabled={busy === `rm:${r.id}`}
                  className="px-3 py-1.5 text-sm rounded-lg bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 disabled:opacity-50 transition-colors"
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
        <div className="divide-y divide-zinc-800 border border-zinc-800 rounded-xl overflow-hidden bg-zinc-900/40">
          {results.length === 0 ? (
            <p className="p-4 text-zinc-600 text-sm">无结果。</p>
          ) : (
            results.map((pkg) => (
              <div key={`${pkg.repoId}:${pkg.name}`} className="p-4 space-y-2">
                <div className="flex items-center gap-3">
                  <span className="px-2 py-0.5 text-xs font-medium bg-zinc-800/50 text-zinc-400 rounded border border-zinc-700/50">{pkg.kind}</span>
                  <span className="text-lg font-semibold text-zinc-100 truncate">{pkg.name}</span>
                  <span className="text-xs text-zinc-500 truncate">{pkg.source}</span>
                  <button
                    onClick={() => doImport(pkg)}
                    disabled={busy === `import:${pkg.repoId}:${pkg.name}`}
                    className="ml-auto px-3 py-1.5 text-sm rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/20 disabled:opacity-50 transition-colors"
                  >
                    {busy === `import:${pkg.repoId}:${pkg.name}` ? '导入中' : '导入本市场'}
                  </button>
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
            ))
          )}
        </div>
      </div>
    </div>
  )
}
