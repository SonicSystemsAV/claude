import { Link } from 'react-router-dom'
import { clsx } from 'clsx'
import { Landmark, Scale, TrendingUp, TrendingDown } from 'lucide-react'
import { useStore, useCan } from '../state/store'
import {
  getBankAccounts,
  displayBalance,
  countUnmatched,
  profitAndLoss,
  getTransactions,
  getCompany,
} from '../db/repo'
import { Money } from '../components/Money'
import { useTransactionOpener } from '../components/useTransactionOpener'
import { formatDate } from '../lib/format'

export default function Dashboard() {
  const companyId = useStore((s) => s.currentCompanyId)
  const rev = useStore((s) => s.rev)
  const refresh = useStore((s) => s.refresh)
  const canEdit = useCan('edit')
  void rev
  const { openTransaction, element: openerEl } = useTransactionOpener(companyId ?? 0, refresh)
  if (companyId == null) return null

  const company = getCompany(companyId)
  const banks = getBankAccounts(companyId)
  const cash = banks.reduce((s, a) => s + displayBalance(a), 0)
  const unmatched = countUnmatched(companyId)
  const pnl = profitAndLoss(companyId)
  const recent = getTransactions(companyId, { limit: 8 })

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{company?.name}</h1>
        <p className="text-sm text-slate-500">Here's where things stand.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={<Landmark size={18} />} label="Cash on hand" tone="brand">
          <Money cents={cash} />
        </StatCard>
        <StatCard icon={<TrendingUp size={18} />} label="Income" tone="emerald">
          <Money cents={pnl.totalIncome} />
        </StatCard>
        <StatCard icon={<TrendingDown size={18} />} label="Expenses" tone="rose">
          <Money cents={pnl.totalExpense} />
        </StatCard>
        <Link to="/reconcile" className="block">
          <StatCard icon={<Scale size={18} />} label="To reconcile" tone="amber" hover>
            <span className={unmatched > 0 ? 'text-amber-600' : 'text-slate-400'}>
              {unmatched} {unmatched === 1 ? 'item' : 'items'}
            </span>
          </StatCard>
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="card lg:col-span-3">
          <div className="border-b border-slate-100 px-5 py-3 text-sm font-semibold text-slate-700">
            Recent transactions
          </div>
          <table className="w-full text-sm">
            <tbody>
              {recent.length === 0 && (
                <tr>
                  <td className="px-5 py-6 text-center text-slate-400">No transactions yet.</td>
                </tr>
              )}
              {recent.map((t) => {
                const total = t.entries
                  .filter((e) => e.amount_cents > 0)
                  .reduce((s, e) => s + e.amount_cents, 0)
                return (
                  <tr
                    key={t.id}
                    className={clsx('border-b border-slate-50 last:border-0', canEdit && 'cursor-pointer hover:bg-slate-50')}
                    onClick={canEdit ? () => openTransaction(t.id) : undefined}
                  >
                    <td className="px-5 py-2.5 text-slate-500">{formatDate(t.date)}</td>
                    <td className="px-2 py-2.5 text-slate-800">{t.memo}</td>
                    <td className="px-5 py-2.5 text-right">
                      <Money cents={total} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="border-t border-slate-100 px-5 py-2.5">
            <Link to="/transactions" className="text-sm font-medium text-brand-600 hover:underline">
              View all →
            </Link>
          </div>
        </div>

        <div className="card lg:col-span-2">
          <div className="border-b border-slate-100 px-5 py-3 text-sm font-semibold text-slate-700">
            Profit &amp; Loss
          </div>
          <div className="space-y-3 p-5">
            <PnlLine label="Income" cents={pnl.totalIncome} />
            <PnlLine label="Expenses" cents={-pnl.totalExpense} />
            <div className="border-t border-slate-100 pt-3">
              <div className="flex items-center justify-between font-semibold">
                <span>Net</span>
                <Money cents={pnl.net} colored />
              </div>
            </div>
          </div>
        </div>
      </div>
      {openerEl}
    </div>
  )
}

function StatCard({
  icon,
  label,
  tone,
  children,
  hover,
}: {
  icon: React.ReactNode
  label: string
  tone: 'brand' | 'emerald' | 'rose' | 'amber'
  children: React.ReactNode
  hover?: boolean
}) {
  const toneMap = {
    brand: 'bg-brand-50 text-brand-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    rose: 'bg-rose-50 text-rose-600',
    amber: 'bg-amber-50 text-amber-600',
  }
  return (
    <div className={`card p-4 ${hover ? 'transition hover:shadow-md' : ''}`}>
      <div className="flex items-center gap-2">
        <span className={`grid h-8 w-8 place-items-center rounded-lg ${toneMap[tone]}`}>{icon}</span>
        <span className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</span>
      </div>
      <div className="mt-3 text-2xl font-bold text-slate-900">{children}</div>
    </div>
  )
}

function PnlLine({ label, cents }: { label: string; cents: number }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-slate-600">{label}</span>
      <Money cents={cents} />
    </div>
  )
}
