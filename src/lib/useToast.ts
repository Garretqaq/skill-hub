/**
 * @author sgz
 * @since 2026-07-04
 */
import { useState, useCallback } from 'react'
import type { ToastType } from '@/app/_components/Toast'

interface ToastState {
  message: string
  type: ToastType
  id: number
}

export function useToast() {
  const [toasts, setToasts] = useState<ToastState[]>([])

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = Date.now()
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
