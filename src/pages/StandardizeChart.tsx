import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { clsx } from 'clsx'
import { Wand2, ArrowRight, CheckCircle2, AlertTriangle } from 'lucide-react'
import { useStore } from '../state/store'
import { getAccounts, displayBalance, updateAccount, mergeAccounts } from '../db/repo'
import type { Account, AccountType } from '../db/types'
import { Money } from '../components/Money'

/**
 * Guided chart standardization. For the selected company it suggests a standard
 * number + name (or a merge target) for each loan / inter-entity account, lets
 * the owner review and adjust per row, and applies it in one pass. Only account
 * metadata and entry account_ids move — amounts never change, so transactions
 * stay balanced. Balance corrections (missing mirror entries) are deliberately
 * NOT done here; see docs/CHART_STANDARD.md.
 */

interface StdAcct { code: string; name: string; type: AccountType; kw: RegExp }

// The reserved standard (same numbers in every company). Keywords drive the
// suggestion only — the owner can override any row.
const STANDARD: StdAcct[] = [
  { code: '1210', name: 'Due from 1933230 Ontario Inc.', type: 'asset', kw: /1933230/i },
  { code: '1220', name: 'Due from Sonic Systems AV Ltd.', type: 'asset', kw: /sonic systems av|systems av/i },
  { code: '1240', name: 'Due from Kevin', type: 'asset', kw: /kevin/i },
  { code: '1250', name: 'Due from Susan Shephard (Nissan)', type: 'asset', kw: /susan|shephard|nissan/i },
  { code: '2210', name: 'Due to 1933230 Ontario Inc.', type: 'liability', kw: /due to.*1933230/i },
  { code: '2220', name: 'Due to Sonic Systems AV Ltd.', type: 'liability', kw: /due to.*systems av/i },
  { code: '2230', name: 'Shareholder loan – Chris Stroesser (SSP)', type: 'liability', kw: /chris|stroesser|shareholder|long term borrowing|stroesser money|notes? payable[ -]*sonic\b|\bsonic\b/i },
  { code: '2240', name: 'Note payable – Aidan', type: 'liability', kw: /aidan/i },
  { code: '2250', name: 'Note payable – Elettia', type: 'liability', kw: /elettia/i },
  { code: '2260', name: 'CEBA loan', type: 'liability', kw: /ceba/i },
  { code: '2270', name: 'Mortgage payable – 88 King St (Albert)', type: 'liability', kw: /mortgage|albert/i },
]

const TYPE_LABEL: Record<AccountType, string> = { asset: 'Asset', liability: 'Liability', equity: 'Equity', income: 'Income', expense: 'Expense' }

function suggest(a: Account): string {
  // Only ever suggest a same-type standard target.
  const hay = `${a.code} ${a.name}`
  for (const s of STANDARD) {
    if (s.type !== a.type) continue
    if (s.kw.test(hay)) return s.code
  }
  return ''
}

export default function StandardizeChart() {
  const companyId = useStore((s) => s.currentCompanyId)
  const companies = useStore((s) => s.companies)
  const refresh = useStore((s) => s.refresh)
  const rev = useStore((s) => s.rev)
  void rev
  const company = companies.find((c) => c.id === companyId)

  const accounts = useMemo(() => (companyId ? getAccounts(companyId).filter((a) => a.type === 'asset' || a.type === 'liability') : []), [companyId, rev])
  const [choices, setChoices] = useState<Record<number, string>>(() => Object.fromEntries(accounts.map((a) => [a.id, suggest(a)])))
  const [results, setResults] = useState<string[] | null>(null)
  const [applying, setApplying] = useState(false)

  // Keep choices in sync when the company (and thus accounts) changes.
  const accountsKey = accounts.map((a) => a.id).join(',')
  const [seenKey, setSeenKey] = useState(accountsKey)
  if (accountsKey !== seenKey) {
    setSeenKey(accountsKey)
    setChoices(Object.fromEntries(accounts.map((a) => [a.id, suggest(a)])))
    setResults(null)
  }

  if (companyId == null) return null

  // Group by chosen target to know which are renames vs merges.
  const groups = new Map<string, number[]>()
  for (const a of accounts) {
    const t = choices[a.id]
    if (t) groups.set(t, [...(groups.get(t) ?? []), a.id])
  }
  const actionLabel = (a: Account): { kind: 'keep' | 'rename' | 'merge'; text: string } => {
    const t = choices[a.id]
    if (!t) return { kind: 'keep', text: 'Keep as-is' }
    const std = STANDARD.find((s) => s.code === t)!
    const group = groups.get(t) ?? []
    const anchorId = group.find((id) => accounts.find((x) => x.id === id)?.code === t) ?? group[0]
    if (a.id === anchorId) return { kind: 'rename', text: `${std.code} ${std.name}` }
    return { kind: 'merge', text: `merge → ${std.code} ${std.name}` }
  }
  const renames = accounts.filter((a) => actionLabel(a).kind === 'rename').length
  const merges = accounts.filter((a) => actionLabel(a).kind === 'merge').length

  function apply() {
    if (!window.confirm(`Apply to ${company?.name}? ${renames} account(s) renumbered, ${merges} merged. Amounts are untouched and every step is in the audit log.`)) return
    setApplying(true)
    const out: string[] = []
    try {
      for (const [code, ids] of groups) {
        const std = STANDARD.find((s) => s.code === code)
        if (!std) continue
        const conflict = accounts.find((a) => a.code === std.code && !ids.includes(a.id))
        if (conflict) { out.push(`Skipped ${std.code}: number already used by “${conflict.name}” — renumber that one first.`); continue }
        try {
          const atCode = ids.find((id) => accounts.find((a) => a.id === id)?.code === std.code)
          const anchorId = atCode ?? ids[0]
          if (atCode) updateAccount(anchorId, { name: std.name })
          else updateAccount(anchorId, { code: std.code, name: std.name })
          let mergedAccts = 0
          let mergedEntries = 0
          for (const id of ids) {
            if (id === anchorId) continue
            mergedEntries += mergeAccounts(id, anchorId)
            mergedAccts++
          }
          out.push(`${std.code} ${std.name}${mergedAccts ? ` · merged ${mergedAccts} account(s), ${mergedEntries} entr${mergedEntries === 1 ? 'y' : 'ies'}` : ' · renumbered'}`)
        } catch (e) {
          out.push(`Failed ${std.code}: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
    } finally {
      setApplying(false)
      setResults(out)
      refresh()
    }
  }

  const targetOptions = (type: AccountType) => STANDARD.filter((s) => s.type === type)

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
          <Wand2 size={22} className="text-sonic-orange" /> Standardize chart
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Loan & inter-entity accounts for <strong>{company?.name}</strong>. Review each row, then apply.
          Only numbers, names, and merges change — <strong>balances are untouched</strong>. Switch company in the
          sidebar to standardize the others. See the plan in <code>docs/CHART_STANDARD.md</code>.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-slate-500">{renames} renumber · {merges} merge · {accounts.length - renames - merges} keep</span>
        <button className="btn-primary ml-auto" disabled={applying || (renames === 0 && merges === 0)} onClick={apply}>
          {applying ? 'Applying…' : 'Apply to this company'}
        </button>
      </div>

      {results && (
        <div className="card space-y-1 p-4">
          <div className="text-sm font-semibold text-slate-700">Done</div>
          <ul className="space-y-0.5 text-sm">
            {results.map((r, i) => (
              <li key={i} className={clsx('flex items-start gap-1.5', r.startsWith('Failed') || r.startsWith('Skipped') ? 'text-amber-700' : 'text-emerald-700')}>
                {r.startsWith('Failed') || r.startsWith('Skipped') ? <AlertTriangle size={13} className="mt-0.5 shrink-0" /> : <CheckCircle2 size={13} className="mt-0.5 shrink-0" />} {r}
              </li>
            ))}
          </ul>
          <Link to="/accounts" className="text-sm text-sonic-orange underline">Back to Chart of Accounts</Link>
        </div>
      )}

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-4 py-2.5">Current account</th>
              <th className="px-2 py-2.5 text-right">Balance</th>
              <th className="px-2 py-2.5">Action</th>
              <th className="px-4 py-2.5">Standardize to</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => {
              const act = actionLabel(a)
              return (
                <tr key={a.id} className="border-b border-slate-50 last:border-0">
                  <td className="px-4 py-2">
                    <span className="font-mono text-xs text-slate-400">{a.code}</span>{' '}
                    <span className="text-slate-800">{a.name}</span>{' '}
                    <span className="text-xs text-slate-400">({TYPE_LABEL[a.type]})</span>
                  </td>
                  <td className="px-2 py-2 text-right"><Money cents={displayBalance(a)} /></td>
                  <td className="px-2 py-2">
                    <span className={clsx('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs',
                      act.kind === 'keep' ? 'bg-slate-100 text-slate-500' : act.kind === 'rename' ? 'bg-sky-50 text-sky-700' : 'bg-amber-50 text-amber-700')}>
                      {act.kind === 'merge' && <ArrowRight size={11} />}{act.kind}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <select
                      className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
                      value={choices[a.id] ?? ''}
                      onChange={(e) => setChoices((prev) => ({ ...prev, [a.id]: e.target.value }))}
                    >
                      <option value="">Keep as-is</option>
                      {targetOptions(a.type).map((s) => (
                        <option key={s.code} value={s.code}>{s.code} · {s.name}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-400">
        Merging moves a duplicate’s transactions into the target and archives the empty account (reversible via the
        audit log). This pass never invents or adjusts balances — adding missing mirror entries (e.g. the ~$112k on the
        King St side) is a separate, reviewed step.
      </p>
    </div>
  )
}
