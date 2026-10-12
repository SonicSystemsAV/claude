import { useMemo, useState } from 'react'
import { clsx } from 'clsx'
import {
  AlertTriangle,
  CheckCircle2,
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
  Scale,
  Users,
  Link2,
  X,
  ChevronDown,
  ChevronRight,
} from 'lucide-react'
import { useStore } from '../state/store'
import { Money } from '../components/Money'
import { formatDate } from '../lib/format'
import {
  reviewInterCompanyTransfers,
  confirmMatch,
  markExternal,
  markIgnored,
  clearReview,
  type ReviewedMovement,
  type TransferFlag,
  type MovementKind,
  type MatchCandidate,
} from '../db/interCompanyReview'

const KIND_LABEL: Record<MovementKind, string> = {
  sale: 'Sale (income)',
  purchase: 'Purchase (expense)',
  ar_payment: 'Payment on invoice (A/R)',
  ap_payment: 'Payment on bill (A/P)',
  transfer_out: 'Transfer out (loan / due-from)',
  transfer_in: 'Transfer in (loan / due-to)',
  equity: 'Owner / shareholder equity',
  bank_transfer: 'Between own bank accounts',
  vague: 'Uncategorized',
  other: 'Other',
}

const FLAG_LABEL: Record<TransferFlag, string> = {
  unmatched_out: 'Unmatched — money out',
  unmatched_in: 'Unmatched — money in',
  amount_mismatch: 'Amount mismatch',
  date_mismatch: 'Date mismatch',
  type_disagreement: 'Sides disagree on type',
  vague_account: 'Vague account',
  unbalanced_pair: 'Pair out of balance',
}

type FilterMode = 'flagged' | 'internal' | 'recipients' | 'all'

export default function TransferReview() {
  const rev = useStore((s) => s.rev)
  void rev
  const [bump, setBump] = useState(0)
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [windowDays, setWindowDays] = useState(5)
  const [filter, setFilter] = useState<FilterMode>('flagged')

  const report = useMemo(
    () =>
      reviewInterCompanyTransfers({
        startDate: start || undefined,
        endDate: end || undefined,
        matchWindowDays: windowDays,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [start, end, windowDays, bump, rev],
  )
  const refresh = () => setBump((b) => b + 1)

  const shown = report.movements.filter((m) => {
    if (filter === 'all') return true
    if (filter === 'flagged') return m.flags.length > 0 && m.confirmed?.resolution !== 'ignored'
    if (filter === 'internal') return m.counterparty.type === 'internal' || m.movement.selfTransfer === true || m.candidates.length > 0
    if (filter === 'recipients') return m.counterparty.type === 'recipient'
    return true
  })

  const c = report.counts

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Transfer review</h1>
        <p className="mt-1 text-sm text-slate-500">
          Every bank movement between your companies and out to recurring recipients, with each side’s category,
          a best-guess match (pick from candidates when several fit), and flags where things don’t tie out.
        </p>
      </div>

      {/* Controls */}
      <div className="card flex flex-wrap items-end gap-3 p-4">
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-500">From date</span>
          <input type="date" className="rounded-md border border-slate-300 px-2 py-1.5" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-500">To date</span>
          <input type="date" className="rounded-md border border-slate-300 px-2 py-1.5" value={end} onChange={(e) => setEnd(e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-500">Deposit lands within</span>
          <select className="rounded-md border border-slate-300 px-2 py-1.5" value={windowDays} onChange={(e) => setWindowDays(Number(e.target.value))}>
            <option value={3}>3 days</option>
            <option value={5}>5 days</option>
            <option value={7}>7 days</option>
          </select>
        </label>
        {(start || end) && (
          <button className="btn-ghost text-sm" onClick={() => { setStart(''); setEnd('') }}>Clear dates</button>
        )}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Movements" value={c.total} />
        <Stat label="Inter-company" value={c.internal} icon={<Link2 size={15} className="text-slate-400" />} />
        <Stat label="Unmatched" value={c.unmatched} tone={c.unmatched ? 'warn' : 'ok'} />
        <Stat label="Type conflicts" value={c.typeDisagreements} tone={c.typeDisagreements ? 'warn' : 'ok'} />
        <Stat label="Vague coding" value={c.vague} tone={c.vague ? 'warn' : 'ok'} />
      </div>

      {/* Balance tie-outs */}
      <BalanceTieOuts pairs={report.pairs} />

      {/* Recurring recipients */}
      {report.recipients.length > 0 && (
        <div className="card p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
            <Users size={15} className="text-slate-400" /> Recurring recipients
          </div>
          <div className="flex flex-wrap gap-2">
            {report.recipients.map((r) => (
              <div key={r.name} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm">
                <span className="font-medium text-slate-800">{r.name}</span>
                <span className="ml-2 text-slate-500">{r.count}× · <Money cents={r.totalOutCents} /></span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex items-center gap-1">
        {([
          ['flagged', `Needs review${report.movements.filter((m) => m.flags.length && m.confirmed?.resolution !== 'ignored').length ? ` (${report.movements.filter((m) => m.flags.length && m.confirmed?.resolution !== 'ignored').length})` : ''}`],
          ['internal', 'Inter-company'],
          ['recipients', 'Recipients'],
          ['all', 'All movements'],
        ] as const).map(([k, label]) => (
          <button key={k} onClick={() => setFilter(k)} className={clsx('rounded-md px-3 py-1.5 text-sm font-medium transition', filter === k ? 'bg-brand-50 text-brand-700' : 'text-slate-500 hover:bg-slate-100')}>
            {label}
          </button>
        ))}
      </div>

      {/* Movement list */}
      <div className="space-y-2">
        {shown.length === 0 && (
          <div className="card p-8 text-center text-sm text-slate-400">
            {filter === 'flagged' ? 'Nothing needs review in this range. 🎉' : 'No movements in this range.'}
          </div>
        )}
        {shown.map((m) => (
          <MovementRow key={`${m.movement.companyId}:${m.movement.txnId}`} rm={m} onChange={refresh} />
        ))}
      </div>
    </div>
  )
}

function Stat({ label, value, tone, icon }: { label: string; value: number; tone?: 'ok' | 'warn'; icon?: React.ReactNode }) {
  return (
    <div className="card px-4 py-3">
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-slate-400">{icon}{label}</div>
      <div className={clsx('mt-0.5 text-xl font-semibold', tone === 'warn' ? 'text-amber-600' : tone === 'ok' ? 'text-emerald-600' : 'text-slate-800')}>{value}</div>
    </div>
  )
}

function BalanceTieOuts({ pairs }: { pairs: ReturnType<typeof reviewInterCompanyTransfers>['pairs'] }) {
  if (pairs.length === 0) return null
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3 text-sm font-semibold text-slate-700">
        <Scale size={15} className="text-slate-400" /> Balance-sheet tie-out by company pair
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="px-5 py-2.5">Pair</th>
            <th className="px-2 py-2.5 text-right">Loan — their books</th>
            <th className="px-2 py-2.5 text-right">Loan — other books</th>
            <th className="px-2 py-2.5 text-right">Loan diff</th>
            <th className="px-2 py-2.5 text-right">Vendor vs customer</th>
            <th className="px-5 py-2.5 text-center">Tie-out</th>
          </tr>
        </thead>
        <tbody>
          {pairs.map((p) => (
            <tr key={`${p.aId}:${p.bId}`} className="border-b border-slate-50 last:border-0">
              <td className="px-5 py-2 text-slate-800">{p.aName} ↔ {p.bName}</td>
              <td className="px-2 py-2 text-right text-slate-600" title={`${p.aName}'s books`}><Money cents={p.loanPerA} colored /></td>
              <td className="px-2 py-2 text-right text-slate-600" title={`${p.bName}'s books`}><Money cents={p.loanPerB} colored /></td>
              <td className="px-2 py-2 text-right"><Money cents={p.loanDiff} colored /></td>
              <td className="px-2 py-2 text-right text-slate-600" title={`${p.aName} A/P for ${p.bName} vs ${p.bName} A/R for ${p.aName}`}>
                {p.tradeDiff === 0 ? <span className="text-emerald-600">matches</span> : <Money cents={p.tradeDiff} colored />}
              </td>
              <td className="px-5 py-2 text-center">
                {p.balanced
                  ? <CheckCircle2 size={15} className="inline text-emerald-500" />
                  : <AlertTriangle size={15} className="inline text-amber-500" />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-5 py-2.5 text-xs text-slate-400">
        “Loan” nets each company’s inter-company due-to / due-from / notes / loan accounts naming the other.
        The two books should be equal and opposite, so <strong>loan diff should be zero</strong>. The last column
        compares one side’s vendor balance for the other against the other’s customer balance — also zero when they agree.
      </p>
    </div>
  )
}

function MovementRow({ rm, onChange }: { rm: ReviewedMovement; onChange: () => void }) {
  const [open, setOpen] = useState(false)
  const m = rm.movement
  const resolved = rm.confirmed
  const selfTransfer = m.selfTransfer === true
  const hasFlags = rm.flags.length > 0
  const isIgnored = resolved?.resolution === 'ignored'
  const isExternal = resolved?.resolution === 'external'
  const isMatched = resolved?.resolution === 'matched'

  return (
    <div className={clsx('card overflow-hidden', hasFlags && !isIgnored && !isMatched && !isExternal && 'ring-1 ring-amber-200')}>
      <button className="flex w-full items-center gap-3 px-4 py-3 text-left" onClick={() => setOpen((o) => !o)}>
        <span className="text-slate-300">{open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</span>
        <span className={clsx('inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full', selfTransfer ? 'bg-slate-100 text-slate-500' : m.direction === 'out' ? 'bg-rose-50 text-rose-500' : 'bg-emerald-50 text-emerald-500')}>
          {selfTransfer ? <ArrowLeftRight size={15} /> : m.direction === 'out' ? <ArrowUpRight size={15} /> : <ArrowDownLeft size={15} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-slate-800">{m.companyName}</span>
            <span className="text-xs text-slate-400">{formatDate(m.date)}</span>
            {m.contactName && !selfTransfer && <span className="truncate text-xs text-slate-500">· {m.contactName}</span>}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs">
            {selfTransfer ? (
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">{m.transferFromName} → {m.transferToName}</span>
            ) : (
              <>
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">{KIND_LABEL[m.kind]}</span>
                <span className="rounded bg-slate-50 px-1.5 py-0.5 text-slate-500">{m.direction === 'out' ? 'from' : 'into'} {m.bankAccountName}</span>
                {rm.counterparty.type === 'internal' && <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-indigo-600">↔ {rm.counterparty.companyName}</span>}
                {rm.counterparty.type === 'recipient' && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">recipient</span>}
              </>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <Money cents={selfTransfer ? Math.abs(m.signedCents) : m.signedCents} colored={!selfTransfer} className="font-semibold" />
          <div className="mt-0.5 flex items-center justify-end gap-1">
            {selfTransfer && <span className="text-xs text-slate-400">internal transfer</span>}
            {isMatched && <span className="inline-flex items-center gap-1 text-xs text-emerald-600"><CheckCircle2 size={12} /> matched</span>}
            {isExternal && <span className="text-xs text-slate-500">external</span>}
            {isIgnored && <span className="text-xs text-slate-400">ignored</span>}
            {!resolved && !selfTransfer && rm.flags.map((f) => (
              <span key={f} className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700"><AlertTriangle size={11} /> {FLAG_LABEL[f]}</span>
            ))}
          </div>
        </div>
      </button>

      {open && (
        <div className="border-t border-slate-100 bg-slate-50/50 px-4 py-3 text-sm">
          {/* Categorization of both-side legs */}
          <div className="mb-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              {selfTransfer ? 'Moved between own accounts' : 'How this side is categorized'}
            </div>
            <ul className="mt-1 space-y-0.5">
              {selfTransfer ? (
                <li className="flex items-center justify-between">
                  <span className="text-slate-700">{m.transferFromName} <ArrowLeftRight size={12} className="inline text-slate-400" /> {m.transferToName}</span>
                  <Money cents={Math.abs(m.signedCents)} />
                </li>
              ) : (
                <>
                  {m.otherLegs.map((l, i) => (
                    <li key={i} className="flex items-center justify-between">
                      <span className="text-slate-700">{l.accountCode} {l.accountName} <span className="text-slate-400">({l.accountType})</span></span>
                      <Money cents={l.amountCents} />
                    </li>
                  ))}
                  {m.otherLegs.length === 0 && <li className="text-amber-600">No offsetting account — needs categorizing.</li>}
                </>
              )}
            </ul>
            {m.memo && <div className="mt-1 text-xs text-slate-500">Memo: {m.memo}</div>}
          </div>

          {/* Flags & notes */}
          {rm.notes.length > 0 && !isIgnored && (
            <ul className="mb-3 space-y-1">
              {rm.notes.map((n, i) => (
                <li key={i} className="flex items-start gap-1.5 text-xs text-amber-700"><AlertTriangle size={12} className="mt-0.5 shrink-0" /> {n}</li>
              ))}
            </ul>
          )}

          {/* Candidate pick-list */}
          {rm.candidates.length > 0 && (
            <div className="mb-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                {isMatched ? 'Matched to' : 'Possible matches — pick the right one'}
              </div>
              <div className="mt-1 space-y-1.5">
                {rm.candidates.map((cand) => (
                  <CandidateRow
                    key={`${cand.movement.companyId}:${cand.movement.txnId}`}
                    cand={cand}
                    chosen={isMatched && resolved?.matched_txn_id === cand.movement.txnId}
                    disabled={isMatched || isExternal || isIgnored}
                    onPick={() => {
                      confirmMatch(m.companyId, m.txnId, cand.movement.companyId, cand.movement.txnId)
                      onChange()
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          {!selfTransfer && (
          <div className="flex flex-wrap items-center gap-2">
            {resolved ? (
              <button className="btn-ghost text-xs" onClick={() => { clearReview(m.companyId, m.txnId); onChange() }}>
                <X size={13} /> Re-open
              </button>
            ) : (
              <>
                <button className="btn-ghost text-xs" onClick={() => { markExternal(m.companyId, m.txnId, m.contactName ?? undefined); onChange() }}>
                  Mark as external payment
                </button>
                <button className="btn-ghost text-xs" onClick={() => { markIgnored(m.companyId, m.txnId); onChange() }}>
                  Reviewed — ignore
                </button>
              </>
            )}
          </div>
          )}
        </div>
      )}
    </div>
  )
}

function CandidateRow({ cand, chosen, disabled, onPick }: { cand: MatchCandidate; chosen: boolean; disabled: boolean; onPick: () => void }) {
  const cm = cand.movement
  return (
    <div className={clsx('flex items-center gap-3 rounded-lg border px-3 py-1.5', chosen ? 'border-emerald-300 bg-emerald-50/60' : 'border-slate-200 bg-white')}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-slate-800">{cm.companyName}</span>
          <span className="text-xs text-slate-500">{cm.direction === 'in' ? 'into' : 'from'} {cm.bankAccountName}</span>
          <span className="text-xs text-slate-400">{formatDate(cm.date)}</span>
        </div>
        <div className="text-xs text-slate-500">{cand.reasons.join(' · ')}</div>
      </div>
      <Money cents={cm.signedCents} colored />
      {chosen ? (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600"><CheckCircle2 size={13} /> matched</span>
      ) : (
        <button className="btn-primary px-2 py-1 text-xs" disabled={disabled} onClick={onPick}>This one</button>
      )}
    </div>
  )
}
