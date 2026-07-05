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
    <footer className="mt-20 pt-6 border-t border-zinc-800/60">
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm text-zinc-500">
        <a
          href={REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 hover:text-zinc-300 transition-colors"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58v-2.03c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.2.09 1.84 1.24 1.84 1.24 1.07 1.84 2.81 1.31 3.5 1 .11-.78.42-1.31.76-1.61-2.67-.3-5.47-1.34-5.47-5.95 0-1.32.47-2.39 1.24-3.23-.13-.3-.54-1.53.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 016 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.65.25 2.88.12 3.18.77.84 1.24 1.91 1.24 3.23 0 4.62-2.81 5.64-5.49 5.94.43.37.81 1.1.81 2.22v3.29c0 .32.22.7.83.58A12 12 0 0024 12.5C24 5.87 18.63.5 12 .5z" />
          </svg>
          <span>{REPO_OWNER}/{REPO_NAME}</span>
        </a>
        {repo && (
          <>
            <span className="text-zinc-700">·</span>
            <span className="inline-flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                <path d="M9.05.435c.33-.66 1.27-.66 1.6 0l2.2 4.45 4.92.72c.73.1 1.02 1 .49 1.51l-3.56 3.47.84 4.9c.12.73-.64 1.28-1.29.94L10 14.6l-4.4 2.32c-.65.34-1.41-.21-1.29-.94l.84-4.9L1.6 7.6c-.53-.51-.24-1.41.49-1.51l4.92-.72 2.2-4.45z" />
              </svg>
              {repo.stargazers_count}
            </span>
          </>
        )}
        <span className="text-zinc-700">·</span>
        <span>开源项目</span>
      </div>
    </footer>
  )
}
