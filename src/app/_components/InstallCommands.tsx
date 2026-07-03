/**
 * @author sgz
 * @since 2026-07-03
 */
'use client'

import { useState } from 'react'

interface InstallCommandsProps {
  market: string
  repoUrl: string
  name: string
}

export default function InstallCommands({ market, repoUrl, name }: InstallCommandsProps) {
  const [copied, setCopied] = useState<string | null>(null)

  const commands = [
    {
      label: '添加市场',
      cmd: `npx skills add-market ${market} ${repoUrl}`,
      id: 'add-market'
    },
    {
      label: '安装技能',
      cmd: `npx skills install ${name} -g`,
      id: 'install'
    }
  ]

  const copyToClipboard = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(id)
      setTimeout(() => setCopied(null), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold text-zinc-100 flex items-center gap-2">
        <svg className="w-5 h-5 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        安装命令
      </h3>

      <div className="space-y-3">
        {commands.map(({ label, cmd, id }) => (
          <div key={id} className="group">
            <div className="text-xs text-zinc-500 mb-2 font-medium">{label}</div>
            <div className="relative">
              {/* Terminal-style background */}
              <div className="absolute inset-0 bg-gradient-to-br from-zinc-950 to-zinc-900 rounded-lg" />
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,rgba(0,217,255,0.05),transparent)] rounded-lg" />

              {/* Content */}
              <div className="relative flex items-center gap-3 p-4 border border-zinc-800 rounded-lg group-hover:border-cyan-500/30 transition-colors duration-300">
                {/* Terminal prompt */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-cyan-400 font-mono text-sm">$</span>
                </div>

                {/* Command */}
                <code className="flex-1 font-mono text-sm text-zinc-300 break-all">
                  {cmd}
                </code>

                {/* Copy button */}
                <button
                  onClick={() => copyToClipboard(cmd, id)}
                  className="flex-shrink-0 p-2 rounded-lg bg-zinc-800/50 hover:bg-zinc-700/50 border border-zinc-700 hover:border-cyan-500/50 transition-all duration-300 group/btn"
                  title="复制命令"
                >
                  {copied === id ? (
                    <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4 text-zinc-400 group-hover/btn:text-cyan-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-start gap-3 p-4 bg-cyan-500/5 border border-cyan-500/20 rounded-lg">
        <svg className="w-5 h-5 text-cyan-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <div className="text-sm text-zinc-400 leading-relaxed">
          首次使用需要先添加市场源，然后再安装具体技能。使用 <code className="px-2 py-0.5 bg-zinc-900/50 rounded text-cyan-400 font-mono text-xs">-g</code> 参数全局安装。
        </div>
      </div>
    </div>
  )
}
