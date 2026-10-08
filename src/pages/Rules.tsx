import { useState } from 'react'
import { Plus, Trash2, Wand2 } from 'lucide-react'
import { useStore } from '../state/store'
import {
  getRules,
  getAccounts,
  createRule,
  deleteRule,
  setRuleEnabled,
  applyRules,
} from '../db/repo'

export default function Rules() {
  const companyId = useStore((s) => s.currentCompanyId)
  const refresh = useStore((s) => s.refresh)
  const rev = useStore((s) => s.rev)
  void rev
  const [pattern, setPattern] = useState('')
  const [accountId, setAccountId] = useState<number | ''>('')
  const [note, setNote] = useState('')
  if (companyId == null) return null

  const rules = getRules(companyId)
  const accounts = getAccounts(companyId).filter((a) => a.type === 'expense' || a.type === 'income' || a.type === 'liability')
  const accountName = (id: number) => {
    const a = accounts.find((x) => x.id === id) ?? getAccounts(companyId).find((x) => x.id === id)
    return a ? `${a.code} ${a.name}` : '—'
  }

  function add() {
    if (!pattern.trim() || accountId === '') return
    createRule({ company_id: companyId!, pattern: pattern.trim(), account_id: Number(accountId) })
    setPattern('')
    setAccountId('')
    refresh()
  }

  function runRules() {
    const n = applyRules(companyId!)
    setNote(n > 0 ? `Categorized ${n} transaction${n === 1 ? '' : 's'}.` : 'No unmatched items matched a rule.')
    refresh()
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Rules</h1>
          <p className="text-sm text-slate-500">
            Auto-categorize bank transactions whose description matches a pattern.
          </p>
        </div>
        <button className="btn-primary" onClick={runRules}>
          <Wand2 size={16} /> Apply rules to unmatched
        </button>
      </div>

      {note && (
        <div className="rounded-lg bg-brand-50 px-4 py-2 text-sm text-brand-700">{note}</div>
      )}

      <div className="card p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <input
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            placeholder="If description contains… (e.g. UBER)"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
          />
          <select
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value === '' ? '' : Number(e.target.value))}
          >
            <option value="">Categorize as…</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} {a.name}
              </option>
            ))}
          </select>
          <button className="btn-primary" onClick={add}>
            <Plus size={16} /> Add rule
          </button>
        </div>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-5 py-2.5">Pattern</th>
              <th className="px-2 py-2.5">Category</th>
              <th className="px-2 py-2.5">Enabled</th>
              <th className="px-5 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {rules.length === 0 && (
              <tr>
                <td colSpan={4} className="px-5 py-6 text-center text-slate-400">
                  No rules yet.
                </td>
              </tr>
            )}
            {rules.map((r) => (
              <tr key={r.id} className="border-b border-slate-50 last:border-0">
                <td className="px-5 py-2.5">
                  <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-600">
                    {r.match_kind} “{r.pattern}”
                  </span>
                </td>
                <td className="px-2 py-2.5 text-slate-700">{accountName(r.account_id)}</td>
                <td className="px-2 py-2.5">
                  <input
                    type="checkbox"
                    checked={r.enabled === 1}
                    onChange={(e) => {
                      setRuleEnabled(r.id, e.target.checked)
                      refresh()
                    }}
                  />
                </td>
                <td className="px-5 py-2.5 text-right">
                  <button
                    className="text-slate-400 hover:text-rose-600"
                    onClick={() => {
                      deleteRule(r.id)
                      refresh()
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
