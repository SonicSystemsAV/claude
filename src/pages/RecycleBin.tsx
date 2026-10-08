import { useState } from 'react'
import { clsx } from 'clsx'
import { RotateCcw, Trash2 } from 'lucide-react'
import { useStore, useCan } from '../state/store'
import { getDeletedTransactions, restoreTransactions, purgeTransactions } from '../db/repo'
import { Money } from '../components/Money'
import { formatDate } from '../lib/format'

export default function RecycleBin() {
  const companyId = useStore((s) => s.currentCompanyId)
  const refresh = useStore((s) => s.refresh)
  const rev = useStore((s) => s.rev)
  const canDelete = useCan('delete')
  const canPurge = useCan('admin')
  void rev
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [note, setNote] = useState<string | null>(null)
  if (companyId == null) return null

  const rows = getDeletedTransactions(companyId)

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }
  function selectAll() {
    setSelected((prev) => (prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.id))))
  }
  function restore() {
    const n = restoreTransactions(companyId!, [...selected])
    setSelected(new Set()); setNote(`Restored ${n} transaction(s).`); refresh()
  }
  function purge() {
    if (!confirm(`Permanently delete ${selected.size} transaction(s)? This cannot be undone.`)) return
    const n = purgeTransactions(companyId!, [...selected])
    setSelected(new Set()); setNote(`Permanently deleted ${n} transaction(s).`); refresh()
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Recycle Bin</h1>
        <p className="text-sm text-slate-500">{rows.length} deleted transaction(s). Restore any time, or permanently delete.</p>
      </div>

      {note && <div className="rounded-lg bg-brand-50 px-4 py-2 text-sm text-brand-700">{note}</div>}

      {selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-lg bg-amber-50 px-4 py-2 text-sm">
          <span className="font-medium text-amber-800">{selected.size} selected</span>
          {canDelete && <button className="btn-primary" onClick={restore}><RotateCcw size={15} /> Restore</button>}
          {canPurge && <button className="btn-outline text-rose-600 hover:bg-rose-50" onClick={purge}><Trash2 size={15} /> Delete permanently</button>}
          <button className="btn-ghost" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="w-10 px-3 py-2.5"><input type="checkbox" checked={rows.length > 0 && selected.size === rows.length} onChange={selectAll} /></th>
              <th className="px-2 py-2.5">Date</th>
              <th className="px-2 py-2.5">Description</th>
              <th className="px-2 py-2.5">Contact</th>
              <th className="px-2 py-2.5">Source</th>
              <th className="px-5 py-2.5 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} className="px-5 py-10 text-center text-slate-400">Recycle bin is empty.</td></tr>}
            {rows.map((t) => (
              <tr key={t.id} className={clsx('border-b border-slate-50 last:border-0 hover:bg-slate-50', selected.has(t.id) && 'bg-amber-50/50')}>
                <td className="px-3 py-2"><input type="checkbox" checked={selected.has(t.id)} onChange={() => toggle(t.id)} /></td>
                <td className="px-2 py-2 whitespace-nowrap text-slate-500">{formatDate(t.date)}</td>
                <td className="px-2 py-2 text-slate-800">{t.memo}</td>
                <td className="px-2 py-2 text-slate-500">{t.contact_name}</td>
                <td className="px-2 py-2 text-slate-400">{t.source}</td>
                <td className="px-5 py-2 text-right"><Money cents={t.total} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
