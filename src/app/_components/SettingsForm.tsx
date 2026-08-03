/**
 * @author sgz
 * @since 2026-07-03
 */
'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/lib/useToast'
import Toast from './Toast'

interface SettingsFormProps {
  onClose: () => void
}

export default function SettingsForm({ onClose }: SettingsFormProps) {
  const router = useRouter()
  const [repoUrl, setRepoUrl] = useState('')
  const [token, setToken] = useState('')
  const [name, setName] = useState('')
  const [hasToken, setHasToken] = useState(false)
  const [proxyUrl, setProxyUrl] = useState('')
  const [proxyAuth, setProxyAuth] = useState('')
  const [noProxy, setNoProxy] = useState('')
  const [hasProxyAuth, setHasProxyAuth] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [testing, setTesting] = useState(false)
  const { toasts, hideToast, success, error } = useToast()

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      const res = await fetch('/api/settings/refresh', { method: 'POST' })
      const d = await res.json()
      if (!res.ok) {
        error(`刷新失败: ${d.detail || d.error}`)
        return
      }
      success(`刷新成功，当前 ${d.count} 个技能`)
      router.refresh()
    } catch (err) {
      error(`刷新失败: ${err}`)
    } finally {
      setRefreshing(false)
    }
  }

  const handleTest = async () => {
    setTesting(true)
    try {
      const res = await fetch('/api/settings/proxy-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proxyUrl: proxyUrl.trim(), proxyAuth: proxyAuth.trim() }),
      })
      const d = await res.json()
      if (!res.ok) {
        error(`代理不通: ${d.detail || d.error}`)
        return
      }
      success(`代理可用，耗时 ${d.ms}ms`)
    } catch (err) {
      error(`测试失败: ${err}`)
    } finally {
      setTesting(false)
    }
  }

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((d) => {
        setRepoUrl(d.repoUrl || '')
        setName(d.name || '')
        setHasToken(!!d.hasToken)
        setProxyUrl(d.proxyUrl || '')
        setNoProxy(d.noProxy || '')
        setHasProxyAuth(!!d.hasProxyAuth)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repoUrl: repoUrl.trim(), token: token.trim(), name: name.trim(),
          proxyUrl: proxyUrl.trim(), proxyAuth: proxyAuth.trim(), noProxy: noProxy.trim(),
        }),
      })
      if (!res.ok) {
        error(`保存失败: ${await res.text()}`)
        return
      }
      success('保存成功')
      onClose()
    } catch (err) {
      error(`保存失败: ${err}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg">
        {/* Glow effect */}
        <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/20 via-fuchsia-500/20 to-cyan-500/20 rounded-2xl blur-2xl" />

        {/* Modal */}
        <div className="relative bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-zinc-800">
            <h2 className="text-2xl font-bold text-zinc-100">设置</h2>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-zinc-800 transition-colors"
            >
              <svg className="w-6 h-6 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
            <div className="space-y-2">
              <label htmlFor="repo-url" className="block text-sm font-medium text-zinc-300">
                远程 Git 仓库地址
              </label>
              <input
                id="repo-url"
                type="text"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                placeholder={loading ? '加载中...' : 'https://host/owner/repo.git'}
                disabled={loading}
                className="w-full px-4 py-3 bg-zinc-900/50 border border-zinc-800 rounded-lg text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/20 transition-all duration-300 disabled:opacity-50"
              />
              <p className="text-sm text-zinc-500">不含 token 的仓库地址。</p>
            </div>

            <div className="space-y-2">
              <label htmlFor="market-name" className="block text-sm font-medium text-zinc-300">
                市场名称
              </label>
              <input
                id="market-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={loading ? '加载中...' : 'my-skills'}
                disabled={loading}
                className="w-full px-4 py-3 bg-zinc-900/50 border border-zinc-800 rounded-lg text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/20 transition-all duration-300 disabled:opacity-50"
              />
              <p className="text-sm text-zinc-500">
                安装命令 <code className="text-cyan-400">install xxx@市场名</code> 用它。改名会写入并推送仓库。
              </p>
            </div>

            <div className="space-y-2">
              <label htmlFor="repo-token" className="block text-sm font-medium text-zinc-300">
                访问 Token
              </label>
              <input
                id="repo-token"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={loading ? '加载中...' : hasToken ? '已配置，留空则保留原 token' : '填写访问 token'}
                disabled={loading}
                autoComplete="new-password"
                className="w-full px-4 py-3 bg-zinc-900/50 border border-zinc-800 rounded-lg text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/20 transition-all duration-300 disabled:opacity-50"
              />
              <p className="text-sm text-zinc-500">
                单独保存，不会回显。推送时自动注入到地址中。
              </p>
            </div>

            <div className="space-y-2">
              <label htmlFor="proxy-url" className="block text-sm font-medium text-zinc-300">
                代理地址
              </label>
              <div className="flex gap-3">
                <input
                  id="proxy-url"
                  type="text"
                  value={proxyUrl}
                  onChange={(e) => setProxyUrl(e.target.value)}
                  placeholder={loading ? '加载中...' : 'http://127.0.0.1:7890（留空停用）'}
                  disabled={loading}
                  className="flex-1 min-w-0 px-4 py-3 bg-zinc-900/50 border border-zinc-800 rounded-lg text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/20 transition-all duration-300 disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={handleTest}
                  disabled={loading || testing || !proxyUrl.trim()}
                  className="px-4 py-3 bg-zinc-800 text-zinc-300 rounded-lg font-medium hover:bg-zinc-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                >
                  {testing ? '测试中...' : '测试'}
                </button>
              </div>
              <p className="text-sm text-zinc-500">
                拉取远程仓库与监听库时使用。支持 http/https/socks5，
                <span className="text-zinc-400">socks5 仅对 git 拉取生效，/proxy 代理路由不支持</span>。
              </p>
            </div>

            <div className="space-y-2">
              <label htmlFor="proxy-auth" className="block text-sm font-medium text-zinc-300">
                代理认证
              </label>
              <input
                id="proxy-auth"
                type="password"
                value={proxyAuth}
                onChange={(e) => setProxyAuth(e.target.value)}
                placeholder={loading ? '加载中...' : hasProxyAuth ? '已配置，留空则保留原值' : 'user:pass（无需认证则留空）'}
                disabled={loading}
                autoComplete="new-password"
                className="w-full px-4 py-3 bg-zinc-900/50 border border-zinc-800 rounded-lg text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/20 transition-all duration-300 disabled:opacity-50"
              />
              <p className="text-sm text-zinc-500">
                单独保存，不会回显。使用时注入到代理地址中。
              </p>
            </div>

            <div className="space-y-2">
              <label htmlFor="no-proxy" className="block text-sm font-medium text-zinc-300">
                不走代理的 host
              </label>
              <input
                id="no-proxy"
                type="text"
                value={noProxy}
                onChange={(e) => setNoProxy(e.target.value)}
                placeholder={loading ? '加载中...' : 'git.corp.com, 10.0.0.1'}
                disabled={loading}
                className="w-full px-4 py-3 bg-zinc-900/50 border border-zinc-800 rounded-lg text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/20 transition-all duration-300 disabled:opacity-50"
              />
              <p className="text-sm text-zinc-500">
                逗号分隔。按后缀匹配：<code className="text-cyan-400">corp.com</code> 同时命中{' '}
                <code className="text-cyan-400">git.corp.com</code>。
              </p>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3 pt-4">
              <button
                type="submit"
                disabled={loading || saving}
                className="flex-1 px-6 py-3 bg-cyan-500 text-white rounded-lg font-medium hover:bg-cyan-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 shadow-[0_0_20px_rgba(0,217,255,0.3)] hover:shadow-[0_0_30px_rgba(0,217,255,0.5)]"
              >
                {saving ? '保存中...' : '保存'}
              </button>
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="px-6 py-3 bg-zinc-800 text-zinc-300 rounded-lg font-medium hover:bg-zinc-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleRefresh}
                disabled={loading || saving || refreshing}
                className="px-6 py-3 bg-zinc-800 text-zinc-300 rounded-lg font-medium hover:bg-zinc-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {refreshing ? '刷新中...' : '刷新'}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Toast 通知 */}
      {toasts.map(toast => (
        <Toast key={toast.id} message={toast.message} type={toast.type} onClose={() => hideToast(toast.id)} />
      ))}
    </div>
  )
}
