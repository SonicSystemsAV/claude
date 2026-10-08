import { useMemo, useRef, useState } from 'react'
import {
  Wand2,
  Upload,
  Check,
  X,
  Link2,
  Unlink,
  Rows3,
  Rows4,
  Sparkles,
} from 'lucide-react'
import { clsx } from 'clsx'
import { useStore } from '../state/store'
import {
  getBankAccounts,
  getBankTransactions,
  getAccounts,
  categorizeBank,
  categorizeMany,
  ignoreBank,
  unmatchBank,
  matchBankToTxn,
  insertBankTransactions,
  suggestAccountByRules,
  applyRules,
} from '../db/repo'
import { autoMatch, candidatesFor, type Candidate } from '../db/matching'
import { parseBankFile } from '../db/importers'
import type { Account, BankStatus, BankTxn } from '../db/types'
import { Money } from '../components/Money'
import { shortDate } from '../lib/format'

type Filter = BankStatus | 'all'

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'unmatched', label: 'Unmatched' },
  { key: 'matched', label: 'Matched' },
  { key: 'ignored', label: 'Ignored' },
  { key: 'all', label: 'All' },
]

export default function Reconcile() {
  const companyId = useStore((s) => s.currentCompanyId)
  const refresh = useStore((s) => s.refresh)
  const rev = useStore((s) => s.rev)

  const [filter, setFilter] = useState<Filter>('unmatched')
  const [bankId, setBankId] = useState<number | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [rowCat, setRowCat] = useState<Record<number, number>>({})
  const [bulkCat, setBulkCat] = useState<number | ''>('')
  const [compact, setCompact] = useState(true)
  const [message, setMessage] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const banks = companyId != null ? getBankAccounts(companyId) : []
  const activeBankId = bankId ?? banks[0]?.id ?? null

  // All non-bank-of-interest accounts for the category picker, grouped by type.
  const postingAccounts = useMemo(() => {
    if (companyId == null) return []
    return getAccounts(companyId).filter((a) => a.id !== activeBankId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, activeBankId, rev])

  if (companyId == null) return null
  if (banks.length === 0) {
    return (
      <div className="p-6 text-slate-500">No bank accounts yet. Add one in the Chart of Accounts.</div>
    )
  }

  const rows =
    activeBankId != null
      ? getBankTransactions(companyId, {
          accountId: activeBankId,
          status: filter === 'all' ? undefined : filter,
        })
      : []

  // counts per filter for the tabs
  const counts = {
    unmatched: getBankTransactions(companyId, { accountId: activeBankId!, status: 'unmatched' }).length,
    matched: getBankTransactions(companyId, { accountId: activeBankId!, status: 'matched' }).length,
    ignored: getBankTransactions(companyId, { accountId: activeBankId!, status: 'ignored' }).length,
  }

  function flash(msg: string) {
    setMessage(msg)
    setTimeout(() => setMessage(null), 4000)
  }

  function runAutoMatch() {
    const total = counts.unmatched
    const n = autoMatch(companyId!)
    refresh()
    flash(n > 0 ? `Auto-matched ${n} of ${total} transactions.` : 'No confident matches found.')
  }

  function runRules() {
    const n = applyRules(companyId!)
    refresh()
    flash(n > 0 ? `Rules categorized ${n} transaction${n === 1 ? '' : 's'}.` : 'No rules matched.')
  }

  async function onImport(file: File) {
    const text = await file.text()
    const parsed = parseBankFile(file.name, text)
    if (parsed.length === 0) {
      flash('Could not read any transactions from that file.')
      return
    }
    const inserted = insertBankTransactions(companyId!, activeBankId!, parsed)
    refresh()
    flash(
      `Imported ${inserted} new transaction${inserted === 1 ? '' : 's'}` +
        (inserted < parsed.length ? ` (${parsed.length - inserted} duplicates skipped).` : '.'),
    )
  }

  function toggleSelect(id: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function selectAll() {
    if (selected.size === rows.length) setSelected(new Set())
    else setSelected(new Set(rows.map((r) => r.id)))
  }

  function categorize(bt: BankTxn, accountId: number) {
    categorizeBank(bt.id, accountId)
    refresh()
    setSelected((prev) => {
      const next = new Set(prev)
      next.delete(bt.id)
      return next
    })
  }

  function bulkApply() {
    if (bulkCat === '' || selected.size === 0) return
    const n = categorizeMany([...selected], Number(bulkCat))
    setSelected(new Set())
    setBulkCat('')
    refresh()
    flash(`Categorized ${n} transaction${n === 1 ? '' : 's'}.`)
  }

  const pad = compact ? 'py-1.5' : 'py-3'

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="border-b border-slate-200 bg-white px-6 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-slate-900">Reconcile</h1>
            {banks.length > 1 && (
              <select
                value={activeBankId ?? ''}
                onChange={(e) => {
                  setBankId(Number(e.target.value))
                  setSelected(new Set())
                }}
                className="rounded-md border border-slate-300 px-2 py-1 text-sm"
              >
                {banks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn-primary" onClick={runAutoMatch}>
              <Sparkles size={16} /> Auto-match
            </button>
            <button className="btn-outline" onClick={runRules}>
              <Wand2 size={16} /> Apply rules
            </button>
            <button className="btn-outline" onClick={() => fileRef.current?.click()}>
              <Upload size={16} /> Import
            </button>
            <button
              className="btn-ghost"
              title={compact ? 'Comfortable rows' : 'Compact rows'}
              onClick={() => setCompact((v) => !v)}
            >
              {compact ? <Rows3 size={16} /> : <Rows4 size={16} />}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.ofx,.qfx,.qbo,.txt"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void onImport(f)
                e.target.value = ''
              }}
            />
          </div>
        </div>

        {/* Filter tabs */}
        <div className="mt-3 flex items-center gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => {
                setFilter(f.key)
                setSelected(new Set())
              }}
              className={clsx(
                'rounded-md px-3 py-1 text-sm font-medium transition',
                filter === f.key ? 'bg-brand-50 text-brand-700' : 'text-slate-500 hover:bg-slate-100',
              )}
            >
              {f.label}
              {f.key !== 'all' && (
                <span className="ml-1.5 text-xs text-slate-400">{counts[f.key as BankStatus]}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {message && (
        <div className="bg-brand-600 px-6 py-1.5 text-sm font-medium text-white">{message}</div>
      )}

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-6 py-2">
          <span className="text-sm font-medium text-amber-800">{selected.size} selected</span>
          <select
            value={bulkCat}
            onChange={(e) => setBulkCat(e.target.value === '' ? '' : Number(e.target.value))}
            className="rounded-md border border-amber-300 bg-white px-2 py-1 text-sm"
          >
            <option value="">Categorize all as…</option>
            {groupedOptions(postingAccounts)}
          </select>
          <button className="btn-primary" onClick={bulkApply} disabled={bulkCat === ''}>
            Apply to {selected.size}
          </button>
          <button className="btn-ghost" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      )}

      {/* Grid */}
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="w-10 px-3 py-2">
                <input
                  type="checkbox"
                  checked={rows.length > 0 && selected.size === rows.length}
                  onChange={selectAll}
                />
              </th>
              <th className="w-20 px-2 py-2">Date</th>
              <th className="px-2 py-2">Description</th>
              <th className="px-2 py-2">Match / Category</th>
              <th className="w-28 px-3 py-2 text-right">Amount</th>
              <th className="w-24 px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-10 text-center text-slate-400">
                  {filter === 'unmatched' ? '🎉 Nothing left to reconcile here.' : 'Nothing here.'}
                </td>
              </tr>
            )}
            {rows.map((bt) => (
              <Row
                key={bt.id}
                bt={bt}
                companyId={companyId}
                pad={pad}
                selected={selected.has(bt.id)}
                onSelect={() => toggleSelect(bt.id)}
                accounts={postingAccounts}
                rowCat={rowCat}
                setRowCat={setRowCat}
                onCategorize={(accId) => categorize(bt, accId)}
                onIgnore={() => {
                  ignoreBank(bt.id)
                  refresh()
                }}
                onUnmatch={() => {
                  unmatchBank(bt.id)
                  refresh()
                }}
                onMatch={(txnId) => {
                  matchBankToTxn(bt.id, txnId)
                  refresh()
                }}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Row({
  bt,
  companyId,
  pad,
  selected,
  onSelect,
  accounts,
  rowCat,
  setRowCat,
  onCategorize,
  onIgnore,
  onUnmatch,
  onMatch,
}: {
  bt: BankTxn
  companyId: number
  pad: string
  selected: boolean
  onSelect: () => void
  accounts: Account[]
  rowCat: Record<number, number>
  setRowCat: React.Dispatch<React.SetStateAction<Record<number, number>>>
  onCategorize: (accountId: number) => void
  onIgnore: () => void
  onUnmatch: () => void
  onMatch: (txnId: number) => void
}) {
  // Best candidate match (only meaningful while unmatched).
  const candidate: Candidate | undefined =
    bt.status === 'unmatched' ? candidatesFor(bt, new Set())[0] : undefined

  // Preselected category from rules, unless the user already picked one.
  const ruleSuggestion =
    bt.status === 'unmatched' ? suggestAccountByRules(companyId, bt.description) : null
  const userPicked = Object.prototype.hasOwnProperty.call(rowCat, bt.id)
  const chosen: number | '' = userPicked ? rowCat[bt.id] : (ruleSuggestion ?? '')

  return (
    <tr
      className={clsx(
        'border-b border-slate-100 hover:bg-slate-50',
        selected && 'bg-amber-50/60',
        bt.status === 'ignored' && 'opacity-50',
      )}
    >
      <td className={`px-3 ${pad}`}>
        <input type="checkbox" checked={selected} onChange={onSelect} />
      </td>
      <td className={`whitespace-nowrap px-2 ${pad} text-slate-500`}>{shortDate(bt.date)}</td>
      <td className={`px-2 ${pad} text-slate-800`}>{bt.description}</td>
      <td className={`px-2 ${pad}`}>
        {bt.status === 'matched' ? (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
            <Link2 size={13} /> matched
          </span>
        ) : bt.status === 'ignored' ? (
          <span className="text-xs text-slate-400">ignored</span>
        ) : candidate ? (
          <div className="flex items-center gap-2">
            <ConfidenceBadge value={candidate.confidence} />
            <span className="truncate text-xs text-slate-500" title={candidate.memo ?? ''}>
              {candidate.memo}
            </span>
            <button
              className="btn-ghost px-2 py-0.5 text-xs text-brand-600"
              onClick={() => onMatch(candidate.txnId)}
            >
              Match
            </button>
          </div>
        ) : (
          <select
            value={chosen}
            onChange={(e) => {
              const v = e.target.value === '' ? undefined : Number(e.target.value)
              if (v != null) setRowCat((prev) => ({ ...prev, [bt.id]: v }))
            }}
            className={clsx(
              'rounded-md border px-2 py-1 text-xs',
              ruleSuggestion && !userPicked
                ? 'border-brand-300 bg-brand-50 text-brand-700'
                : 'border-slate-300',
            )}
          >
            <option value="">Categorize as…</option>
            {groupedOptions(accounts)}
          </select>
        )}
      </td>
      <td className={`px-3 ${pad} text-right`}>
        <Money cents={bt.amount_cents} colored />
      </td>
      <td className={`px-3 ${pad}`}>
        <div className="flex items-center justify-end gap-1">
          {bt.status === 'unmatched' && !candidate && (
            <button
              className="btn-primary px-2 py-1 text-xs"
              disabled={chosen === ''}
              onClick={() => chosen !== '' && onCategorize(Number(chosen))}
              title="Post this to the chosen category"
            >
              <Check size={13} />
            </button>
          )}
          {bt.status === 'unmatched' && (
            <button className="btn-ghost px-2 py-1 text-xs" title="Ignore" onClick={onIgnore}>
              <X size={13} />
            </button>
          )}
          {(bt.status === 'matched' || bt.status === 'ignored') && (
            <button
              className="btn-ghost px-2 py-1 text-xs text-slate-500"
              title="Undo"
              onClick={onUnmatch}
            >
              <Unlink size={13} />
            </button>
          )}
        </div>
      </td>
    </tr>
  )
}

function ConfidenceBadge({ value }: { value: number }) {
  const pct = Math.round(value * 100)
  const tone =
    value >= 0.85 ? 'bg-emerald-100 text-emerald-700' : value >= 0.7 ? 'bg-brand-100 text-brand-700' : 'bg-amber-100 text-amber-700'
  return (
    <span className={clsx('rounded px-1.5 py-0.5 text-xs font-semibold tabular-nums', tone)}>
      {pct}%
    </span>
  )
}

function groupedOptions(accounts: Account[]) {
  const types = ['income', 'expense', 'liability', 'equity', 'asset'] as const
  const label: Record<string, string> = {
    income: 'Income',
    expense: 'Expenses',
    liability: 'Liabilities',
    equity: 'Equity',
    asset: 'Assets',
  }
  return types.map((t) => {
    const list = accounts.filter((a) => a.type === t)
    if (list.length === 0) return null
    return (
      <optgroup key={t} label={label[t]}>
        {list.map((a) => (
          <option key={a.id} value={a.id}>
            {a.code} {a.name}
          </option>
        ))}
      </optgroup>
    )
  })
}
