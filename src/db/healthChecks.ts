/**
 * Health-check / validation engine — the accuracy battery behind the Review
 * Center.
 *
 * Each check is deterministic and read-only: it looks at the ledger and emits
 * zero or more `Issue` records. The Review Center aggregates every issue from
 * every company into one worklist, groups and ranks them, and links each one to
 * the place it gets fixed. Nothing here mutates the books.
 *
 * To add a check: write a function `(companies) => Issue[]` and push it into
 * `CHECKS`. Keep it cheap (a query or two) and attribute each issue to the
 * company it belongs to so the Review Center can group by company.
 */

import { all } from './db'
import { formatMoney } from '../lib/money'
import { todayISO } from '../lib/format'
import { reviewInterCompanyTransfers, needsReview, interCompanyTieOuts } from './interCompanyReview'
import { countUnmatched } from './repo'

export type IssueSeverity = 'high' | 'medium' | 'low'

export type IssueCategory =
  | 'balance' // trial balance won't tie / unbalanced entries
  | 'interco' // inter-company tie-out disagreement
  | 'transfers' // transfers still needing review
  | 'uncategorized' // postings to suspense / uncategorized
  | 'reconcile' // bank items not matched to the ledger
  | 'duplicate' // suspected duplicate transactions
  | 'future' // future-dated transactions

export interface IssueFix {
  /** Route to send the user to in order to work the issue. */
  route: string
  /** Button label, e.g. "Review transfers". */
  label: string
}

export interface Issue {
  /** Stable id so the UI can key / dedupe. */
  id: string
  category: IssueCategory
  severity: IssueSeverity
  /** Owning company (for grouping). A cross-company issue picks one side. */
  companyId: number
  companyName: string
  /** Base currency of the owning company, for money formatting. */
  currency: string
  /** Short headline. */
  title: string
  /** One-line plain-English explanation of what's wrong and why it matters. */
  detail: string
  /** How many underlying records (transactions / items). */
  count: number
  /** Dollar magnitude in cents (0 when not money-shaped). */
  amountCents: number
  fix?: IssueFix
}

interface Co {
  id: number
  name: string
  currency: string
}

const SEVERITY_RANK: Record<IssueSeverity, number> = { high: 0, medium: 1, low: 2 }

function listCos(): Co[] {
  return all<{ id: number; name: string; base_currency: string }>(
    'SELECT id, name, base_currency FROM companies ORDER BY name',
  ).map((c) => ({ id: c.id, name: c.name, currency: c.base_currency || 'CAD' }))
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

/** Trial balance won't tie: transactions whose entries don't sum to zero. If
 *  every transaction balances, the whole company balances — so a non-empty
 *  result here is exactly what makes a trial balance ≠ 0. */
function checkUnbalanced(cos: Co[]): Issue[] {
  const rows = all<{ company_id: number; n: number; total: number }>(`
    WITH txtot AS (
      SELECT t.id AS tid, t.company_id AS cid, SUM(e.amount_cents) AS bal
      FROM transactions t JOIN entries e ON e.transaction_id = t.id
      WHERE t.deleted = 0 AND t.status = 'posted'
      GROUP BY t.id
    )
    SELECT cid AS company_id, COUNT(*) AS n, SUM(ABS(bal)) AS total
    FROM txtot WHERE bal <> 0 GROUP BY cid
  `)
  const byCo = new Map(rows.map((r) => [r.company_id, r]))
  const out: Issue[] = []
  for (const c of cos) {
    const r = byCo.get(c.id)
    if (!r || r.n === 0) continue
    out.push({
      id: `balance:${c.id}`,
      category: 'balance',
      severity: 'high',
      companyId: c.id,
      companyName: c.name,
      currency: c.currency,
      title: `Trial balance won't tie — ${r.n} unbalanced transaction${r.n === 1 ? '' : 's'}`,
      detail: `${r.n} transaction${r.n === 1 ? ' has' : 's have'} debits and credits that don't match, so this company's books don't balance. Open each and correct the entry that's off.`,
      count: r.n,
      amountCents: r.total,
      fix: { route: '/transactions', label: 'Open transactions' },
    })
  }
  return out
}

/** Inter-company loans / trade balances that disagree between the two books. */
function checkInterco(cos: Co[]): Issue[] {
  const pairs = interCompanyTieOuts(cos.map((c) => ({ id: c.id, name: c.name })))
  const curOf = (id: number) => cos.find((c) => c.id === id)?.currency ?? 'CAD'
  const out: Issue[] = []
  for (const p of pairs) {
    if (p.balanced) continue
    const bits: string[] = []
    if (Math.abs(p.loanDiff) >= 1) {
      bits.push(
        `their loan / due-to-from accounts are off by ${fmt(Math.abs(p.loanDiff), curOf(p.aId))} (one side recorded a transfer the other didn't)`,
      )
    }
    if (Math.abs(p.tradeDiff) >= 1) {
      bits.push(
        `${p.aName}'s payable to ${p.bName} doesn't match ${p.bName}'s receivable by ${fmt(Math.abs(p.tradeDiff), curOf(p.aId))}`,
      )
    }
    out.push({
      id: `interco:${p.aId}:${p.bId}`,
      category: 'interco',
      severity: 'high',
      companyId: p.aId,
      companyName: `${p.aName} ↔ ${p.bName}`,
      currency: curOf(p.aId),
      title: `${p.aName} and ${p.bName} don't agree`,
      detail: `Between these two companies, ${bits.join('; ')}. One of the two books is missing or miscoding a transfer.`,
      count: 1,
      amountCents: Math.max(Math.abs(p.loanDiff), Math.abs(p.tradeDiff)),
      fix: { route: '/transfers', label: 'Review transfers' },
    })
  }
  return out
}

/** Transfers still sitting in the needs-review queue, bucketed by company. */
function checkTransferBacklog(cos: Co[]): Issue[] {
  let review
  try {
    review = reviewInterCompanyTransfers()
  } catch {
    return []
  }
  const byCo = new Map<number, { count: number; total: number }>()
  for (const m of review.movements) {
    if (!needsReview(m)) continue
    const b = byCo.get(m.movement.companyId) ?? { count: 0, total: 0 }
    b.count++
    b.total += Math.abs(m.movement.signedCents)
    byCo.set(m.movement.companyId, b)
  }
  const out: Issue[] = []
  for (const c of cos) {
    const b = byCo.get(c.id)
    if (!b || b.count === 0) continue
    out.push({
      id: `transfers:${c.id}`,
      category: 'transfers',
      severity: b.count >= 50 ? 'medium' : 'low',
      companyId: c.id,
      companyName: c.name,
      currency: c.currency,
      title: `${b.count} transfer${b.count === 1 ? '' : 's'} need review`,
      detail: `${b.count} bank movement${b.count === 1 ? '' : 's'} look like inter-company or external transfers but haven't been matched or cleared yet.`,
      count: b.count,
      amountCents: b.total,
      fix: { route: '/transfers', label: 'Review transfers' },
    })
  }
  return out
}

const RE_VAGUE = /\b(uncategor|ask my accountant|suspense|to be (determined|classified)|unknown|unapplied cash|undeposited)\b/i

/** Entries posted to a suspense / uncategorized account — real money with no
 *  real category, so every report built on it is wrong. */
function checkUncategorized(cos: Co[]): Issue[] {
  const out: Issue[] = []
  for (const c of cos) {
    const accts = all<{ id: number; name: string }>(
      'SELECT id, name FROM accounts WHERE company_id = ? AND archived = 0',
      [c.id],
    ).filter((a) => RE_VAGUE.test(a.name))
    if (!accts.length) continue
    const ids = accts.map((a) => a.id)
    const placeholders = ids.map(() => '?').join(',')
    const r = all<{ n: number; total: number }>(
      `SELECT COUNT(*) AS n, SUM(ABS(e.amount_cents)) AS total
       FROM entries e JOIN transactions t ON t.id = e.transaction_id
       WHERE t.deleted = 0 AND t.status = 'posted' AND e.account_id IN (${placeholders})`,
      ids,
    )[0]
    if (!r || r.n === 0) continue
    out.push({
      id: `uncategorized:${c.id}`,
      category: 'uncategorized',
      severity: 'medium',
      companyId: c.id,
      companyName: c.name,
      currency: c.currency,
      title: `${r.n} posting${r.n === 1 ? '' : 's'} sitting in a suspense account`,
      detail: `${fmt(r.total, c.currency)} is coded to ${accts.map((a) => `"${a.name}"`).join(', ')} — a placeholder, not a real category. Reclassify these so the P&L and balance sheet are right.`,
      count: r.n,
      amountCents: r.total,
      fix: { route: '/transfers', label: 'Categorize' },
    })
  }
  return out
}

/** Bank-feed items not yet matched to a ledger transaction. */
function checkReconcile(cos: Co[]): Issue[] {
  const out: Issue[] = []
  for (const c of cos) {
    const n = countUnmatched(c.id)
    if (!n) continue
    out.push({
      id: `reconcile:${c.id}`,
      category: 'reconcile',
      severity: n >= 25 ? 'medium' : 'low',
      companyId: c.id,
      companyName: c.name,
      currency: c.currency,
      title: `${n} bank item${n === 1 ? '' : 's'} to reconcile`,
      detail: `${n} imported bank line${n === 1 ? ' has' : 's have'} no matching entry in the ledger yet. Match or categorize them so the bank balance ties to the books.`,
      count: n,
      amountCents: 0,
      fix: { route: '/reconcile', label: 'Reconcile' },
    })
  }
  return out
}

/** Suspected duplicate transactions: same company, date, counterparty and
 *  amount, posted more than once. */
function checkDuplicates(cos: Co[]): Issue[] {
  const rows = all<{ company_id: number; groups: number; extra: number; total: number }>(`
    WITH txtot AS (
      SELECT t.id AS tid, t.company_id AS cid, t.date AS d,
             COALESCE(t.memo, '') AS memo, COALESCE(t.contact_id, 0) AS contact,
             SUM(CASE WHEN e.amount_cents > 0 THEN e.amount_cents ELSE 0 END) AS amt
      FROM transactions t JOIN entries e ON e.transaction_id = t.id
      WHERE t.deleted = 0 AND t.status = 'posted'
      GROUP BY t.id
    ),
    dups AS (
      SELECT cid, amt, COUNT(*) AS n
      FROM txtot
      GROUP BY cid, d, memo, contact, amt
      HAVING n > 1 AND amt > 0
    )
    SELECT cid AS company_id, COUNT(*) AS groups, SUM(n - 1) AS extra, SUM((n - 1) * amt) AS total
    FROM dups GROUP BY cid
  `)
  const byCo = new Map(rows.map((r) => [r.company_id, r]))
  const out: Issue[] = []
  for (const c of cos) {
    const r = byCo.get(c.id)
    if (!r || r.extra === 0) continue
    out.push({
      id: `duplicate:${c.id}`,
      category: 'duplicate',
      severity: 'medium',
      companyId: c.id,
      companyName: c.name,
      currency: c.currency,
      title: `${r.extra} suspected duplicate transaction${r.extra === 1 ? '' : 's'}`,
      detail: `${r.groups} set${r.groups === 1 ? '' : 's'} of transactions share the same date, payee and amount — ${fmt(r.total, c.currency)} may be double-counted. Check each and delete the extras.`,
      count: r.extra,
      amountCents: r.total,
      fix: { route: '/transactions', label: 'Open transactions' },
    })
  }
  return out
}

/** Transactions dated in the future — usually a typo'd year on import. */
function checkFutureDated(cos: Co[]): Issue[] {
  const today = todayISO()
  const rows = all<{ company_id: number; n: number; latest: string }>(
    `SELECT company_id, COUNT(*) AS n, MAX(date) AS latest
     FROM transactions WHERE deleted = 0 AND status = 'posted' AND date > ?
     GROUP BY company_id`,
    [today],
  )
  const byCo = new Map(rows.map((r) => [r.company_id, r]))
  const out: Issue[] = []
  for (const c of cos) {
    const r = byCo.get(c.id)
    if (!r || r.n === 0) continue
    out.push({
      id: `future:${c.id}`,
      category: 'future',
      severity: 'low',
      companyId: c.id,
      companyName: c.name,
      currency: c.currency,
      title: `${r.n} future-dated transaction${r.n === 1 ? '' : 's'}`,
      detail: `${r.n} transaction${r.n === 1 ? ' is' : 's are'} dated after today (latest ${r.latest}). Often a typo'd year on import — it inflates current-period reports.`,
      count: r.n,
      amountCents: 0,
      fix: { route: '/transactions', label: 'Open transactions' },
    })
  }
  return out
}

const CHECKS: ((cos: Co[]) => Issue[])[] = [
  checkUnbalanced,
  checkInterco,
  checkTransferBacklog,
  checkUncategorized,
  checkReconcile,
  checkDuplicates,
  checkFutureDated,
]

/** Run every health check across all companies and return a ranked worklist. */
export function runHealthChecks(): Issue[] {
  const cos = listCos()
  const issues: Issue[] = []
  for (const check of CHECKS) {
    try {
      issues.push(...check(cos))
    } catch {
      // A single failing check never takes down the whole Review Center.
    }
  }
  return issues.sort((a, b) => {
    const s = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
    if (s !== 0) return s
    return b.amountCents - a.amountCents
  })
}

export interface HealthSummary {
  total: number
  high: number
  medium: number
  low: number
}

export function summarize(issues: Issue[]): HealthSummary {
  return {
    total: issues.length,
    high: issues.filter((i) => i.severity === 'high').length,
    medium: issues.filter((i) => i.severity === 'medium').length,
    low: issues.filter((i) => i.severity === 'low').length,
  }
}

function fmt(cents: number, currency: string): string {
  return formatMoney(cents, currency)
}
