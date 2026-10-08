import { useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { RotateCcw, CheckCircle2 } from 'lucide-react'
import { useStore } from '../state/store'
import { getBankAccounts } from '../db/repo'
import {
  reconciledBalance,
  unreconciledBankTxns,
  finishReconciliation,
  getReconciliations,
  reopenReconciliation,
} from '../db/reconcile'
import { Money } from '../components/Money'
import { parseMoney, formatMoney } from '../lib/money'
import { todayISO, formatDate, shortDate } from '../lib/format'

export default function StatementRec() {
  const companyId = useStore((s) => s.currentCompanyId)
  const refresh = useStore((s) => s.refresh)
  const rev = useStore((s) => s.rev)

  const banks = companyId != null ? getBankAccounts(companyId) : []
  const [bankId, setBankId] = useState<number | null>(null)
  const [stmtDate, setStmtDate] = useState(todayISO())
  const [endingStr, setEndingStr] = useState('')
  const [cleared, setCleared] = useState<Set<number>>(new Set())
  const [message, setMessage] = useState<string | null>(null)

  const activeBankId = bankId ?? banks[0]?.id ?? null

  const opening = activeBankId != null ? reconciledBalance(companyId!, activeBankId) : 0
  const lines = useMemo(
    () => (activeBankId != null ? unreconciledBankTxns(companyId!, activeBankId, stmtDate) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [companyId, activeBankId, stmtDate, rev],
  )
  const history = activeBankId != null ? getReconciliations(companyId!, activeBankId) : []

  if (companyId == null) return null
  if (banks.length === 0) return <div className="p-6 text-slate-500">No bank accounts yet.</div>

  const ending = parseMoney(endingStr)
  const clearedSum = lines.filter((l) => cleared.has(l.id)).reduce((s, l) => s + l.amount_cents, 0)
  const clearedBalance = opening + clearedSum
  const difference = ending - clearedBalance
  const canFinish = endingStr.trim() !== '' && difference === 0 && cleared.size > 0

  function toggle(id: number) {
    setCleared((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function finish() {
    finishReconciliation({
      companyId: companyId!,
      accountId: activeBankId!,
      statementDate: stmtDate,
      endingBalanceCents: ending,
      clearedIds: [...cleared],
    })
    setCleared(new Set())
    setEndingStr('')
    setMessage(`Reconciled to ${formatDate(stmtDate)}. 🎉`)
    refresh()
  }

  function reopen(id: number, date: string) {
    if (!confirm(`Reopen the reconciliation of ${formatDate(date)}? Its lines will be un-reconciled so you can redo it. This is recorded in the audit log.`)) return
    reopenReconciliation(id)
    setMessage('Reconciliation reopened — its lines are available to reconcile again.')
    refresh()
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Statement Reconciliation</h1>
        {banks.length > 1 && (
          <select
            value={activeBankId ?? ''}
            onChange={(e) => { setBankId(Number(e.target.value)); setCleared(new Set()) }}
            className="rounded-md border border-slate-300 px-2 py-1 text-sm"
          >
            {banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
      </div>

      {message && <div className="rounded-lg bg-brand-50 px-4 py-2 text-sm text-brand-700">{message}</div>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-500">Statement date</span>
          <input type="date" className="w-full rounded-md border border-slate-300 px-3 py-1.5" value={stmtDate} onChange={(e) => setStmtDate(e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-500">Statement ending balance</span>
          <input className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-right" placeholder="0.00" value={endingStr} onChange={(e) => setEndingStr(e.target.value)} />
        </label>
        <div className="text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-500">Cleared balance</span>
          <div className="rounded-md bg-slate-50 px-3 py-1.5 text-right"><Money cents={clearedBalance} /></div>
        </div>
        <div className="text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-500">Difference</span>
          <div className={clsx('rounded-md px-3 py-1.5 text-right font-semibold', difference === 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700')}>
            {formatMoney(difference)}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="text-xs text-slate-400">Opening (previously reconciled): {formatMoney(opening)} · {cleared.size} of {lines.length} selected</div>
        <button className="btn-primary" disabled={!canFinish} onClick={finish}>
          <CheckCircle2 size={16} /> Finish reconciliation
        </button>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="w-10 px-3 py-2"></th>
              <th className="px-2 py-2">Date</th>
              <th className="px-2 py-2">Description</th>
              <th className="px-5 py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 && <tr><td colSpan={4} className="px-5 py-8 text-center text-slate-400">Nothing left to reconcile up to this date.</td></tr>}
            {lines.map((l) => (
              <tr key={l.id} className={clsx('border-b border-slate-50 hover:bg-slate-50', cleared.has(l.id) && 'bg-emerald-50/40')}>
                <td className="px-3 py-1.5"><input type="checkbox" checked={cleared.has(l.id)} onChange={() => toggle(l.id)} /></td>
                <td className="px-2 py-1.5 whitespace-nowrap text-slate-500">{shortDate(l.date)}</td>
                <td className="px-2 py-1.5 text-slate-800">{l.description}</td>
                <td className="px-5 py-1.5 text-right"><Money cents={l.amount_cents} colored /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {history.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Past reconciliations</h2>
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} className="border-b border-slate-50 last:border-0">
                    <td className="px-5 py-2 text-slate-700">{formatDate(h.statement_date)}</td>
                    <td className="px-2 py-2 text-slate-500">{h.cleared_count} lines</td>
                    <td className="px-2 py-2 text-right"><Money cents={h.ending_balance_cents} /></td>
                    <td className="px-2 py-2">
                      {h.status === 'reopened'
                        ? <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700">reopened {h.reopened_at ? '· re-reconciled' : ''}</span>
                        : <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-700">completed</span>}
                    </td>
                    <td className="px-5 py-2 text-right">
                      {h.status === 'completed' && (
                        <button className="btn-ghost px-2 py-1 text-xs text-slate-500" onClick={() => reopen(h.id, h.statement_date)}>
                          <RotateCcw size={13} /> Reopen
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
