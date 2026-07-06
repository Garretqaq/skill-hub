/**
 * @author sgz
 * @since 2026-07-03
 */
'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { PluginEntry } from '@/lib/marketplace'
import type { UpdateItem } from '@/lib/watched'
import UploadForm from './UploadForm'
import SettingsForm from './SettingsForm'
import { useToast } from '@/lib/useToast'
import Toast from './Toast'

interface AdminConsoleProps {
  plugins: PluginEntry[]
}

export default function AdminConsole({ plugins }: AdminConsoleProps) {
  const [showUpload, setShowUpload] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const router = useRouter()
  const { toasts, hideToast, error, success } = useToast()
  const [updates, setUpdates] = useState<Record<string, UpdateItem>>({})

  const loadUpdates = useCallback(async () => {
    const res = await fetch('/api/updates')
    if (!res.ok) return
    const data = await res.json()
    const map: Record<string, UpdateItem> = {}
    for (const u of data.updates as UpdateItem[]) map[u.name] = u
    setUpdates(map)
  }, [])

  useEffect(() => { loadUpdates() }, [loadUpdates])

  const onChanged = useCallback(() => { router.refresh(); loadUpdates() }, [router, loadUpdates])

  // 初始顺序来自 props；order 存 name 数组
  const initialOrder = useMemo(() => plugins.map(p => p.name), [plugins])
  const [order, setOrder] = useState<string[]>(initialOrder)
  const [saving, setSaving] = useState(false)
  // props 变化（router.refresh 后）时重置本地顺序
  useEffect(() => { setOrder(plugins.map(p => p.name)) }, [plugins])

  const byName = useMemo(() => new Map(plugins.map(p => [p.name, p])), [plugins])
  const dirty = order.length === initialOrder.length && order.some((n, i) => n !== initialOrder[i])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    setOrder(prev => {
      const from = prev.indexOf(String(active.id))
      const to = prev.indexOf(String(over.id))
      return arrayMove(prev, from, to)
    })
  }

  const handleReset = () => setOrder(plugins.map(p => p.name))

  const handleSaveOrder = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/skills/order', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order }),
      })
      if (!res.ok) { error(`保存排序失败: ${await res.text()}`); return }
      success('排序已保存')
      router.refresh()
    } catch (err) {
      error(`保存排序失败: ${err}`)
    } finally {
      setSaving(false)
    }
  }

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
          <Link
            href="/admin/remote"
            className="flex items-center gap-2 px-5 py-2.5 bg-zinc-800 text-zinc-300 rounded-lg font-medium hover:bg-zinc-700 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            远程仓库
          </Link>
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

      {/* 未保存排序提示条 */}
      {dirty && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
          <span className="text-sm text-amber-400">有未保存的排序改动</span>
          <div className="flex items-center gap-2">
            <button
              onClick={handleReset}
              disabled={saving}
              className="px-3 py-1.5 text-sm rounded-lg bg-zinc-800/50 text-zinc-300 border border-zinc-700 hover:bg-zinc-700/50 disabled:opacity-50 transition-colors"
            >
              撤销
            </button>
            <button
              onClick={handleSaveOrder}
              disabled={saving}
              className="px-3 py-1.5 text-sm rounded-lg font-medium bg-cyan-500 text-white hover:bg-cyan-600 disabled:opacity-50 transition-colors"
            >
              {saving ? '保存中...' : '保存排序'}
            </button>
          </div>
        </div>
      )}

      {/* Skill list */}
      {plugins.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center border border-dashed border-zinc-800 rounded-2xl">
          <p className="text-zinc-500 text-lg">还没有技能</p>
          <p className="text-zinc-600 text-sm mt-2">点击右上角「上传技能」添加第一个</p>
        </div>
      ) : (
        <div className="divide-y divide-zinc-800 border border-zinc-800 rounded-2xl overflow-hidden bg-zinc-900/40 backdrop-blur-sm">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={order} strategy={verticalListSortingStrategy}>
              {order.map((name) => {
                const plugin = byName.get(name)
                if (!plugin) return null
                return (
                  <AdminRow
                    key={name}
                    plugin={plugin}
                    update={updates[name]}
                    onChanged={onChanged}
                    onError={error}
                    onSuccess={success}
                  />
                )
              })}
            </SortableContext>
          </DndContext>
        </div>
      )}

      {showUpload && <UploadForm onClose={() => setShowUpload(false)} />}
      {showSettings && <SettingsForm onClose={() => setShowSettings(false)} />}

      {/* Toast 通知 */}
      {toasts.map(toast => (
        <Toast key={toast.id} message={toast.message} type={toast.type} onClose={() => hideToast(toast.id)} />
      ))}
    </div>
  )
}

function AdminRow({ plugin, update, onChanged, onError, onSuccess }: {
  plugin: PluginEntry; update?: UpdateItem;
  onChanged: () => void; onError: (msg: string) => void; onSuccess: (msg: string) => void
}) {
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [updating, setUpdating] = useState(false)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: plugin.name })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 }

  const handleDelete = async () => {
    if (!confirming) {
      setConfirming(true)
      return
    }
    setDeleting(true)
    try {
      const res = await fetch(`/api/skills/${plugin.name}`, { method: 'DELETE' })
      if (!res.ok) {
        onError(`删除失败: ${await res.text()}`)
        return
      }
      onChanged()
    } catch (err) {
      onError(`删除失败: ${err}`)
    } finally {
      setDeleting(false)
      setConfirming(false)
    }
  }

  const handleUpdate = async () => {
    setUpdating(true)
    try {
      const res = await fetch('/api/updates', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: plugin.name }),
      })
      if (!res.ok) { onError(`更新失败: ${await res.text()}`); return }
      onSuccess(`已更新 ${plugin.name} 到 v${update?.remoteVersion}`)
      onChanged()
    } catch (err) {
      onError(`更新失败: ${err}`)
    } finally {
      setUpdating(false)
    }
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-4 p-5 transition-colors ${isDragging ? 'bg-zinc-800/80' : 'hover:bg-zinc-900/60'}`}
    >
      <button
        {...attributes}
        {...listeners}
        aria-label="拖动排序"
        className="flex-shrink-0 cursor-grab active:cursor-grabbing text-zinc-600 hover:text-zinc-400 touch-none"
      >
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path d="M7 4a1 1 0 100 2 1 1 0 000-2zM7 9a1 1 0 100 2 1 1 0 000-2zM7 14a1 1 0 100 2 1 1 0 000-2zM13 4a1 1 0 100 2 1 1 0 000-2zM13 9a1 1 0 100 2 1 1 0 000-2zM13 14a1 1 0 100 2 1 1 0 000-2z" />
        </svg>
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-3">
          <Link
            href={`/skills/${plugin.name}`}
            className="text-lg font-semibold text-zinc-100 hover:text-cyan-400 transition-colors truncate"
          >
            {plugin.name}
          </Link>
          {update && (
            <span
              title="仅按版本号检测"
              className="px-2 py-0.5 text-xs font-medium bg-amber-500/10 text-amber-400 rounded border border-amber-500/30 whitespace-nowrap"
            >
              有更新 v{update.localVersion}→v{update.remoteVersion}
            </span>
          )}
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
        {update && (
          <button
            onClick={handleUpdate}
            disabled={updating}
            className="px-3 py-1.5 text-sm rounded-lg font-medium bg-amber-500/10 text-amber-400 border border-amber-500/30 hover:bg-amber-500/20 disabled:opacity-50 transition-colors"
          >
            {updating ? '更新中...' : '更新'}
          </button>
        )}
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
