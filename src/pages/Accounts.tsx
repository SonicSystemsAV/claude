import { useMemo, useState } from 'react'
import { Plus, Landmark, X, ChevronRight } from 'lucide-react'
import { useStore, useCan } from '../state/store'
import { getAccounts, displayBalance, createAccount, generalLedger, getAccount } from '../db/repo'
import type { Account, AccountType, NormalBalance } from '../db/types'
import { Money } from '../components/Money'
import { formatDate } from '../lib/format'

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
  const [registerId, setRegisterId] = useState<number | null>(null)
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
                    <tr
                      key={a.id}
                      className="group cursor-pointer border-b border-slate-50 last:border-0 hover:bg-orange-50/50"
                      onClick={() => setRegisterId(a.id)}
                      title="View transactions in this account"
                    >
                      <td className="w-16 px-5 py-2.5 font-mono text-xs text-slate-400">{a.code}</td>
                      <td className="px-2 py-2.5 text-slate-800">
                        <span className="inline-flex items-center gap-1.5">
                          {a.is_bank === 1 && <Landmark size={14} className="text-brand-500" />}
                          {a.name}
                        </span>
                      </td>
                      <td className="px-5 py-2.5 text-right">
                        <span className="inline-flex items-center gap-1.5">
                          <Money cents={displayBalance(a)} />
                          <ChevronRight size={14} className="text-slate-300 group-hover:text-sonic-orange" />
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        })}
      </div>

      {registerId != null && (
        <AccountRegister companyId={companyId} accountId={registerId} onClose={() => setRegisterId(null)} />
      )}
    </div>
  )
}

function AccountRegister({ companyId, accountId, onClose }: { companyId: number; accountId: number; onClose: () => void }) {
  const account = getAccount(accountId)
  const [q, setQ] = useState('')
  const ledger = useMemo(() => generalLedger(companyId, accountId), [companyId, accountId])

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const list = needle
      ? ledger.rows.filter((r) =>
          [r.memo, r.reference, r.contact_name].some((v) => v && v.toLowerCase().includes(needle)),
        )
      : ledger.rows
    // Newest first for reading; running balance already baked in chronologically.
    return [...list].reverse()
  }, [ledger, q])

  if (!account) return null

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-3xl flex-col bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-rule px-5 py-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-subtle">{account.code}</span>
              <h2 className="text-lg font-semibold text-ink">{account.name}</h2>
            </div>
            <p className="mt-0.5 text-sm text-muted">
              {ledger.rows.length} transaction{ledger.rows.length === 1 ? '' : 's'} · balance{' '}
              <span className="font-medium text-ink">
                <Money cents={displayBalance(account)} />
              </span>
            </p>
          </div>
          <button className="rounded-nav p-1.5 text-muted hover:bg-rule-soft" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="border-b border-rule px-5 py-2.5">
          <input
            className="input w-full text-sm"
            placeholder="Search memo, reference, or name…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {rows.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted">
              {ledger.rows.length === 0 ? 'No transactions have hit this account yet.' : 'Nothing matches that search.'}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-ground text-xs uppercase tracking-wide text-subtle">
                <tr>
                  <th className="px-5 py-2 text-left font-semibold">Date</th>
                  <th className="px-2 py-2 text-left font-semibold">Name / Memo</th>
                  <th className="px-3 py-2 text-right font-semibold">Amount</th>
                  <th className="px-5 py-2 text-right font-semibold">Balance</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-rule/60 last:border-0 align-top">
                    <td className="whitespace-nowrap px-5 py-2 text-muted">{formatDate(r.date)}</td>
                    <td className="px-2 py-2">
                      {r.contact_name && <div className="text-ink">{r.contact_name}</div>}
                      {(r.memo || r.reference) && (
                        <div className="text-xs text-subtle">
                          {[r.reference, r.memo].filter(Boolean).join(' · ')}
                        </div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      <Money cents={r.amount_cents} />
                    </td>
                    <td className="whitespace-nowrap px-5 py-2 text-right font-medium text-ink">
                      <Money cents={r.running} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="border-t border-rule px-5 py-2 text-[11px] text-subtle">
          Amounts are signed (+ debit / − credit). Running balance is debit-positive, in account order.
        </div>
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
