/**
 * @author sgz
 * @since 2026-07-03
 */
'use client'

import { useState, useEffect } from 'react'

interface SettingsFormProps {
  onClose: () => void
}

export default function SettingsForm({ onClose }: SettingsFormProps) {
  const [repoUrl, setRepoUrl] = useState('')
  const [token, setToken] = useState('')
  const [name, setName] = useState('')
  const [hasToken, setHasToken] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((d) => {
        setRepoUrl(d.repoUrl || '')
        setName(d.name || '')
        setHasToken(!!d.hasToken)
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
        body: JSON.stringify({ repoUrl: repoUrl.trim(), token: token.trim(), name: name.trim() }),
      })
      if (!res.ok) {
        alert(`保存失败: ${await res.text()}`)
        return
      }
      onClose()
    } catch (err) {
      alert(`保存失败: ${err}`)
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
          <form onSubmit={handleSubmit} className="p-6 space-y-6">
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
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
