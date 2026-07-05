/**
 * @author sgz
 * @since 2026-07-05
 */
const REPO_OWNER = 'Garretqaq'
const REPO_NAME = 'skill-hub'
const REPO_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}`

interface RepoInfo {
  description: string | null
  stargazers_count: number
  forks_count: number
  language: string | null
}

async function fetchRepo(): Promise<RepoInfo | null> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}`,
      {
        headers: { Accept: 'application/vnd.github+json' },
        next: { revalidate: 3600 },
      }
    )
    if (!res.ok) return null
    return (await res.json()) as RepoInfo
  } catch {
    return null
  }
}

export default async function GitHubRepoCard() {
  const repo = await fetchRepo()

  return (
    <a
      href={REPO_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="group block max-w-2xl p-5 bg-zinc-900/60 border border-zinc-800 rounded-2xl hover:border-cyan-500/40 hover:bg-zinc-900/80 transition-all duration-300"
    >
      <div className="flex items-start gap-4">
        <div className="shrink-0 w-11 h-11 bg-zinc-800 rounded-xl flex items-center justify-center group-hover:bg-cyan-500/10 transition-colors">
          <svg className="w-6 h-6 text-zinc-300 group-hover:text-cyan-400 transition-colors" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58v-2.03c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.2.09 1.84 1.24 1.84 1.24 1.07 1.84 2.81 1.31 3.5 1 .11-.78.42-1.31.76-1.61-2.67-.3-5.47-1.34-5.47-5.95 0-1.32.47-2.39 1.24-3.23-.13-.3-.54-1.53.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 016 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.65.25 2.88.12 3.18.77.84 1.24 1.91 1.24 3.23 0 4.62-2.81 5.64-5.49 5.94.43.37.81 1.1.81 2.22v3.29c0 .32.22.7.83.58A12 12 0 0024 12.5C24 5.87 18.63.5 12 .5z" />
          </svg>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-zinc-400 text-sm">{REPO_OWNER} /</span>
            <span className="text-zinc-100 font-semibold group-hover:text-cyan-400 transition-colors">{REPO_NAME}</span>
            <svg className="w-4 h-4 text-zinc-600 group-hover:text-cyan-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
          </div>

          <p className="mt-1.5 text-sm text-zinc-400 line-clamp-2">
            {repo?.description ?? '开源的 Claude 技能插件市场，浏览、安装和分享 Skill。'}
          </p>

          {repo && (
            <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-zinc-500">
              {repo.language && (
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-cyan-400" />
                  {repo.language}
                </span>
              )}
              <span className="flex items-center gap-1.5">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M9.05.435c.33-.66 1.27-.66 1.6 0l2.2 4.45 4.92.72c.73.1 1.02 1 .49 1.51l-3.56 3.47.84 4.9c.12.73-.64 1.28-1.29.94L10 14.6l-4.4 2.32c-.65.34-1.41-.21-1.29-.94l.84-4.9L1.6 7.6c-.53-.51-.24-1.41.49-1.51l4.92-.72 2.2-4.45z" />
                </svg>
                {repo.stargazers_count}
              </span>
              <span className="flex items-center gap-1.5">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M5 5.5A2.5 2.5 0 117.5 8 2.5 2.5 0 015 5.5zm11 0A2.5 2.5 0 1118.5 8 2.5 2.5 0 0116 5.5zM6.5 9.5v1a2 2 0 002 2h3v3.55a2.5 2.5 0 101.5 0V12.5h3a2 2 0 002-2v-1a4 4 0 01-1.5.3h-7A4 4 0 016.5 9.5z" />
                </svg>
                {repo.forks_count}
              </span>
            </div>
          )}
        </div>
      </div>
    </a>
  )
}
