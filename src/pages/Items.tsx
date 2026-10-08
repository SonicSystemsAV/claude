import { useRef, useState } from 'react'
import { Plus, Pencil, Package, Archive, Upload, Download } from 'lucide-react'
import { useStore, useCan } from '../state/store'
import { listItems, deactivateItem, importItemsCSV } from '../db/items'
import { getAccounts } from '../db/repo'
import { ItemForm } from '../components/ItemForm'
import { Money } from '../components/Money'
import { downloadCSV } from '../lib/csv'
import type { Item } from '../db/types'

export default function Items() {
  const companyId = useStore((s) => s.currentCompanyId)
  const refresh = useStore((s) => s.refresh)
  const rev = useStore((s) => s.rev)
  const canEdit = useCan('edit')
  void rev
  const [editing, setEditing] = useState<Item | null>(null)
  const [adding, setAdding] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  if (companyId == null) return null

  async function importCsv(file: File) {
    setNote('Importing…')
    try {
      const r = importItemsCSV(companyId!, await file.text())
      refresh()
      const bits = [`${r.created} item(s) created`]
      if (r.skipped) bits.push(`${r.skipped} skipped`)
      if (r.accountsCreated) bits.push(`${r.accountsCreated} account(s) created`)
      setNote(bits.join(' · ') + (r.errors.length ? ` · ${r.errors.length} error(s): ${r.errors.slice(0, 3).join('; ')}` : ''))
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e))
    }
  }

  function downloadTemplate() {
    downloadCSV(
      'items-template.csv',
      ['Name', 'Type', 'Description', 'Sell', 'Income Account', 'Price', 'Buy', 'Expense Account', 'Cost', 'Taxable'],
      [['Consulting', 'Service', 'Hourly consulting', 'yes', 'Consulting Revenue', '150.00', 'no', '', '', 'yes'],
       ['Materials', 'Product', 'Resold materials', 'yes', 'Sales Income', '0.00', 'yes', 'Cost of Goods', '0.00', 'yes']],
    )
  }

  const items = listItems(companyId)
  const accounts = getAccounts(companyId)
  const acctName = (id: number | null) => (id == null ? '—' : accounts.find((a) => a.id === id)?.name ?? '—')

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Products &amp; Services</h1>
          <p className="text-sm text-slate-500">{items.length} item{items.length === 1 ? '' : 's'} · used on itemized invoices, bills and expenses</p>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <button className="btn-ghost text-slate-500" onClick={downloadTemplate} title="Download a CSV template"><Download size={15} /> Template</button>
            <button className="btn-outline" onClick={() => fileRef.current?.click()}><Upload size={16} /> Import CSV</button>
            <button className="btn-primary" onClick={() => setAdding(true)}><Plus size={16} /> New item</button>
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importCsv(f); e.target.value = '' }} />
          </div>
        )}
      </div>

      {note && <div className="rounded-lg bg-brand-50 px-4 py-2 text-sm text-brand-700">{note}</div>}

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-5 py-2.5">Name</th>
              <th className="px-2 py-2.5">Type</th>
              <th className="px-2 py-2.5">Sell → income</th>
              <th className="px-2 py-2.5 text-right">Price</th>
              <th className="px-2 py-2.5">Buy → expense</th>
              {canEdit && <th className="w-10 px-3 py-2.5" />}
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr><td colSpan={6} className="px-5 py-10 text-center text-slate-400">
                <Package size={22} className="mx-auto mb-2 text-slate-300" />
                No items yet. Create one here, or add one on the fly while making an invoice or expense.
              </td></tr>
            )}
            {items.map((it) => (
              <tr key={it.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                <td className="px-5 py-2.5 font-medium text-slate-800">{it.name}{it.description && <span className="ml-2 text-xs text-slate-400">{it.description}</span>}</td>
                <td className="px-2 py-2.5 text-slate-500">{it.type === 'service' ? 'Service' : 'Product'}</td>
                <td className="px-2 py-2.5 text-slate-500">{it.sell === 1 ? acctName(it.income_account_id) : <span className="text-slate-300">—</span>}</td>
                <td className="px-2 py-2.5 text-right">{it.sell === 1 ? <Money cents={it.sales_price_cents} /> : <span className="text-slate-300">—</span>}</td>
                <td className="px-2 py-2.5 text-slate-500">{it.buy === 1 ? acctName(it.expense_account_id) : <span className="text-slate-300">—</span>}</td>
                {canEdit && (
                  <td className="px-3 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button className="text-slate-300 hover:text-brand-600" title="Edit" onClick={() => setEditing(it)}><Pencil size={15} /></button>
                      <button className="text-slate-300 hover:text-rose-600" title="Archive" onClick={() => { if (confirm(`Archive “${it.name}”? Past documents keep it.`)) { deactivateItem(it.id); refresh() } }}><Archive size={15} /></button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(adding || editing) && (
        <ItemForm
          companyId={companyId}
          edit={editing ?? undefined}
          onClose={() => { setAdding(false); setEditing(null) }}
          onSaved={() => { setAdding(false); setEditing(null); refresh() }}
        />
      )}
    </div>
  )
}
