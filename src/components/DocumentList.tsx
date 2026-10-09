import { useState } from 'react'
import { clsx } from 'clsx'
import { Ban, Pencil, Printer } from 'lucide-react'
import { listDocuments, voidDocument, type DocumentWithContact } from '../db/documents'
import { printDocument } from '../db/documentPrint'
import type { DocType } from '../db/types'
import { Money } from './Money'
import { formatDate, todayISO } from '../lib/format'
import { useCan } from '../state/store'

function isEditable(d: DocumentWithContact): boolean {
  if (d.status === 'void') return false
  if (d.type === 'expense' || d.type === 'sales_receipt') return true
  if (d.type === 'invoice' || d.type === 'bill') return d.status === 'open'
  return false
}

const STATUS_BADGE: Record<string, string> = {
  open: 'bg-amber-50 text-amber-700',
  partial: 'bg-brand-50 text-brand-700',
  paid: 'bg-emerald-50 text-emerald-700',
  void: 'bg-slate-100 text-slate-400 line-through',
}

export function DocumentList({
  companyId,
  type,
  onChange,
  onEdit,
  showBalance = true,
}: {
  companyId: number
  type: DocType
  onChange: () => void
  onEdit?: (docId: number) => void
  showBalance?: boolean
}) {
  const all: DocumentWithContact[] = listDocuments(companyId, type)
  const canEdit = useCan('edit')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const docs = all.filter((d) => (!start || d.date >= start) && (!end || d.date <= end))

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
        <span className="text-xs font-medium text-slate-500">From</span>
        <input type="date" className="rounded-md border border-slate-300 px-2 py-1" value={start} onChange={(e) => setStart(e.target.value)} />
        <span className="text-xs font-medium text-slate-500">To</span>
        <input type="date" className="rounded-md border border-slate-300 px-2 py-1" value={end} onChange={(e) => setEnd(e.target.value)} />
        <button className="btn-ghost px-2 py-1 text-xs" onClick={() => { setStart(`${new Date().getFullYear()}-01-01`); setEnd(todayISO()) }}>This year</button>
        <button className="btn-ghost px-2 py-1 text-xs" onClick={() => { const d = new Date(); setStart(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`); setEnd(todayISO()) }}>This month</button>
        {(start || end) && <button className="btn-ghost px-2 py-1 text-xs" onClick={() => { setStart(''); setEnd('') }}>Clear</button>}
        {(start || end) && <span className="text-xs text-slate-400">{docs.length} of {all.length}</span>}
      </div>
      <div className="card overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="px-5 py-2.5">#</th>
            <th className="px-2 py-2.5">Date</th>
            <th className="px-2 py-2.5">Contact</th>
            <th className="px-2 py-2.5">Status</th>
            <th className="px-2 py-2.5 text-right">Total</th>
            {showBalance && <th className="px-2 py-2.5 text-right">Balance</th>}
            <th className="w-20 px-3 py-2.5"></th>
          </tr>
        </thead>
        <tbody>
          {docs.length === 0 && (
            <tr>
              <td colSpan={showBalance ? 7 : 6} className="px-5 py-8 text-center text-slate-400">Nothing here yet.</td>
            </tr>
          )}
          {docs.map((d) => (
            <tr key={d.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
              <td className="px-5 py-2.5 font-mono text-xs text-slate-500">{d.number}</td>
              <td className="px-2 py-2.5 whitespace-nowrap text-slate-500">{formatDate(d.date)}</td>
              <td className="px-2 py-2.5 text-slate-800">{d.contact_name ?? '—'}</td>
              <td className="px-2 py-2.5">
                <span className={clsx('rounded px-1.5 py-0.5 text-xs font-medium capitalize', STATUS_BADGE[d.status])}>
                  {d.status}
                </span>
              </td>
              <td className="px-2 py-2.5 text-right"><Money cents={d.total_cents} /></td>
              {showBalance && (
                <td className="px-2 py-2.5 text-right">
                  <Money cents={d.balance_cents} />
                </td>
              )}
              <td className="px-3 py-2.5 text-right">
                <div className="flex items-center justify-end gap-2">
                  {d.status !== 'void' && (
                    <button className="text-slate-300 hover:text-brand-600" title="Print / Save PDF" onClick={() => printDocument(d.id)}>
                      <Printer size={15} />
                    </button>
                  )}
                  {canEdit && onEdit && isEditable(d) && (
                    <button className="text-slate-300 hover:text-brand-600" title="Edit" onClick={() => onEdit(d.id)}>
                      <Pencil size={15} />
                    </button>
                  )}
                  {canEdit && d.status !== 'void' && (
                    <button
                      className="text-slate-300 hover:text-rose-600"
                      title="Void"
                      onClick={() => {
                        if (confirm(`Void ${d.number}? This removes its ledger entries.`)) {
                          voidDocument(d.id)
                          onChange()
                        }
                      }}
                    >
                      <Ban size={15} />
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  )
}
