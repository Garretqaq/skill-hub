/**
 * @author sgz
 * @since 2026-07-03
 */
import { redirect } from 'next/navigation'
import { getUser } from '@/lib/auth'
import { listPlugins } from '@/lib/marketplace'
import { REPO_DIR } from '@/lib/config'
import AdminConsole from '@/app/_components/AdminConsole'

export const dynamic = 'force-dynamic'
export const metadata = { title: '控制台 - Skill Hub' }

export default async function AdminPage() {
  const user = await getUser()
  if (!user) redirect('/login')

  const plugins = listPlugins(REPO_DIR)

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-fuchsia-500/10 rounded-full blur-3xl" />
      </div>

      <div className="relative max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <AdminConsole plugins={plugins} />
      </div>
    </div>
  )
}
