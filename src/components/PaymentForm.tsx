import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { useStore } from '../state/store'
import { getBankAccounts, getContacts } from '../db/repo'
import { openDocuments, receivePayment, payBills } from '../db/documents'
import { parseMoney, formatMoney } from '../lib/money'
import { todayISO, formatDate } from '../lib/format'

export function PaymentForm({
  kind,
  onClose,
  onSaved,
}: {
  kind: 'ar' | 'ap'
  onClose: () => void
  onSaved: () => void
}) {
  const companyId = useStore((s) => s.currentCompanyId)!
  const isAR = kind === 'ar'
  const banks = getBankAccounts(companyId)
  const contacts = getContacts(companyId)

  const [contactName, setContactName] = useState('')
  const [date, setDate] = useState(todayISO())
  const [bankId, setBankId] = useState<number | ''>(banks[0]?.id ?? '')
  const [amounts, setAmounts] = useState<Record<number, string>>({})
  const [included, setIncluded] = useState<Set<number>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const contact = contacts.find((c) => c.name === contactName.trim())
  const docs = useMemo(
    () => (contact ? openDocuments(companyId, isAR ? 'invoice' : 'bill', contact.id) : []),
    [companyId, contact, isAR],
  )

  function toggle(docId: number, balance: number) {
    setIncluded((prev) => {
      const next = new Set(prev)
      if (next.has(docId)) next.delete(docId)
      else {
        next.add(docId)
        setAmounts((a) => ({ ...a, [docId]: a[docId] ?? (balance / 100).toFixed(2) }))
      }
      return next
    })
  }

  const applications = [...included]
    .map((id) => ({ documentId: id, amount_cents: parseMoney(amounts[id] ?? '0') }))
    .filter((a) => a.amount_cents > 0)
  const total = applications.reduce((s, a) => s + a.amount_cents, 0)

  function save() {
    setError(null)
    if (!contact) { setError('Choose a contact with open items.'); return }
    if (bankId === '') { setError('Choose a bank account.'); return }
    if (applications.length === 0) { setError('Select at least one item to pay.'); return }
    setSaving(true)
    try {
      const payload = { companyId, contactId: contact.id, date, bankAccountId: Number(bankId), applications }
      if (isAR) receivePayment(payload)
      else payBills(payload)
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
          <h2 className="text-lg font-semibold text-slate-900">
            {isAR ? 'Receive Payment' : 'Pay Bills'}
          </h2>
          <button className="btn-ghost p-1" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="space-y-4 p-5">
          <div className="grid grid-cols-3 gap-3">
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium text-slate-500">{isAR ? 'Customer' : 'Supplier'}</span>
              <input
                list="pay-contact-list"
                className="w-full rounded-md border border-slate-300 px-3 py-1.5"
                value={contactName}
                onChange={(e) => { setContactName(e.target.value); setIncluded(new Set()) }}
                placeholder="Name"
              />
              <datalist id="pay-contact-list">
                {contacts.map((c) => <option key={c.id} value={c.name} />)}
              </datalist>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium text-slate-500">Date</span>
              <input type="date" className="w-full rounded-md border border-slate-300 px-3 py-1.5" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium text-slate-500">{isAR ? 'Deposit to' : 'Pay from'}</span>
              <select className="w-full rounded-md border border-slate-300 px-3 py-1.5" value={bankId} onChange={(e) => setBankId(e.target.value === '' ? '' : Number(e.target.value))}>
                {banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </label>
          </div>

          <div className="rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="w-8 px-3 py-2"></th>
                  <th className="px-2 py-2">{isAR ? 'Invoice' : 'Bill'}</th>
                  <th className="px-2 py-2">Due</th>
                  <th className="px-2 py-2 text-right">Balance</th>
                  <th className="px-3 py-2 text-right">Payment</th>
                </tr>
              </thead>
              <tbody>
                {!contact && (
                  <tr><td colSpan={5} className="px-3 py-5 text-center text-slate-400">Pick a {isAR ? 'customer' : 'supplier'} to see open items.</td></tr>
                )}
                {contact && docs.length === 0 && (
                  <tr><td colSpan={5} className="px-3 py-5 text-center text-slate-400">No open {isAR ? 'invoices' : 'bills'}.</td></tr>
                )}
                {docs.map((d) => (
                  <tr key={d.id} className="border-b border-slate-50 last:border-0">
                    <td className="px-3 py-2">
                      <input type="checkbox" checked={included.has(d.id)} onChange={() => toggle(d.id, d.balance_cents)} />
                    </td>
                    <td className="px-2 py-2 text-slate-700">{d.number}</td>
                    <td className="px-2 py-2 text-slate-500">{d.due_date ? formatDate(d.due_date) : '—'}</td>
                    <td className="px-2 py-2 text-right">{formatMoney(d.balance_cents)}</td>
                    <td className="px-3 py-2 text-right">
                      <input
                        className="w-24 rounded-md border border-slate-300 px-2 py-1 text-right text-sm disabled:bg-slate-50"
                        disabled={!included.has(d.id)}
                        value={amounts[d.id] ?? ''}
                        onChange={(e) => setAmounts((a) => ({ ...a, [d.id]: e.target.value }))}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-end gap-8 text-base font-semibold text-slate-900">
            <span>Total payment</span>
            <span>{formatMoney(total)}</span>
          </div>

          {error && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : isAR ? 'Receive payment' : 'Pay bills'}
          </button>
        </div>
      </div>
    </div>
  )
}
