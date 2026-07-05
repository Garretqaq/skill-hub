/**
 * @author sgz
 * @since 2026-07-04
 */
import { useState, useCallback, useRef } from 'react'
import type { ToastType } from '@/app/_components/Toast'

interface ToastState {
  message: string
  type: ToastType
  id: number
}

export function useToast() {
  const [toasts, setToasts] = useState<ToastState[]>([])
  // 单调递增计数器：同一毫秒内连续触发多个 toast 时 Date.now() 会撞 key，这里保证 id 唯一
  const seq = useRef(0)

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = ++seq.current
    setToasts(prev => [...prev, { message, type, id }])
  }, [])

  const hideToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  return {
    toasts,
    showToast,
    hideToast,
    success: useCallback((msg: string) => showToast(msg, 'success'), [showToast]),
    error: useCallback((msg: string) => showToast(msg, 'error'), [showToast]),
    info: useCallback((msg: string) => showToast(msg, 'info'), [showToast])
  }
}
