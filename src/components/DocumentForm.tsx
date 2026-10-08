import { useMemo, useState } from 'react'
import { X, Plus, Trash2, UserPlus } from 'lucide-react'
import { useStore } from '../state/store'
import { getAccounts, getBankAccounts, ensureContact, getContacts } from '../db/repo'
import { sellItems, buyItems, getItem } from '../db/items'
import {
  createInvoice,
  createBill,
  createExpense,
  createSalesReceipt,
  updateDocument,
  getTaxCodes,
  defaultTaxCodeId,
  nextDocNumber,
  type DocumentEditData,
} from '../db/documents'
import type { Account, DocType, DocumentLineInput, Item } from '../db/types'
import { parseMoney, formatMoney } from '../lib/money'
import { todayISO } from '../lib/format'
import { ItemForm } from './ItemForm'
import { ContactForm } from './ContactForm'
import { QuickAccount } from './QuickAccount'

export const PAYMENT_METHODS = ['Cash', 'Cheque', 'Credit card', 'Debit', 'E-transfer', 'EFT', 'Square', 'Other']

const NEW_ITEM = '__new_item__'
const NEW_ACCT = '__new_acct__'

interface LineState {
  item_id: number | ''
  account_id: number | ''
  description: string
  qty: string
  rate: string
  taxable: boolean
}

const TITLES: Record<string, string> = {
  invoice: 'Invoice',
  bill: 'Bill',
  expense: 'Expense',
  sales_receipt: 'Sales Receipt',
}

function lineAmountCents(l: LineState): number {
  const qty = parseFloat(l.qty)
  const rate = parseMoney(l.rate)
  return Math.round((isNaN(qty) ? 1 : qty) * rate)
}

export function DocumentForm({
  type,
  edit,
  initialContactName,
  onClose,
  onSaved,
}: {
  type: Extract<DocType, 'invoice' | 'bill' | 'expense' | 'sales_receipt'>
  edit?: DocumentEditData
  initialContactName?: string
  onClose: () => void
  onSaved: () => void
}) {
  const companyId = useStore((s) => s.currentCompanyId)!
  const rev = useStore((s) => s.rev)
  const refresh = useStore((s) => s.refresh)
  const isSales = type === 'invoice' || type === 'sales_receipt'
  const needsBank = type === 'expense' || type === 'sales_receipt'
  const hasDue = type === 'invoice' || type === 'bill'
  const hasPaymentMethod = type === 'sales_receipt' || type === 'expense'

  const accounts = getAccounts(companyId)
  const banks = getBankAccounts(companyId)
  const contacts = getContacts(companyId)
  const items = isSales ? sellItems(companyId) : buyItems(companyId)
  const taxCodes = getTaxCodes(companyId)
  const taxAvailable = taxCodes.length > 0
  void rev // re-read lists after inline creation

  const lineAccounts = useMemo(
    () =>
      accounts.filter((a) =>
        isSales ? a.type === 'income' || a.type === 'expense' : a.type === 'expense' || a.type === 'asset',
      ),
    [accounts, isSales],
  )

  const [contactName, setContactName] = useState(edit?.contactName ?? initialContactName ?? '')
  const [date, setDate] = useState(edit?.doc.date ?? todayISO())
  const [dueDate, setDueDate] = useState(edit?.doc.due_date ?? todayISO())
  const [number] = useState(() => edit?.doc.number ?? nextDocNumber(companyId, type))
  const [bankId, setBankId] = useState<number | ''>(edit?.bankAccountId ?? banks[0]?.id ?? '')
  const [paymentMethod, setPaymentMethod] = useState<string>(edit?.doc.payment_method ?? '')
  const [taxCodeId, setTaxCodeId] = useState<number | null>(() => edit?.doc.tax_code_id ?? defaultTaxCodeId(companyId))
  const taxRate = taxCodes.find((c) => c.id === taxCodeId)?.rate ?? 0

  const [lines, setLines] = useState<LineState[]>(() =>
    edit && edit.lines.length
      ? edit.lines.map((l) => ({
          item_id: l.item_id ?? '',
          account_id: l.account_id,
          description: l.description ?? '',
          qty: '1',
          rate: (l.amount_cents / 100).toFixed(2),
          taxable: l.taxable,
        }))
      : [{ item_id: '', account_id: lineAccounts[0]?.id ?? '', description: '', qty: '1', rate: '', taxable: taxAvailable }],
  )
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Inline-creation modals
  const [itemModal, setItemModal] = useState<number | null>(null) // line index awaiting a new item
  const [acctModal, setAcctModal] = useState<number | null>(null)
  const [contactModal, setContactModal] = useState(false)

  const parsedLines = lines
    .filter((l) => l.account_id !== '' && lineAmountCents(l) !== 0)
    .map<DocumentLineInput>((l) => ({
      account_id: Number(l.account_id),
      item_id: l.item_id === '' ? null : Number(l.item_id),
      description: l.description || null,
      qty: parseFloat(l.qty) || 1,
      unit_price_cents: parseMoney(l.rate),
      amount_cents: lineAmountCents(l),
      taxable: l.taxable,
    }))

  const subtotal = parsedLines.reduce((s, l) => s + l.amount_cents, 0)
  const taxableBase = parsedLines.reduce((s, l) => s + (l.taxable ? l.amount_cents : 0), 0)
  const tax = taxAvailable ? Math.round(taxableBase * taxRate) : 0
  const total = subtotal + tax

  function updateLine(i: number, patch: Partial<LineState>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))
  }
  function addLine() {
    setLines((prev) => [...prev, { item_id: '', account_id: lineAccounts[0]?.id ?? '', description: '', qty: '1', rate: '', taxable: taxAvailable }])
  }
  function removeLine(i: number) {
    setLines((prev) => prev.filter((_, idx) => idx !== i))
  }

  function pickItem(i: number, value: string) {
    if (value === NEW_ITEM) { setItemModal(i); return }
    if (value === '') { updateLine(i, { item_id: '' }); return }
    const it = getItem(Number(value))
    if (!it) return
    applyItem(i, it)
  }
  function applyItem(i: number, it: Item) {
    const acct = isSales ? it.income_account_id : it.expense_account_id
    const priceCents = isSales ? it.sales_price_cents : it.cost_cents
    updateLine(i, {
      item_id: it.id,
      account_id: acct ?? (lines[i].account_id || ''),
      description: it.description || it.name,
      rate: priceCents ? (priceCents / 100).toFixed(2) : lines[i].rate,
      taxable: it.taxable === 1,
    })
  }
  function pickAccount(i: number, value: string) {
    if (value === NEW_ACCT) { setAcctModal(i); return }
    updateLine(i, { account_id: value === '' ? '' : Number(value) })
  }

  function save() {
    setError(null)
    if (parsedLines.length === 0) { setError('Add at least one line with an amount.'); return }
    if (needsBank && bankId === '') { setError('Choose an account to pay from / deposit to.'); return }
    setSaving(true)
    try {
      const contactId = contactName.trim()
        ? ensureContact(companyId, contactName.trim(), isSales ? 'customer' : 'supplier')
        : null
      const base = {
        companyId,
        contactId,
        date,
        dueDate: hasDue ? dueDate : null,
        number,
        memo: null,
        paymentMethod: hasPaymentMethod ? (paymentMethod || null) : undefined,
        lines: parsedLines,
        taxCodeId,
      }
      if (edit) {
        updateDocument(edit.doc.id, {
          ...base,
          paidFromAccountId: needsBank ? Number(bankId) : undefined,
          depositAccountId: needsBank ? Number(bankId) : undefined,
        })
      } else if (type === 'invoice') createInvoice(base)
      else if (type === 'bill') createBill(base)
      else if (type === 'expense') createExpense({ ...base, paidFromAccountId: Number(bankId) })
      else createSalesReceipt({ ...base, depositAccountId: Number(bankId) })
      onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-slate-900/40 p-4">
      <div className="card my-8 w-full max-w-3xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h2 className="text-lg font-semibold text-slate-900">{(edit ? 'Edit ' : 'New ') + TITLES[type]}</h2>
          <button className="btn-ghost p-1" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="space-y-4 p-5">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 text-sm">
              <span className="mb-1 block text-xs font-medium text-slate-500">{isSales ? 'Customer' : 'Supplier'}</span>
              <div className="flex gap-2">
                <input
                  list="contact-list"
                  className="w-full rounded-md border border-slate-300 px-3 py-1.5"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  placeholder={isSales ? 'Customer name' : 'Supplier name'}
                />
                <button className="btn-outline shrink-0" onClick={() => setContactModal(true)} title="New contact with details">
                  <UserPlus size={15} /> New
                </button>
                <datalist id="contact-list">
                  {contacts.map((c) => <option key={c.id} value={c.name} />)}
                </datalist>
              </div>
            </div>

            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium text-slate-500">Date</span>
              <input type="date" className="w-full rounded-md border border-slate-300 px-3 py-1.5" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            {hasDue ? (
              <label className="text-sm">
                <span className="mb-1 block text-xs font-medium text-slate-500">Due date</span>
                <input type="date" className="w-full rounded-md border border-slate-300 px-3 py-1.5" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </label>
            ) : (
              <label className="text-sm">
                <span className="mb-1 block text-xs font-medium text-slate-500">{type === 'expense' ? 'Paid from' : 'Deposit to'}</span>
                <select className="w-full rounded-md border border-slate-300 px-3 py-1.5" value={bankId} onChange={(e) => setBankId(e.target.value === '' ? '' : Number(e.target.value))}>
                  {banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </label>
            )}
            {hasPaymentMethod && (
              <label className="text-sm">
                <span className="mb-1 block text-xs font-medium text-slate-500">Payment method</span>
                <select className="w-full rounded-md border border-slate-300 px-3 py-1.5" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                  <option value="">—</option>
                  {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </label>
            )}
          </div>

          {/* Line items */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Lines</span>
              <span className="text-xs text-slate-400">#{number}</span>
            </div>
            <div className="grid grid-cols-[1.3fr_1.2fr_1.5fr_48px_84px_90px_auto] gap-2 text-[11px] font-medium uppercase tracking-wide text-slate-400">
              <span>Item</span><span>Account</span><span>Description</span><span className="text-right">Qty</span><span className="text-right">Rate</span><span className="text-right">Amount</span><span />
            </div>
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[1.3fr_1.2fr_1.5fr_48px_84px_90px_auto] items-center gap-2">
                <select className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" value={l.item_id} onChange={(e) => pickItem(i, e.target.value)}>
                  <option value="">—</option>
                  {items.map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}
                  <option value={NEW_ITEM}>+ New item…</option>
                </select>
                <select className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" value={l.account_id} onChange={(e) => pickAccount(i, e.target.value)}>
                  <option value="">Account…</option>
                  {groupAccounts(lineAccounts)}
                  <option value={NEW_ACCT}>+ New account…</option>
                </select>
                <input className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" placeholder="Description" value={l.description} onChange={(e) => updateLine(i, { description: e.target.value })} />
                <input className="w-full rounded-md border border-slate-300 px-1.5 py-1.5 text-right text-sm" value={l.qty} onChange={(e) => updateLine(i, { qty: e.target.value })} />
                <input className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-right text-sm" placeholder="0.00" value={l.rate} onChange={(e) => updateLine(i, { rate: e.target.value })} />
                <span className="text-right text-sm tabular-nums text-slate-700">{formatMoney(lineAmountCents(l))}</span>
                <div className="flex items-center gap-1">
                  {taxAvailable && (
                    <input type="checkbox" checked={l.taxable} onChange={(e) => updateLine(i, { taxable: e.target.checked })} title="Taxable" />
                  )}
                  <button className="text-slate-400 hover:text-rose-600" onClick={() => removeLine(i)}><Trash2 size={15} /></button>
                </div>
              </div>
            ))}
            <button className="btn-ghost text-sm text-brand-600" onClick={addLine}><Plus size={15} /> Add line</button>
          </div>

          {/* Totals */}
          <div className="flex items-start justify-between border-t border-slate-100 pt-3">
            <div>
              {taxAvailable && (
                <label className="text-sm">
                  <span className="mr-2 text-xs font-medium text-slate-500">Tax</span>
                  <select className="rounded-md border border-slate-300 px-2 py-1 text-sm" value={taxCodeId ?? ''} onChange={(e) => setTaxCodeId(e.target.value === '' ? null : Number(e.target.value))}>
                    <option value="">No tax</option>
                    {taxCodes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </label>
              )}
            </div>
            <div className="space-y-1 text-right text-sm">
              <div className="flex justify-between gap-8 text-slate-500"><span>Subtotal</span><span>{formatMoney(subtotal)}</span></div>
              {taxAvailable && <div className="flex justify-between gap-8 text-slate-500"><span>Tax</span><span>{formatMoney(tax)}</span></div>}
              <div className="flex justify-between gap-8 text-base font-semibold text-slate-900"><span>Total</span><span>{formatMoney(total)}</span></div>
            </div>
          </div>

          {error && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : `Save ${TITLES[type].toLowerCase()}`}</button>
        </div>
      </div>

      {/* Inline creation */}
      {itemModal !== null && (
        <ItemForm
          companyId={companyId}
          defaultMode={isSales ? 'sell' : 'buy'}
          onClose={() => setItemModal(null)}
          onSaved={(id) => {
            const it = getItem(id)
            const i = itemModal
            setItemModal(null)
            refresh()
            if (it && i !== null) applyItem(i, it)
          }}
        />
      )}
      {acctModal !== null && (
        <QuickAccount
          companyId={companyId}
          defaultType={isSales ? 'income' : 'expense'}
          onClose={() => setAcctModal(null)}
          onSaved={(id) => {
            const i = acctModal
            setAcctModal(null)
            refresh()
            if (i !== null) updateLine(i, { account_id: id })
          }}
        />
      )}
      {contactModal && (
        <ContactForm
          companyId={companyId}
          defaultKind={isSales ? 'customer' : 'supplier'}
          onClose={() => setContactModal(false)}
          onSaved={(_id, name) => {
            setContactModal(false)
            refresh()
            setContactName(name)
          }}
        />
      )}
    </div>
  )
}

function groupAccounts(accounts: Account[]) {
  const types = ['income', 'expense', 'asset', 'liability', 'equity'] as const
  const label: Record<string, string> = { income: 'Income', expense: 'Expenses', asset: 'Assets', liability: 'Liabilities', equity: 'Equity' }
  return types.map((t) => {
    const list = accounts.filter((a) => a.type === t)
    if (list.length === 0) return null
    return (
      <optgroup key={t} label={label[t]}>
        {list.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
      </optgroup>
    )
  })
}
