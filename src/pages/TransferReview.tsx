import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
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
  Zap,
  Layers,
  List as ListIcon,
  Ban,
  Search,
  Trash2,
  Sparkles,
  Send,
} from 'lucide-react'
import { useStore } from '../state/store'
import { Money } from '../components/Money'
import { formatDate } from '../lib/format'
import { getAccounts } from '../db/repo'
import { reclassEntry, addCategoryRule, countEntriesOnAccount, loadCategoryRules, applyCategoryRule, deleteCategoryRule } from '../db/categoryRules'
import { runProposal, describeAction, applyProposedAction, type Proposal } from '../db/assistantActions'
import { loadAssistantConfig } from '../db/assistant'
import {
  reviewInterCompanyTransfers,
  needsReview,
  acceptAutoMatches,
  ignoreBatch,
  addRule,
  deleteRule,
  confirmMatch,
  markExternal,
  markIgnored,
  clearReview,
  type TransferReview as Review,
  type ReviewedMovement,
  type TransferFlag,
  type MovementKind,
  type MatchCandidate,
  type MovementLeg,
} from '../db/interCompanyReview'

const KIND_LABEL: Record<MovementKind, string> = {
  sale: 'Sale (income)',
  purchase: 'Purchase (expense)',
  ar_payment: 'Payment on invoice (A/R)',
  ap_payment: 'Payment on bill (A/P)',
  transfer_out: 'Transfer out (loan / due-from)',
  transfer_in: 'Transfer in (loan / due-to)',
  debt_payment: 'Loan / mortgage / tax payment',
  equity: 'Owner / shareholder equity',
  bank_transfer: 'Between own accounts',
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

type FilterMode = 'needs' | 'internal' | 'recipients' | 'all'
const FLAT_PAGE = 50
const GROUP_PAGE = 20

function keyOf(rm: ReviewedMovement) {
  return `${rm.movement.companyId}:${rm.movement.txnId}`
}

/** Bucket a movement for the grouped view, with the rule it would create. */
function groupInfo(rm: ReviewedMovement): { key: string; label: string; rule: { scope: 'account' | 'recipient'; text: string } | null } {
  if (rm.counterparty.type === 'internal')
    return { key: `co:${rm.counterparty.companyId}`, label: `↔ ${rm.counterparty.companyName}`, rule: null }
  if (rm.counterparty.type === 'recipient')
    return { key: `rc:${rm.counterparty.name.toLowerCase()}`, label: rm.counterparty.name, rule: { scope: 'recipient', text: rm.counterparty.name } }
  const acct = rm.movement.primaryAccountName || rm.movement.bankAccountName
  return { key: `ac:${acct.toLowerCase()}`, label: acct, rule: { scope: 'account', text: acct } }
}

export default function TransferReview() {
  const rev = useStore((s) => s.rev)
  void rev
  const [bump, setBump] = useState(0)
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [windowDays, setWindowDays] = useState(5)
  const [filter, setFilter] = useState<FilterMode>('needs')
  const [grouped, setGrouped] = useState(true)
  const [page, setPage] = useState(0)
  const [query, setQuery] = useState('')
  const [showRules, setShowRules] = useState(false)
  const [showAi, setShowAi] = useState(false)
  const currentCompanyId = useStore((s) => s.currentCompanyId)

  const report: Review = useMemo(
    () => reviewInterCompanyTransfers({ startDate: start || undefined, endDate: end || undefined, matchWindowDays: windowDays }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [start, end, windowDays, bump, rev],
  )
  const refresh = () => setBump((b) => b + 1)
  useEffect(() => setPage(0), [filter, grouped, query, start, end, windowDays])

  const q = query.trim().toLowerCase()
  const shown = report.movements.filter((m) => {
    if (filter === 'needs' && !needsReview(m)) return false
    if (filter === 'internal' && !(m.counterparty.type === 'internal' || m.movement.selfTransfer || m.candidates.length > 0)) return false
    if (filter === 'recipients' && m.counterparty.type !== 'recipient') return false
    if (q) {
      const blob = [m.movement.companyName, m.movement.contactName, m.movement.memo, m.movement.bankAccountName, m.movement.primaryAccountName, ...m.movement.otherLegs.map((l) => l.accountName)]
        .filter(Boolean).join(' ').toLowerCase()
      if (!blob.includes(q)) return false
    }
    return true
  })

  const c = report.counts

  function acceptAuto() {
    const n = acceptAutoMatches(report)
    if (n) refresh()
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Transfer review</h1>
        <p className="mt-1 text-sm text-slate-500">
          Money between your companies and out to recurring recipients — matched, categorized, and flagged where it doesn’t tie out.
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
        <label className="text-sm flex-1 min-w-[180px]">
          <span className="mb-1 block text-xs font-medium text-slate-500">Search</span>
          <div className="flex items-center gap-1.5 rounded-md border border-slate-300 px-2 py-1.5">
            <Search size={14} className="text-slate-400" />
            <input className="w-full outline-none" placeholder="account, company, memo…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
        </label>
        {(start || end) && <button className="btn-ghost text-sm" onClick={() => { setStart(''); setEnd('') }}>Clear dates</button>}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Needs review" value={c.needsReview} tone={c.needsReview ? 'warn' : 'ok'} />
        <Stat label="Movements" value={c.total} />
        <Stat label="Inter-company" value={c.internal} icon={<Link2 size={15} className="text-slate-400" />} />
        <Stat label="Type conflicts" value={c.typeDisagreements} tone={c.typeDisagreements ? 'warn' : 'ok'} />
        <Stat label="Vague coding" value={c.vague} tone={c.vague ? 'warn' : 'ok'} />
      </div>

      {/* Bulk helpers */}
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-primary" disabled={!c.autoMatchable} onClick={acceptAuto}>
          <Zap size={15} /> Accept {c.autoMatchable} auto-match{c.autoMatchable === 1 ? '' : 'es'}
        </button>
        <button className="btn-ghost text-sm" onClick={() => setShowRules((s) => !s)}>
          <Ban size={14} /> Ignore rules {report.rules.length ? `(${report.rules.length})` : ''}
        </button>
        <button className="btn-ghost text-sm" onClick={() => setShowAi((s) => !s)}>
          <Sparkles size={14} /> Ask AI
        </button>
        <span className="ml-auto text-xs text-slate-400">
          Confident matches (exact amount, ≤2 days, both sides named) accept in one click.
        </span>
      </div>

      {showAi && <AiPanel companyId={currentCompanyId ?? null} review={report} onChange={refresh} />}
      {showRules && <RulesPanel review={report} onChange={refresh} />}

      {/* Balance tie-outs */}
      <BalanceTieOuts pairs={report.pairs} />

      {/* Recurring recipients */}
      {report.recipients.length > 0 && (
        <div className="card p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
            <Users size={15} className="text-slate-400" /> Recurring recipients
          </div>
          <div className="flex flex-wrap gap-2">
            {report.recipients.slice(0, 40).map((r) => (
              <div key={r.name} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm">
                <span className="font-medium text-slate-800">{r.name}</span>
                <span className="ml-2 text-slate-500">{r.count}× · <Money cents={r.totalOutCents} /></span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filter tabs + view toggle */}
      <div className="flex flex-wrap items-center gap-1">
        {([
          ['needs', `Needs review${c.needsReview ? ` (${c.needsReview})` : ''}`],
          ['internal', 'Inter-company'],
          ['recipients', 'Recipients'],
          ['all', 'All movements'],
        ] as const).map(([k, label]) => (
          <button key={k} onClick={() => setFilter(k)} className={clsx('rounded-md px-3 py-1.5 text-sm font-medium transition', filter === k ? 'bg-brand-50 text-brand-700' : 'text-slate-500 hover:bg-slate-100')}>
            {label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1">
          <span className="text-xs text-slate-400">{shown.length} shown</span>
          <button onClick={() => setGrouped((g) => !g)} className="btn-ghost text-sm" title={grouped ? 'Flat list' : 'Group by account/company'}>
            {grouped ? <><ListIcon size={14} /> Flat</> : <><Layers size={14} /> Group</>}
          </button>
        </div>
      </div>

      {/* List */}
      {shown.length === 0 ? (
        <div className="card p-8 text-center text-sm text-slate-400">
          {filter === 'needs' ? 'Nothing needs review in this range. 🎉' : 'No movements match.'}
        </div>
      ) : grouped ? (
        <GroupedList shown={shown} page={page} setPage={setPage} onChange={refresh} />
      ) : (
        <FlatList shown={shown} page={page} setPage={setPage} onChange={refresh} />
      )}
    </div>
  )
}

function Stat({ label, value, tone, icon }: { label: string; value: number; tone?: 'ok' | 'warn'; icon?: React.ReactNode }) {
  return (
    <div className="card px-4 py-3">
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-slate-400">{icon}{label}</div>
      <div className={clsx('mt-0.5 text-xl font-semibold', tone === 'warn' ? 'text-amber-600' : tone === 'ok' ? 'text-emerald-600' : 'text-slate-800')}>{value.toLocaleString()}</div>
    </div>
  )
}

/** Left/right arrow keys flip pages, unless the user is typing in a field. */
function usePageKeys(page: number, pages: number, setPage: (n: number) => void) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')) return
      if (e.key === 'ArrowLeft' && page > 0) setPage(page - 1)
      else if (e.key === 'ArrowRight' && page < pages - 1) setPage(page + 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [page, pages, setPage])
}

function Pager({ page, pages, setPage }: { page: number; pages: number; setPage: (n: number) => void }) {
  if (pages <= 1) return null
  return (
    <div className="flex items-center justify-center gap-2 py-2 text-sm">
      <button className="btn-ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>← Prev</button>
      <span className="text-slate-500">Page {page + 1} of {pages}</span>
      <button className="btn-ghost" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next →</button>
    </div>
  )
}

function FlatList({ shown, page, setPage, onChange }: { shown: ReviewedMovement[]; page: number; setPage: (n: number) => void; onChange: () => void }) {
  const pages = Math.ceil(shown.length / FLAT_PAGE)
  usePageKeys(page, pages, setPage)
  const slice = shown.slice(page * FLAT_PAGE, page * FLAT_PAGE + FLAT_PAGE)
  return (
    <div className="space-y-2">
      <Pager page={page} pages={pages} setPage={setPage} />
      {slice.map((m) => (
        <MovementRow key={keyOf(m)} rm={m} onChange={onChange} />
      ))}
      <Pager page={page} pages={pages} setPage={setPage} />
    </div>
  )
}

function GroupedList({ shown, page, setPage, onChange }: { shown: ReviewedMovement[]; page: number; setPage: (n: number) => void; onChange: () => void }) {
  const groups = useMemo(() => {
    const map = new Map<string, { label: string; rule: ReturnType<typeof groupInfo>['rule']; items: ReviewedMovement[]; total: number }>()
    for (const m of shown) {
      const gi = groupInfo(m)
      const g = map.get(gi.key) ?? { label: gi.label, rule: gi.rule, items: [], total: 0 }
      g.items.push(m)
      g.total += Math.abs(m.movement.signedCents)
      map.set(gi.key, g)
    }
    return [...map.values()].sort((a, b) => b.items.length - a.items.length)
  }, [shown])

  const pages = Math.ceil(groups.length / GROUP_PAGE)
  usePageKeys(page, pages, setPage)
  const slice = groups.slice(page * GROUP_PAGE, page * GROUP_PAGE + GROUP_PAGE)
  return (
    <div className="space-y-2">
      <Pager page={page} pages={pages} setPage={setPage} />
      {slice.map((g) => (
        <GroupBlock key={g.label} group={g} onChange={onChange} />
      ))}
      <Pager page={page} pages={pages} setPage={setPage} />
    </div>
  )
}

function GroupBlock({ group, onChange }: { group: { label: string; rule: { scope: 'account' | 'recipient'; text: string } | null; items: ReviewedMovement[]; total: number }; onChange: () => void }) {
  const [open, setOpen] = useState(false)
  const [limit, setLimit] = useState(25)
  const openItems = group.items.filter((m) => needsReview(m))

  function ignoreAll() {
    ignoreBatch(group.items.map((m) => ({ companyId: m.movement.companyId, txnId: m.movement.txnId })))
    onChange()
  }
  function makeRule() {
    if (!group.rule) return
    addRule(group.rule.scope, group.rule.text)
    onChange()
  }

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-2.5">
        <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setOpen((o) => !o)}>
          <span className="text-slate-300">{open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</span>
          <span className="truncate font-medium text-slate-800">{group.label}</span>
          <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{group.items.length}</span>
          {openItems.length > 0 && <span className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700">{openItems.length} open</span>}
        </button>
        <Money cents={group.total} className="shrink-0 text-sm text-slate-500" />
        <div className="flex shrink-0 items-center gap-1">
          <button className="btn-ghost text-xs" onClick={ignoreAll} title="Mark every item here reviewed/ignored">
            <CheckCircle2 size={13} /> Ignore all
          </button>
          {group.rule && (
            <button className="btn-ghost text-xs" onClick={makeRule} title={`Always ignore ${group.rule.scope === 'account' ? 'this account' : 'this recipient'} in future`}>
              <Ban size={13} /> Always ignore
            </button>
          )}
        </div>
      </div>
      {open && (
        <div className="border-t border-slate-100 bg-slate-50/40 p-2">
          {group.items.slice(0, limit).map((m) => (
            <MovementRow key={keyOf(m)} rm={m} onChange={onChange} dense />
          ))}
          {group.items.length > limit && (
            <button className="btn-ghost mt-1 w-full text-xs" onClick={() => setLimit((l) => l + 50)}>
              Show {Math.min(50, group.items.length - limit)} more of {group.items.length}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function BalanceTieOuts({ pairs }: { pairs: Review['pairs'] }) {
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
              <td className="px-2 py-2 text-right text-slate-600"><Money cents={p.loanPerA} colored /></td>
              <td className="px-2 py-2 text-right text-slate-600"><Money cents={p.loanPerB} colored /></td>
              <td className="px-2 py-2 text-right"><Money cents={p.loanDiff} colored /></td>
              <td className="px-2 py-2 text-right text-slate-600">
                {p.tradeDiff === 0 ? <span className="text-emerald-600">matches</span> : <Money cents={p.tradeDiff} colored />}
              </td>
              <td className="px-5 py-2 text-center">
                {p.balanced ? <CheckCircle2 size={15} className="inline text-emerald-500" /> : <AlertTriangle size={15} className="inline text-amber-500" />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-5 py-2.5 text-xs text-slate-400">
        “Loan” nets each company’s inter-company due-to / due-from / notes / loan accounts naming the other; the two books should be equal and
        opposite, so <strong>loan diff should be zero</strong>. The last column compares one side’s vendor balance against the other’s customer balance.
      </p>
    </div>
  )
}

function RulesPanel({ review, onChange }: { review: Review; onChange: () => void }) {
  const catRules = useMemo(() => loadCategoryRules(), [review])
  return (
    <div className="card space-y-4 p-4">
      <div>
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
          <Ban size={15} className="text-slate-400" /> Standing ignore rules
        </div>
        {review.rules.length === 0 ? (
          <p className="text-sm text-slate-400">
            None yet. Use <strong>Always ignore</strong> on a group to stop an account or recipient from being flagged — it survives re-imports.
          </p>
        ) : (
          <ul className="space-y-1 text-sm">
            {review.rules.map((r) => (
              <li key={r.id} className="flex items-center justify-between rounded-md border border-slate-100 px-3 py-1.5">
                <span className="text-slate-700">
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">{r.scope}</span>{' '}
                  ignore “{r.match_text}”
                </span>
                <button className="btn-ghost text-xs text-rose-600" onClick={() => { deleteRule(r.id); onChange() }}>
                  <Trash2 size={13} /> Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
          <ArrowLeftRight size={15} className="text-slate-400" /> Reclassify rules
        </div>
        {catRules.length === 0 ? (
          <p className="text-sm text-slate-400">
            None yet. Use <strong>recategorize → All like this + remember</strong> on a transaction to move everything from one account to another and keep it applied.
          </p>
        ) : (
          <ul className="space-y-1 text-sm">
            {catRules.map((r) => (
              <li key={r.id} className="flex items-center justify-between rounded-md border border-slate-100 px-3 py-1.5">
                <span className="text-slate-700">{r.from_name} → {r.to_name}{r.source === 'ai' ? <span className="ml-1 rounded bg-emerald-50 px-1 text-xs text-emerald-600">AI</span> : null}</span>
                <span className="flex items-center gap-2">
                  <button className="btn-ghost text-xs" title="Re-apply to any new matching entries" onClick={() => { applyCategoryRule(r); onChange() }}>Apply again</button>
                  <button className="btn-ghost text-xs text-rose-600" onClick={() => { deleteCategoryRule(r.id); onChange() }}><Trash2 size={13} /> Remove</button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function MovementRow({ rm, onChange, dense }: { rm: ReviewedMovement; onChange: () => void; dense?: boolean }) {
  const [open, setOpen] = useState(false)
  const m = rm.movement
  const resolved = rm.confirmed
  const ruled = rm.ruled
  const selfTransfer = m.selfTransfer === true
  const hasFlags = rm.flags.length > 0
  const isIgnored = resolved?.resolution === 'ignored'
  const isExternal = resolved?.resolution === 'external'
  const isMatched = resolved?.resolution === 'matched'
  const openState = hasFlags && !resolved && !ruled && !selfTransfer

  return (
    <div className={clsx('card overflow-hidden', openState && 'ring-1 ring-amber-200', dense && 'shadow-none border-slate-100')}>
      <button className="flex w-full items-center gap-3 px-4 py-2.5 text-left" onClick={() => setOpen((o) => !o)}>
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
              </>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <Money cents={selfTransfer ? Math.abs(m.signedCents) : m.signedCents} colored={!selfTransfer} className="font-semibold" />
          <div className="mt-0.5 flex items-center justify-end gap-1">
            {rm.autoMatch && !resolved && <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-600"><Zap size={11} /> auto</span>}
            {isMatched && <span className="inline-flex items-center gap-1 text-xs text-emerald-600"><CheckCircle2 size={12} /> matched</span>}
            {isExternal && <span className="text-xs text-slate-500">external</span>}
            {isIgnored && <span className="text-xs text-slate-400">ignored</span>}
            {ruled && <span className="inline-flex items-center gap-1 text-xs text-slate-400"><Ban size={11} /> rule</span>}
            {!resolved && !ruled && !selfTransfer && rm.flags.map((f) => (
              <span key={f} className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700"><AlertTriangle size={11} /> {FLAG_LABEL[f]}</span>
            ))}
          </div>
        </div>
      </button>

      {open && (
        <div className="border-t border-slate-100 bg-slate-50/50 px-4 py-3 text-sm">
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

          {!selfTransfer && m.otherLegs.length === 1 && (
            <Recategorize
              companyId={m.companyId}
              leg={m.otherLegs[0]}
              onChange={onChange}
            />
          )}

          {ruled && (
            <div className="mb-3 text-xs text-slate-500">Auto-ignored by rule: “{ruled.match_text}” ({ruled.scope}).</div>
          )}

          {rm.notes.length > 0 && !isIgnored && !ruled && (
            <ul className="mb-3 space-y-1">
              {rm.notes.map((n, i) => (
                <li key={i} className="flex items-start gap-1.5 text-xs text-amber-700"><AlertTriangle size={12} className="mt-0.5 shrink-0" /> {n}</li>
              ))}
            </ul>
          )}

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
                    onPick={() => { confirmMatch(m.companyId, m.txnId, cand.movement.companyId, cand.movement.txnId); onChange() }}
                  />
                ))}
              </div>
            </div>
          )}

          {!selfTransfer && (
            <div className="flex flex-wrap items-center gap-2">
              {ruled ? (
                <span className="text-xs text-slate-400">Ignored by a standing rule — remove it under “Ignore rules” to re-open.</span>
              ) : resolved ? (
                <button className="btn-ghost text-xs" onClick={() => { clearReview(m.companyId, m.txnId); onChange() }}>
                  <X size={13} /> Re-open
                </button>
              ) : (
                <>
                  <button className="btn-ghost text-xs" onClick={() => { markExternal(m.companyId, m.txnId, m.contactName ?? undefined); onChange() }}>Mark as external payment</button>
                  <button className="btn-ghost text-xs" onClick={() => { markIgnored(m.companyId, m.txnId); onChange() }}>Reviewed — ignore</button>
                  {m.primaryAccountName && (
                    <button className="btn-ghost text-xs text-slate-500" onClick={() => { addRule('account', m.primaryAccountName!); onChange() }} title="Always ignore movements coded to this account">
                      <Ban size={12} /> Always ignore this account
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function AiPanel({ companyId, review, onChange }: { companyId: number | null; review: Review; onChange: () => void }) {
  const config = useMemo(() => loadAssistantConfig(), [])
  const companyName = review.companies.find((c) => c.id === companyId)?.name
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [results, setResults] = useState<string[]>([])

  async function send() {
    if (companyId == null) { setError('Pick a company first (top-left company switcher) — the assistant acts on the active company.'); return }
    setError(null); setResults([]); setProposal(null); setLoading(true)
    try {
      const p = await runProposal(companyId, input.trim() || `Suggest how to handle the needs-review items for ${companyName ?? 'this company'}.`, review, config)
      setProposal(p)
      setChecked(new Set(p.actions.map((_, i) => i)))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  function apply() {
    if (!proposal) return
    const out: string[] = []
    proposal.actions.forEach((a, i) => { if (checked.has(i)) { try { out.push(applyProposedAction(a)) } catch (e) { out.push(`Failed: ${e instanceof Error ? e.message : String(e)}`) } } })
    setResults(out); setProposal(null); onChange()
  }

  return (
    <div className="card space-y-3 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
        <Sparkles size={15} className="text-brand-500" /> Ask AI {companyName ? <span className="text-xs font-normal text-slate-400">· acting on {companyName}</span> : null}
      </div>
      <div className="flex items-start gap-2">
        <textarea
          className="min-h-[2.5rem] flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
          rows={2}
          placeholder={`e.g. "Reclassify all undocumented ATM cash to the shareholder loan", or "how should I handle these?"`}
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button className="btn-primary" disabled={loading} onClick={send}><Send size={14} /> {loading ? 'Thinking…' : 'Send'}</button>
      </div>

      {error && (
        <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error} {error.includes('API key') && <Link to="/settings" className="underline">Open Settings</Link>}
        </div>
      )}

      {proposal && (
        <div className="space-y-2">
          {proposal.message && <p className="text-sm text-slate-700">{proposal.message}</p>}
          {proposal.actions.length === 0 ? (
            <p className="text-sm text-slate-400">No actions proposed.</p>
          ) : (
            <>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Proposed — review & apply</div>
              <ul className="space-y-1.5">
                {proposal.actions.map((a, i) => {
                  const d = describeAction(a)
                  return (
                    <li key={i} className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                      <input type="checkbox" className="mt-1" checked={checked.has(i)} onChange={(e) => {
                        const next = new Set(checked); if (e.target.checked) next.add(i); else next.delete(i); setChecked(next)
                      }} />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-slate-800">{d.label} <span className="text-xs font-normal text-slate-400">· {d.impact}</span></div>
                        {a.reason && <div className="text-xs text-slate-500">{a.reason}</div>}
                      </div>
                    </li>
                  )
                })}
              </ul>
              <div className="flex items-center gap-2">
                <button className="btn-primary" disabled={checked.size === 0} onClick={apply}>Apply {checked.size} selected</button>
                <button className="btn-ghost text-sm" onClick={() => setProposal(null)}>Discard</button>
              </div>
            </>
          )}
        </div>
      )}

      {results.length > 0 && (
        <ul className="space-y-0.5 text-sm text-emerald-700">
          {results.map((r, i) => <li key={i} className="flex items-center gap-1.5"><CheckCircle2 size={13} /> {r}</li>)}
        </ul>
      )}

      <p className="text-xs text-slate-400">
        The AI only proposes — nothing changes until you Apply. Every applied action is balanced, written to the audit log, and reversible.
      </p>
    </div>
  )
}

function Recategorize({ companyId, leg, onChange }: { companyId: number; leg: MovementLeg; onChange: () => void }) {
  const [target, setTarget] = useState<number | ''>('')
  const accounts = useMemo(() => getAccounts(companyId).filter((a) => a.id !== leg.accountId), [companyId, leg.accountId])
  const matchCount = useMemo(() => countEntriesOnAccount(leg.accountId), [leg.accountId])

  return (
    <div className="mb-3 rounded-lg border border-slate-200 bg-white p-2">
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Recategorize</div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-slate-500">{leg.accountCode} {leg.accountName} →</span>
        <select className="rounded-md border border-slate-300 px-2 py-1 text-sm" value={target} onChange={(e) => setTarget(e.target.value === '' ? '' : Number(e.target.value))}>
          <option value="">Choose account…</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
        </select>
        <button className="btn-ghost text-xs" disabled={target === ''} onClick={() => { reclassEntry(leg.entryId, Number(target)); onChange() }}>
          This one
        </button>
        <button
          className="btn-ghost text-xs"
          disabled={target === ''}
          title={`Move all ${matchCount} entries coded to "${leg.accountName}" and remember the rule`}
          onClick={() => { addCategoryRule(leg.accountId, Number(target)); onChange() }}
        >
          All {matchCount} like this + remember
        </button>
      </div>
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
