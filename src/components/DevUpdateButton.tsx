import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { isTauri } from '../lib/desktop'

/**
 * Dev-only "Update to latest" button. Visible only in the Vite dev build
 * running inside Tauri. Calls the `dev_update` Rust command (git pull), then
 * reloads so the just-pulled web code is active — Vite serves the new files
 * immediately, so there's no rebuild for TS/React changes. Native/Rust changes
 * still need a full refresh.
 */
export default function DevUpdateButton() {
  const enabled = import.meta.env.DEV && isTauri()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  if (!enabled) return null

  async function update() {
    setBusy(true)
    setMsg(null)
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const out = await invoke<string>('dev_update')
      const upToDate = /already up to date/i.test(out)
      setMsg(upToDate ? 'Already up to date.' : 'Updated — reloading…')
      if (!upToDate) {
        // Give the latest code a moment, then reload to pick it up.
        setTimeout(() => location.reload(), 700)
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed bottom-3 left-3 z-50 flex flex-col items-start gap-1">
      {msg && (
        <div className="max-w-xs whitespace-pre-wrap rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-700 shadow">
          {msg}
        </div>
      )}
      <button
        onClick={update}
        disabled={busy}
        title="Dev only: git pull + reload the web app"
        className="flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-900/90 px-3 py-1.5 text-xs font-medium text-white shadow hover:bg-slate-900 disabled:opacity-60"
      >
        <RefreshCw size={13} className={busy ? 'animate-spin' : ''} />
        {busy ? 'Updating…' : 'Update to latest'}
      </button>
    </div>
  )
}
