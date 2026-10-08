import { useState } from 'react'
import { Plus, Landmark } from 'lucide-react'
import { useStore, useCan } from '../state/store'
import { getAccounts, displayBalance, createAccount } from '../db/repo'
import type { Account, AccountType, NormalBalance } from '../db/types'
import { Money } from '../components/Money'

const TYPE_ORDER: AccountType[] = ['asset', 'liability', 'equity', 'income', 'expense']
const TYPE_LABEL: Record<AccountType, string> = {
  asset: 'Assets',
  liability: 'Liabilities',
  equity: 'Equity',
  income: 'Income',
  expense: 'Expenses',
}
const DEFAULT_NORMAL: Record<AccountType, NormalBalance> = {
  asset: 'debit',
  liability: 'credit',
  equity: 'credit',
  income: 'credit',
  expense: 'debit',
}

export default function Accounts() {
  const companyId = useStore((s) => s.currentCompanyId)
  const refresh = useStore((s) => s.refresh)
  const rev = useStore((s) => s.rev)
  const canEdit = useCan('edit')
  void rev
  const [adding, setAdding] = useState(false)
  if (companyId == null) return null

  const accounts = getAccounts(companyId)
  const byType = (t: AccountType) => accounts.filter((a) => a.type === t)

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Chart of Accounts</h1>
          <p className="text-sm text-slate-500">{accounts.length} accounts</p>
        </div>
        {canEdit && (
          <button className="btn-primary" onClick={() => setAdding((v) => !v)}>
            <Plus size={16} /> New account
          </button>
        )}
      </div>

      {adding && (
        <AddAccountForm
          companyId={companyId}
          onDone={() => {
            setAdding(false)
            refresh()
          }}
        />
      )}

      <div className="space-y-5">
        {TYPE_ORDER.map((type) => {
          const list = byType(type)
          if (list.length === 0) return null
          return (
            <div key={type} className="card overflow-hidden">
              <div className="border-b border-slate-100 bg-slate-50 px-5 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {TYPE_LABEL[type]}
              </div>
              <table className="w-full text-sm">
                <tbody>
                  {list.map((a: Account) => (
                    <tr key={a.id} className="border-b border-slate-50 last:border-0">
                      <td className="w-16 px-5 py-2.5 font-mono text-xs text-slate-400">{a.code}</td>
                      <td className="px-2 py-2.5 text-slate-800">
                        <span className="inline-flex items-center gap-1.5">
                          {a.is_bank === 1 && <Landmark size={14} className="text-brand-500" />}
                          {a.name}
                        </span>
                      </td>
                      <td className="px-5 py-2.5 text-right">
                        <Money cents={displayBalance(a)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function AddAccountForm({ companyId, onDone }: { companyId: number; onDone: () => void }) {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [type, setType] = useState<AccountType>('expense')
  const [isBank, setIsBank] = useState(false)

  function submit() {
    if (!code.trim() || !name.trim()) return
    createAccount({
      company_id: companyId,
      code: code.trim(),
      name: name.trim(),
      type,
      normal_balance: DEFAULT_NORMAL[type],
      is_bank: isBank,
    })
    onDone()
  }

  return (
    <div className="card space-y-3 p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <input
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          placeholder="Code (e.g. 6400)"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        <input
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm sm:col-span-2"
          placeholder="Account name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <select
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          value={type}
          onChange={(e) => setType(e.target.value as AccountType)}
        >
          {TYPE_ORDER.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={isBank} onChange={(e) => setIsBank(e.target.checked)} />
          This is a bank account
        </label>
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={onDone}>
            Cancel
          </button>
          <button className="btn-primary" onClick={submit}>
            Add account
          </button>
        </div>
      </div>
    </div>
  )
}
