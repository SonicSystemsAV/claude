import { useState } from 'react'
import { X } from 'lucide-react'
import { createAccountQuick } from '../db/repo'
import type { AccountType } from '../db/types'

const TYPES: { v: AccountType; label: string }[] = [
  { v: 'income', label: 'Income' },
  { v: 'expense', label: 'Expense' },
  { v: 'asset', label: 'Asset' },
  { v: 'liability', label: 'Liability' },
  { v: 'equity', label: 'Equity' },
]

/** Compact modal to add a new account on the fly (auto code + normal balance). */
export function QuickAccount({
  companyId,
  defaultType = 'expense',
  onClose,
  onSaved,
}: {
  companyId: number
  defaultType?: AccountType
  onClose: () => void
  onSaved: (accountId: number) => void
}) {
  const [name, setName] = useState('')
  const [type, setType] = useState<AccountType>(defaultType)
  const [isBank, setIsBank] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function save() {
    setError(null)
    try {
      const id = createAccountQuick(companyId, name, type, isBank)
      onSaved(id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-auto bg-slate-900/40 p-4">
      <div className="card my-16 w-full max-w-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h2 className="text-base font-semibold text-slate-900">New account</h2>
          <button className="btn-ghost p-1" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="space-y-3 p-5">
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-slate-500">Name</span>
            <input autoFocus className="w-full rounded-md border border-slate-300 px-3 py-1.5" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && save()} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-slate-500">Type</span>
            <select className="w-full rounded-md border border-slate-300 px-3 py-1.5" value={type} onChange={(e) => setType(e.target.value as AccountType)}>
              {TYPES.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
            </select>
          </label>
          {type === 'asset' && (
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={isBank} onChange={(e) => setIsBank(e.target.checked)} /> This is a bank / cash account
            </label>
          )}
          {error && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={!name.trim()}>Add account</button>
        </div>
      </div>
    </div>
  )
}
