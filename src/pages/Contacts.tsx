import { useState } from 'react'
import { Users, UserRound, Truck, SlidersHorizontal, Check, Plus, ArrowLeft, Pencil, Trash2, Mail, Phone, Globe, MapPin, ExternalLink } from 'lucide-react'
import { clsx } from 'clsx'
import { useStore, useCan } from '../state/store'
import { contactSummaries, getContact, getTransactions, softDeleteTransactions, type ContactSummary } from '../db/repo'
import { openDocuments, getDocumentForEdit, getDocumentByTxnId, type DocumentEditData } from '../db/documents'
import type { Contact, ContactKind, DocType } from '../db/types'
import { Money } from '../components/Money'
import { ContactForm } from '../components/ContactForm'
import { DocumentForm } from '../components/DocumentForm'
import { formatDate } from '../lib/format'

type Filter = 'all' | 'customer' | 'supplier'
type ColKey = 'type' | 'txns' | 'volume' | 'balance' | 'last'

const OPTIONAL_COLS: { key: ColKey; label: string }[] = [
  { key: 'type', label: 'Type' },
  { key: 'balance', label: 'Balance' },
  { key: 'txns', label: 'Transactions' },
  { key: 'volume', label: 'Volume' },
  { key: 'last', label: 'Last activity' },
]

const KIND_BADGE: Record<ContactKind, string> = {
  customer: 'bg-emerald-50 text-emerald-700',
  supplier: 'bg-indigo-50 text-indigo-700',
  both: 'bg-amber-50 text-amber-700',
  other: 'bg-slate-100 text-slate-500',
}

const COLS_KEY = 'ledgerly.contactCols'
function loadCols(): Record<ColKey, boolean> {
  const def: Record<ColKey, boolean> = { type: true, balance: true, txns: true, volume: false, last: false }
  try {
    const raw = localStorage.getItem(COLS_KEY)
    if (raw) return { ...def, ...JSON.parse(raw) }
  } catch {
    /* ignore */
  }
  return def
}

function contactBalance(c: ContactSummary): number {
  return c.kind === 'supplier' ? c.ap_balance : c.ar_balance
}

export default function Contacts() {
  const companyId = useStore((s) => s.currentCompanyId)
  const rev = useStore((s) => s.rev)
  void rev
  const [filter, setFilter] = useState<Filter>('all')
  const [cols, setCols] = useState<Record<ColKey, boolean>>(loadCols)
  const [showCols, setShowCols] = useState(false)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  if (companyId == null) return null

  if (selectedId != null) {
    return <ContactDetail companyId={companyId} id={selectedId} onBack={() => setSelectedId(null)} />
  }

  function toggleCol(k: ColKey) {
    setCols((prev) => {
      const next = { ...prev, [k]: !prev[k] }
      try { localStorage.setItem(COLS_KEY, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }

  const all = contactSummaries(companyId)
  const matches = (k: ContactKind) =>
    filter === 'all' ? true : filter === 'customer' ? k === 'customer' || k === 'both' : k === 'supplier' || k === 'both'
  const rows = all.filter((c) => matches(c.kind))
  const customers = all.filter((c) => c.kind === 'customer' || c.kind === 'both').length
  const suppliers = all.filter((c) => c.kind === 'supplier' || c.kind === 'both').length

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Customers &amp; Suppliers</h1>
          <p className="text-sm text-slate-500">{all.length} contacts · {customers} customers · {suppliers} suppliers</p>
        </div>
        <button className="btn-primary" onClick={() => setCreating(true)}><Plus size={16} /> New contact</button>
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          {([['all', 'All', Users], ['customer', 'Customers', UserRound], ['supplier', 'Suppliers', Truck]] as const).map(([key, label, Icon]) => (
            <button key={key} onClick={() => setFilter(key)} className={clsx('inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition', filter === key ? 'bg-brand-50 text-brand-700' : 'text-slate-500 hover:bg-slate-100')}>
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>
        <div className="relative">
          <button className="btn-outline" onClick={() => setShowCols((v) => !v)}><SlidersHorizontal size={15} /> Columns</button>
          {showCols && (
            <div className="absolute right-0 z-20 mt-1 w-44 rounded-lg border border-slate-200 bg-white p-1 shadow-lg" onMouseLeave={() => setShowCols(false)}>
              {OPTIONAL_COLS.map((c) => (
                <button key={c.key} onClick={() => toggleCol(c.key)} className="flex w-full items-center justify-between rounded px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-100">
                  {c.label}{cols[c.key] && <Check size={14} className="text-brand-600" />}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-5 py-2.5">Name</th>
              {cols.type && <th className="px-2 py-2.5">Type</th>}
              {cols.balance && <th className="px-2 py-2.5 text-right">Balance</th>}
              {cols.txns && <th className="px-2 py-2.5 text-right">Transactions</th>}
              {cols.volume && <th className="px-2 py-2.5 text-right">Volume</th>}
              {cols.last && <th className="px-5 py-2.5 text-right">Last activity</th>}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={6} className="px-5 py-8 text-center text-slate-400">No contacts yet. Add one, or they'll appear after a QuickBooks import.</td></tr>
            )}
            {rows.map((c) => (
              <tr key={c.id} className="cursor-pointer border-b border-slate-50 last:border-0 hover:bg-slate-50" onClick={() => setSelectedId(c.id)}>
                <td className="px-5 py-2.5 font-medium text-slate-800 hover:text-brand-600">{c.name}</td>
                {cols.type && <td className="px-2 py-2.5"><span className={clsx('rounded px-1.5 py-0.5 text-xs font-medium capitalize', KIND_BADGE[c.kind])}>{c.kind}</span></td>}
                {cols.balance && <td className="px-2 py-2.5 text-right"><Money cents={contactBalance(c)} /></td>}
                {cols.txns && <td className="px-2 py-2.5 text-right tabular-nums text-slate-600">{c.txn_count}</td>}
                {cols.volume && <td className="px-2 py-2.5 text-right"><Money cents={c.gross} /></td>}
                {cols.last && <td className="px-5 py-2.5 text-right text-slate-500">{c.last_date ? formatDate(c.last_date) : '—'}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {creating && (
        <ContactForm
          companyId={companyId}
          onClose={() => setCreating(false)}
          onSaved={(id) => { setCreating(false); useStore.getState().refresh(); setSelectedId(id) }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

const EDITABLE: DocType[] = ['invoice', 'bill', 'expense', 'sales_receipt']

function ContactDetail({ companyId, id, onBack }: { companyId: number; id: number; onBack: () => void }) {
  const refresh = useStore((s) => s.refresh)
  const rev = useStore((s) => s.rev)
  const canEdit = useCan('edit')
  const canDelete = useCan('delete')
  void rev

  const contact = getContact(id)
  const summary = contactSummaries(companyId).find((c) => c.id === id)
  const [editing, setEditing] = useState(false)
  const [newDoc, setNewDoc] = useState<Extract<DocType, 'invoice' | 'bill' | 'expense' | 'sales_receipt'> | null>(null)
  const [editDoc, setEditDoc] = useState<DocumentEditData | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [note, setNote] = useState<string | null>(null)

  if (!contact) {
    return <div className="mx-auto max-w-5xl p-6"><button className="btn-ghost" onClick={onBack}><ArrowLeft size={15} /> Back</button><p className="mt-4 text-slate-500">Contact not found.</p></div>
  }

  const isCustomer = contact.kind === 'customer' || contact.kind === 'both'
  const isSupplier = contact.kind === 'supplier' || contact.kind === 'both'
  const isBoth = contact.kind === 'both'
  const ar = summary?.ar_balance ?? 0
  const ap = summary?.ap_balance ?? 0
  const balance = contact.kind === 'supplier' ? ap : ar

  const openDocs = [
    ...(isCustomer ? openDocuments(companyId, 'invoice', id) : []),
    ...(isSupplier ? openDocuments(companyId, 'bill', id) : []),
  ]
  const txns = getTransactions(companyId, { limit: 500, contactId: id })

  function toggle(txnId: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(txnId) ? next.delete(txnId) : next.add(txnId)
      return next
    })
  }
  function deleteSelected() {
    const n = softDeleteTransactions(companyId, [...selected])
    setSelected(new Set()); setNote(`Moved ${n} transaction(s) to the Recycle Bin.`); refresh()
  }
  function openTxn(txnId: number) {
    const doc = getDocumentByTxnId(txnId)
    if (doc && EDITABLE.includes(doc.type) && doc.status !== 'void') {
      const d = getDocumentForEdit(doc.id)
      if (d) setEditDoc(d)
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-6">
      <button className="btn-ghost text-slate-500" onClick={onBack}><ArrowLeft size={15} /> All contacts</button>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900">{contact.name}</h1>
            <span className={clsx('rounded px-1.5 py-0.5 text-xs font-medium capitalize', KIND_BADGE[contact.kind])}>{contact.kind}</span>
          </div>
          <p className="text-sm text-slate-500">
            {summary?.txn_count ?? 0} transactions
            {isBoth ? (
              <> · owed to you <Money cents={ar} /> · you owe <Money cents={ap} /></>
            ) : (
              <> · {contact.kind === 'supplier' ? 'you owe' : 'owed to you'} <Money cents={balance} /></>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          {canEdit && <button className="btn-outline" onClick={() => setEditing(true)}><Pencil size={15} /> Edit</button>}
          {canEdit && isCustomer && <button className="btn-primary" onClick={() => setNewDoc('invoice')}><Plus size={15} /> Invoice</button>}
          {canEdit && isSupplier && <button className="btn-primary" onClick={() => setNewDoc(isCustomer ? 'bill' : 'expense')}><Plus size={15} /> {isCustomer ? 'Bill' : 'Expense'}</button>}
        </div>
      </div>

      {note && <div className="rounded-lg bg-brand-50 px-4 py-2 text-sm text-brand-700">{note}</div>}

      {/* Info + stats */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="card space-y-2 p-4 text-sm md:col-span-2">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Contact details</div>
          {!contact.email && !contact.phone && !contact.address_line1 && !contact.website && (
            <p className="text-slate-400">No details yet — use Edit to add email, phone and address.</p>
          )}
          {contact.email && <div className="flex items-center gap-2 text-slate-700"><Mail size={14} className="text-slate-400" /> {contact.email}</div>}
          {contact.phone && <div className="flex items-center gap-2 text-slate-700"><Phone size={14} className="text-slate-400" /> {contact.phone}</div>}
          {contact.website && <div className="flex items-center gap-2 text-slate-700"><Globe size={14} className="text-slate-400" /> {contact.website}</div>}
          {(contact.address_line1 || contact.city) && (
            <div className="flex items-start gap-2 text-slate-700">
              <MapPin size={14} className="mt-0.5 text-slate-400" />
              <span>{[contact.address_line1, contact.address_line2, [contact.city, contact.province, contact.postal].filter(Boolean).join(' '), contact.country].filter(Boolean).join(', ')}</span>
            </div>
          )}
          {contact.notes && <div className="mt-1 whitespace-pre-wrap border-t border-slate-100 pt-2 text-slate-500">{contact.notes}</div>}
        </div>
        <div className="card space-y-2 p-4">
          {isBoth ? (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Owed to you</div>
                <div className="text-xl font-semibold text-slate-900"><Money cents={ar} /></div>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">You owe</div>
                <div className="text-xl font-semibold text-slate-900"><Money cents={ap} /></div>
              </div>
            </div>
          ) : (
            <>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{contact.kind === 'supplier' ? 'You owe' : 'Owed to you'}</div>
              <div className="text-2xl font-semibold text-slate-900"><Money cents={balance} /></div>
            </>
          )}
          <div className="text-xs text-slate-500">{openDocs.length} open item(s) · lifetime volume <Money cents={summary?.gross ?? 0} /></div>
        </div>
      </div>

      {/* Open items (statement) */}
      {openDocs.length > 0 && (
        <div className="card overflow-hidden">
          <div className="border-b border-slate-100 bg-slate-50 px-5 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Open items</div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="px-5 py-2">#</th><th className="px-2 py-2">Type</th><th className="px-2 py-2">Date</th><th className="px-2 py-2">Due</th><th className="px-2 py-2 text-right">Total</th><th className="px-5 py-2 text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {openDocs.map((d) => (
                <tr key={d.id} className="cursor-pointer border-b border-slate-50 last:border-0 hover:bg-slate-50" onClick={() => { const dd = getDocumentForEdit(d.id); if (dd) setEditDoc(dd) }}>
                  <td className="px-5 py-2 font-mono text-xs text-slate-500">{d.number}</td>
                  <td className="px-2 py-2 capitalize text-slate-500">{d.type.replace('_', ' ')}</td>
                  <td className="px-2 py-2 text-slate-500">{formatDate(d.date)}</td>
                  <td className="px-2 py-2 text-slate-500">{d.due_date ? formatDate(d.due_date) : '—'}</td>
                  <td className="px-2 py-2 text-right"><Money cents={d.total_cents} /></td>
                  <td className="px-5 py-2 text-right font-medium"><Money cents={d.balance_cents} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Transactions */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">All transactions ({txns.length})</span>
          {canDelete && selected.size > 0 && (
            <button className="btn-outline text-rose-600 hover:bg-rose-50" onClick={deleteSelected}><Trash2 size={15} /> Move {selected.size} to Recycle Bin</button>
          )}
        </div>
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                {canDelete && <th className="w-10 px-3 py-2.5" />}
                <th className="px-2 py-2.5">Date</th>
                <th className="px-2 py-2.5">Description</th>
                <th className="px-2 py-2.5">Source</th>
                <th className="px-5 py-2.5 text-right">Amount</th>
                <th className="w-10 px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {txns.length === 0 && <tr><td colSpan={6} className="px-5 py-8 text-center text-slate-400">No transactions for this contact yet.</td></tr>}
              {txns.map((t) => {
                const total = t.entries.filter((e) => e.amount_cents > 0).reduce((s, e) => s + e.amount_cents, 0)
                const doc = getDocumentByTxnId(t.id)
                const openable = doc && EDITABLE.includes(doc.type) && doc.status !== 'void'
                return (
                  <tr key={t.id} className={clsx('border-b border-slate-50 last:border-0 hover:bg-slate-50', selected.has(t.id) && 'bg-amber-50/50')}>
                    {canDelete && (
                      <td className="px-3 py-2.5"><input type="checkbox" checked={selected.has(t.id)} onChange={() => toggle(t.id)} /></td>
                    )}
                    <td className="px-2 py-2.5 whitespace-nowrap text-slate-500">{formatDate(t.date)}</td>
                    <td className="px-2 py-2.5 text-slate-800">{t.memo}</td>
                    <td className="px-2 py-2.5"><span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">{t.source}</span></td>
                    <td className="px-5 py-2.5 text-right"><Money cents={total} /></td>
                    <td className="px-3 py-2.5 text-right">
                      {openable && <button className="text-slate-300 hover:text-brand-600" title="Open" onClick={() => openTxn(t.id)}><ExternalLink size={15} /></button>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modals */}
      {editing && (
        <ContactForm companyId={companyId} edit={contact as Contact} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); refresh() }} />
      )}
      {newDoc && (
        <DocumentForm type={newDoc} initialContactName={contact.name} onClose={() => setNewDoc(null)} onSaved={refresh} />
      )}
      {editDoc && EDITABLE.includes(editDoc.doc.type) && (
        <DocumentForm
          type={editDoc.doc.type as Extract<DocType, 'invoice' | 'bill' | 'expense' | 'sales_receipt'>}
          edit={editDoc}
          onClose={() => setEditDoc(null)}
          onSaved={refresh}
        />
      )}
    </div>
  )
}
