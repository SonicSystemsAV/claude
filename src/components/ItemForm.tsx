import { useState } from 'react'
import { X } from 'lucide-react'
import { getAccounts } from '../db/repo'
import { createItem, updateItem } from '../db/items'
import type { Account, Item, ItemType } from '../db/types'
import { parseMoney, formatMoney } from '../lib/money'

/** Create or edit a product/service item. Used on the Items page and inline from documents. */
export function ItemForm({
  companyId,
  edit,
  defaultMode,
  onClose,
  onSaved,
}: {
  companyId: number
  edit?: Item
  /** Pre-tick sell or buy based on where it was launched (invoice vs expense). */
  defaultMode?: 'sell' | 'buy'
  onClose: () => void
  onSaved: (itemId: number) => void
}) {
  const accounts = getAccounts(companyId)
  const incomeAccts = accounts.filter((a) => a.type === 'income')
  const expenseAccts = accounts.filter((a) => a.type === 'expense' || a.type === 'asset')

  const [name, setName] = useState(edit?.name ?? '')
  const [type, setType] = useState<ItemType>(edit?.type ?? 'service')
  const [description, setDescription] = useState(edit?.description ?? '')
  const [sell, setSell] = useState(edit ? edit.sell === 1 : defaultMode !== 'buy')
  const [buy, setBuy] = useState(edit ? edit.buy === 1 : defaultMode === 'buy')
  const [incomeAccountId, setIncomeAccountId] = useState<number | ''>(edit?.income_account_id ?? incomeAccts[0]?.id ?? '')
  const [expenseAccountId, setExpenseAccountId] = useState<number | ''>(edit?.expense_account_id ?? expenseAccts[0]?.id ?? '')
  const [price, setPrice] = useState(edit ? (edit.sales_price_cents / 100).toFixed(2) : '')
  const [cost, setCost] = useState(edit ? (edit.cost_cents / 100).toFixed(2) : '')
  const [taxable, setTaxable] = useState(edit ? edit.taxable === 1 : true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  function save() {
    setError(null)
    setSaving(true)
    try {
      const input = {
        name,
        type,
        description: description || null,
        sell,
        incomeAccountId: sell ? (incomeAccountId === '' ? null : Number(incomeAccountId)) : null,
        salesPriceCents: parseMoney(price),
        buy,
        expenseAccountId: buy ? (expenseAccountId === '' ? null : Number(expenseAccountId)) : null,
        costCents: parseMoney(cost),
        taxable,
      }
      const id = edit ? (updateItem(edit.id, input), edit.id) : createItem(companyId, input)
      onSaved(id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-auto bg-slate-900/40 p-4">
      <div className="card my-8 w-full max-w-lg">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h2 className="text-lg font-semibold text-slate-900">{edit ? 'Edit item' : 'New item'}</h2>
          <button className="btn-ghost p-1" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="space-y-4 p-5">
          <div className="grid grid-cols-2 gap-3">
            <label className="col-span-2 text-sm">
              <span className="mb-1 block text-xs font-medium text-slate-500">Name</span>
              <input className="w-full rounded-md border border-slate-300 px-3 py-1.5" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Consulting, Installation, Materials" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium text-slate-500">Type</span>
              <select className="w-full rounded-md border border-slate-300 px-3 py-1.5" value={type} onChange={(e) => setType(e.target.value as ItemType)}>
                <option value="service">Service</option>
                <option value="non_inventory">Non-inventory product</option>
              </select>
            </label>
            <label className="flex items-end gap-2 pb-1 text-sm text-slate-600">
              <input type="checkbox" checked={taxable} onChange={(e) => setTaxable(e.target.checked)} /> Taxable by default
            </label>
            <label className="col-span-2 text-sm">
              <span className="mb-1 block text-xs font-medium text-slate-500">Description</span>
              <input className="w-full rounded-md border border-slate-300 px-3 py-1.5" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Shown on the document line" />
            </label>
          </div>

          <div className="rounded-lg border border-slate-200 p-3">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <input type="checkbox" checked={sell} onChange={(e) => setSell(e.target.checked)} /> I sell this
            </label>
            {sell && (
              <div className="mt-2 grid grid-cols-2 gap-3">
                <label className="text-sm">
                  <span className="mb-1 block text-xs font-medium text-slate-500">Income account</span>
                  <select className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" value={incomeAccountId} onChange={(e) => setIncomeAccountId(e.target.value === '' ? '' : Number(e.target.value))}>
                    <option value="">Choose…</option>
                    {accountOptions(incomeAccts)}
                  </select>
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-xs font-medium text-slate-500">Sales price</span>
                  <input className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-right text-sm" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" />
                </label>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-slate-200 p-3">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <input type="checkbox" checked={buy} onChange={(e) => setBuy(e.target.checked)} /> I buy this
            </label>
            {buy && (
              <div className="mt-2 grid grid-cols-2 gap-3">
                <label className="text-sm">
                  <span className="mb-1 block text-xs font-medium text-slate-500">Expense account</span>
                  <select className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" value={expenseAccountId} onChange={(e) => setExpenseAccountId(e.target.value === '' ? '' : Number(e.target.value))}>
                    <option value="">Choose…</option>
                    {accountOptions(expenseAccts)}
                  </select>
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-xs font-medium text-slate-500">Cost</span>
                  <input className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-right text-sm" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0.00" />
                </label>
              </div>
            )}
          </div>

          {price && <p className="text-xs text-slate-400">Default price {formatMoney(parseMoney(price))}.</p>}
          {error && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={saving || !name.trim()}>{saving ? 'Saving…' : 'Save item'}</button>
        </div>
      </div>
    </div>
  )
}

function accountOptions(accounts: Account[]) {
  return accounts.map((a) => (
    <option key={a.id} value={a.id}>{a.code} {a.name}</option>
  ))
}
