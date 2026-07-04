/**
 * @author sgz
 * @since 2026-07-03
 */
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { PluginEntry } from '@/lib/marketplace'
import UploadForm from './UploadForm'
import SettingsForm from './SettingsForm'

interface AdminConsoleProps {
  plugins: PluginEntry[]
}

export default function AdminConsole({ plugins }: AdminConsoleProps) {
  const [showUpload, setShowUpload] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const router = useRouter()

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-4xl font-bold text-zinc-100">技能控制台</h1>
          <p className="text-zinc-400">
            共 <span className="text-cyan-400 font-semibold">{plugins.length}</span> 个技能，可上传与删除。
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowSettings(true)}
            className="flex items-center gap-2 px-5 py-2.5 bg-zinc-800 text-zinc-300 rounded-lg font-medium hover:bg-zinc-700 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            设置
          </button>
          <button
            onClick={() => setShowUpload(true)}
            className="flex items-center gap-2 px-5 py-2.5 bg-cyan-500 text-white rounded-lg font-medium hover:bg-cyan-600 transition-all duration-300 shadow-[0_0_20px_rgba(0,217,255,0.3)] hover:shadow-[0_0_30px_rgba(0,217,255,0.5)]"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            上传技能
          </button>
        </div>
      </div>

      {/* Skill list */}
      {plugins.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center border border-dashed border-zinc-800 rounded-2xl">
          <p className="text-zinc-500 text-lg">还没有技能</p>
          <p className="text-zinc-600 text-sm mt-2">点击右上角「上传技能」添加第一个</p>
        </div>
      ) : (
        <div className="divide-y divide-zinc-800 border border-zinc-800 rounded-2xl overflow-hidden bg-zinc-900/40 backdrop-blur-sm">
          {plugins.map((plugin) => (
            <AdminRow key={plugin.name} plugin={plugin} onChanged={() => router.refresh()} />
          ))}
        </div>
      )}

      {showUpload && <UploadForm onClose={() => setShowUpload(false)} />}
      {showSettings && <SettingsForm onClose={() => setShowSettings(false)} />}
    </div>
  )
}

function AdminRow({ plugin, onChanged }: { plugin: PluginEntry; onChanged: () => void }) {
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const handleDelete = async () => {
    if (!confirming) {
      setConfirming(true)
      return
    }
    setDeleting(true)
    try {
      const res = await fetch(`/api/skills/${plugin.name}`, { method: 'DELETE' })
      if (!res.ok) {
        alert(`删除失败: ${await res.text()}`)
        return
      }
      onChanged()
    } catch (err) {
      alert(`删除失败: ${err}`)
    } finally {
      setDeleting(false)
      setConfirming(false)
    }
  }

  return (
    <div className="flex items-center gap-4 p-5 hover:bg-zinc-900/60 transition-colors">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-3">
          <Link
            href={`/skills/${plugin.name}`}
            className="text-lg font-semibold text-zinc-100 hover:text-cyan-400 transition-colors truncate"
          >
            {plugin.name}
          </Link>
          {plugin.tags?.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="hidden sm:inline px-2 py-0.5 text-xs font-medium bg-zinc-800/50 text-zinc-400 rounded border border-zinc-700/50"
            >
              {tag}
            </span>
          ))}
        </div>
        <p className="text-sm text-zinc-500 truncate mt-1">{plugin.description || '暂无描述'}</p>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        <Link
          href={`/skills/${plugin.name}`}
          className="px-3 py-1.5 text-sm rounded-lg bg-zinc-800/50 text-zinc-300 border border-zinc-700 hover:bg-zinc-700/50 transition-colors"
        >
          查看
        </Link>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-all duration-300 disabled:opacity-50 ${
            confirming
              ? 'bg-red-500 text-white hover:bg-red-600'
              : 'bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20'
          }`}
        >
          {deleting ? '删除中...' : confirming ? '确认删除' : '删除'}
        </button>
        {confirming && !deleting && (
          <button
            onClick={() => setConfirming(false)}
            className="px-3 py-1.5 text-sm rounded-lg bg-zinc-800/50 text-zinc-400 border border-zinc-700 hover:bg-zinc-700/50 transition-colors"
          >
            取消
          </button>
        )}
      </div>
    </div>
  )
}
