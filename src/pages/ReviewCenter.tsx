import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { clsx } from 'clsx'
import {
  ShieldCheck,
  AlertTriangle,
  AlertCircle,
  Info,
  RefreshCw,
  Scale,
  ArrowLeftRight,
  Layers,
  HelpCircle,
  BadgeCheck,
  Copy,
  CalendarClock,
  ChevronRight,
  Sparkles,
  Send,
  CheckCircle2,
  FileEdit,
  ArrowDownUp,
  TrendingUp,
  Flag,
} from 'lucide-react'
import { useStore } from '../state/store'
import { formatMoney } from '../lib/money'
import {
  runHealthChecks,
  summarize,
  topIssues,
  type Issue,
  type IssueCategory,
  type IssueSeverity,
} from '../db/healthChecks'
import { loadAssistantConfig } from '../db/assistant'
import { describeAction, applyProposedAction, type Proposal } from '../db/assistantActions'
import { runReviewProposal } from '../db/reviewAssistant'

const CATEGORY_META: Record<IssueCategory, { label: string; icon: typeof Scale }> = {
  balance: { label: 'Balance', icon: Scale },
  interco: { label: 'Inter-company', icon: ArrowLeftRight },
  transfers: { label: 'Transfers', icon: ArrowLeftRight },
  uncategorized: { label: 'Uncategorized', icon: HelpCircle },
  reconcile: { label: 'Reconcile', icon: BadgeCheck },
  duplicate: { label: 'Duplicates', icon: Copy },
  future: { label: 'Future-dated', icon: CalendarClock },
  draft: { label: 'Drafts', icon: FileEdit },
  wrongsign: { label: 'Wrong sign', icon: ArrowDownUp },
  swing: { label: 'Big swing', icon: TrendingUp },
}

const SEVERITY_META: Record<
  IssueSeverity,
  { label: string; dot: string; chip: string; icon: typeof AlertTriangle }
> = {
  high: { label: 'Needs attention', dot: 'bg-rose-500', chip: 'bg-rose-50 text-rose-700 border-rose-200', icon: AlertTriangle },
  medium: { label: 'Worth a look', dot: 'bg-amber-500', chip: 'bg-amber-50 text-amber-700 border-amber-200', icon: AlertCircle },
  low: { label: 'Tidy up', dot: 'bg-sky-500', chip: 'bg-sky-50 text-sky-700 border-sky-200', icon: Info },
}

type SeverityFilter = 'all' | IssueSeverity

export default function ReviewCenter() {
  const rev = useStore((s) => s.rev)
  const companies = useStore((s) => s.companies)
  const navigate = useNavigate()
  const [sevFilter, setSevFilter] = useState<SeverityFilter>('all')
  const [companyFilter, setCompanyFilter] = useState<number | 'all'>('all')
  const [showAi, setShowAi] = useState(false)

  // Recompute whenever the ledger changes (rev) or the user re-runs checks.
  const issues = useMemo(() => runHealthChecks(), [rev])
  const summary = summarize(issues)

  const filtered = issues.filter(
    (i) =>
      (sevFilter === 'all' || i.severity === sevFilter) &&
      (companyFilter === 'all' || i.companyId === companyFilter),
  )

  // Group filtered issues by owning company for display.
  const groups = useMemo(() => {
    const map = new Map<string, Issue[]>()
    for (const i of filtered) {
      const arr = map.get(i.companyName) ?? []
      arr.push(i)
      map.set(i.companyName, arr)
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length)
  }, [filtered])

  return (
    <div className="mx-auto max-w-4xl p-6">
      <header className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 font-display text-[22px] font-semibold text-ink">
            <ShieldCheck size={22} className="text-sonic-orange" />
            Review Center
          </h1>
          <p className="mt-1 text-sm text-muted">
            Everything that needs attention, across all your companies — ranked by what matters most.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className={clsx(
              'flex items-center gap-1.5 rounded-control border px-3 py-1.5 text-sm font-medium transition',
              showAi ? 'border-sonic-orange bg-orange-50 text-sonic-orange' : 'border-slate-200 text-muted hover:border-slate-300',
            )}
            onClick={() => setShowAi((v) => !v)}
          >
            <Sparkles size={15} /> Ask AI
          </button>
          <button className="btn-ghost flex items-center gap-1.5 text-sm" onClick={() => useStore.getState().refresh()}>
            <RefreshCw size={15} /> Re-run checks
          </button>
        </div>
      </header>

      {showAi && <ReviewAiPanel issues={issues} onApplied={() => useStore.getState().refresh()} />}

      {/* Summary tiles */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryTile
          active={sevFilter === 'all'}
          onClick={() => setSevFilter('all')}
          label="All issues"
          value={summary.total}
          dot="bg-ink"
        />
        <SummaryTile
          active={sevFilter === 'high'}
          onClick={() => setSevFilter((s) => (s === 'high' ? 'all' : 'high'))}
          label="Needs attention"
          value={summary.high}
          dot={SEVERITY_META.high.dot}
        />
        <SummaryTile
          active={sevFilter === 'medium'}
          onClick={() => setSevFilter((s) => (s === 'medium' ? 'all' : 'medium'))}
          label="Worth a look"
          value={summary.medium}
          dot={SEVERITY_META.medium.dot}
        />
        <SummaryTile
          active={sevFilter === 'low'}
          onClick={() => setSevFilter((s) => (s === 'low' ? 'all' : 'low'))}
          label="Tidy up"
          value={summary.low}
          dot={SEVERITY_META.low.dot}
        />
      </div>

      {/* Company filter */}
      {companies.length > 1 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <FilterChip active={companyFilter === 'all'} onClick={() => setCompanyFilter('all')}>
            All companies
          </FilterChip>
          {companies.map((c) => (
            <FilterChip key={c.id} active={companyFilter === c.id} onClick={() => setCompanyFilter(c.id)}>
              {c.name}
            </FilterChip>
          ))}
        </div>
      )}

      {/* Start here — the few things most worth doing first */}
      {sevFilter === 'all' && companyFilter === 'all' && issues.length > 5 && (
        <section className="mb-5 rounded-card border border-orange-200 bg-orange-50/60 p-4">
          <h2 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold uppercase tracking-wide text-sonic-orange">
            <Flag size={14} /> Start here
          </h2>
          <div className="space-y-1.5">
            {topIssues(issues, 5).map((issue) => {
              const sev = SEVERITY_META[issue.severity]
              return (
                <button
                  key={issue.id}
                  onClick={() => issue.fix && navigate(issue.fix.route)}
                  className="flex w-full items-center gap-2.5 rounded-control bg-surface px-3 py-2 text-left text-sm hover:ring-1 hover:ring-orange-200"
                >
                  <span className={clsx('h-2 w-2 shrink-0 rounded-full', sev.dot)} />
                  <span className="min-w-0 flex-1 truncate font-medium text-ink">{issue.title}</span>
                  <span className="hidden shrink-0 text-xs text-subtle sm:inline">{issue.companyName}</span>
                  {issue.fix && <ChevronRight size={15} className="shrink-0 text-subtle" />}
                </button>
              )
            })}
          </div>
        </section>
      )}

      {/* Results */}
      {issues.length === 0 ? (
        <AllClear />
      ) : filtered.length === 0 ? (
        <div className="card p-8 text-center text-sm text-muted">No issues match this filter.</div>
      ) : (
        <div className="space-y-5">
          {groups.map(([companyName, list]) => (
            <section key={companyName}>
              <h2 className="mb-2 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wide text-subtle">
                {companyName}
                <span className="grid h-5 min-w-5 place-items-center rounded-full bg-slate-200 px-1.5 text-[11px] font-bold text-slate-600">
                  {list.length}
                </span>
              </h2>
              <div className="space-y-2">
                {list.map((issue) => (
                  <IssueCard key={issue.id} issue={issue} onFix={() => issue.fix && navigate(issue.fix.route)} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

function SummaryTile({
  label,
  value,
  dot,
  active,
  onClick,
}: {
  label: string
  value: number
  dot: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'card flex flex-col items-start p-3 text-left transition',
        active ? 'ring-2 ring-sonic-orange' : 'hover:border-slate-300',
      )}
    >
      <span className="flex items-center gap-1.5 text-[12px] font-medium text-muted">
        <span className={clsx('h-2 w-2 rounded-full', dot)} />
        {label}
      </span>
      <span className="mt-1 text-2xl font-semibold text-ink">{value}</span>
    </button>
  )
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'rounded-full border px-3 py-1 text-[13px] font-medium transition',
        active ? 'border-sonic-orange bg-orange-50 text-sonic-orange' : 'border-slate-200 text-muted hover:border-slate-300',
      )}
    >
      {children}
    </button>
  )
}

function IssueCard({ issue, onFix }: { issue: Issue; onFix: () => void }) {
  const sev = SEVERITY_META[issue.severity]
  const cat = CATEGORY_META[issue.category]
  const CatIcon = cat.icon
  return (
    <div className="card flex items-start gap-3 p-4">
      <div className={clsx('mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full', sev.dot)} title={sev.label} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
            <CatIcon size={12} /> {cat.label}
          </span>
          <h3 className="text-[15px] font-semibold text-ink">{issue.title}</h3>
        </div>
        <p className="mt-1 text-[13px] leading-relaxed text-muted">{issue.detail}</p>
        {issue.amountCents > 0 && (
          <p className="mt-1 text-[13px] font-medium text-ink">{formatMoney(issue.amountCents, issue.currency)}</p>
        )}
      </div>
      {issue.fix && (
        <button
          className="btn-ghost flex shrink-0 items-center gap-1 self-center text-[13px] font-medium text-sonic-orange"
          onClick={onFix}
        >
          {issue.fix.label}
          <ChevronRight size={15} />
        </button>
      )}
    </div>
  )
}

function ReviewAiPanel({ issues, onApplied }: { issues: Issue[]; onApplied: () => void }) {
  const config = useMemo(() => loadAssistantConfig(), [])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [results, setResults] = useState<string[]>([])

  async function send() {
    setError(null)
    setResults([])
    setProposal(null)
    setLoading(true)
    try {
      const prompt =
        input.trim() ||
        'Look at the open issues across all companies and tell me what to fix first. Propose the reclassifications you can apply, and for anything you can\'t fix directly, tell me where to handle it.'
      const p = await runReviewProposal(prompt, issues, config)
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
    proposal.actions.forEach((a, i) => {
      if (checked.has(i)) {
        try {
          out.push(applyProposedAction(a))
        } catch (e) {
          out.push(`Failed: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
    })
    setResults(out)
    setProposal(null)
    onApplied()
  }

  return (
    <div className="card mb-5 space-y-3 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-ink">
        <Sparkles size={15} className="text-sonic-orange" /> Ask AI
        <span className="text-xs font-normal text-subtle">· works across all your companies</span>
      </div>
      <div className="flex items-start gap-2">
        <textarea
          className="min-h-[2.5rem] flex-1 rounded-control border border-rule px-3 py-2 text-sm"
          rows={2}
          placeholder={`e.g. "Clean up the suspense accounts", "what should I fix first?", or "move all the ATM cash to the shareholder loan"`}
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button className="btn-primary" disabled={loading} onClick={send}>
          <Send size={14} /> {loading ? 'Thinking…' : 'Send'}
        </button>
      </div>

      {error && (
        <div className="rounded-control bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error} {error.includes('API key') && <Link to="/settings" className="underline">Open Settings</Link>}
        </div>
      )}

      {proposal && (
        <div className="space-y-2">
          {proposal.message && <p className="whitespace-pre-wrap text-sm text-muted">{proposal.message}</p>}
          {proposal.actions.length === 0 ? (
            <p className="text-sm text-subtle">No actions proposed — see the note above.</p>
          ) : (
            <>
              <div className="text-xs font-semibold uppercase tracking-wide text-subtle">Proposed — review &amp; apply</div>
              <ul className="space-y-1.5">
                {proposal.actions.map((a, i) => {
                  const d = describeAction(a)
                  return (
                    <li key={i} className="flex items-start gap-2 rounded-control border border-rule bg-surface px-3 py-2 text-sm">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={checked.has(i)}
                        onChange={(e) => {
                          const next = new Set(checked)
                          if (e.target.checked) next.add(i)
                          else next.delete(i)
                          setChecked(next)
                        }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-ink">
                          {d.label} <span className="text-xs font-normal text-subtle">· {d.impact}</span>
                        </div>
                        {a.reason && <div className="text-xs text-muted">{a.reason}</div>}
                      </div>
                    </li>
                  )
                })}
              </ul>
              <div className="flex items-center gap-2">
                <button className="btn-primary" disabled={checked.size === 0} onClick={apply}>
                  Apply {checked.size} selected
                </button>
                <button className="btn-ghost text-sm" onClick={() => setProposal(null)}>
                  Discard
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {results.length > 0 && (
        <ul className="space-y-0.5 text-sm text-emerald-700">
          {results.map((r, i) => (
            <li key={i} className="flex items-center gap-1.5">
              <CheckCircle2 size={13} /> {r}
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-subtle">
        The AI only proposes — nothing changes until you Apply. Every applied action is balanced, written to the audit log, and
        reversible. It can reclassify and set ignore rules; deletions, merges, and edits are left for you to do by hand.
      </p>
    </div>
  )
}

function AllClear() {
  return (
    <div className="card flex flex-col items-center gap-2 p-10 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-full bg-emerald-50">
        <Layers size={26} className="text-emerald-600" />
      </div>
      <h2 className="text-lg font-semibold text-ink">Nothing to review</h2>
      <p className="max-w-sm text-sm text-muted">
        Every health check passed across all companies — the books balance, transfers tie out, and nothing is sitting
        uncategorized. Nice.
      </p>
    </div>
  )
}
