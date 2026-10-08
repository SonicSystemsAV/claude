import { all } from './db'
import { getBankTransactions, matchBankToTxn, usedTransactionIds } from './repo'
import type { BankTxn } from './types'

export interface Candidate {
  txnId: number
  date: string
  memo: string | null
  reference: string | null
  amount_cents: number
  confidence: number
  reasons: string[]
}

const MAX_DAY_GAP = 7

function tokenize(s: string): string[] {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2)
}

/** Jaccard-ish token overlap between two strings, 0..1. */
function descSimilarity(a: string, b: string): number {
  const ta = new Set(tokenize(a))
  const tb = new Set(tokenize(b))
  if (ta.size === 0 || tb.size === 0) return 0
  let inter = 0
  for (const t of ta) if (tb.has(t)) inter++
  const union = ta.size + tb.size - inter
  return union === 0 ? 0 : inter / union
}

function dayGap(a: string, b: string): number {
  const da = new Date(a).getTime()
  const db = new Date(b).getTime()
  if (isNaN(da) || isNaN(db)) return 9999
  return Math.abs(Math.round((da - db) / 86400000))
}

/**
 * Candidate book transactions for a bank line: transactions that post the same
 * signed amount to the SAME bank account, not already claimed by another bank
 * line, within a date window. Scored by date proximity + description overlap.
 */
export function candidatesFor(bt: BankTxn, used: Set<number>): Candidate[] {
  // Entries on this bank account with the exact bank-signed amount.
  const rows = all<{
    txnId: number
    date: string
    memo: string | null
    reference: string | null
    amount_cents: number
  }>(
    `SELECT t.id AS txnId, t.date AS date, t.memo AS memo, t.reference AS reference, e.amount_cents AS amount_cents
     FROM entries e
     JOIN transactions t ON t.id = e.transaction_id
     WHERE e.account_id = ? AND e.amount_cents = ? AND t.status != 'void' AND t.deleted = 0`,
    [bt.account_id, bt.amount_cents],
  )

  const out: Candidate[] = []
  for (const r of rows) {
    if (used.has(r.txnId)) continue
    const gap = dayGap(bt.date, r.date)
    if (gap > MAX_DAY_GAP) continue
    const dateScore = 1 - gap / MAX_DAY_GAP // 1.0 same day → 0 at the edge
    const desc = descSimilarity(bt.description, `${r.memo ?? ''} ${r.reference ?? ''}`)
    // Amount already matches exactly (required), so weight date + description.
    const confidence = Math.min(1, 0.55 + 0.25 * dateScore + 0.35 * desc)
    const reasons: string[] = ['Exact amount']
    if (gap === 0) reasons.push('Same date')
    else reasons.push(`${gap}d apart`)
    if (desc > 0.15) reasons.push('Description overlap')
    out.push({
      txnId: r.txnId,
      date: r.date,
      memo: r.memo,
      reference: r.reference,
      amount_cents: r.amount_cents,
      confidence,
      reasons,
    })
  }
  out.sort((a, b) => b.confidence - a.confidence)
  return out
}

export interface SuggestionMap {
  [bankTxnId: number]: Candidate[]
}

/** Compute candidate suggestions for all unmatched bank lines. */
export function suggestAll(companyId: number): SuggestionMap {
  const used = usedTransactionIds(companyId)
  const unmatched = getBankTransactions(companyId, { status: 'unmatched' })
  const map: SuggestionMap = {}
  for (const bt of unmatched) {
    map[bt.id] = candidatesFor(bt, used)
  }
  return map
}

const AUTO_THRESHOLD = 0.7

/**
 * Auto-match every unmatched bank line that has a single confident, unambiguous
 * candidate. Claims transactions greedily so two bank lines never share one.
 * Returns the number matched.
 */
export function autoMatch(companyId: number): number {
  const used = usedTransactionIds(companyId)
  const unmatched = getBankTransactions(companyId, { status: 'unmatched' })
  let matched = 0
  for (const bt of unmatched) {
    const cands = candidatesFor(bt, used).filter((c) => !used.has(c.txnId))
    if (cands.length === 0) continue
    const best = cands[0]
    const second = cands[1]
    const unambiguous = !second || best.confidence - second.confidence > 0.1
    if (best.confidence >= AUTO_THRESHOLD && unambiguous) {
      matchBankToTxn(bt.id, best.txnId)
      used.add(best.txnId)
      matched++
    }
  }
  return matched
}
