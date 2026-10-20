import { useState } from 'react'
import { RefreshCw, AlertTriangle } from 'lucide-react'
import { isTauri } from '../lib/desktop'

/**
 * "Update to latest" — a permanent fixture in the sidebar footer (desktop app
 * only). Pulls the newest web code and reloads so Vite serves it.
 *
 * The plain update is `git pull --ff-only`, which refuses (and does nothing) if
 * the local checkout has diverged or has stray changes — the failure mode that
 * silently stranded the app on an old build. When that happens we surface the
 * error and offer "Force to latest" (git fetch + reset --hard), which discards
 * local changes and matches the remote exactly.
 *
 * Native/Rust changes still need a full `tauri dev` restart to take effect; the
 * web layer (TS/React) reloads live.
 */
export default function DevUpdateButton() {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  if (!isTauri()) return null

  async function run(force: boolean) {
    setBusy(true)
    setMsg(force ? 'Forcing to latest…' : 'Checking for updates…')
    setFailed(false)
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const out = await invoke<string>('dev_update', { force })
      const upToDate = /already up to date/i.test(out)
      setMsg(upToDate ? 'Already up to date.' : `${out}\n\nReloading…`)
      if (!upToDate) setTimeout(() => location.reload(), 900)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-3 space-y-1.5">
      <button
        onClick={() => void run(false)}
        disabled={busy}
        title="git pull + reload the web app"
        className="flex w-full items-center justify-center gap-1.5 rounded-nav border border-nav-line bg-nav-input px-3 py-1.5 text-xs font-medium text-nav-text hover:bg-nav-active disabled:opacity-60"
      >
        <RefreshCw size={13} className={busy ? 'animate-spin' : ''} />
        {busy ? 'Updating…' : 'Update to latest'}
      </button>
      {failed && (
        <button
          onClick={() => void run(true)}
          disabled={busy}
          title="Discard local changes and match the remote exactly"
          className="flex w-full items-center justify-center gap-1.5 rounded-nav border border-amber-500/60 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-500/20 disabled:opacity-60"
        >
          <AlertTriangle size={13} /> Force to latest (discard local changes)
        </button>
      )}
      {msg && (
        <div className="max-h-28 overflow-y-auto whitespace-pre-wrap rounded-nav bg-nav-input px-2.5 py-1.5 font-mono text-[10px] leading-snug text-subtle">
          {msg}
        </div>
      )}
    </div>
  )
}
