import { useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { Upload, CheckCircle2, AlertTriangle, FileWarning, Download, Scale } from 'lucide-react'
import { useStore } from '../state/store'
import { getAccounts, trialBalanceRange } from '../db/repo'
import {
  parseExternalTrialBalance, suggestMatches, reconcile,
  type ExtTrialBalance, type MatchStrength, type MatchSuggestion, type ReconResult, type ReconRow, type ExtTbLine,
} from '../db/tbReconcile'
import type { Account } from '../db/types'
import { Money } from '../components/Money'
import { formatMoney } from '../lib/money'

/**
 * Reconcile the selected company's books against an uploaded external trial
 * balance (a QuickBooks "Trial Balance" CSV). The app matches lines and does
 * the arithmetic; the result is an exact, line-by-line diff — ties, mismatches,
 * and anything present on only one side. Mappings for renamed accounts are
 * remembered per company so a re-upload lands in the same place.
 */

const MAP_KEY = (companyId: number) => `sonic.tbmap.${companyId}`

function loadSavedMap(companyId: number): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(MAP_KEY(companyId)) ?? '{}') } catch { return {} }
}
function saveSavedMap(companyId: number, byName: Record<string, string>) {
  try { localStorage.setItem(MAP_KEY(companyId), JSON.stringify(byName)) } catch { /* ignore */ }
}

const STRENGTH_BADGE: Record<MatchStrength, { label: string; cls: string }> = {
  exact: { label: 'number', cls: 'bg-emerald-100 text-emerald-700' },
  strong: { label: 'name', cls: 'bg-sky-100 text-sky-700' },
  weak: { label: 'maybe', cls: 'bg-amber-100 text-amber-700' },
  none: { label: 'unmatched', cls: 'bg-rose-100 text-rose-700' },
}

export default function ReconcileTB() {
  const companyId = useStore((s) => s.currentCompanyId)
  const companies = useStore((s) => s.companies)
  const rev = useStore((s) => s.rev)
  void rev
  const company = companies.find((c) => c.id === companyId)
  const cur = company?.base_currency ?? 'CAD'

  const [ext, setExt] = useState<ExtTrialBalance | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  // lineId -> app accountId ('' = unmatched)
  const [mapping, setMapping] = useState<Record<number, number | ''>>({})
  const [result, setResult] = useState<ReconResult | null>(null)

  const accounts = useMemo<Account[]>(() => (companyId ? getAccounts(companyId, true) : []), [companyId, rev])
  const appRows = useMemo(
    () => (companyId ? trialBalanceRange(companyId, start || undefined, end || undefined) : []),
    [companyId, start, end, rev],
  )
  const acctById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts])

  function onFile(file: File | undefined) {
    if (!file || !companyId) return
    setParseError(null); setResult(null)
    setFileName(file.name)
    const reader = new FileReader()
    reader.onerror = () => setParseError(`Could not read ${file.name}.`)
    reader.onload = () => {
      try {
        const parsed = parseExternalTrialBalance(String(reader.result ?? ''))
        if (parsed.lines.length === 0) {
          setParseError('No account lines found. Make sure this is a Trial Balance CSV with Account / Debit / Credit columns.')
          setExt(null); return
        }
        setExt(parsed)
        // Auto-match, then apply any remembered overrides (by account name).
        const suggestions = suggestMatches(parsed, accounts)
        const saved = loadSavedMap(companyId)
        const codeToId = new Map(accounts.map((a) => [a.code?.trim(), a.id]))
        const next: Record<number, number | ''> = {}
        for (const line of parsed.lines) {
          const savedCode = saved[line.fullName]
          const savedId = savedCode != null ? codeToId.get(savedCode) : undefined
          next[line.id] = savedId ?? suggestions.get(line.id)?.accountId ?? ''
        }
        setMapping(next)
      } catch (e) {
        setParseError(e instanceof Error ? e.message : String(e))
      }
    }
    reader.readAsText(file)
  }

  function setLineMap(line: ExtTbLine, accountId: number | '') {
    setMapping((m) => ({ ...m, [line.id]: accountId }))
    if (companyId && ext) {
      const saved = loadSavedMap(companyId)
      if (accountId === '') delete saved[line.fullName]
      else { const a = acctById.get(accountId); if (a) saved[line.fullName] = a.code?.trim() ?? String(accountId) }
      saveSavedMap(companyId, saved)
    }
  }

  function runReconcile() {
    if (!ext || !companyId) return
    const m = new Map<number, number | null>()
    for (const line of ext.lines) m.set(line.id, mapping[line.id] === '' ? null : (mapping[line.id] as number))
    setResult(reconcile(ext, appRows, m))
  }

  const suggestions = useMemo<Map<number, MatchSuggestion>>(() => (ext ? suggestMatches(ext, accounts) : new Map()), [ext, accounts])

  if (!companyId) return <div className="p-8 text-muted">Select a company first.</div>

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-1 flex items-center gap-2">
        <Scale size={20} className="text-brand-600" />
        <h1 className="section-title text-ink">Reconcile against a trial balance</h1>
      </div>
      <p className="mb-5 text-sm text-muted">
        Upload a QuickBooks (or other) Trial Balance export for <span className="font-medium text-ink">{company?.name}</span>.
        The app matches each line to one of its accounts and computes the exact difference — no guessing.
        Switch the active company in the sidebar to reconcile a different one.
      </p>

      {/* Upload + period */}
      <div className="card mb-5 p-4">
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex cursor-pointer items-center gap-2 rounded-control border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-600 hover:border-brand-400 hover:text-brand-600">
            <Upload size={16} />
            {fileName ? <span className="font-medium text-ink">{fileName}</span> : 'Choose Trial Balance CSV…'}
            <input type="file" accept=".csv,text/csv,text/plain" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">App period — from</label>
            <input type="date" className="input text-sm" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">to</label>
            <input type="date" className="input text-sm" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
          <p className="max-w-xs text-xs text-subtle">
            Leave the dates blank for an all-time balance. Set them to match the report's period if it covers only one year.
          </p>
        </div>
        {parseError && (
          <div className="mt-3 flex items-start gap-2 rounded-control bg-rose-50 px-3 py-2 text-sm text-rose-700">
            <FileWarning size={15} className="mt-0.5 shrink-0" /> {parseError}
          </div>
        )}
      </div>

      {ext && (
        <>
          {/* Parse summary */}
          <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-muted">
            {ext.companyName && <span>Report: <span className="font-medium text-ink">{ext.companyName}</span></span>}
            {ext.asOf && <span>As of <span className="font-medium text-ink">{ext.asOf}</span></span>}
            <span>{ext.lines.length} nonzero lines</span>
            <span>Dr {formatMoney(ext.totalDebit, cur)} · Cr {formatMoney(ext.totalCredit, cur)}</span>
            {ext.totalDebit !== ext.totalCredit && (
              <span className="text-amber-600">⚠ report sides differ by {formatMoney(Math.abs(ext.totalDebit - ext.totalCredit), cur)}</span>
            )}
          </div>

          {/* Mapping table */}
          <div className="card mb-5 overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
              <h2 className="text-sm font-semibold text-ink">Match report lines to accounts</h2>
              <button className="btn-primary px-3 py-1.5 text-sm" onClick={runReconcile}>Reconcile</button>
            </div>
            <div className="max-h-[22rem] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase tracking-wide text-subtle">
                  <tr>
                    <th className="px-4 py-2 font-medium">Report line</th>
                    <th className="px-2 py-2 text-right font-medium">Balance</th>
                    <th className="px-2 py-2 font-medium">Match</th>
                    <th className="px-4 py-2 font-medium">App account</th>
                  </tr>
                </thead>
                <tbody>
                  {ext.lines.map((line) => {
                    const strength = suggestions.get(line.id)?.strength ?? 'none'
                    const sel = mapping[line.id] ?? ''
                    const badge = STRENGTH_BADGE[sel === '' ? 'none' : strength]
                    return (
                      <tr key={line.id} className="border-t border-slate-50">
                        <td className="px-4 py-1.5">
                          <span className="text-ink">{line.leaf}</span>
                          {line.fullName !== line.leaf && <span className="block text-xs text-subtle">{line.fullName}</span>}
                        </td>
                        <td className="px-2 py-1.5 text-right"><Money cents={line.net} currency={cur} colored /></td>
                        <td className="px-2 py-1.5">
                          <span className={clsx('rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase', badge.cls)}>{badge.label}</span>
                        </td>
                        <td className="px-4 py-1.5">
                          <select
                            className="input w-full max-w-xs text-xs"
                            value={sel}
                            onChange={(e) => setLineMap(line, e.target.value === '' ? '' : Number(e.target.value))}
                          >
                            <option value="">— unmatched —</option>
                            {accounts.map((a) => (
                              <option key={a.id} value={a.id}>{a.code ? `${a.code} · ` : ''}{a.name}</option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {result && <Results result={result} cur={cur} company={company?.name ?? 'company'} />}
    </div>
  )
}

function Results({ result, cur, company }: { result: ReconResult; cur: string; company: string }) {
  const tie = Math.abs(result.totalAbsDiff) < 1 && result.extOnly.length === 0 && result.appOnly.length === 0
  return (
    <div className="space-y-5">
      {/* Headline */}
      <div className={clsx('rounded-xl border p-4', tie ? 'border-emerald-200 bg-emerald-50/60' : 'border-amber-200 bg-amber-50/60')}>
        <div className="flex items-center gap-2 text-sm font-semibold">
          {tie ? <CheckCircle2 size={16} className="text-emerald-600" /> : <AlertTriangle size={16} className="text-amber-600" />}
          {tie ? 'The books agree with the report.' : <>Total difference: <Money cents={result.totalAbsDiff} currency={cur} /></>}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-3 text-xs text-slate-600 sm:grid-cols-4">
          <Tile label="Agree" value={`${result.ties.length}`} />
          <Tile label="Mismatched" value={`${result.mismatches.length}`} tone={result.mismatches.length ? 'warn' : undefined} />
          <Tile label="Report only" value={`${result.extOnly.length}`} tone={result.extOnly.length ? 'warn' : undefined} />
          <Tile label="App only" value={`${result.appOnly.length}`} tone={result.appOnly.length ? 'warn' : undefined} />
        </div>
      </div>

      {result.mismatches.length > 0 && (
        <Section title="Mismatched — matched accounts that disagree" tone="warn">
          <DiffTable rows={result.mismatches} cur={cur} />
        </Section>
      )}
      {result.appOnly.length > 0 && (
        <Section title="In the app, not in the report" tone="warn">
          <DiffTable rows={result.appOnly} cur={cur} hideExt />
        </Section>
      )}
      {result.extOnly.length > 0 && (
        <Section title="In the report, not in the app" tone="warn">
          <table className="w-full text-sm">
            <tbody>
              {result.extOnly.map((l) => (
                <tr key={l.id} className="border-t border-slate-50">
                  <td className="px-4 py-1.5 text-ink">{l.fullName}</td>
                  <td className="px-4 py-1.5 text-right"><Money cents={l.net} currency={cur} colored /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}
      {result.ties.length > 0 && (
        <Section title={`Agree (${result.ties.length})`}>
          <DiffTable rows={result.ties} cur={cur} />
        </Section>
      )}

      <button
        className="inline-flex items-center gap-1.5 rounded-control border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
        onClick={() => downloadDiffCsv(result, cur, company)}
      >
        <Download size={14} /> Download full diff (CSV)
      </button>
    </div>
  )
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: 'warn' }) {
  return (
    <div className="rounded-lg bg-white/70 px-3 py-2">
      <div className={clsx('text-lg font-semibold', tone === 'warn' ? 'text-amber-700' : 'text-slate-800')}>{value}</div>
      <div className="text-[11px] uppercase tracking-wide text-subtle">{label}</div>
    </div>
  )
}

function Section({ title, tone, children }: { title: string; tone?: 'warn'; children: React.ReactNode }) {
  return (
    <div className="card overflow-hidden">
      <div className={clsx('border-b px-4 py-2.5 text-sm font-semibold', tone === 'warn' ? 'border-amber-100 text-amber-800' : 'border-slate-100 text-ink')}>
        {title}
      </div>
      <div className="overflow-x-auto">{children}</div>
    </div>
  )
}

function DiffTable({ rows, cur, hideExt }: { rows: ReconRow[]; cur: string; hideExt?: boolean }) {
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs uppercase tracking-wide text-subtle">
        <tr>
          <th className="px-4 py-2 font-medium">Account</th>
          <th className="px-2 py-2 text-right font-medium">App</th>
          {!hideExt && <th className="px-2 py-2 text-right font-medium">Report</th>}
          {!hideExt && <th className="px-4 py-2 text-right font-medium">Difference</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.account.id} className="border-t border-slate-50">
            <td className="px-4 py-1.5">
              <span className="text-ink">{r.account.code ? `${r.account.code} · ` : ''}{r.account.name}</span>
              {r.extLines.length > 1 && <span className="block text-xs text-subtle">{r.extLines.length} report lines combined</span>}
            </td>
            <td className="px-2 py-1.5 text-right"><Money cents={r.appNet} currency={cur} colored /></td>
            {!hideExt && <td className="px-2 py-1.5 text-right"><Money cents={r.extNet} currency={cur} colored /></td>}
            {!hideExt && (
              <td className="px-4 py-1.5 text-right font-medium">
                {Math.abs(r.diff) < 1 ? <span className="text-emerald-600">—</span> : <Money cents={r.diff} currency={cur} colored />}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function downloadDiffCsv(result: ReconResult, cur: string, company: string) {
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`
  const dollars = (c: number) => (c / 100).toFixed(2)
  const lines: string[] = ['Section,Account,App,Report,Difference']
  const push = (section: string, acct: string, app: number | '', ext: number | '', diff: number | '') =>
    lines.push([esc(section), esc(acct), app === '' ? '' : dollars(app), ext === '' ? '' : dollars(ext), diff === '' ? '' : dollars(diff)].join(','))
  for (const r of result.mismatches) push('Mismatch', `${r.account.code ?? ''} ${r.account.name}`.trim(), r.appNet, r.extNet, r.diff)
  for (const r of result.appOnly) push('App only', `${r.account.code ?? ''} ${r.account.name}`.trim(), r.appNet, '', r.appNet)
  for (const l of result.extOnly) push('Report only', l.fullName, '', l.net, -l.net)
  for (const r of result.ties) push('Agree', `${r.account.code ?? ''} ${r.account.name}`.trim(), r.appNet, r.extNet, r.diff)
  void cur
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `reconcile-${company.replace(/[^a-z0-9]+/gi, '_')}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
