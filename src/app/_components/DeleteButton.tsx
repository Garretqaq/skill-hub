/**
 * @author sgz
 * @since 2026-07-03
 */
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/lib/useToast'
import Toast from './Toast'

interface DeleteButtonProps {
  name: string
}

export default function DeleteButton({ name }: DeleteButtonProps) {
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const router = useRouter()
  const { toasts, hideToast, error } = useToast()

  const handleDelete = async () => {
    if (!confirming) {
      setConfirming(true)
      return
    }

    setDeleting(true)
    try {
      const res = await fetch(`/api/skills/${name}`, { method: 'DELETE' })
      if (!res.ok) {
        const text = await res.text()
        error(`删除失败: ${text}`)
        return
      }
      router.push('/')
      router.refresh()
    } catch (err) {
      error(`删除失败: ${err}`)
    } finally {
      setDeleting(false)
      setConfirming(false)
    }
  }

  return (
    <div className="p-6 bg-red-500/5 border border-red-500/20 rounded-xl">
      <h3 className="text-lg font-bold text-zinc-100 mb-2 flex items-center gap-2">
        <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        危险区域
      </h3>
      <p className="text-sm text-zinc-400 mb-4">
        删除此技能将移除所有相关文件，此操作不可撤销。
      </p>
      <div className="flex items-center gap-3">
        <button
          onClick={handleDelete}
          disabled={deleting}
          className={`px-4 py-2 rounded-lg font-medium text-sm transition-all duration-300 ${
            confirming
              ? 'bg-red-500 text-white hover:bg-red-600 shadow-[0_0_20px_rgba(239,68,68,0.4)]'
              : 'bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 hover:border-red-500/50'
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {deleting ? '删除中...' : confirming ? '确认删除' : '删除技能'}
        </button>
        {confirming && (
          <button
            onClick={() => setConfirming(false)}
            disabled={deleting}
            className="px-4 py-2 rounded-lg font-medium text-sm bg-zinc-800/50 text-zinc-400 border border-zinc-700 hover:bg-zinc-700/50 hover:border-zinc-600 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            取消
          </button>
        )}
      </div>

      {/* Toast 通知 */}
      {toasts.map(toast => (
        <Toast key={toast.id} message={toast.message} type={toast.type} onClose={() => hideToast(toast.id)} />
      ))}
    </div>
  )
}
