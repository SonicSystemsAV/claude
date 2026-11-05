import { useState } from 'react'
import { clsx } from 'clsx'
import { Star, Save, Trash2 } from 'lucide-react'
import { useStore } from '../state/store'
import {
  profitAndLossRange,
  balanceSheet,
  trialBalanceAsOf,
  gstHstReturn,
  generalLedger,
  salesByCustomer,
  getAccounts,
} from '../db/repo'
import { aging, type AgingBuckets } from '../db/documents'
import { Money } from '../components/Money'
import { formatMoney } from '../lib/money'
import ExportButtons from '../components/ExportButtons'
import type { ExportTable } from '../lib/exporters'
import { formatDate, todayISO } from '../lib/format'

type Report = 'pnl' | 'balance' | 'trial' | 'ledger' | 'sales' | 'ar_aging' | 'ap_aging' | 'gst'
const REPORTS: { key: Report; label: string }[] = [
  { key: 'pnl', label: 'Profit & Loss' },
  { key: 'balance', label: 'Balance Sheet' },
  { key: 'trial', label: 'Trial Balance' },
  { key: 'ledger', label: 'General Ledger' },
  { key: 'sales', label: 'Sales by Customer' },
  { key: 'ar_aging', label: 'A/R Aging' },
  { key: 'ap_aging', label: 'A/P Aging' },
  { key: 'gst', label: 'GST/HST Return' },
]
const REPORT_LABEL: Record<Report, string> = Object.fromEntries(REPORTS.map((r) => [r.key, r.label])) as Record<Report, string>

/** A saved custom report — the report type plus its current settings. */
interface SavedReport {
  id: string
  name: string
  report: Report
  start: string
  end: string
  asOf: string
  ledgerAccountId: number | ''
}
const SAVED_KEY = (companyId: number) => `sonic.savedReports.${companyId}`
function loadSaved(companyId: number): SavedReport[] {
  try { return JSON.parse(localStorage.getItem(SAVED_KEY(companyId)) ?? '[]') } catch { return [] }
}
function storeSaved(companyId: number, list: SavedReport[]) {
  try { localStorage.setItem(SAVED_KEY(companyId), JSON.stringify(list)) } catch { /* ignore */ }
}

const usesRange = (r: Report) => r === 'pnl' || r === 'gst' || r === 'sales' || r === 'ledger'

export default function Reports() {
  const companyId = useStore((s) => s.currentCompanyId)
  const companies = useStore((s) => s.companies)
  const rev = useStore((s) => s.rev)
  void rev
  const [report, setReport] = useState<Report>('pnl')
  const thisYear = new Date().getFullYear()
  const [start, setStart] = useState(`${thisYear}-01-01`)
  const [end, setEnd] = useState(todayISO())
  const [asOf, setAsOf] = useState(todayISO())
  const [ledgerAccountId, setLedgerAccountId] = useState<number | ''>('')
  const [saved, setSaved] = useState<SavedReport[]>(() => (companyId ? loadSaved(companyId) : []))
  if (companyId == null) return null

  const company = companies.find((c) => c.id === companyId)
  const opts = { start, end, asOf, ledgerAccountId }

  function saveCurrent() {
    const name = window.prompt('Name this report', `${REPORT_LABEL[report]} — ${usesRange(report) ? `${start}…${end}` : asOf}`)
    if (!name || !companyId) return
    const entry: SavedReport = { id: String(Date.now()), name: name.trim(), report, start, end, asOf, ledgerAccountId }
    const next = [...saved, entry]
    setSaved(next); storeSaved(companyId, next)
  }
  function applySaved(s: SavedReport) {
    setReport(s.report); setStart(s.start); setEnd(s.end); setAsOf(s.asOf); setLedgerAccountId(s.ledgerAccountId)
  }
  function removeSaved(id: string) {
    if (!companyId) return
    const next = saved.filter((s) => s.id !== id)
    setSaved(next); storeSaved(companyId, next)
  }

  const buildExport = (): ExportTable => buildReportExport(report, companyId, opts, company?.name ?? '')

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-slate-900">Reports</h1>
        <div className="flex items-center gap-2">
          <button className="btn-ghost flex items-center gap-1.5 text-sm" onClick={saveCurrent} title="Save this report with its current dates/options">
            <Save size={15} /> Save report
          </button>
          <ExportButtons build={buildExport} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        {REPORTS.map((r) => (
          <button
            key={r.key}
            onClick={() => setReport(r.key)}
            className={clsx(
              'rounded-md px-3 py-1.5 text-sm font-medium transition',
              report === r.key ? 'bg-brand-50 text-brand-700' : 'text-slate-500 hover:bg-slate-100',
            )}
          >
            {r.label}
          </button>
        ))}
      </div>

      {saved.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-slate-400">Saved:</span>
          {saved.map((s) => (
            <span key={s.id} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white py-0.5 pl-2 pr-1 text-xs">
              <button className="inline-flex items-center gap-1 text-slate-600 hover:text-brand-600" onClick={() => applySaved(s)}>
                <Star size={11} className="text-amber-400" /> {s.name}
              </button>
              <button className="text-slate-300 hover:text-rose-600" title="Delete saved report" onClick={() => removeSaved(s.id)}><Trash2 size={11} /></button>
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 px-4 py-2 text-sm">
        {usesRange(report) ? (
          <>
            <label className="flex items-center gap-2">
              <span className="text-slate-500">From</span>
              <input type="date" className="rounded-md border border-slate-300 px-2 py-1" value={start} onChange={(e) => setStart(e.target.value)} />
            </label>
            <label className="flex items-center gap-2">
              <span className="text-slate-500">To</span>
              <input type="date" className="rounded-md border border-slate-300 px-2 py-1" value={end} onChange={(e) => setEnd(e.target.value)} />
            </label>
            <div className="flex gap-1">
              <button className="btn-ghost px-2 py-1 text-xs" onClick={() => { setStart(`${thisYear}-01-01`); setEnd(todayISO()) }}>This year</button>
              <button className="btn-ghost px-2 py-1 text-xs" onClick={() => { setStart(`${thisYear - 1}-01-01`); setEnd(`${thisYear - 1}-12-31`) }}>Last year</button>
              <button className="btn-ghost px-2 py-1 text-xs" onClick={() => { setStart('2000-01-01'); setEnd(todayISO()) }}>All dates</button>
            </div>
          </>
        ) : (
          <label className="flex items-center gap-2">
            <span className="text-slate-500">As of</span>
            <input type="date" className="rounded-md border border-slate-300 px-2 py-1" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
          </label>
        )}
        {report === 'ledger' && (
          <label className="flex items-center gap-2">
            <span className="text-slate-500">Account</span>
            <select
              className="rounded-md border border-slate-300 px-2 py-1"
              value={ledgerAccountId}
              onChange={(e) => setLedgerAccountId(e.target.value === '' ? '' : Number(e.target.value))}
            >
              <option value="">Choose…</option>
              {getAccounts(companyId).map((a) => (
                <option key={a.id} value={a.id}>{a.code} {a.name}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      {report === 'pnl' && <PnlReport companyId={companyId} start={start} end={end} />}
      {report === 'ledger' && <LedgerReport companyId={companyId} accountId={ledgerAccountId} start={start} end={end} />}
      {report === 'sales' && <SalesReport companyId={companyId} start={start} end={end} />}
      {report === 'balance' && <BalanceReport companyId={companyId} asOf={asOf} />}
      {report === 'trial' && <TrialReport companyId={companyId} asOf={asOf} />}
      {report === 'ar_aging' && <AgingReport companyId={companyId} which="ar" asOf={asOf} />}
      {report === 'ap_aging' && <AgingReport companyId={companyId} which="ap" asOf={asOf} />}
      {report === 'gst' && <GstReport companyId={companyId} start={start} end={end} />}
    </div>
  )
}

// ---- Export builder (CSV / Excel / PDF via ExportButtons) -------------------

const d = (cents: number) => (cents / 100).toFixed(2)

function buildReportExport(
  report: Report,
  companyId: number,
  o: { start: string; end: string; asOf: string; ledgerAccountId: number | '' },
  companyName: string,
): ExportTable {
  const base = (name: string, period: string): Pick<ExportTable, 'filename' | 'title'> => ({
    filename: `${name}-${companyName.replace(/[^a-z0-9]+/gi, '_')}`,
    title: `${REPORT_LABEL[report]} — ${companyName} (${period})`,
  })
  if (report === 'pnl') {
    const p = profitAndLossRange(companyId, o.start, o.end)
    const rows: (string | number)[][] = []
    for (const r of p.income) rows.push(['Income', `${r.account.code} ${r.account.name}`, d(r.amount)])
    rows.push(['', 'Total income', d(p.totalIncome)])
    for (const r of p.expenses) rows.push(['Expense', `${r.account.code} ${r.account.name}`, d(r.amount)])
    rows.push(['', 'Total expenses', d(p.totalExpense)])
    rows.push(['', 'Net income', d(p.net)])
    return { ...base('profit-and-loss', `${o.start}…${o.end}`), headers: ['Section', 'Account', 'Amount'], align: ['left', 'left', 'right'], rows }
  }
  if (report === 'balance') {
    const b = balanceSheet(companyId, o.asOf)
    const rows: (string | number)[][] = []
    for (const r of b.assets) rows.push(['Asset', `${r.account.code} ${r.account.name}`, d(r.amount)])
    rows.push(['', 'Total assets', d(b.totalAssets)])
    for (const r of b.liabilities) rows.push(['Liability', `${r.account.code} ${r.account.name}`, d(r.amount)])
    rows.push(['', 'Total liabilities', d(b.totalLiabilities)])
    for (const r of b.equity) rows.push(['Equity', `${r.account.code} ${r.account.name}`, d(r.amount)])
    rows.push(['Equity', 'Net income (accumulated)', d(b.netIncome)])
    rows.push(['', 'Total liabilities & equity', d(b.totalLiabEquity)])
    return { ...base('balance-sheet', `as of ${o.asOf}`), headers: ['Section', 'Account', 'Amount'], align: ['left', 'left', 'right'], rows }
  }
  if (report === 'trial') {
    const rows = trialBalanceAsOf(companyId, o.asOf)
    const td = rows.reduce((s, r) => s + r.debit, 0), tc = rows.reduce((s, r) => s + r.credit, 0)
    return {
      ...base('trial-balance', `as of ${o.asOf}`),
      headers: ['Account', 'Debit', 'Credit'], align: ['left', 'right', 'right'],
      rows: [...rows.map((r) => [`${r.account.code} ${r.account.name}`, r.debit ? d(r.debit) : '', r.credit ? d(r.credit) : '']), ['Total', d(td), d(tc)]],
    }
  }
  if (report === 'ledger') {
    if (o.ledgerAccountId === '') return { ...base('general-ledger', `${o.start}…${o.end}`), headers: ['Date', 'Description', 'Contact', 'Reference', 'Amount', 'Balance'], rows: [] }
    const { opening, rows, closing } = generalLedger(companyId, Number(o.ledgerAccountId), o.start, o.end)
    const acct = getAccounts(companyId).find((a) => a.id === Number(o.ledgerAccountId))
    return {
      ...base(`ledger-${acct?.code ?? o.ledgerAccountId}`, `${o.start}…${o.end}`),
      headers: ['Date', 'Description', 'Contact', 'Reference', 'Amount', 'Balance'],
      align: ['left', 'left', 'left', 'left', 'right', 'right'],
      rows: [
        ['', 'Opening balance', '', '', '', d(opening)],
        ...rows.map((r) => [r.date, r.memo ?? '', r.contact_name ?? '', r.reference ?? '', d(r.amount_cents), d(r.running)]),
        ['', 'Closing balance', '', '', '', d(closing)],
      ],
    }
  }
  if (report === 'sales') {
    const rows = salesByCustomer(companyId, o.start, o.end)
    return {
      ...base('sales-by-customer', `${o.start}…${o.end}`),
      headers: ['Customer', 'Transactions', 'Revenue'], align: ['left', 'right', 'right'],
      rows: rows.map((r) => [r.name, r.txns, d(r.revenue)]),
    }
  }
  if (report === 'ar_aging' || report === 'ap_aging') {
    const which = report === 'ar_aging' ? 'ar' : 'ap'
    const { rows } = aging(companyId, which, o.asOf)
    return {
      ...base(report, `as of ${o.asOf}`),
      headers: [which === 'ar' ? 'Customer' : 'Supplier', 'Number', 'Due', 'Days overdue', 'Balance'],
      align: ['left', 'left', 'left', 'right', 'right'],
      rows: rows.map((r) => [r.contact_name ?? '', r.number, r.due_date ?? r.date, r.days_overdue || '', d(r.balance_cents)]),
    }
  }
  // gst
  const g = gstHstReturn(companyId, o.start, o.end)
  return {
    ...base('gst-hst-return', `${o.start}…${o.end}`),
    headers: ['Line', 'Description', 'Amount'], align: ['left', 'left', 'right'],
    rows: [
      ['101', 'Sales & other revenue', d(g.line101_revenue)],
      ['103', 'GST/HST collected on sales', d(g.line103_collected)],
      ['106', 'Input tax credits (ITCs)', d(g.line106_itc)],
      ['109', `Net tax — ${g.line109_netTax >= 0 ? 'to remit' : 'refund'}`, d(Math.abs(g.line109_netTax))],
    ],
  }
}

// ---- Sub-reports (display) --------------------------------------------------

function GstReport({ companyId, start, end }: { companyId: number; start: string; end: string }) {
  const g = gstHstReturn(companyId, start, end)
  const remit = g.line109_netTax >= 0
  return (
    <div className="space-y-4">
      {g.taxAccounts.length === 0 && (
        <div className="rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-700">
          No GST/HST account found in this company — figures below show revenue only.
        </div>
      )}
      <div className="card divide-y divide-slate-100 py-2">
        <div className="flex items-center justify-between px-5 py-2">
          <div><span className="font-mono text-xs text-slate-400">101</span> Sales &amp; other revenue</div>
          <Money cents={g.line101_revenue} />
        </div>
        <div className="flex items-center justify-between px-5 py-2">
          <div><span className="font-mono text-xs text-slate-400">103</span> GST/HST collected on sales</div>
          <Money cents={g.line103_collected} />
        </div>
        <div className="flex items-center justify-between px-5 py-2">
          <div><span className="font-mono text-xs text-slate-400">106</span> Input tax credits (ITCs)</div>
          <Money cents={g.line106_itc} />
        </div>
        <div className="flex items-center justify-between bg-slate-50 px-5 py-3 text-base font-semibold text-slate-900">
          <div>
            <span className="font-mono text-xs text-slate-400">109</span> Net tax —{' '}
            <span className={remit ? 'text-rose-600' : 'text-emerald-600'}>{remit ? 'to remit' : 'refund'}</span>
          </div>
          <Money cents={Math.abs(g.line109_netTax)} />
        </div>
      </div>
      <p className="text-xs text-slate-400">
        Computed from ledger postings to your GST/HST account{g.taxAccounts.length > 1 ? 's' : ''} for the selected period.
        Line 101 is total revenue — adjust for any exempt or zero-rated sales before filing. Not a substitute for filing advice.
      </p>
    </div>
  )
}

function LedgerReport({ companyId, accountId, start, end }: { companyId: number; accountId: number | ''; start: string; end: string }) {
  if (accountId === '') {
    return <div className="card p-8 text-center text-slate-400">Choose an account above to see its ledger.</div>
  }
  const { opening, rows, closing } = generalLedger(companyId, Number(accountId), start, end)
  const acct = getAccounts(companyId).find((a) => a.id === Number(accountId))
  return (
    <div className="space-y-3">
      <div className="text-sm font-medium text-slate-700">{acct ? `${acct.code} ${acct.name}` : ''}</div>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-5 py-2.5">Date</th>
              <th className="px-2 py-2.5">Description</th>
              <th className="px-2 py-2.5">Contact</th>
              <th className="px-2 py-2.5 text-right">Amount</th>
              <th className="px-5 py-2.5 text-right">Balance</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-slate-100 bg-slate-50/50 text-slate-500">
              <td className="px-5 py-1.5" colSpan={3}>Opening balance</td>
              <td></td>
              <td className="px-5 py-1.5 text-right"><Money cents={opening} /></td>
            </tr>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-slate-50">
                <td className="px-5 py-1.5 whitespace-nowrap text-slate-500">{formatDate(r.date)}</td>
                <td className="px-2 py-1.5 text-slate-700">{r.memo}</td>
                <td className="px-2 py-1.5 text-slate-500">{r.contact_name}</td>
                <td className="px-2 py-1.5 text-right"><Money cents={r.amount_cents} colored /></td>
                <td className="px-5 py-1.5 text-right"><Money cents={r.running} /></td>
              </tr>
            ))}
            <tr className="border-t-2 border-slate-200 font-semibold">
              <td className="px-5 py-2" colSpan={3}>Closing balance</td>
              <td></td>
              <td className="px-5 py-2 text-right"><Money cents={closing} /></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SalesReport({ companyId, start, end }: { companyId: number; start: string; end: string }) {
  const rows = salesByCustomer(companyId, start, end)
  const total = rows.reduce((s, r) => s + r.revenue, 0)
  return (
    <div className="card overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="px-5 py-2.5">Customer</th>
            <th className="px-2 py-2.5 text-right">Transactions</th>
            <th className="px-5 py-2.5 text-right">Revenue</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={3} className="px-5 py-8 text-center text-slate-400">No sales in this period.</td></tr>}
          {rows.map((r) => (
            <tr key={r.contact_id} className="border-b border-slate-50 last:border-0">
              <td className="px-5 py-1.5 text-slate-800">{r.name}</td>
              <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">{r.txns}</td>
              <td className="px-5 py-1.5 text-right"><Money cents={r.revenue} /></td>
            </tr>
          ))}
          <tr className="border-t-2 border-slate-200 font-semibold">
            <td className="px-5 py-2">Total</td>
            <td></td>
            <td className="px-5 py-2 text-right"><Money cents={total} /></td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function Row({ label, cents, bold, indent }: { label: string; cents: number; bold?: boolean; indent?: boolean }) {
  return (
    <div className={clsx('flex items-center justify-between px-5 py-1.5', bold && 'font-semibold text-slate-900', !bold && 'text-slate-600', indent && 'pl-9')}>
      <span>{label}</span>
      <Money cents={cents} />
    </div>
  )
}

function PnlReport({ companyId, start, end }: { companyId: number; start: string; end: string }) {
  const p = profitAndLossRange(companyId, start, end)
  return (
    <div className="card divide-y divide-slate-100 py-2">
      <div className="px-5 py-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Income</div>
      {p.income.map((r) => <Row key={r.account.id} label={`${r.account.code} ${r.account.name}`} cents={r.amount} indent />)}
      <Row label="Total income" cents={p.totalIncome} bold />
      <div className="px-5 py-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Expenses</div>
      {p.expenses.map((r) => <Row key={r.account.id} label={`${r.account.code} ${r.account.name}`} cents={r.amount} indent />)}
      <Row label="Total expenses" cents={p.totalExpense} bold />
      <Row label="Net income" cents={p.net} bold />
    </div>
  )
}

function BalanceReport({ companyId, asOf }: { companyId: number; asOf: string }) {
  const b = balanceSheet(companyId, asOf)
  return (
    <div className="space-y-2">
      <div className="card divide-y divide-slate-100 py-2">
        <div className="px-5 py-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Assets</div>
        {b.assets.map((r) => <Row key={r.account.id} label={`${r.account.code} ${r.account.name}`} cents={r.amount} indent />)}
        <Row label="Total assets" cents={b.totalAssets} bold />
        <div className="px-5 py-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Liabilities</div>
        {b.liabilities.map((r) => <Row key={r.account.id} label={`${r.account.code} ${r.account.name}`} cents={r.amount} indent />)}
        <Row label="Total liabilities" cents={b.totalLiabilities} bold />
        <div className="px-5 py-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Equity</div>
        {b.equity.map((r) => <Row key={r.account.id} label={`${r.account.code} ${r.account.name}`} cents={r.amount} indent />)}
        <Row label="Net income (accumulated — prior years + current)" cents={b.netIncome} indent />
        <Row label="Total liabilities & equity" cents={b.totalLiabEquity} bold />
        {!b.balanced && (
          <div className="px-5 py-2 text-xs text-amber-600">
            Note: assets and liabilities+equity differ by {formatMoney(b.totalAssets - b.totalLiabEquity)}.
          </div>
        )}
      </div>
      <p className="px-1 text-xs text-slate-400">
        This ledger has no fiscal-year close, so prior-year earnings aren't split into a separate “Retained Earnings” line —
        they're combined with the current period in “Net income (accumulated)”. QuickBooks shows them separately, so the equity
        <em> breakdown</em> looks different even when the totals agree. Use “Verify vs QBO” to compare account by account.
      </p>
    </div>
  )
}

function TrialReport({ companyId, asOf }: { companyId: number; asOf: string }) {
  const rows = trialBalanceAsOf(companyId, asOf)
  const td = rows.reduce((s, r) => s + r.debit, 0)
  const tc = rows.reduce((s, r) => s + r.credit, 0)
  return (
    <div className="card overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="px-5 py-2.5">Account</th>
            <th className="px-2 py-2.5 text-right">Debit</th>
            <th className="px-5 py-2.5 text-right">Credit</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.account.id} className="border-b border-slate-50 last:border-0">
              <td className="px-5 py-1.5 text-slate-700"><span className="font-mono text-xs text-slate-400">{r.account.code}</span> {r.account.name}</td>
              <td className="px-2 py-1.5 text-right">{r.debit ? formatMoney(r.debit) : ''}</td>
              <td className="px-5 py-1.5 text-right">{r.credit ? formatMoney(r.credit) : ''}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-slate-200 font-semibold">
            <td className="px-5 py-2">Total</td>
            <td className="px-2 py-2 text-right">{formatMoney(td)}</td>
            <td className="px-5 py-2 text-right">{formatMoney(tc)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

const BUCKETS: { key: keyof AgingBuckets; label: string }[] = [
  { key: 'current', label: 'Current' },
  { key: 'd1_30', label: '1–30' },
  { key: 'd31_60', label: '31–60' },
  { key: 'd61_90', label: '61–90' },
  { key: 'd90_plus', label: '90+' },
]

function AgingReport({ companyId, which, asOf }: { companyId: number; which: 'ar' | 'ap'; asOf: string }) {
  const { rows, totals } = aging(companyId, which, asOf)
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-6 gap-2">
        {BUCKETS.map((b) => (
          <div key={b.key} className="card p-3 text-center">
            <div className="text-xs text-slate-400">{b.label}</div>
            <div className="mt-1 text-sm font-semibold"><Money cents={totals[b.key]} /></div>
          </div>
        ))}
        <div className="card bg-brand-50 p-3 text-center">
          <div className="text-xs text-brand-500">Total</div>
          <div className="mt-1 text-sm font-semibold text-brand-700"><Money cents={totals.total} /></div>
        </div>
      </div>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-5 py-2.5">{which === 'ar' ? 'Customer' : 'Supplier'}</th>
              <th className="px-2 py-2.5">#</th>
              <th className="px-2 py-2.5">Due</th>
              <th className="px-2 py-2.5 text-right">Days</th>
              <th className="px-5 py-2.5 text-right">Balance</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-5 py-8 text-center text-slate-400">Nothing outstanding. 🎉</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-slate-50 last:border-0">
                <td className="px-5 py-1.5 text-slate-800">{r.contact_name ?? '—'}</td>
                <td className="px-2 py-1.5 font-mono text-xs text-slate-400">{r.number}</td>
                <td className="px-2 py-1.5 text-slate-500">{r.due_date ?? r.date}</td>
                <td className="px-2 py-1.5 text-right text-slate-500">{r.days_overdue || ''}</td>
                <td className="px-5 py-1.5 text-right"><Money cents={r.balance_cents} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
