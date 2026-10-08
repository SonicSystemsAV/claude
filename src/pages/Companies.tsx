import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { clsx } from 'clsx'
import { Plus, ArrowRight, X, Building2, Link2 } from 'lucide-react'
import { useStore } from '../state/store'
import { companyOverview, getAccounts, getBankAccounts } from '../db/repo'
import { postInterCompany, getInterCompanyLinks, suggestDueAccount } from '../db/intercompany'
import type { Account, Company } from '../db/types'
import { Money } from '../components/Money'
import { parseMoney } from '../lib/money'
import { todayISO, formatDate } from '../lib/format'

type Tab = 'overview' | 'intercompany'

export default function Companies() {
  const companies = useStore((s) => s.companies)
  const setCompany = useStore((s) => s.setCompany)
  const refresh = useStore((s) => s.refresh)
  const rev = useStore((s) => s.rev)
  void rev
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('overview')
  const [showForm, setShowForm] = useState(false)

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Companies</h1>
        {tab === 'intercompany' && companies.length >= 2 && (
          <button className="btn-primary" onClick={() => setShowForm(true)}><Plus size={15} /> Inter-company transaction</button>
        )}
      </div>

      <div className="flex items-center gap-1">
        {([['overview', 'Overview', Building2], ['intercompany', 'Inter-company', Link2]] as const).map(([k, label, Icon]) => (
          <button key={k} onClick={() => setTab(k)} className={clsx('inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition', tab === k ? 'bg-brand-50 text-brand-700' : 'text-slate-500 hover:bg-slate-100')}>
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {tab === 'overview' ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {companies.map((c) => (
            <OverviewCard key={c.id} company={c} onOpen={() => { setCompany(c.id); navigate('/') }} />
          ))}
        </div>
      ) : (
        <InterCompanyList />
      )}

      {showForm && <InterCompanyForm onClose={() => setShowForm(false)} onSaved={refresh} />}
    </div>
  )
}

function OverviewCard({ company, onOpen }: { company: Company; onOpen: () => void }) {
  const o = companyOverview(company.id)
  return (
    <button onClick={onOpen} className="card p-4 text-left transition hover:shadow-md">
      <div className="flex items-center justify-between">
        <span className="text-lg font-semibold text-slate-900">{company.name}</span>
        <ArrowRight size={16} className="text-slate-300" />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
        <Metric label="Cash"><Money cents={o.cash} /></Metric>
        <Metric label="Net income"><Money cents={o.net} colored /></Metric>
        <Metric label="To reconcile"><span className={o.unreconciled ? 'text-amber-600' : 'text-slate-400'}>{o.unreconciled}</span></Metric>
        <Metric label="A/R"><Money cents={o.ar} /></Metric>
        <Metric label="A/P"><Money cents={o.ap} /></Metric>
        <Metric label="Income"><Money cents={o.income} /></Metric>
      </div>
    </button>
  )
}

function Metric({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-0.5 font-semibold text-slate-800">{children}</div>
    </div>
  )
}

function InterCompanyList() {
  const rev = useStore((s) => s.rev)
  void rev
  const links = getInterCompanyLinks()
  return (
    <div className="card overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="px-5 py-2.5">Date</th>
            <th className="px-2 py-2.5">From</th>
            <th className="px-2 py-2.5">To</th>
            <th className="px-2 py-2.5">Memo</th>
            <th className="px-5 py-2.5 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {links.length === 0 && <tr><td colSpan={5} className="px-5 py-8 text-center text-slate-400">No inter-company transactions yet. Both sides post together and stay linked.</td></tr>}
          {links.map((l) => (
            <tr key={l.id} className="border-b border-slate-50 last:border-0">
              <td className="px-5 py-2 whitespace-nowrap text-slate-500">{formatDate(l.date)}</td>
              <td className="px-2 py-2 text-slate-800">{l.from_name}</td>
              <td className="px-2 py-2 text-slate-800">{l.to_name}</td>
              <td className="px-2 py-2 text-slate-500">{l.memo}</td>
              <td className="px-5 py-2 text-right"><Money cents={l.amount_cents} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function AccountSelect({ accounts, value, onChange }: { accounts: Account[]; value: number | ''; onChange: (v: number | '') => void }) {
  return (
    <select className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" value={value} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}>
      <option value="">Account…</option>
      {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
    </select>
  )
}

function InterCompanyForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const companies = useStore((s) => s.companies)
  const current = useStore((s) => s.currentCompanyId)
  const [fromId, setFromId] = useState<number>(current ?? companies[0]?.id ?? 0)
  const [toId, setToId] = useState<number>(companies.find((c) => c.id !== (current ?? companies[0]?.id))?.id ?? 0)
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayISO())
  const [memo, setMemo] = useState('')
  const [error, setError] = useState<string | null>(null)

  const fromAccts = getAccounts(fromId)
  const toAccts = getAccounts(toId)
  const fromName = companies.find((c) => c.id === fromId)?.name ?? ''
  const toName = companies.find((c) => c.id === toId)?.name ?? ''

  const [fromAcct, setFromAcct] = useState<number | ''>(() => getBankAccounts(fromId)[0]?.id ?? '')
  const [fromDue, setFromDue] = useState<number | ''>(() => suggestDueAccount(fromId, toName, 'from') ?? '')
  const [toAcct, setToAcct] = useState<number | ''>('')
  const [toDue, setToDue] = useState<number | ''>(() => suggestDueAccount(toId, fromName, 'to') ?? '')

  function onFrom(id: number) {
    setFromId(id)
    setFromAcct(getBankAccounts(id)[0]?.id ?? '')
    setFromDue(suggestDueAccount(id, toName, 'from') ?? '')
  }
  function onTo(id: number) {
    setToId(id)
    setToDue(suggestDueAccount(id, fromName, 'to') ?? '')
    setToAcct('')
  }

  function save() {
    setError(null)
    const cents = parseMoney(amount)
    if (cents <= 0) { setError('Enter an amount.'); return }
    if (fromAcct === '' || fromDue === '' || toAcct === '' || toDue === '') { setError('Choose all four accounts.'); return }
    try {
      postInterCompany({
        date, amountCents: cents, memo: memo || null,
        from: { companyId: fromId, accountId: Number(fromAcct), dueAccountId: Number(fromDue) },
        to: { companyId: toId, accountId: Number(toAcct), dueAccountId: Number(toDue) },
      })
      onSaved(); onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-slate-900/40 p-4">
      <div className="card my-8 w-full max-w-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h2 className="text-lg font-semibold text-slate-900">Inter-company transaction</h2>
          <button className="btn-ghost p-1" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="space-y-4 p-5">
          <div className="grid grid-cols-3 gap-3">
            <label className="text-sm"><span className="mb-1 block text-xs font-medium text-slate-500">Amount</span>
              <input className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-right" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
            <label className="text-sm"><span className="mb-1 block text-xs font-medium text-slate-500">Date</span>
              <input type="date" className="w-full rounded-md border border-slate-300 px-3 py-1.5" value={date} onChange={(e) => setDate(e.target.value)} /></label>
            <label className="text-sm"><span className="mb-1 block text-xs font-medium text-slate-500">Memo</span>
              <input className="w-full rounded-md border border-slate-300 px-3 py-1.5" value={memo} onChange={(e) => setMemo(e.target.value)} /></label>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2 rounded-lg border border-slate-200 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">From (gives value)</div>
              <select className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" value={fromId} onChange={(e) => onFrom(Number(e.target.value))}>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <div><span className="text-xs text-slate-500">Paid from / source</span><AccountSelect accounts={fromAccts} value={fromAcct} onChange={setFromAcct} /></div>
              <div><span className="text-xs text-slate-500">Records as (Due from {toName})</span><AccountSelect accounts={fromAccts} value={fromDue} onChange={setFromDue} /></div>
            </div>
            <div className="space-y-2 rounded-lg border border-slate-200 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">To (receives value)</div>
              <select className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" value={toId} onChange={(e) => onTo(Number(e.target.value))}>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <div><span className="text-xs text-slate-500">Received as / expense</span><AccountSelect accounts={toAccts} value={toAcct} onChange={setToAcct} /></div>
              <div><span className="text-xs text-slate-500">Records as (Due to {fromName})</span><AccountSelect accounts={toAccts} value={toDue} onChange={setToDue} /></div>
            </div>
          </div>

          {error && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save}>Post both sides</button>
        </div>
      </div>
    </div>
  )
}
