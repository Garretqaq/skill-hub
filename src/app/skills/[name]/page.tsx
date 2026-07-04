/**
 * @author sgz
 * @since 2026-07-03
 */
import { notFound } from 'next/navigation'
import { getPluginDetail } from '@/lib/marketplace'
import { REPO_DIR } from '@/lib/config'
import { getSettings, getMarketName } from '@/lib/settings'
import { getUser } from '@/lib/auth'
import InstallCommands from '@/app/_components/InstallCommands'
import DeleteButton from '@/app/_components/DeleteButton'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ name: string }>
}

export async function generateMetadata({ params }: PageProps) {
  const { name } = await params
  const detail = getPluginDetail(REPO_DIR(), name)
  const title = detail?.entry.displayName || name
  return { title: `${title} - Skill Hub` }
}

export default async function SkillDetailPage({ params }: PageProps) {
  const { name } = await params
  const detail = getPluginDetail(REPO_DIR(), name)

  if (!detail) {
    notFound()
  }

  const user = await getUser()
  const publicRepoUrl = getSettings().repoUrl // 设置里配置的仓库地址（已脱敏）

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950">
      {/* Background decoration */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 right-0 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 left-0 w-96 h-96 bg-fuchsia-500/10 rounded-full blur-3xl" />
      </div>

      {/* Content */}
      <div className="relative">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          {/* Back Button */}
          <a
            href="/"
            className="inline-flex items-center gap-2 text-zinc-400 hover:text-cyan-400 transition-colors mb-8 group"
          >
            <svg className="w-5 h-5 group-hover:-translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            <span>返回列表</span>
          </a>

          {/* Header */}
          <div className="mb-12 space-y-6">
            <div className="space-y-4">
              <div className="flex items-center gap-4 flex-wrap">
                <h1 className="text-4xl md:text-5xl font-bold text-zinc-100 leading-tight">
                  {detail.entry.displayName || detail.entry.name}
                </h1>
                {detail.entry.version && (
                  <span className="px-3 py-1 text-sm font-mono font-medium bg-fuchsia-500/10 text-fuchsia-400 border border-fuchsia-500/30 rounded-lg">
                    v{detail.entry.version}
                  </span>
                )}
              </div>

              {detail.entry.description && (
                <p className="text-xl text-zinc-400 leading-relaxed">
                  {detail.entry.description}
                </p>
              )}

              {/* Tags */}
              {detail.entry.tags && detail.entry.tags.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-2">
                  {detail.entry.tags.map(tag => (
                    <span
                      key={tag}
                      className="px-4 py-2 text-sm font-medium bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 rounded-lg"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Meta Info */}
            <div className="flex items-center gap-6 text-sm text-zinc-500 pt-4 border-t border-zinc-800">
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                </svg>
                <span>来源: {detail.entry.source}</span>
              </div>
            </div>
          </div>

          {/* Main Content - single column, 安装命令 on top */}
          <div className="min-w-0 space-y-8">
            {/* Install Commands */}
            <div className="relative group">
              <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/5 to-fuchsia-500/5 rounded-2xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
              <div className="relative p-6 bg-zinc-900/40 border border-zinc-800 rounded-2xl backdrop-blur-sm">
                <InstallCommands
                  market={getMarketName()}
                  repoUrl={publicRepoUrl}
                  name={name}
                />
              </div>
            </div>

            {/* Markdown Documentation */}
            {detail.skillMarkdown && (
                <div className="relative group">
                  <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/5 to-fuchsia-500/5 rounded-2xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                  <div className="relative p-8 bg-zinc-900/40 border border-zinc-800 rounded-2xl backdrop-blur-sm">
                    <h2 className="text-2xl font-bold text-zinc-100 mb-6 flex items-center gap-2">
                      <svg className="w-6 h-6 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      技能说明
                    </h2>
                    <div className="prose prose-invert prose-zinc max-w-none break-words prose-headings:text-zinc-100 prose-p:text-zinc-300 prose-a:text-cyan-400 prose-strong:text-zinc-200 prose-code:text-cyan-400 prose-code:bg-zinc-800/50 prose-code:px-2 prose-code:py-1 prose-code:rounded prose-pre:bg-zinc-950 prose-pre:border prose-pre:border-zinc-800 prose-pre:overflow-x-auto">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {detail.skillMarkdown}
                      </ReactMarkdown>
                    </div>
                  </div>
                </div>
              )}

              {/* File Tree */}
              <div className="relative group">
                <div className="absolute inset-0 bg-gradient-to-br from-fuchsia-500/5 to-cyan-500/5 rounded-2xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                <div className="relative p-8 bg-zinc-900/40 border border-zinc-800 rounded-2xl backdrop-blur-sm">
                  <h2 className="text-2xl font-bold text-zinc-100 mb-6 flex items-center gap-2">
                    <svg className="w-6 h-6 text-fuchsia-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                    </svg>
                    文件结构
                  </h2>
                  <div className="space-y-1 font-mono text-sm">
                    {detail.files.map((file, idx) => {
                      const depth = file.split('/').length - 1
                      const name = file.split('/').pop()
                      const isDir = detail.files.some(f => f.startsWith(file + '/'))
                      return (
                        <div
                          key={idx}
                          className="flex items-center gap-2 py-1 px-3 hover:bg-zinc-800/50 rounded transition-colors"
                          style={{ paddingLeft: `${depth * 1.5 + 0.75}rem` }}
                        >
                          <svg className={`w-4 h-4 flex-shrink-0 ${isDir ? 'text-fuchsia-400' : 'text-zinc-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            {isDir ? (
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                            ) : (
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                            )}
                          </svg>
                          <span className="text-zinc-400 truncate">{name}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>

            {/* Delete Button (if logged in) */}
            {user && <DeleteButton name={name} />}
          </div>
        </div>
      </div>
    </div>
  )
}
