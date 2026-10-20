import { useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { Users, AlertTriangle, Info } from 'lucide-react'
import { useStore } from '../state/store'
import { subledgerByContact, type SubledgerAccount } from '../db/repo'
import { Money } from '../components/Money'
import { formatMoney } from '../lib/money'

/**
 * Receivables & payables broken down by customer / supplier — the sub-ledger
 * QuickBooks shows as a customer or vendor balance. A receivable account can
 * foot to the right GL total while hiding large offsetting per-contact balances
 * (invoices and payments never applied to each other); this surfaces them and
 * flags the wrong-sign ones (a credit sitting in A/R, or a debit in A/P), which
 * are the signature of an unapplied payment.
 */
export default function Subledger() {
  const companyId = useStore((s) => s.currentCompanyId)
  const companies = useStore((s) => s.companies)
  const rev = useStore((s) => s.rev)
  void rev
  const company = companies.find((c) => c.id === companyId)
  const cur = company?.base_currency ?? 'CAD'
  const [asOf, setAsOf] = useState('')

  const data = useMemo(
    () => (companyId ? subledgerByContact(companyId, asOf || undefined) : { receivable: [], payable: [] }),
    [companyId, asOf, rev],
  )

  if (!companyId) return <div className="p-8 text-muted">Select a company first.</div>

  const nothing = data.receivable.length === 0 && data.payable.length === 0

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-1 flex items-center gap-2">
        <Users size={20} className="text-brand-600" />
        <h1 className="section-title text-ink">Receivables & payables by contact</h1>
      </div>
      <p className="mb-4 text-sm text-muted">
        Who owes <span className="font-medium text-ink">{company?.name}</span>, and who it owes — broken out by customer and
        supplier. A total can be correct while the split underneath is a mess.
      </p>

      <div className="mb-4 flex items-center gap-3">
        <label className="text-xs font-medium text-muted">As of</label>
        <input type="date" className="input text-sm" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        <span className="text-xs text-subtle">blank = all time</span>
      </div>

      <div className="mb-5 flex items-start gap-2 rounded-control bg-sky-50 px-3 py-2 text-xs text-sky-800">
        <Info size={14} className="mt-0.5 shrink-0" />
        A <span className="font-semibold">credit balance in A/R</span> (shown negative/red) or a{' '}
        <span className="font-semibold">debit balance in A/P</span> usually means a payment was recorded but never applied to
        an invoice — the balance is real in total but sitting on the wrong contact.
      </div>

      {nothing && <div className="card p-6 text-sm text-muted">No receivable or payable accounts with activity for this company.</div>}

      {data.receivable.map((sa) => <SubledgerCard key={sa.account.id} sa={sa} cur={cur} kind="ar" />)}
      {data.payable.map((sa) => <SubledgerCard key={sa.account.id} sa={sa} cur={cur} kind="ap" />)}
    </div>
  )
}

function SubledgerCard({ sa, cur, kind }: { sa: SubledgerAccount; cur: string; kind: 'ar' | 'ap' }) {
  // Wrong sign: A/R should be a debit (positive); A/P should be a credit (negative).
  const isWrong = (net: number) => (kind === 'ar' ? net < 0 : net > 0)
  const flagged = sa.contacts.filter((c) => isWrong(c.net))
  const flaggedTotal = flagged.reduce((s, c) => s + Math.abs(c.net), 0)

  return (
    <div className="card mb-5 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
        <h2 className="text-sm font-semibold text-ink">
          {sa.account.code ? `${sa.account.code} · ` : ''}{sa.account.name}
        </h2>
        <div className="flex items-center gap-3 text-xs">
          {flagged.length > 0 && (
            <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 font-medium text-amber-700">
              <AlertTriangle size={11} /> {flagged.length} wrong-sign · {formatMoney(flaggedTotal, cur)}
            </span>
          )}
          <span className="text-muted">Total <Money cents={sa.total} currency={cur} colored /></span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-subtle">
            <tr>
              <th className="px-4 py-2 font-medium">Contact</th>
              <th className="px-4 py-2 text-right font-medium">Balance</th>
            </tr>
          </thead>
          <tbody>
            {sa.contacts.map((c, i) => {
              const wrong = isWrong(c.net)
              return (
                <tr key={i} className={clsx('border-t border-slate-50', wrong && 'bg-amber-50/50')}>
                  <td className="px-4 py-1.5">
                    <span className="text-ink">{c.contactName}</span>
                    {wrong && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-700">unapplied?</span>}
                  </td>
                  <td className="px-4 py-1.5 text-right"><Money cents={c.net} currency={cur} colored /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
