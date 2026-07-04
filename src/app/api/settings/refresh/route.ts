/** @author sgz @since 2026-07-04 */
import { NextResponse } from 'next/server'
import { getUser } from '@/lib/session'
import { REPO_DIR, stripCreds } from '@/lib/config'
import { syncFromRemote } from '@/lib/repo'
import { listPlugins } from '@/lib/marketplace'

export async function POST() {
  if (!(await getUser())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    syncFromRemote()
  } catch (e) {
    return NextResponse.json({ error: 'refresh failed', detail: stripCreds(String(e)) }, { status: 500 })
  }
  return NextResponse.json({ count: listPlugins(REPO_DIR()).length })
}
