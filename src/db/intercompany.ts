import { all, one, insert, tx } from './db'
import { postTransaction, audit, getAccounts, getCompany } from './repo'
import { formatMoney } from '../lib/money'

export interface InterCompanyLink {
  id: number
  from_company_id: number
  from_txn_id: number | null
  to_company_id: number
  to_txn_id: number | null
  amount_cents: number
  date: string
  memo: string | null
  created_at: string
  from_name: string
  to_name: string
}

/** Suggest an inter-company "due from / due to" account for a company. */
export function suggestDueAccount(companyId: number, otherName: string, kind: 'from' | 'to'): number | null {
  const accts = getAccounts(companyId)
  const other = otherName.toLowerCase().split(/\s+/).filter((w) => w.length > 2)
  const nameHas = (n: string, words: string[]) => words.some((w) => n.includes(w))
  // prefer an account that mentions the other company
  const byOther = accts.find((a) => other.some((w) => a.name.toLowerCase().includes(w)))
  if (byOther) return byOther.id
  if (kind === 'from') {
    return accts.find((a) => a.type === 'asset' && nameHas(a.name.toLowerCase(), ['due from', 'receivable from', 'loan to', 'loans to', 'intercompany']))?.id ?? null
  }
  return accts.find((a) => a.type === 'liability' && nameHas(a.name.toLowerCase(), ['due to', 'payable to', 'loan from', 'notes payable', 'intercompany']))?.id ?? null
}

export function postInterCompany(p: {
  date: string
  amountCents: number
  memo?: string | null
  from: { companyId: number; accountId: number; dueAccountId: number }
  to: { companyId: number; accountId: number; dueAccountId: number }
}): number {
  if (p.amountCents <= 0) throw new Error('Amount must be greater than zero.')
  if (p.from.companyId === p.to.companyId) throw new Error('Pick two different companies.')
  return tx(() => {
    const fromName = getCompany(p.from.companyId)?.name ?? 'company'
    const toName = getCompany(p.to.companyId)?.name ?? 'company'
    // From company: it gives value out and records a receivable (Due from To).
    const fromTxn = postTransaction({
      company_id: p.from.companyId, date: p.date, memo: p.memo ?? `Inter-company → ${toName}`,
      source: 'intercompany',
      lines: [
        { account_id: p.from.dueAccountId, amount_cents: p.amountCents },
        { account_id: p.from.accountId, amount_cents: -p.amountCents },
      ],
    })
    // To company: it receives value / books the cost and records a payable (Due to From).
    const toTxn = postTransaction({
      company_id: p.to.companyId, date: p.date, memo: p.memo ?? `Inter-company ← ${fromName}`,
      source: 'intercompany',
      lines: [
        { account_id: p.to.accountId, amount_cents: p.amountCents },
        { account_id: p.to.dueAccountId, amount_cents: -p.amountCents },
      ],
    })
    const linkId = insert(
      `INSERT INTO intercompany_links (from_company_id, from_txn_id, to_company_id, to_txn_id, amount_cents, date, memo)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [p.from.companyId, fromTxn, p.to.companyId, toTxn, p.amountCents, p.date, p.memo ?? null],
    )
    audit(p.from.companyId, 'create', 'intercompany', linkId, `Inter-company to ${toName} — ${formatMoney(p.amountCents)}`)
    audit(p.to.companyId, 'create', 'intercompany', linkId, `Inter-company from ${fromName} — ${formatMoney(p.amountCents)}`)
    return linkId
  })
}

export function getInterCompanyLinks(companyId?: number): InterCompanyLink[] {
  const params: unknown[] = []
  let where = ''
  if (companyId) {
    where = 'WHERE l.from_company_id = ? OR l.to_company_id = ?'
    params.push(companyId, companyId)
  }
  return all<InterCompanyLink>(
    `SELECT l.*, fc.name AS from_name, tc.name AS to_name
     FROM intercompany_links l
     JOIN companies fc ON fc.id = l.from_company_id
     JOIN companies tc ON tc.id = l.to_company_id
     ${where} ORDER BY l.id DESC`,
    params,
  )
}

// ---------------------------------------------------------------------------
// Elimination / mismatch report (consolidated multi-entity view)
//
// postInterCompany() posts BOTH legs atomically and equal, so a group's books
// start consistent. Drift only appears if someone later edits, voids, or
// recycle-bins one leg. This report (a) verifies each link's two legs still
// agree with the recorded amount, and (b) nets the inter-company positions per
// company pair so consolidated statements can eliminate the double-count.
// ---------------------------------------------------------------------------

/** State of one leg (one company's posting) of an inter-company link. */
export interface IntercoLegStatus {
  txnId: number | null
  /** Row exists and is not in the recycle bin. */
  present: boolean
  voided: boolean
  /** The leg's magnitude = sum of its debit entries (equals the link amount when untouched). */
  debitCents: number
  /** present && !voided && debitCents === link.amount_cents. */
  matchesLink: boolean
}

function legStatus(txnId: number | null, linkAmount: number): IntercoLegStatus {
  if (txnId == null) return { txnId, present: false, voided: false, debitCents: 0, matchesLink: false }
  const t = one<{ deleted: number; status: string }>('SELECT deleted, status FROM transactions WHERE id = ?', [txnId])
  if (!t) return { txnId, present: false, voided: false, debitCents: 0, matchesLink: false }
  const present = t.deleted === 0
  const voided = t.status === 'void'
  const d = one<{ s: number }>(
    'SELECT COALESCE(SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END), 0) AS s FROM entries WHERE transaction_id = ?',
    [txnId],
  )
  const debitCents = d?.s ?? 0
  return { txnId, present, voided, debitCents, matchesLink: present && !voided && debitCents === linkAmount }
}

export interface IntercoLinkCheck extends InterCompanyLink {
  from: IntercoLegStatus
  to: IntercoLegStatus
  reconciled: boolean
  /** Human-readable problems, empty when reconciled. */
  issues: string[]
}

/** Verify both legs of every link (optionally only those touching `companyId`). */
export function checkInterCompanyLinks(companyId?: number): IntercoLinkCheck[] {
  return getInterCompanyLinks(companyId).map((l) => {
    const from = legStatus(l.from_txn_id, l.amount_cents)
    const to = legStatus(l.to_txn_id, l.amount_cents)
    const issues: string[] = []
    const check = (side: IntercoLegStatus, name: string) => {
      if (!side.present) issues.push(`${name}: posting missing or in recycle bin`)
      else if (side.voided) issues.push(`${name}: posting voided`)
      else if (!side.matchesLink) issues.push(`${name}: amount is ${formatMoney(side.debitCents)}, link says ${formatMoney(l.amount_cents)}`)
    }
    check(from, l.from_name)
    check(to, l.to_name)
    return { ...l, from, to, reconciled: issues.length === 0, issues }
  })
}

/** Netted inter-company position for one unordered company pair. */
export interface IntercoPairElimination {
  aId: number
  aName: string
  bId: number
  bName: string
  /** Receivables A holds against B (links posted from A → B), by link amount. */
  aToB: number
  /** Receivables B holds against A. */
  bToA: number
  /** aToB − bToA; positive means A is the net creditor of B. */
  net: number
  /** Gross amount removed from consolidated statements for this pair (aToB + bToA). */
  eliminationCents: number
  linkCount: number
  mismatchCount: number
}

export interface IntercoEliminationReport {
  pairs: IntercoPairElimination[]
  /** Reconciled links whose legs disagree or are missing/voided. */
  mismatches: IntercoLinkCheck[]
  totalEliminated: number
  mismatchCount: number
}

/**
 * Consolidated elimination + mismatch report across the group (or a subset).
 * Amounts use each link's recorded amount; any leg that no longer agrees is
 * surfaced in `mismatches` and counted per pair, since those must be fixed
 * before the elimination figures can be trusted.
 */
export function interCompanyEliminations(companyIds?: number[]): IntercoEliminationReport {
  const checks = checkInterCompanyLinks()
  const filter = companyIds && companyIds.length ? new Set(companyIds) : null
  const pairMap = new Map<string, IntercoPairElimination>()
  const mismatches: IntercoLinkCheck[] = []

  for (const c of checks) {
    if (filter && !(filter.has(c.from_company_id) && filter.has(c.to_company_id))) continue
    // Stable unordered-pair key, ordered by company id.
    const [aId, aName, bId, bName] =
      c.from_company_id < c.to_company_id
        ? [c.from_company_id, c.from_name, c.to_company_id, c.to_name]
        : [c.to_company_id, c.to_name, c.from_company_id, c.from_name]
    const key = `${aId}:${bId}`
    const row =
      pairMap.get(key) ??
      { aId, aName, bId, bName, aToB: 0, bToA: 0, net: 0, eliminationCents: 0, linkCount: 0, mismatchCount: 0 }
    row.linkCount++
    if (c.from_company_id === aId) row.aToB += c.amount_cents
    else row.bToA += c.amount_cents
    if (!c.reconciled) { row.mismatchCount++; mismatches.push(c) }
    pairMap.set(key, row)
  }

  const pairs = [...pairMap.values()]
    .map((r) => ({ ...r, net: r.aToB - r.bToA, eliminationCents: r.aToB + r.bToA }))
    .sort((x, y) => y.eliminationCents - x.eliminationCents)

  return {
    pairs,
    mismatches,
    totalEliminated: pairs.reduce((s, p) => s + p.eliminationCents, 0),
    mismatchCount: mismatches.length,
  }
}
