/**
 * Reconcile the app's books against an external trial balance (e.g. a
 * QuickBooks "Trial Balance" CSV export). The point is to do the matching and
 * the arithmetic DETERMINISTICALLY — the thing the chat assistant kept getting
 * wrong — so the owner sees an exact, line-by-line diff instead of an LLM's
 * eyeballed guess.
 *
 * Flow:
 *   1. parseExternalTrialBalance(csv) — pull the account lines + totals out of
 *      the export, tolerant of QB's header/blank/total rows and ":"-nested
 *      subaccount names.
 *   2. suggestMatches(...) — auto-pair each external line to an app account by
 *      account number, then normalized name, then token overlap. The owner can
 *      override any pairing in the UI.
 *   3. reconcile(...) — compute, per app account, (app net − external net), and
 *      bucket everything into: ties, mismatches, external-only, app-only.
 *
 * All amounts are integer cents, debit-positive (a positive net is a debit
 * balance, negative is a credit balance) so the app side (from
 * trialBalanceRange) and the external side compare directly.
 */

import type { Account } from './types'
import type { TrialBalanceAcct } from './repo'

// ---- CSV parsing (quoted-field aware; local copy to stay self-contained) ---

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  const s = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (inQuotes) {
      if (ch === '"') { if (s[i + 1] === '"') { field += '"'; i++ } else inQuotes = false } else field += ch
    } else if (ch === '"') inQuotes = true
    else if (ch === ',') { row.push(field); field = '' }
    else if (ch === '\n') { row.push(field); field = ''; rows.push(row); row = [] }
    else field += ch
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows
}

function toCents(v: string | undefined): number {
  if (!v) return 0
  const neg = /\(.*\)/.test(v) // accounting negatives: (123.45)
  const n = parseFloat(v.replace(/[(),$\s]/g, ''))
  if (isNaN(n)) return 0
  return Math.round(n * 100) * (neg ? -1 : 1)
}

// ---- External trial balance ------------------------------------------------

export interface ExtTbLine {
  /** Stable index within the parse, for React keys. */
  id: number
  /** The account name exactly as the export shows it (may be "Parent:Child"). */
  fullName: string
  /** The leaf name (after the last ":"). */
  leaf: string
  /** Leading numeric token (account number) if the name starts with one. */
  numberToken: string | null
  debit: number
  credit: number
  /** debit − credit, in cents (debit-positive). */
  net: number
}

export interface ExtTrialBalance {
  companyName: string | null
  asOf: string | null
  lines: ExtTbLine[]
  totalDebit: number
  totalCredit: number
  /** The TOTAL row from the export, if present, for a sanity check. */
  reportedTotalDebit: number | null
  reportedTotalCredit: number | null
}

function splitName(fullName: string): { leaf: string; numberToken: string | null } {
  const parts = fullName.split(':')
  const leaf = parts[parts.length - 1].trim()
  // A leading number token on the full name OR the leaf (QB puts it either place).
  const m = fullName.trim().match(/^(\d{3,6}[A-Za-z]?)\b/) || leaf.match(/^(\d{3,6}[A-Za-z]?)\b/)
  return { leaf, numberToken: m ? m[1] : null }
}

export function parseExternalTrialBalance(csv: string): ExtTrialBalance {
  const rows = parseCsv(csv)
  let companyName: string | null = null
  let asOf: string | null = null
  let headerIdx = -1
  let nameCol = 0, debitCol = -1, creditCol = -1

  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i].map((c) => c.trim())
    const lower = cells.map((c) => c.toLowerCase())
    if (headerIdx < 0) {
      // Metadata rows before the header.
      if (companyName === null && cells[0] && !/trial balance/i.test(cells[0])) companyName = cells[0]
      const asOfCell = cells.find((c) => /as of/i.test(c))
      if (asOfCell) asOf = asOfCell.replace(/^as of\s*/i, '').trim()
      const d = lower.indexOf('debit')
      const cr = lower.indexOf('credit')
      if (d >= 0 && cr >= 0) {
        headerIdx = i; debitCol = d; creditCol = cr
        // Account-name column: the labelled one, else the first column.
        const n = lower.findIndex((c) => /account|name/.test(c))
        nameCol = n >= 0 ? n : 0
      }
    }
  }

  const lines: ExtTbLine[] = []
  let totalDebit = 0, totalCredit = 0
  let reportedTotalDebit: number | null = null, reportedTotalCredit: number | null = null
  if (headerIdx >= 0) {
    let id = 0
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const cells = rows[i]
      const name = (cells[nameCol] ?? '').trim()
      if (!name) continue
      if (/^total\b/i.test(name)) {
        reportedTotalDebit = toCents(cells[debitCol]); reportedTotalCredit = toCents(cells[creditCol])
        continue
      }
      const debit = toCents(cells[debitCol])
      const credit = toCents(cells[creditCol])
      const net = debit - credit
      if (net === 0) continue // skip zero-balance subaccounts
      const { leaf, numberToken } = splitName(name)
      lines.push({ id: id++, fullName: name, leaf, numberToken, debit, credit, net })
      totalDebit += debit; totalCredit += credit
    }
  }

  return { companyName, asOf, lines, totalDebit, totalCredit, reportedTotalDebit, reportedTotalCredit }
}

// ---- Matching --------------------------------------------------------------

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
}
function stripNum(s: string): string {
  return norm(s).replace(/^\d+[a-z]?\s*/, '').trim()
}
function tokens(s: string): Set<string> {
  return new Set(stripNum(s).split(' ').filter((t) => t.length > 2))
}

export type MatchStrength = 'exact' | 'strong' | 'weak' | 'none'

export interface MatchSuggestion {
  accountId: number | null
  strength: MatchStrength
}

/** Best app-account guess for one external line. */
function bestMatch(line: ExtTbLine, accts: Account[]): MatchSuggestion {
  // 1) Account number exact.
  if (line.numberToken) {
    const byNum = accts.find((a) => a.code && a.code.trim() === line.numberToken)
    if (byNum) return { accountId: byNum.id, strength: 'exact' }
  }
  const leaf = stripNum(line.leaf)
  const full = stripNum(line.fullName.replace(/:/g, ' '))
  // 2) Normalized name equality (leaf or full).
  for (const a of accts) {
    const an = stripNum(a.name)
    if (an && (an === leaf || an === full)) return { accountId: a.id, strength: 'strong' }
  }
  // 3) Token overlap — pick the highest-scoring account above a floor.
  const lineTok = tokens(line.fullName)
  if (lineTok.size) {
    let best: { id: number; score: number } | null = null
    for (const a of accts) {
      const at = tokens(a.name)
      if (!at.size) continue
      let shared = 0
      for (const t of lineTok) if (at.has(t)) shared++
      const score = shared / Math.max(lineTok.size, at.size)
      if (score > 0 && (!best || score > best.score)) best = { id: a.id, score }
    }
    if (best && best.score >= 0.6) return { accountId: best.id, strength: 'strong' }
    if (best && best.score >= 0.34) return { accountId: best.id, strength: 'weak' }
  }
  return { accountId: null, strength: 'none' }
}

/** Suggest a mapping for every external line. Returns a map lineId → suggestion. */
export function suggestMatches(ext: ExtTrialBalance, accts: Account[]): Map<number, MatchSuggestion> {
  const m = new Map<number, MatchSuggestion>()
  for (const line of ext.lines) m.set(line.id, bestMatch(line, accts))
  return m
}

// ---- Reconcile -------------------------------------------------------------

export interface ReconRow {
  account: Account
  appNet: number
  extNet: number
  diff: number // appNet − extNet
  /** External lines that mapped onto this account (often >1 for QB subaccounts). */
  extLines: ExtTbLine[]
}

export interface ReconResult {
  ties: ReconRow[]          // mapped and agree (|diff| < 1¢)
  mismatches: ReconRow[]    // mapped but differ
  extOnly: ExtTbLine[]      // external line, no app account mapped
  appOnly: ReconRow[]       // app account nonzero, nothing external mapped to it
  appTotalNet: number       // sum of app nets (should be ~0 for a balanced ledger)
  extTotalNet: number       // sum of external nets (should be ~0)
  appTotalDebit: number
  appTotalCredit: number
  extTotalDebit: number
  extTotalCredit: number
  /** Net of every discrepancy — how far the two sets of books are apart. */
  totalAbsDiff: number
}

/**
 * Compute the reconciliation. `mapping` is lineId → app accountId (null/absent
 * means the owner left it unmatched). Many external lines may map to one app
 * account; their nets are summed.
 */
export function reconcile(
  ext: ExtTrialBalance,
  appRows: TrialBalanceAcct[],
  mapping: Map<number, number | null>,
): ReconResult {
  const appById = new Map(appRows.map((r) => [r.account.id, r]))
  const extByApp = new Map<number, ExtTbLine[]>()
  const extOnly: ExtTbLine[] = []

  for (const line of ext.lines) {
    const target = mapping.get(line.id) ?? null
    if (target != null && appById.has(target)) {
      const arr = extByApp.get(target) ?? []
      arr.push(line)
      extByApp.set(target, arr)
    } else {
      extOnly.push(line)
    }
  }

  const ties: ReconRow[] = []
  const mismatches: ReconRow[] = []
  const appOnly: ReconRow[] = []

  for (const r of appRows) {
    const extLines = extByApp.get(r.account.id)
    const appNet = r.net
    if (extLines && extLines.length) {
      const extNet = extLines.reduce((s, l) => s + l.net, 0)
      const row: ReconRow = { account: r.account, appNet, extNet, diff: appNet - extNet, extLines }
      ;(Math.abs(row.diff) < 1 ? ties : mismatches).push(row)
    } else if (appNet !== 0) {
      appOnly.push({ account: r.account, appNet, extNet: 0, diff: appNet, extLines: [] })
    }
  }

  const bySize = (a: ReconRow, b: ReconRow) => Math.abs(b.diff) - Math.abs(a.diff)
  mismatches.sort(bySize)
  appOnly.sort((a, b) => Math.abs(b.appNet) - Math.abs(a.appNet))
  extOnly.sort((a, b) => Math.abs(b.net) - Math.abs(a.net))

  const appTotalNet = appRows.reduce((s, r) => s + r.net, 0)
  const extTotalNet = ext.lines.reduce((s, l) => s + l.net, 0)
  const appTotalDebit = appRows.reduce((s, r) => s + (r.net > 0 ? r.net : 0), 0)
  const appTotalCredit = appRows.reduce((s, r) => s + (r.net < 0 ? -r.net : 0), 0)
  const totalAbsDiff =
    mismatches.reduce((s, r) => s + Math.abs(r.diff), 0) +
    appOnly.reduce((s, r) => s + Math.abs(r.appNet), 0) +
    extOnly.reduce((s, l) => s + Math.abs(l.net), 0)

  return {
    ties, mismatches, extOnly, appOnly,
    appTotalNet, extTotalNet,
    appTotalDebit, appTotalCredit,
    extTotalDebit: ext.totalDebit, extTotalCredit: ext.totalCredit,
    totalAbsDiff,
  }
}
