/**
 * @author sgz
 * @since 2026-07-03
 */
import { listPlugins } from '@/lib/marketplace'
import { REPO_DIR } from '@/lib/config'
import { getMarketName } from '@/lib/settings'
import SkillGrid from './_components/SkillGrid'
import GitHubRepoCard from './_components/GitHubRepoCard'

export const dynamic = 'force-dynamic'

export function generateMetadata() {
  return {
    title: `${getMarketName()} - Skill Hub`,
    description: '浏览和安装 Claude 技能插件'
  }
}

export default function HomePage() {
  const plugins = listPlugins(REPO_DIR)
  const marketName = getMarketName()

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950">
      {/* Background decoration */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-fuchsia-500/10 rounded-full blur-3xl animate-pulse delay-1000" />
      </div>

      {/* Content */}
      <div className="relative">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          {/* Hero Section */}
          <div className="mb-12 space-y-6">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-cyan-500/10 border border-cyan-500/20 rounded-full text-cyan-400 text-sm font-medium">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
              </svg>
              {marketName}
            </div>

            <h1 className="text-5xl md:text-6xl font-bold text-zinc-100 leading-tight">
              技能市场
            </h1>

            <p className="text-xl text-zinc-400 max-w-2xl leading-relaxed">
              浏览、安装和分享 Claude 技能插件，让 AI 助手更强大。
            </p>

            <div className="flex flex-wrap items-center gap-6 text-sm text-zinc-500">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                <span>共 {plugins.length} 个技能</span>
              </div>
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <span>开源免费</span>
              </div>
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                <span>即装即用</span>
              </div>
            </div>


            {/* Open-source repo */}
            <GitHubRepoCard />
          </div>

          {/* Grid */}
          <SkillGrid plugins={plugins} />
        </div>
      </div>
    </div>
  )
}
