import { Fragment, useState } from 'react'
import { ChevronRight, ChevronDown, X, Trash2, Plus, ExternalLink } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { clsx } from 'clsx'
import { useStore, useCan } from '../state/store'
import { getTransactions, getContact, softDeleteTransactions } from '../db/repo'
import { Money } from '../components/Money'
import { JournalEntryForm } from '../components/JournalEntryForm'
import { useTransactionOpener } from '../components/useTransactionOpener'
import { formatDate } from '../lib/format'

const SOURCE_BADGE: Record<string, string> = {
  manual: 'bg-slate-100 text-slate-500',
  reconcile: 'bg-brand-50 text-brand-600',
  import: 'bg-indigo-50 text-indigo-600',
  seed: 'bg-slate-100 text-slate-400',
}

export default function Transactions() {
  const companyId = useStore((s) => s.currentCompanyId)
  const rev = useStore((s) => s.rev)
  void rev
  const refresh = useStore((s) => s.refresh)
  const canDelete = useCan('delete')
  const canEdit = useCan('edit')
  const [open, setOpen] = useState<Set<number>>(new Set())
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [newJournal, setNewJournal] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()
  const { openTransaction, element: openerEl } = useTransactionOpener(companyId ?? 0, refresh)
  if (companyId == null) return null

  const contactId = searchParams.get('contact') ? Number(searchParams.get('contact')) : undefined
  const contact = contactId ? getContact(contactId) : undefined
  const txns = getTransactions(companyId, { limit: 1000, contactId })

  function toggle(id: number) {
    setOpen((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }
  function toggleSel(id: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }
  function selectAll() {
    setSelected((prev) => (prev.size === txns.length ? new Set() : new Set(txns.map((t) => t.id))))
  }
  function moveToBin() {
    setError(null)
    try {
      softDeleteTransactions(companyId!, [...selected])
      setSelected(new Set())
      refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Transactions</h1>
          <p className="text-sm text-slate-500">{txns.length} shown · click a row to see the entries</p>
        </div>
        {canEdit && <button className="btn-primary" onClick={() => setNewJournal(true)}><Plus size={16} /> New journal entry</button>}
      </div>

      {contact && (
        <div className="flex items-center gap-2 rounded-lg bg-brand-50 px-4 py-2 text-sm text-brand-700">
          <span>
            Filtered by <span className="font-semibold">{contact.name}</span>
          </span>
          <button
            className="ml-auto inline-flex items-center gap-1 text-brand-600 hover:underline"
            onClick={() => setSearchParams({})}
          >
            <X size={14} /> clear
          </button>
        </div>
      )}

      {canDelete && selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-lg bg-amber-50 px-4 py-2 text-sm">
          <span className="font-medium text-amber-800">{selected.size} selected</span>
          <button className="btn-primary" onClick={moveToBin}><Trash2 size={15} /> Move to Recycle Bin</button>
          <button className="btn-ghost" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}
      {error && <div className="rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</div>}

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="w-10 px-3 py-2.5">{canDelete && <input type="checkbox" checked={txns.length > 0 && selected.size === txns.length} onChange={selectAll} />}</th>
              <th className="w-8 px-4 py-2.5"></th>
              <th className="px-2 py-2.5">Date</th>
              <th className="px-2 py-2.5">Description</th>
              <th className="px-2 py-2.5">Contact</th>
              <th className="px-2 py-2.5">Source</th>
              <th className="px-4 py-2.5 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {txns.map((t) => {
              const total = t.entries
                .filter((e) => e.amount_cents > 0)
                .reduce((s, e) => s + e.amount_cents, 0)
              const isOpen = open.has(t.id)
              return (
                <Fragment key={t.id}>
                  <tr
                    className={clsx('cursor-pointer border-b border-slate-50 hover:bg-slate-50', isOpen && 'bg-slate-50')}
                    onClick={() => toggle(t.id)}
                  >
                    <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                      {canDelete && <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggleSel(t.id)} />}
                    </td>
                    <td className="px-4 py-2.5 text-slate-400">
                      {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </td>
                    <td className="px-2 py-2.5 whitespace-nowrap text-slate-500">{formatDate(t.date)}</td>
                    <td className="px-2 py-2.5 text-slate-800">{t.memo}</td>
                    <td className="px-2 py-2.5 text-slate-500" onClick={(e) => e.stopPropagation()}>
                      {t.contact_name && (
                        <Link
                          to={`/transactions?contact=${t.contact_id}`}
                          className="hover:text-brand-600 hover:underline"
                        >
                          {t.contact_name}
                        </Link>
                      )}
                    </td>
                    <td className="px-2 py-2.5">
                      <span
                        className={clsx(
                          'rounded px-1.5 py-0.5 text-xs font-medium',
                          SOURCE_BADGE[t.source] ?? SOURCE_BADGE.manual,
                        )}
                      >
                        {t.source}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Money cents={total} />
                        {canEdit && (
                          <button
                            className="text-slate-300 hover:text-brand-600"
                            title="Open / edit"
                            onClick={(e) => { e.stopPropagation(); openTransaction(t.id) }}
                          >
                            <ExternalLink size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {isOpen &&
                    t.entries.map((e) => (
                      <tr key={e.id} className="border-b border-slate-50 bg-slate-50/50 text-xs">
                        <td></td>
                        <td></td>
                        <td></td>
                        <td className="px-2 py-1.5 text-slate-600" colSpan={3}>
                          <span className="font-mono text-slate-400">{e.account_code}</span>{' '}
                          {e.account_name}
                        </td>
                        <td className="px-4 py-1.5 text-right">
                          <span className={e.amount_cents < 0 ? 'text-rose-600' : 'text-slate-700'}>
                            {e.amount_cents >= 0 ? 'Dr ' : 'Cr '}
                            <Money cents={Math.abs(e.amount_cents)} />
                          </span>
                        </td>
                      </tr>
                    ))}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {newJournal && <JournalEntryForm companyId={companyId} onClose={() => setNewJournal(false)} onSaved={refresh} />}
      {openerEl}
    </div>
  )
}
