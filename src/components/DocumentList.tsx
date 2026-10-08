import { clsx } from 'clsx'
import { Ban, Pencil } from 'lucide-react'
import { listDocuments, voidDocument, type DocumentWithContact } from '../db/documents'
import type { DocType } from '../db/types'
import { Money } from './Money'
import { formatDate } from '../lib/format'
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
  const docs: DocumentWithContact[] = listDocuments(companyId, type)
  const canEdit = useCan('edit')

  return (
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
            {canEdit && <th className="w-10 px-3 py-2.5"></th>}
          </tr>
        </thead>
        <tbody>
          {docs.length === 0 && (
            <tr>
              <td colSpan={7} className="px-5 py-8 text-center text-slate-400">Nothing here yet.</td>
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
              {canEdit && (
                <td className="px-3 py-2.5 text-right">
                  <div className="flex items-center justify-end gap-2">
                    {onEdit && isEditable(d) && (
                      <button className="text-slate-300 hover:text-brand-600" title="Edit" onClick={() => onEdit(d.id)}>
                        <Pencil size={15} />
                      </button>
                    )}
                    {d.status !== 'void' && (
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
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
