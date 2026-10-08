import { useState } from 'react'
import { clsx } from 'clsx'
import { useStore } from '../state/store'
import {
  getTaxMap,
  setTaxMapping,
  gifiIncomeStatement,
  gifiBalanceSheet,
  t2125Summary,
  type CodeTotal,
} from '../db/taxReports'
import { GIFI_INCOME, GIFI_BALANCE, T2125_INCOME, T2125_EXPENSE } from '../db/taxCodes'
import { Money } from '../components/Money'
import { formatMoney } from '../lib/money'
import { todayISO } from '../lib/format'
import type { AccountType } from '../db/types'

type View = 't2125' | 'gifi_is' | 'gifi_bs' | 'mapping'
const VIEWS: { key: View; label: string }[] = [
  { key: 't2125', label: 'T2125 (T1)' },
  { key: 'gifi_is', label: 'GIFI Income Statement' },
  { key: 'gifi_bs', label: 'GIFI Balance Sheet' },
  { key: 'mapping', label: 'Account Mapping' },
]

export default function Tax() {
  const companyId = useStore((s) => s.currentCompanyId)
  const refresh = useStore((s) => s.refresh)
  const rev = useStore((s) => s.rev)
  void rev
  const [view, setView] = useState<View>('t2125')
  const thisYear = new Date().getFullYear()
  const [start, setStart] = useState(`${thisYear}-01-01`)
  const [end, setEnd] = useState(todayISO())
  const [asOf, setAsOf] = useState(todayISO())
  if (companyId == null) return null

  const usesRange = view === 't2125' || view === 'gifi_is'
  const needsDate = view !== 'mapping'

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Tax</h1>
        <p className="text-sm text-slate-500">Figures organized for your UFile entry. Not filing advice.</p>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            onClick={() => setView(v.key)}
            className={clsx('rounded-md px-3 py-1.5 text-sm font-medium transition', view === v.key ? 'bg-brand-50 text-brand-700' : 'text-slate-500 hover:bg-slate-100')}
          >
            {v.label}
          </button>
        ))}
      </div>

      {needsDate && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 px-4 py-2 text-sm">
          {usesRange ? (
            <>
              <label className="flex items-center gap-2"><span className="text-slate-500">From</span>
                <input type="date" className="rounded-md border border-slate-300 px-2 py-1" value={start} onChange={(e) => setStart(e.target.value)} /></label>
              <label className="flex items-center gap-2"><span className="text-slate-500">To</span>
                <input type="date" className="rounded-md border border-slate-300 px-2 py-1" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
              <div className="flex gap-1">
                <button className="btn-ghost px-2 py-1 text-xs" onClick={() => { setStart(`${thisYear}-01-01`); setEnd(todayISO()) }}>This year</button>
                <button className="btn-ghost px-2 py-1 text-xs" onClick={() => { setStart(`${thisYear - 1}-01-01`); setEnd(`${thisYear - 1}-12-31`) }}>Last year</button>
                <button className="btn-ghost px-2 py-1 text-xs" onClick={() => { setStart('2000-01-01'); setEnd(todayISO()) }}>All dates</button>
              </div>
            </>
          ) : (
            <label className="flex items-center gap-2"><span className="text-slate-500">As of</span>
              <input type="date" className="rounded-md border border-slate-300 px-2 py-1" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></label>
          )}
        </div>
      )}

      {view === 't2125' && <T2125View companyId={companyId} start={start} end={end} />}
      {view === 'gifi_is' && <GifiIncomeView companyId={companyId} start={start} end={end} />}
      {view === 'gifi_bs' && <GifiBalanceView companyId={companyId} asOf={asOf} />}
      {view === 'mapping' && <MappingView companyId={companyId} onChange={refresh} />}
    </div>
  )
}

function CodeRows({ rows }: { rows: CodeTotal[] }) {
  return (
    <>
      {rows.map((r) => (
        <div key={r.code} className="flex items-center justify-between px-5 py-1.5" title={r.accounts.join(', ')}>
          <span className="text-slate-600"><span className="font-mono text-xs text-slate-400">{r.code}</span> {r.label}</span>
          <Money cents={r.amount} />
        </div>
      ))}
    </>
  )
}

function TotalRow({ label, cents }: { label: string; cents: number }) {
  return (
    <div className="flex items-center justify-between px-5 py-2 font-semibold text-slate-900">
      <span>{label}</span><Money cents={cents} />
    </div>
  )
}

function T2125View({ companyId, start, end }: { companyId: number; start: string; end: string }) {
  const t = t2125Summary(companyId, start, end)
  return (
    <div className="card divide-y divide-slate-100 py-2">
      <div className="px-5 py-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Business income</div>
      <CodeRows rows={t.income} />
      <TotalRow label="8299 Gross business income" cents={t.grossIncome} />
      <div className="px-5 py-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Expenses</div>
      <CodeRows rows={t.expenses} />
      <TotalRow label="9368 Total expenses" cents={t.totalExpenses} />
      <TotalRow label="9369 Net income (before adjustments)" cents={t.netIncome} />
      <div className="px-5 py-2 text-xs text-slate-400">
        Enter line 8523 (meals) at full value — UFile applies the 50% limit. CCA (9936) is computed separately.
      </div>
    </div>
  )
}

function GifiIncomeView({ companyId, start, end }: { companyId: number; start: string; end: string }) {
  const g = gifiIncomeStatement(companyId, start, end)
  return (
    <div className="card divide-y divide-slate-100 py-2">
      <div className="px-5 py-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Revenue</div>
      <CodeRows rows={g.revenue} />
      <TotalRow label="8299 Total revenue" cents={g.totalRevenue} />
      {g.costOfSales.length > 0 && (
        <>
          <div className="px-5 py-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Cost of sales</div>
          <CodeRows rows={g.costOfSales} />
          <TotalRow label="8518 Total cost of sales" cents={g.totalCostOfSales} />
        </>
      )}
      <div className="px-5 py-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Operating expenses</div>
      <CodeRows rows={g.expenses} />
      <TotalRow label="9368 Total operating expenses" cents={g.totalExpenses} />
      <TotalRow label="9999 Net income (loss)" cents={g.netIncome} />
    </div>
  )
}

function GifiBalanceView({ companyId, asOf }: { companyId: number; asOf: string }) {
  const g = gifiBalanceSheet(companyId, asOf)
  const le = g.totalLiabilities + g.totalEquity
  return (
    <div className="card divide-y divide-slate-100 py-2">
      <div className="px-5 py-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Assets</div>
      <CodeRows rows={g.assets} />
      <TotalRow label="2599 Total assets" cents={g.totalAssets} />
      <div className="px-5 py-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Liabilities</div>
      <CodeRows rows={g.liabilities} />
      <TotalRow label="3499 Total liabilities" cents={g.totalLiabilities} />
      <div className="px-5 py-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Equity</div>
      <CodeRows rows={g.equity} />
      <TotalRow label="3620 Total equity" cents={g.totalEquity} />
      <TotalRow label="Total liabilities & equity" cents={le} />
      {Math.abs(g.totalAssets - le) >= 1 && (
        <div className="px-5 py-2 text-xs text-amber-600">Assets and liabilities+equity differ by {formatMoney(g.totalAssets - le)} — check unmapped accounts in Account Mapping.</div>
      )}
    </div>
  )
}

const TYPE_LABEL: Record<AccountType, string> = {
  asset: 'Assets', liability: 'Liabilities', equity: 'Equity', income: 'Income', expense: 'Expenses',
}

function MappingView({ companyId, onChange }: { companyId: number; onChange: () => void }) {
  const map = getTaxMap(companyId)
  const gifiOpts = [...GIFI_INCOME, ...GIFI_BALANCE]
  const t2125Opts = [...T2125_INCOME, ...T2125_EXPENSE]

  return (
    <div className="space-y-2">
      <p className="text-sm text-slate-500">
        Auto-suggested from account names. Override any row; blank reverts to the suggestion. Overrides are saved.
      </p>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-5 py-2.5">Account</th>
              <th className="px-2 py-2.5">GIFI (T2)</th>
              <th className="px-2 py-2.5">T2125 (T1)</th>
            </tr>
          </thead>
          <tbody>
            {map.map((e) => (
              <tr key={e.account.id} className="border-b border-slate-50 last:border-0">
                <td className="px-5 py-1.5 text-slate-700">
                  <span className="font-mono text-xs text-slate-400">{e.account.code}</span> {e.account.name}
                  <span className="ml-2 text-xs text-slate-300">{TYPE_LABEL[e.account.type]}</span>
                </td>
                <td className="px-2 py-1.5">
                  <select
                    className={clsx('rounded-md border px-2 py-1 text-xs', e.gifi_overridden ? 'border-brand-300 bg-brand-50' : 'border-slate-200')}
                    value={e.gifi_code}
                    onChange={(ev) => { setTaxMapping(companyId, e.account.id, { gifi_code: ev.target.value }); onChange() }}
                  >
                    {gifiOpts.map((o) => <option key={o.code} value={o.code}>{o.code} {o.label}</option>)}
                  </select>
                </td>
                <td className="px-2 py-1.5">
                  <select
                    className={clsx('rounded-md border px-2 py-1 text-xs', e.t2125_overridden ? 'border-brand-300 bg-brand-50' : 'border-slate-200')}
                    value={e.t2125_line ?? ''}
                    onChange={(ev) => { setTaxMapping(companyId, e.account.id, { t2125_line: ev.target.value || null }); onChange() }}
                  >
                    <option value="">—</option>
                    {t2125Opts.map((o) => <option key={o.code} value={o.code}>{o.code} {o.label}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
