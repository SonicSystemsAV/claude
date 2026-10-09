import { clsx } from 'clsx'
import { Download } from 'lucide-react'
import { useStore } from '../state/store'
import { getAuditLog } from '../db/repo'
import { downloadCSV } from '../lib/csv'
import { formatDate } from '../lib/format'

const ACTION_BADGE: Record<string, string> = {
  create: 'bg-emerald-50 text-emerald-700',
  payment: 'bg-brand-50 text-brand-700',
  void: 'bg-rose-50 text-rose-700',
  import: 'bg-indigo-50 text-indigo-700',
  update: 'bg-amber-50 text-amber-700',
  map: 'bg-slate-100 text-slate-500',
}

function fmtTs(ts: string): string {
  // stored as 'YYYY-MM-DD HH:MM:SS' (UTC from SQLite datetime('now')).
  // Show the date in the app-wide format + local time, for consistency.
  try {
    const d = new Date(ts.replace(' ', 'T') + 'Z')
    const localISO = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    return `${formatDate(localISO)} ${hh}:${mm}`
  } catch {
    return ts
  }
}

export default function Audit() {
  const companyId = useStore((s) => s.currentCompanyId)
  const rev = useStore((s) => s.rev)
  void rev
  if (companyId == null) return null

  const rows = getAuditLog(companyId, 1000)

  function exportCSV() {
    downloadCSV(
      'sonic-the-ledgerhog-audit-log.csv',
      ['Time', 'User', 'Action', 'Entity', 'Entity ID', 'Summary'],
      rows.map((r) => [fmtTs(r.ts), r.user ?? '', r.action, r.entity, r.entity_id ?? '', r.summary]),
    )
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Audit Log</h1>
          <p className="text-sm text-slate-500">{rows.length} recorded actions</p>
        </div>
        <button className="btn-outline" onClick={exportCSV} disabled={rows.length === 0}>
          <Download size={15} /> Export CSV
        </button>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-5 py-2.5">Time</th>
              <th className="px-2 py-2.5">User</th>
              <th className="px-2 py-2.5">Action</th>
              <th className="px-2 py-2.5">Entity</th>
              <th className="px-5 py-2.5">Summary</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={4} className="px-5 py-8 text-center text-slate-400">No activity recorded yet.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-slate-50 last:border-0">
                <td className="px-5 py-2 whitespace-nowrap text-slate-500">{fmtTs(r.ts)}</td>
                <td className="px-2 py-2 text-slate-600">{r.user ?? '—'}</td>
                <td className="px-2 py-2">
                  <span className={clsx('rounded px-1.5 py-0.5 text-xs font-medium capitalize', ACTION_BADGE[r.action] ?? 'bg-slate-100 text-slate-500')}>
                    {r.action}
                  </span>
                </td>
                <td className="px-2 py-2 text-slate-500">{r.entity.replace('_', ' ')}</td>
                <td className="px-5 py-2 text-slate-800">{r.summary}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
