/**
 * @author sgz
 * @since 2026-07-04
 */
'use client'

import { useEffect, useState } from 'react'

export type ToastType = 'success' | 'error' | 'info'

interface ToastProps {
  message: string
  type: ToastType
  onClose: () => void
}

export default function Toast({ message, type, onClose }: ToastProps) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    // 延迟显示动画
    const showTimer = setTimeout(() => setVisible(true), 10)
    // 3 秒后自动关闭
    const closeTimer = setTimeout(() => {
      setVisible(false)
      setTimeout(onClose, 200) // 等待淡出动画完成
    }, 3000)

    return () => {
      clearTimeout(showTimer)
      clearTimeout(closeTimer)
    }
  }, [onClose])

  const styles = {
    success: {
      bg: 'bg-emerald-500/10',
      border: 'border-emerald-500/30',
      text: 'text-emerald-400',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      )
    },
    error: {
      bg: 'bg-red-500/10',
      border: 'border-red-500/30',
      text: 'text-red-400',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      )
    },
    info: {
      bg: 'bg-cyan-500/10',
      border: 'border-cyan-500/30',
      text: 'text-cyan-400',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      )
    }
  }

  const style = styles[type]

  return (
    <div
      className={`fixed top-4 right-4 z-[100] transition-all duration-200 ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'
      }`}
    >
      <div className={`flex items-center gap-3 px-4 py-3 rounded-lg border ${style.bg} ${style.border} ${style.text} shadow-xl backdrop-blur-sm min-w-[320px] max-w-md`}>
        <div className="flex-shrink-0">{style.icon}</div>
        <p className="flex-1 text-sm font-medium whitespace-pre-line">{message}</p>
        <button
          onClick={() => {
            setVisible(false)
            setTimeout(onClose, 200)
          }}
          className="flex-shrink-0 p-1 hover:bg-white/10 rounded transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  )
}
