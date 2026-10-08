import { useState } from 'react'
import { X, Plus, Trash2 } from 'lucide-react'
import { useStore } from '../state/store'
import { getAccounts, getContacts, ensureContact, postTransaction, updateJournalEntry, type TransactionWithEntries } from '../db/repo'
import type { Account } from '../db/types'
import { parseMoney, formatMoney } from '../lib/money'
import { todayISO } from '../lib/format'
import { QuickAccount } from './QuickAccount'

const NEW_ACCT = '__new_acct__'

interface LineState {
  account_id: number | ''
  debit: string
  credit: string
  memo: string
}

function lineAmount(l: LineState): number {
  return parseMoney(l.debit) - parseMoney(l.credit)
}

/** Create or edit a manual journal entry (balanced debits = credits). */
export function JournalEntryForm({
  companyId,
  edit,
  onClose,
  onSaved,
}: {
  companyId: number
  edit?: TransactionWithEntries
  onClose: () => void
  onSaved: () => void
}) {
  const refresh = useStore((s) => s.refresh)
  const accounts = getAccounts(companyId)
  const contacts = getContacts(companyId)

  const [date, setDate] = useState(edit?.date ?? todayISO())
  const [memo, setMemo] = useState(edit?.memo ?? '')
  const [reference, setReference] = useState(edit?.reference ?? '')
  const [contactName, setContactName] = useState(edit?.contact_name ?? '')
  const [lines, setLines] = useState<LineState[]>(() =>
    edit
      ? edit.entries.map((e) => ({
          account_id: e.account_id,
          debit: e.amount_cents > 0 ? (e.amount_cents / 100).toFixed(2) : '',
          credit: e.amount_cents < 0 ? (-e.amount_cents / 100).toFixed(2) : '',
          memo: e.memo ?? '',
        }))
      : [{ account_id: '', debit: '', credit: '', memo: '' }, { account_id: '', debit: '', credit: '', memo: '' }],
  )
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [acctModal, setAcctModal] = useState<number | null>(null)

  const totalDebit = lines.reduce((s, l) => s + parseMoney(l.debit), 0)
  const totalCredit = lines.reduce((s, l) => s + parseMoney(l.credit), 0)
  const diff = totalDebit - totalCredit
  const balanced = diff === 0 && totalDebit > 0

  function updateLine(i: number, patch: Partial<LineState>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))
  }
  function addLine() { setLines((prev) => [...prev, { account_id: '', debit: '', credit: '', memo: '' }]) }
  function removeLine(i: number) { setLines((prev) => prev.filter((_, idx) => idx !== i)) }
  function pickAccount(i: number, v: string) {
    if (v === NEW_ACCT) { setAcctModal(i); return }
    updateLine(i, { account_id: v === '' ? '' : Number(v) })
  }

  function save() {
    setError(null)
    const posted = lines
      .filter((l) => l.account_id !== '' && lineAmount(l) !== 0)
      .map((l) => ({ account_id: Number(l.account_id), amount_cents: lineAmount(l), memo: l.memo || null }))
    if (posted.length < 2) { setError('Add at least two lines with amounts.'); return }
    if (posted.reduce((s, l) => s + l.amount_cents, 0) !== 0) { setError('Debits must equal credits.'); return }
    setSaving(true)
    try {
      const contact_id = contactName.trim() ? ensureContact(companyId, contactName.trim(), 'other') : null
      const input = { company_id: companyId, date, memo: memo || null, reference: reference || null, contact_id, lines: posted }
      if (edit) updateJournalEntry(edit.id, input)
      else postTransaction({ ...input, source: 'manual' })
      onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-slate-900/40 p-4">
      <div className="card my-8 w-full max-w-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h2 className="text-lg font-semibold text-slate-900">{edit ? 'Edit journal entry' : 'New journal entry'}</h2>
          <button className="btn-ghost p-1" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="space-y-4 p-5">
          <div className="grid grid-cols-3 gap-3">
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium text-slate-500">Date</span>
              <input type="date" className="w-full rounded-md border border-slate-300 px-3 py-1.5" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium text-slate-500">Reference</span>
              <input className="w-full rounded-md border border-slate-300 px-3 py-1.5" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium text-slate-500">Contact</span>
              <input list="je-contacts" className="w-full rounded-md border border-slate-300 px-3 py-1.5" value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Optional" />
              <datalist id="je-contacts">{contacts.map((c) => <option key={c.id} value={c.name} />)}</datalist>
            </label>
            <label className="col-span-3 text-sm">
              <span className="mb-1 block text-xs font-medium text-slate-500">Memo</span>
              <input className="w-full rounded-md border border-slate-300 px-3 py-1.5" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="What's this entry for?" />
            </label>
          </div>

          <div className="space-y-2">
            <div className="grid grid-cols-[1.6fr_1.4fr_100px_100px_auto] gap-2 text-[11px] font-medium uppercase tracking-wide text-slate-400">
              <span>Account</span><span>Description</span><span className="text-right">Debit</span><span className="text-right">Credit</span><span />
            </div>
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[1.6fr_1.4fr_100px_100px_auto] items-center gap-2">
                <select className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" value={l.account_id} onChange={(e) => pickAccount(i, e.target.value)}>
                  <option value="">Account…</option>
                  {groupAccounts(accounts)}
                  <option value={NEW_ACCT}>+ New account…</option>
                </select>
                <input className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" placeholder="Description" value={l.memo} onChange={(e) => updateLine(i, { memo: e.target.value })} />
                <input className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-right text-sm" placeholder="0.00" value={l.debit} onChange={(e) => updateLine(i, { debit: e.target.value, credit: '' })} />
                <input className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-right text-sm" placeholder="0.00" value={l.credit} onChange={(e) => updateLine(i, { credit: e.target.value, debit: '' })} />
                <button className="text-slate-400 hover:text-rose-600" onClick={() => removeLine(i)}><Trash2 size={15} /></button>
              </div>
            ))}
            <button className="btn-ghost text-sm text-brand-600" onClick={addLine}><Plus size={15} /> Add line</button>
          </div>

          <div className="flex items-center justify-end gap-6 border-t border-slate-100 pt-3 text-sm">
            <div className="text-slate-500">Debits <span className="font-medium text-slate-800">{formatMoney(totalDebit)}</span></div>
            <div className="text-slate-500">Credits <span className="font-medium text-slate-800">{formatMoney(totalCredit)}</span></div>
            <div className={diff === 0 ? 'text-credit' : 'text-debit'}>{diff === 0 ? 'Balanced' : `Off by ${formatMoney(Math.abs(diff))}`}</div>
          </div>

          {error && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={saving || !balanced}>{saving ? 'Saving…' : edit ? 'Save changes' : 'Post entry'}</button>
        </div>
      </div>

      {acctModal !== null && (
        <QuickAccount
          companyId={companyId}
          onClose={() => setAcctModal(null)}
          onSaved={(id) => { const i = acctModal; setAcctModal(null); refresh(); if (i !== null) updateLine(i, { account_id: id }) }}
        />
      )}
    </div>
  )
}

function groupAccounts(accounts: Account[]) {
  const types = ['asset', 'liability', 'equity', 'income', 'expense'] as const
  const label: Record<string, string> = { income: 'Income', expense: 'Expenses', asset: 'Assets', liability: 'Liabilities', equity: 'Equity' }
  return types.map((t) => {
    const list = accounts.filter((a) => a.type === t)
    if (list.length === 0) return null
    return <optgroup key={t} label={label[t]}>{list.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}</optgroup>
  })
}
