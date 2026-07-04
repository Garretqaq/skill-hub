/**
 * @author sgz
 * @since 2026-07-04
 */
import { redirect } from 'next/navigation'
import { getUser } from '@/lib/auth'
import RemoteRepos from '@/app/_components/RemoteRepos'

export const dynamic = 'force-dynamic'
export const metadata = { title: '远程仓库 - Skill Hub' }

export default async function RemotePage() {
  const user = await getUser()
  if (!user) redirect('/login')

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-fuchsia-500/10 rounded-full blur-3xl" />
      </div>
      <div className="relative max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <RemoteRepos />
      </div>
    </div>
  )
}
