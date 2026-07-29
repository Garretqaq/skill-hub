/**
 * @author sgz
 * @since 2026-07-03
 */
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: username, pass: password })
      })

      if (res.status === 401) {
        setError('用户名或密码错误')
        setLoading(false)
        return
      }

      if (res.status === 429) {
        setError('登录失败次数过多，账户已被锁定')
        setLoading(false)
        return
      }

      if (!res.ok) {
        setError('登录失败，请稍后重试')
        setLoading(false)
        return
      }

      router.push('/admin')
      router.refresh()
    } catch (err) {
      setError('网络错误，请检查连接')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950 flex items-center justify-center p-4">
      {/* Background decoration - reduced intensity */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-[32rem] h-[32rem] bg-cyan-500/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-[32rem] h-[32rem] bg-fuchsia-500/5 rounded-full blur-3xl" />
      </div>

      {/* Login Card */}
      <div className="relative w-full max-w-md">
        {/* Card - removed excessive glow */}
        <div className="relative bg-zinc-900/90 backdrop-blur-sm border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="p-8 pb-6 text-center border-b border-zinc-800/50">
            <div className="inline-flex items-center justify-center w-14 h-14 bg-gradient-to-br from-cyan-500 to-fuchsia-500 rounded-xl mb-5">
              <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-zinc-100 mb-1.5">管理员登录</h1>
            <p className="text-sm text-zinc-400">登录后可上传和管理技能</p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-8 space-y-5">
            {/* Error Message */}
            {error && (
              <div className="flex items-start gap-3 p-3.5 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400">
                <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-sm leading-tight">{error}</span>
              </div>
            )}

            {/* Username */}
            <div className="space-y-2">
              <label htmlFor="username" className="block text-sm font-medium text-zinc-300">
                用户名
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoComplete="username"
                className="w-full px-4 py-2.5 bg-zinc-800/50 border border-zinc-700/50 rounded-lg text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-cyan-500/40 focus:bg-zinc-800/70 transition-all duration-200 [&:-webkit-autofill]:shadow-[0_0_0_1000px_rgb(39_39_42_/_0.5)_inset] [&:-webkit-autofill]:[-webkit-text-fill-color:rgb(244_244_245)] [&:-webkit-autofill:hover]:shadow-[0_0_0_1000px_rgb(39_39_42_/_0.5)_inset] [&:-webkit-autofill:focus]:shadow-[0_0_0_1000px_rgb(39_39_42_/_0.7)_inset]"
                placeholder="请输入用户名"
              />
            </div>

            {/* Password */}
            <div className="space-y-2">
              <label htmlFor="password" className="block text-sm font-medium text-zinc-300">
                密码
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="w-full px-4 py-2.5 bg-zinc-800/50 border border-zinc-700/50 rounded-lg text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-cyan-500/40 focus:bg-zinc-800/70 transition-all duration-200 [&:-webkit-autofill]:shadow-[0_0_0_1000px_rgb(39_39_42_/_0.5)_inset] [&:-webkit-autofill]:[-webkit-text-fill-color:rgb(244_244_245)] [&:-webkit-autofill:hover]:shadow-[0_0_0_1000px_rgb(39_39_42_/_0.5)_inset] [&:-webkit-autofill:focus]:shadow-[0_0_0_1000px_rgb(39_39_42_/_0.7)_inset]"
                placeholder="请输入密码"
              />
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading || !username || !password}
              className="w-full px-6 py-3 bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white rounded-lg font-medium hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:ring-offset-2 focus:ring-offset-zinc-900 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
            >
              {loading ? '登录中...' : '登录'}
            </button>

            {/* Back Link */}
            <div className="text-center pt-2">
              <a
                href="/"
                className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-cyan-400 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                返回首页
              </a>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
