/**
 * @author sgz
 * @since 2026-07-03
 */
'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import type { PluginEntry } from '@/lib/marketplace'

interface SkillGridProps {
  plugins: PluginEntry[]
}

export default function SkillGrid({ plugins }: SkillGridProps) {
  const [search, setSearch] = useState('')
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set())

  // Extract all unique tags
  const allTags = useMemo(() => {
    const tags = new Set<string>()
    plugins.forEach(p => p.tags?.forEach(t => tags.add(t)))
    return Array.from(tags).sort()
  }, [plugins])

  // Filter plugins
  const filtered = useMemo(() => {
    let result = plugins

    // Search filter
    if (search.trim()) {
      const term = search.toLowerCase()
      result = result.filter(p =>
        p.name.toLowerCase().includes(term) ||
        p.description?.toLowerCase().includes(term)
      )
    }

    // Tag filter
    if (selectedTags.size > 0) {
      result = result.filter(p =>
        p.tags?.some(t => selectedTags.has(t))
      )
    }

    return result
  }, [plugins, search, selectedTags])

  const toggleTag = (tag: string) => {
    setSelectedTags(prev => {
      const next = new Set(prev)
      if (next.has(tag)) next.delete(tag)
      else next.add(tag)
      return next
    })
  }

  return (
    <div className="w-full space-y-8">
      {/* Search & Filter Bar */}
      <div className="space-y-4">
        {/* Search Input */}
        <div className="relative group">
          <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/20 to-fuchsia-500/20 rounded-xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索技能名称或描述..."
            className="relative w-full px-6 py-4 bg-zinc-900/50 border border-zinc-800 rounded-xl text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/20 backdrop-blur-sm transition-all duration-300"
          />
          <svg className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>

        {/* Tag Filter */}
        {allTags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {allTags.map(tag => (
              <button
                key={tag}
                onClick={() => toggleTag(tag)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-300 ${
                  selectedTags.has(tag)
                    ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/50 shadow-[0_0_15px_rgba(0,217,255,0.3)]'
                    : 'bg-zinc-900/30 text-zinc-400 border border-zinc-800 hover:border-zinc-700 hover:text-zinc-300'
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Results Count */}
      <div className="text-zinc-400 text-sm">
        找到 <span className="text-cyan-400 font-semibold">{filtered.length}</span> 个技能
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-20 h-20 rounded-full bg-zinc-900/50 border border-zinc-800 flex items-center justify-center mb-6">
            <svg className="w-10 h-10 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-zinc-500 text-lg">没有找到匹配的技能</p>
          <p className="text-zinc-600 text-sm mt-2">尝试调整搜索条件或标签筛选</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filtered.map((plugin) => (
            <Link
              key={plugin.name}
              href={`/skills/${plugin.name}`}
              className="group relative block"
            >
              {/* Glow effect on hover */}
              <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/0 via-fuchsia-500/0 to-cyan-500/0 group-hover:from-cyan-500/20 group-hover:via-fuchsia-500/10 group-hover:to-cyan-500/20 rounded-2xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

              {/* Card */}
              <div className="relative h-full p-6 bg-zinc-900/40 border border-zinc-800 rounded-2xl backdrop-blur-sm group-hover:border-cyan-500/50 group-hover:bg-zinc-900/60 transition-all duration-300 overflow-hidden">
                {/* Animated corner accent */}
                <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-cyan-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

                <div className="relative space-y-4">
                  {/* Header */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <h3 className="text-xl font-bold text-zinc-100 group-hover:text-cyan-400 transition-colors duration-300 line-clamp-1">
                        {plugin.name}
                      </h3>
                      {plugin.version && (
                        <span className="flex-shrink-0 px-2 py-0.5 text-xs font-mono font-medium bg-fuchsia-500/10 text-fuchsia-400 border border-fuchsia-500/30 rounded">
                          v{plugin.version}
                        </span>
                      )}
                    </div>
                    <svg className="w-5 h-5 text-zinc-600 group-hover:text-cyan-400 group-hover:translate-x-1 group-hover:-translate-y-1 transition-all duration-300 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                    </svg>
                  </div>

                  {/* Description */}
                  <p className="text-zinc-400 text-sm leading-relaxed line-clamp-3 min-h-[3.75rem]">
                    {plugin.description || '暂无描述'}
                  </p>

                  {/* Tags */}
                  {plugin.tags && plugin.tags.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-2">
                      {plugin.tags.slice(0, 3).map(tag => (
                        <span
                          key={tag}
                          className="px-3 py-1 text-xs font-medium bg-zinc-800/50 text-zinc-400 rounded-md border border-zinc-700/50"
                        >
                          {tag}
                        </span>
                      ))}
                      {plugin.tags.length > 3 && (
                        <span className="px-3 py-1 text-xs font-medium text-zinc-500">
                          +{plugin.tags.length - 3}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Source indicator */}
                  <div className="flex items-center gap-2 text-xs text-zinc-600 pt-2 border-t border-zinc-800/50">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                    </svg>
                    <span className="truncate">{plugin.source}</span>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
