/**
 * @author sgz
 * @since 2026-07-03
 */
'use client'

import { useState } from 'react'
import ThemeToggle from './ThemeToggle'

interface NavBarProps {
  user: { username: string } | null
}

export default function NavBar({ user }: NavBarProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)

  const handleLogout = async () => {
    setLoggingOut(true)
    try {
      await fetch('/api/logout', { method: 'POST' })
      window.location.href = '/'
    } catch (err) {
      console.error('Logout failed:', err)
      setLoggingOut(false)
    }
  }

  return (
    <nav className="sticky top-0 z-40 bg-zinc-900/80 backdrop-blur-xl border-b border-zinc-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <a href="/" className="flex items-center gap-3 group">
              <div className="w-10 h-10 bg-gradient-to-br from-cyan-500 to-fuchsia-500 rounded-xl flex items-center justify-center shadow-[0_0_20px_rgba(0,217,255,0.3)] group-hover:shadow-[0_0_30px_rgba(0,217,255,0.5)] transition-all duration-300">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <span className="text-xl font-bold text-zinc-100 group-hover:text-cyan-400 transition-colors">
                Skill Hub
              </span>
            </a>

            {/* Actions */}
            <div className="flex items-center gap-3">
              <ThemeToggle />
              {user ? (
                <>
                  {/* Console Link */}
                  <a
                    href="/admin"
                    className="flex items-center gap-2 px-4 py-2 bg-zinc-800 text-zinc-300 rounded-lg hover:bg-zinc-700 transition-colors font-medium"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h12a2 2 0 012 2v2H4V6zM4 10h16v8a2 2 0 01-2 2H6a2 2 0 01-2-2v-8zM7 14h.01M7 17h.01M11 14h6" />
                    </svg>
                    <span className="hidden sm:inline">控制台</span>
                  </a>

                  {/* User Menu */}
                  <div className="relative">
                    <button
                      onClick={() => setMenuOpen((v) => !v)}
                      className="flex items-center gap-2 px-3 py-1.5 bg-zinc-800/50 rounded-lg border border-zinc-700 hover:bg-zinc-800 transition-colors cursor-pointer"
                    >
                      <div className="w-2 h-2 bg-green-500 rounded-full" />
                      <span className="hidden sm:inline text-sm text-zinc-400">{user.username}</span>
                      <svg
                        className={`w-4 h-4 text-zinc-500 transition-transform ${menuOpen ? 'rotate-180' : ''}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>

                    {menuOpen && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                        <div className="absolute right-0 mt-2 w-40 z-50 bg-zinc-900 border border-zinc-800 rounded-lg shadow-xl py-1">
                          <button
                            onClick={handleLogout}
                            disabled={loggingOut}
                            className="flex items-center gap-2 w-full px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800 transition-colors disabled:opacity-50 cursor-pointer"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                            </svg>
                            登出
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </>
              ) : (
                <a
                  href="/login"
                  className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white rounded-lg hover:shadow-[0_0_20px_rgba(0,217,255,0.4)] transition-all duration-300 font-medium"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
                  </svg>
                  <span>登录</span>
                </a>
              )}
            </div>
          </div>
        </div>
      </nav>
  )
}
