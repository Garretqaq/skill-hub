/**
 * @author sgz
 * @since 2026-07-03
 */
'use client'

import { useState, useEffect } from 'react'

interface InstallCommandsProps {
  market: string
  repoUrl: string
  name: string
}

// 从仓库地址解析 owner/repo，供拼接本站 /proxy 代理地址
function parseOwnerRepo(url: string): { owner: string; repo: string } | null {
  const m = url.match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/)
  return m ? { owner: m[1], repo: m[2] } : null
}

export default function InstallCommands({ market, repoUrl, name }: InstallCommandsProps) {
  const [copied, setCopied] = useState<string | null>(null)
  const [origin, setOrigin] = useState('') // 客户端挂载后取，SSR 阶段为空
  const [client, setClient] = useState<'claude' | 'codex' | 'omp'>('claude')

  useEffect(() => setOrigin(window.location.origin), [])

  const or = parseOwnerRepo(repoUrl)
  // 末尾带 .git：Claude Code 据此识别为 git 源走 clone；否则会当 HTTP-JSON 端点直接 fetch 报 schema 错
  const proxyUrl = origin && or ? `${origin}/proxy/${or.owner}/${or.repo}.git` : ''

  // 各客户端命令串：同结构动态生成，仅前缀/子命令/flag 不同
  const cmds = {
    claude: {
      install: `/plugin install ${name}@${market}`,
      addDirect: `/plugin marketplace add ${repoUrl}`,
      addProxy: `/plugin marketplace add ${proxyUrl}`,
    },
    codex: {
      install: `codex plugin add ${name}@${market} --json`,
      addDirect: `codex plugin marketplace add ${repoUrl}`,
      addProxy: `codex plugin marketplace add ${proxyUrl}`,
    },
    omp: {
      install: `omp plugin install ${name}@${market}`,
      addDirect: `omp plugin marketplace add ${repoUrl}`,
      addProxy: `omp plugin marketplace add ${proxyUrl}`,
    },
  }[client]

  const copyToClipboard = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(id)
      setTimeout(() => setCopied(null), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  // 单条命令行（终端风格 + 复制按钮）
  const cmdRow = (cmd: string, id: string) => (
    <div className="relative">
      <div className="absolute inset-0 bg-gradient-to-br from-zinc-950 to-zinc-900 rounded-lg" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,rgba(0,217,255,0.05),transparent)] rounded-lg" />
      <div className="relative flex items-center gap-3 p-4 border border-zinc-800 rounded-lg hover:border-cyan-500/30 transition-colors duration-300">
        <span className="text-cyan-400 font-mono text-sm flex-shrink-0">›</span>
        <code className="flex-1 font-mono text-sm text-zinc-300 break-all">{cmd}</code>
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
  )

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold text-zinc-100 flex items-center gap-2">
        <svg className="w-5 h-5 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        安装命令
      </h3>

      {/* 客户端切换：Claude Code / Codex / Oh My Pi */}
      <div className="flex gap-2">
        {(['claude', 'codex', 'omp'] as const).map((c) => (
          <button
            key={c}
            onClick={() => setClient(c)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-all duration-200 ${
              client === c
                ? 'bg-cyan-500/15 border-cyan-500/50 text-cyan-300'
                : 'bg-zinc-900/30 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700'
            }`}
          >
            {c === 'claude' ? 'Claude Code' : c === 'codex' ? 'Codex' : 'Oh My Pi'}
          </button>
        ))}
      </div>

      {/* 执行环境提示：claude 在会话内执行，codex / omp 在终端直接执行 */}
      <div className="text-xs text-zinc-500 leading-relaxed">
        {client === 'claude'
          ? '先运行 claude 启动会话，再在会话内执行下列斜杠命令。'
          : client === 'codex'
            ? '在终端直接执行下列命令，无需先启动 codex。'
            : '在终端直接执行下列命令，无需先启动 omp。'}
      </div>

      {/* 安装技能：最常用，置顶常显 */}
      <div className="space-y-2">
        <div className="text-xs text-zinc-500 font-medium">安装技能</div>
        {cmdRow(cmds.install, 'install')}
      </div>

      {/* 添加市场：一次性步骤，默认折叠。已添加过市场源的可跳过 */}
      <details className="group/market rounded-lg border border-zinc-800 bg-zinc-900/30">
        <summary className="flex items-center gap-2 px-4 py-3 cursor-pointer text-sm text-zinc-300 select-none list-none hover:text-cyan-400 transition-colors">
          <svg className="w-4 h-4 flex-shrink-0 transition-transform group-open/market:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <span className="font-medium">添加市场源</span>
          <span className="text-xs text-zinc-500">首次使用需要 · 已添加过可跳过</span>
        </summary>
        <div className="px-4 pb-4 pt-1 space-y-3">
          <div className="space-y-2">
            <div className="text-xs text-zinc-500 font-medium">直连（GitHub）</div>
            {cmdRow(cmds.addDirect, 'add-direct')}
          </div>
          {proxyUrl && (
            <div className="space-y-2">
              <div className="text-xs text-zinc-500 font-medium">代理加速（国内网络更快）</div>
              {cmdRow(cmds.addProxy, 'add-proxy')}
            </div>
          )}
        </div>
      </details>

      <div className="flex items-start gap-3 p-4 bg-cyan-500/5 border border-cyan-500/20 rounded-lg">
        <svg className="w-5 h-5 text-cyan-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <div className="text-sm text-zinc-400 leading-relaxed">
          首次使用先「添加市场源」，之后安装本市场的其它技能无需重复添加。国内访问 GitHub 慢时，用「代理加速」地址。
        </div>
      </div>
    </div>
  )
}
