/**
 * Inter-company transfer review.
 *
 * Purpose: look at historical money that moved between the group's company bank
 * accounts (and out to personal / recurring recipients) and check it was put to
 * correct, consistent use.
 *
 * What it does, end to end:
 *  1. gatherBankMovements — every posted transaction that touches a bank account,
 *     across all companies, with the bank side (signed: + in / − out) and the
 *     "other side" GL legs that say what the money was FOR.
 *  2. classifyMovement — reads the other-side accounts AND the source document
 *     type to label each movement: sale, purchase, a payment against an invoice
 *     (A/R) or bill (A/P), an inter-company transfer (due-to / due-from / notes /
 *     loan), owner equity, or a vague/placeholder coding.
 *  3. identifyCounterparty — is the other end one of our own companies, a known
 *     recurring recipient (e.g. Albert Benudiz / BA Graphics), or a one-off?
 *  4. matchTransfers — pair each internal outflow with the inflow on the other
 *     company's books by amount + date, ranking candidates so the UI can offer a
 *     pick-list when several could be the match.
 *  5. flags — unmatched money out, amount/date mismatches, vague accounts, and
 *     "type disagreement" where the two sides disagree on what the money was
 *     (one booked a loan, the other booked a sale).
 *  6. balanceTieOuts — the balance sheets must agree: A's notes/due-to B equals
 *     B's notes/due-from A, and A's vendor balance for B equals B's customer
 *     balance for A.
 *
 * The engine only reads the ledger; user decisions persist in interco_reviews.
 */

import { all, one, run, tx, insert } from './db'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** How the "other side" of a bank movement was booked. */
export type MovementKind =
  | 'sale' // money in, booked to income
  | 'purchase' // money out, booked to an expense
  | 'ar_payment' // money in against Accounts Receivable (a customer paid an invoice)
  | 'ap_payment' // money out against Accounts Payable (we paid a bill)
  | 'transfer_out' // money out to an inter-company / loan / due-from account
  | 'transfer_in' // money in from an inter-company / loan / due-to account
  | 'debt_payment' // money out against a plain liability (mortgage, loan, tax) — not inter-company
  | 'equity' // owner draw / contribution / shareholder loan
  | 'bank_transfer' // moved between two of this same company's bank accounts
  | 'vague' // uncategorized / suspense / ask-my-accountant / no other leg
  | 'other' // a leg we could not confidently bucket

export interface MovementLeg {
  entryId: number
  accountId: number
  accountName: string
  accountCode: string
  accountType: string
  amountCents: number // entry sign: + debit / − credit
}

export interface BankMovement {
  companyId: number
  companyName: string
  txnId: number
  date: string
  memo: string | null
  reference: string | null
  source: string
  contactId: number | null
  contactName: string | null
  /** The cash account (bank or credit card) this movement hit. */
  bankAccountId: number
  bankAccountName: string
  /** Bank sign: + money in (deposit), − money out (withdrawal). */
  signedCents: number
  direction: 'in' | 'out'
  /** Non-cash GL legs — what the money was for. */
  otherLegs: MovementLeg[]
  /** Linked source-document type, when the txn came from a document. */
  docType: string | null
  kind: MovementKind
  /** The account name the classification keyed on (for display / debugging). */
  primaryAccountName: string | null
  /** True when the whole transaction just moves money between two of this
   *  company's own cash accounts (e.g. chequing → credit card). Self-contained
   *  and already balanced, so it needs no cross matching. */
  selfTransfer?: boolean
  /** For a self-transfer: the account money left / landed in. */
  transferFromName?: string | null
  transferToName?: string | null
}

export type Counterparty =
  | { type: 'internal'; companyId: number; companyName: string }
  | { type: 'recipient'; name: string }
  | { type: 'none' }

export type TransferFlag =
  | 'unmatched_out' // internal money out with no inflow found on the other books
  | 'unmatched_in' // internal money in with no outflow found
  | 'amount_mismatch' // best candidate's amount differs from this one
  | 'date_mismatch' // best candidate is far from this one's date
  | 'type_disagreement' // the two sides disagree on what the money was
  | 'vague_account' // coded to a placeholder / uncategorized account
  | 'unbalanced_pair' // the pair's balance-sheet positions don't tie out

export interface MatchCandidate {
  movement: BankMovement
  /** 0–200, higher = better. */
  score: number
  reasons: string[]
  sameAmount: boolean
  dayGap: number
}

export interface ReviewedMovement {
  movement: BankMovement
  counterparty: Counterparty
  /** Candidate counter-movements, best first (only for internal transfers). */
  candidates: MatchCandidate[]
  /** The user-confirmed counterparty txn, if any (from interco_reviews). */
  confirmed: InterCoReview | null
  /** A standing rule that auto-resolved this movement, if any. */
  ruled: InterCoRule | null
  flags: TransferFlag[]
  /** Short human-readable notes for each flag. */
  notes: string[]
  /** True when the best candidate is a confident auto-match (one click to accept all). */
  autoMatch: boolean
}

export interface InterCoRule {
  id: number
  scope: 'account' | 'recipient'
  company_id: number | null
  match_text: string
  action: 'ignore'
  note: string | null
  created_at: string
}

export interface InterCoReview {
  id: number
  company_id: number
  txn_id: number
  matched_company_id: number | null
  matched_txn_id: number | null
  resolution: 'matched' | 'external' | 'ignored'
  recipient: string | null
  note: string | null
  created_at: string
}

/** Balance-sheet tie-out for one unordered company pair. */
export interface PairTieOut {
  aId: number
  aName: string
  bId: number
  bName: string
  /** Net inter-company balance per A's books: + = B owes A, − = A owes B (cents). */
  loanPerA: number
  /** Net per B's books: + = A owes B, − = B owes A (cents). */
  loanPerB: number
  /** loanPerA + loanPerB; should be 0 when the two sets of books agree. */
  loanDiff: number
  /** A's A/P balance owed to contact "B" (cents). */
  apFromA: number
  /** B's A/R balance owed by contact "A" (cents). */
  arFromB: number
  /** apFromA − arFromB; should be 0. */
  tradeDiff: number
  balanced: boolean
}

export interface RecipientSummary {
  name: string
  count: number
  totalOutCents: number
  companies: string[]
}

export interface TransferReview {
  movements: ReviewedMovement[]
  pairs: PairTieOut[]
  recipients: RecipientSummary[]
  companies: { id: number; name: string }[]
  rules: InterCoRule[]
  counts: {
    total: number
    internal: number
    unmatched: number
    typeDisagreements: number
    vague: number
    unbalancedPairs: number
    /** Open items still needing a decision (flagged, not resolved, not ruled out). */
    needsReview: number
    /** Of those, how many have a confident one-click auto-match available. */
    autoMatchable: number
  }
}

export interface ReviewOptions {
  /** Only movements on/after this ISO date. */
  startDate?: string
  /** Only movements on/before this ISO date. */
  endDate?: string
  /** Day window for candidate matching (default 7). */
  matchWindowDays?: number
  /** A recipient seen at least this many times is "recurring" (default 2). */
  recipientMinCount?: number
}

// ---------------------------------------------------------------------------
// Account-name heuristics (centralized so they're easy to tune)
// ---------------------------------------------------------------------------

const RE_TRANSFER = /\b(due (to|from)|inter.?company|loan (to|from)|loans? (to|from)|notes? (payable|receivable)|advances? (to|from)|shareholder loan)\b/i
const RE_AR = /\b(accounts? receivable|a\/r|trade receivable)\b/i
const RE_AP = /\b(accounts? payable|a\/p|trade payable)\b/i
const RE_EQUITY = /\b(draw|drawings|owner|shareholder|dividend|distribution|capital contribution|contributed capital)\b/i
// Placeholder / needs-a-real-category accounts. Deliberately NOT a bare "other"
// — that wrongly flags legitimate accounts like "Other Income" / "Other Interest
// Expense". "Ask my accountant" and "uncategorized" are the real ones to surface.
const RE_VAGUE = /\b(uncategor|ask my accountant|suspense|to be (determined|classified)|unknown|opening balance|unapplied cash|undeposited)\b/i

function isTransferAccount(name: string): boolean {
  return RE_TRANSFER.test(name)
}

// ---------------------------------------------------------------------------
// 1. Gather bank movements across all companies
// ---------------------------------------------------------------------------

export function gatherBankMovements(opts: ReviewOptions = {}): BankMovement[] {
  const params: unknown[] = []
  let dateWhere = ''
  if (opts.startDate) {
    dateWhere += ' AND t.date >= ?'
    params.push(opts.startDate)
  }
  if (opts.endDate) {
    dateWhere += ' AND t.date <= ?'
    params.push(opts.endDate)
  }

  // Every posted, non-recycled txn that touches a cash account — a bank account
  // or a credit-card account (credit cards move money internally too).
  const rows = all<{
    txn_id: number
    company_id: number
    company_name: string
    date: string
    memo: string | null
    reference: string | null
    source: string
    contact_id: number | null
    contact_name: string | null
    doc_type: string | null
  }>(
    `SELECT DISTINCT t.id AS txn_id, t.company_id, c.name AS company_name, t.date,
            t.memo, t.reference, t.source, t.contact_id, ct.name AS contact_name,
            d.type AS doc_type
       FROM transactions t
       JOIN companies c ON c.id = t.company_id
       JOIN entries e ON e.transaction_id = t.id
       JOIN accounts a ON a.id = e.account_id
       LEFT JOIN contacts ct ON ct.id = t.contact_id
       LEFT JOIN documents d ON d.transaction_id = t.id
      WHERE ${CASH_ACCOUNT_SQL} AND t.deleted = 0 AND t.status <> 'void' ${dateWhere}
      ORDER BY t.date, t.id`,
    params,
  )

  const movements: BankMovement[] = []
  for (const r of rows) {
    const legs = all<{
      entry_id: number
      account_id: number
      name: string
      code: string
      type: string
      is_bank: number
      amount_cents: number
    }>(
      `SELECT e.id AS entry_id, e.account_id, a.name, a.code, a.type, a.is_bank, e.amount_cents
         FROM entries e JOIN accounts a ON a.id = e.account_id
        WHERE e.transaction_id = ?`,
      [r.txn_id],
    )
    const cashLegs = legs.filter(isCashLeg)
    const otherLegs = legs.filter((l) => !isCashLeg(l))
    if (cashLegs.length === 0) continue
    const otherSum = otherLegs.reduce((s, l) => s + l.amount_cents, 0)

    const base = {
      companyId: r.company_id,
      companyName: r.company_name,
      txnId: r.txn_id,
      date: r.date,
      memo: r.memo,
      reference: r.reference,
      source: r.source,
      contactId: r.contact_id,
      contactName: r.contact_name,
      docType: r.doc_type,
    }

    // Self-contained internal transfer: two+ cash legs, nothing booked outside
    // cash (e.g. chequing → savings, or a credit-card payment from chequing).
    if (cashLegs.length >= 2 && Math.abs(otherSum) < 1) {
      const fromLeg = cashLegs.filter((l) => l.amount_cents < 0).sort((a, b) => a.amount_cents - b.amount_cents)[0]
      const toLeg = cashLegs.filter((l) => l.amount_cents > 0).sort((a, b) => b.amount_cents - a.amount_cents)[0]
      const amt = Math.abs(toLeg?.amount_cents ?? fromLeg?.amount_cents ?? 0)
      movements.push({
        ...base,
        bankAccountId: (fromLeg ?? cashLegs[0]).account_id,
        bankAccountName: cashLegs.map((l) => l.name).join(' → '),
        signedCents: -amt,
        direction: 'out',
        otherLegs: [],
        kind: 'bank_transfer',
        primaryAccountName: null,
        selfTransfer: true,
        transferFromName: fromLeg?.name ?? null,
        transferToName: toLeg?.name ?? null,
      })
      continue
    }

    const signedCents = cashLegs.reduce((s, l) => s + l.amount_cents, 0)
    if (signedCents === 0) continue

    const m: BankMovement = {
      ...base,
      bankAccountId: cashLegs[0].account_id,
      bankAccountName: cashLegs.map((l) => l.name).join(' / '),
      signedCents,
      direction: signedCents > 0 ? 'in' : 'out',
      otherLegs: otherLegs.map((l) => ({
        entryId: l.entry_id,
        accountId: l.account_id,
        accountName: l.name,
        accountCode: l.code,
        accountType: l.type,
        amountCents: l.amount_cents,
      })),
      kind: 'other',
      primaryAccountName: null,
    }
    const classified = classifyMovement(m)
    m.kind = classified.kind
    m.primaryAccountName = classified.primaryAccountName
    movements.push(m)
  }
  return movements
}

/** SQL predicate: an account that holds spendable money — a bank account or a
 *  credit-card liability account. */
const CASH_ACCOUNT_SQL = `(a.is_bank = 1 OR (a.type = 'liability' AND (
  LOWER(a.name) LIKE '%credit card%' OR LOWER(a.name) LIKE '%visa%' OR
  LOWER(a.name) LIKE '%mastercard%' OR LOWER(a.name) LIKE '%master card%' OR
  LOWER(a.name) LIKE '%amex%' OR LOWER(a.name) LIKE '%american express%')))`

const CREDIT_CARD_RE = /credit card|visa|mastercard|master card|amex|american express/i

/** A cash leg: a bank account, or a credit-card liability account. */
function isCashLeg(l: { is_bank: number; type: string; name: string }): boolean {
  return l.is_bank === 1 || (l.type === 'liability' && CREDIT_CARD_RE.test(l.name))
}

// ---------------------------------------------------------------------------
// 2. Classify a movement from its other-side legs + document type
// ---------------------------------------------------------------------------

export function classifyMovement(
  m: Pick<BankMovement, 'direction' | 'otherLegs' | 'docType'>,
  bothBank = false,
): { kind: MovementKind; primaryAccountName: string | null } {
  if (bothBank) return { kind: 'bank_transfer', primaryAccountName: null }
  if (m.otherLegs.length === 0) return { kind: 'vague', primaryAccountName: null }

  // The leg that carries the most money decides the character of the movement.
  const primary = [...m.otherLegs].sort((a, b) => Math.abs(b.amountCents) - Math.abs(a.amountCents))[0]
  const name = primary.accountName
  const type = primary.accountType

  // A linked document type is the strongest signal when present.
  const doc = m.docType
  if (doc === 'invoice' || doc === 'payment_received') return { kind: 'ar_payment', primaryAccountName: name }
  if (doc === 'bill' || doc === 'payment_made') return { kind: 'ap_payment', primaryAccountName: name }
  if (doc === 'sales_receipt') return { kind: 'sale', primaryAccountName: name }
  if (doc === 'expense') return { kind: 'purchase', primaryAccountName: name }

  if (RE_VAGUE.test(name)) return { kind: 'vague', primaryAccountName: name }
  if (isTransferAccount(name)) {
    return { kind: m.direction === 'out' ? 'transfer_out' : 'transfer_in', primaryAccountName: name }
  }
  if (RE_AR.test(name)) return { kind: 'ar_payment', primaryAccountName: name }
  if (RE_AP.test(name)) return { kind: 'ap_payment', primaryAccountName: name }
  if (type === 'equity' || RE_EQUITY.test(name)) return { kind: 'equity', primaryAccountName: name }
  if (type === 'income') return { kind: 'sale', primaryAccountName: name }
  if (type === 'expense') return { kind: 'purchase', primaryAccountName: name }
  // A plain liability that ISN'T an inter-company/loan/due account (handled above)
  // is an ordinary debt payment — a mortgage, bank loan, tax remittance. These are
  // NOT inter-company transfers and must not be searched for a matching deposit,
  // or every mortgage payment floods the review queue. Everything else is "other".
  if (type === 'liability') return { kind: 'debt_payment', primaryAccountName: name }
  return { kind: 'other', primaryAccountName: name }
}

/** The two classifications two sides of one transfer can hold and still agree. */
export function kindsAgree(outKind: MovementKind, inKind: MovementKind): boolean {
  const out = new Set<MovementKind>([outKind])
  const inn = new Set<MovementKind>([inKind])
  // Clean inter-company loan: one lends (out), the other borrows (in).
  if (out.has('transfer_out') && inn.has('transfer_in')) return true
  // Real trade: one buys, the other sells (possibly via A/P ↔ A/R payments).
  const buy = out.has('purchase') || out.has('ap_payment')
  const sell = inn.has('sale') || inn.has('ar_payment')
  if (buy && sell) return true
  return false
}

// ---------------------------------------------------------------------------
// 3. Counterparty identification
// ---------------------------------------------------------------------------

// Corporate suffixes — never identifying.
const NAME_STOP = new Set(['inc', 'ltd', 'llc', 'corp', 'co', 'the', 'and', 'company', 'limited', 'incorporated', 'corporation'])
// Geographic + ultra-generic business words. These are NOT identifiers: two
// unrelated numbered companies both say "Ontario", countless firms say
// "Properties" or "Holdings". A token here can never, on its own, say two names
// are the same company — only a number or a genuinely distinctive word can.
const GENERIC_TOKENS = new Set([
  // provinces / regions / countries / major cities
  'ontario', 'quebec', 'alberta', 'manitoba', 'saskatchewan', 'british', 'columbia', 'scotia',
  'brunswick', 'newfoundland', 'labrador', 'yukon', 'nunavut', 'territories', 'canada', 'canadian',
  'america', 'american', 'usa', 'toronto', 'ottawa', 'mississauga', 'hamilton', 'vaughan', 'markham',
  'brampton', 'london', 'windsor', 'kitchener', 'waterloo', 'niagara', 'durham', 'york', 'peel',
  // generic corporate words
  'properties', 'property', 'holdings', 'holding', 'group', 'groupe', 'services', 'service',
  'solutions', 'enterprises', 'enterprise', 'ventures', 'venture', 'management', 'consulting',
  'trading', 'industries', 'industrial', 'capital', 'partners', 'associates', 'consultants',
  'contracting', 'contractors', 'construction', 'rentals', 'rental', 'leasing', 'investments',
  'investment', 'international', 'national', 'global', 'worldwide', 'systems', 'solution',
])

/** Lower-case alphanumeric word tokens of a string (length > 2, suffixes dropped). */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !NAME_STOP.has(w))
}

/** A token strong enough to identify a company by itself: a company number, or a
 *  distinctive word that isn't geographic/generic. */
function isStrongToken(t: string): boolean {
  if (/^\d{3,}$/.test(t)) return true // company number
  return t.length >= 4 && !GENERIC_TOKENS.has(t)
}

/**
 * Strong, distinctive tokens per company — tokens that (a) no other company name
 * shares and (b) are specific enough to identify it (a number, or a real word,
 * never a province like "Ontario" or a filler like "Properties"). A numbered
 * company reduces to its number, so "1933230 Ontario Inc" is identified only by
 * "1933230" — never by "ontario", which it shares with every other Ontario firm.
 */
export function distinctiveTokens(companies: { id: number; name: string }[]): Map<number, string[]> {
  const result = new Map<number, string[]>()
  for (const c of companies) {
    const mine = tokenize(c.name)
    const othersAll = new Set<string>()
    for (const o of companies) if (o.id !== c.id) tokenize(o.name).forEach((t) => othersAll.add(t))
    const strong = mine.filter((t) => !othersAll.has(t) && isStrongToken(t))
    // No strong identifier (e.g. a name made only of generic/shared words): leave
    // empty rather than match on a generic word — a miss beats a false positive.
    result.set(c.id, strong)
  }
  return result
}

/** Token set drawn from a movement's counterparty-identifying text (NOT its own
 *  company name): contact, memo, reference, and the offsetting account names. */
function blobTokenSet(m: BankMovement): Set<string> {
  const text = [m.contactName, m.memo, m.reference, ...m.otherLegs.map((l) => l.accountName)]
    .filter(Boolean)
    .join(' ')
  return new Set(tokenize(text))
}

export function identifyCounterparty(
  m: BankMovement,
  companies: { id: number; name: string }[],
  distinct: Map<number, string[]>,
  recipientMinCount: number,
  recipientCounts: Map<string, number>,
): Counterparty {
  const words = blobTokenSet(m)
  // Internal: does the movement name another of our companies by a STRONG token?
  for (const c of companies) {
    if (c.id === m.companyId) continue
    const toks = distinct.get(c.id) ?? []
    if (toks.some((t) => words.has(t))) return { type: 'internal', companyId: c.id, companyName: c.name }
  }
  // Recurring external recipient (by contact name).
  if (m.contactName) {
    const key = m.contactName.trim().toLowerCase()
    if ((recipientCounts.get(key) ?? 0) >= recipientMinCount) return { type: 'recipient', name: m.contactName.trim() }
  }
  return { type: 'none' }
}

// ---------------------------------------------------------------------------
// 4. Candidate matching
// ---------------------------------------------------------------------------

/** Signed day gap: days from `a` to `b` (positive when b is later). */
function daysBetween(a: string, b: string): number {
  const da = Date.parse(a)
  const db = Date.parse(b)
  if (Number.isNaN(da) || Number.isNaN(db)) return 9999
  return Math.round((db - da) / 86_400_000)
}

/**
 * Score a candidate counter-movement. A genuine transfer requires:
 *  - EXACT amount (to the cent), and
 *  - the deposit on/after the withdrawal, within `windowDays` (money leaves
 *    first and lands the same day or a few days later — e.g. a Friday transfer
 *    before a long weekend clears the following week).
 * One small day of slack is allowed the other way for posting/timezone quirks.
 */
function scoreCandidate(
  src: BankMovement,
  cand: BankMovement,
  windowDays: number,
  distinct: Map<number, string[]>,
): MatchCandidate | null {
  if (Math.abs(src.signedCents) !== Math.abs(cand.signedCents)) return null // exact amount only

  const outM = src.direction === 'out' ? src : cand
  const inM = src.direction === 'out' ? cand : src
  const lag = daysBetween(outM.date, inM.date) // deposit date − withdrawal date
  if (lag < -1 || lag > windowDays) return null
  const gap = Math.abs(lag)

  const reasons: string[] = ['exact amount']
  let score = 100
  if (gap === 0) {
    score += 60
    reasons.push('same day')
  } else {
    score += Math.max(10, 50 - gap * 7)
    reasons.push(`lands ${gap}d later`)
  }
  // Mutual naming raises confidence — but only via STRONG tokens, so two "Sonic"
  // companies don't look like they reference each other just by sharing "Sonic".
  const srcWords = blobTokenSet(src)
  const candWords = blobTokenSet(cand)
  const srcNamesCand = (distinct.get(cand.companyId) ?? []).some((t) => srcWords.has(t))
  const candNamesSrc = (distinct.get(src.companyId) ?? []).some((t) => candWords.has(t))
  if (srcNamesCand && candNamesSrc) {
    score += 30
    reasons.push('both reference each other')
  } else if (srcNamesCand || candNamesSrc) {
    score += 15
    reasons.push('one references the other')
  }
  if (cand.companyId === src.companyId) reasons.push(`→ ${cand.bankAccountName}`)
  else reasons.push(`${cand.companyName} · ${cand.bankAccountName}`)
  return { movement: cand, score, reasons, sameAmount: true, dayGap: gap }
}

// ---------------------------------------------------------------------------
// 5 + 6. Full review
// ---------------------------------------------------------------------------

function accountBalanceCents(accountId: number): number {
  const r = one<{ s: number }>(
    `SELECT COALESCE(SUM(e.amount_cents),0) AS s
       FROM entries e JOIN transactions t ON t.id = e.transaction_id
      WHERE e.account_id = ? AND t.deleted = 0 AND t.status <> 'void'`,
    [accountId],
  )
  return r?.s ?? 0
}

/** Net inter-company loan position in `companyId`'s books toward the other
 *  company. + = the other company owes us, − = we owe the other company.
 *
 *  An account with an explicit counterparty TAG is authoritative: it counts
 *  toward the pair when (and only when) its tag matches the other company's code
 *  — no name-guessing. Untagged accounts fall back to the fuzzy rule (looks like
 *  a loan account AND names the other company). This way tagged books tie out
 *  exactly while legacy/untagged books still work. */
function loanPositionToward(companyId: number, otherTokens: string[], otherCode?: string | null): number {
  const accts = all<{ id: number; name: string; type: string; cp: string | null }>(
    `SELECT id, name, type, interco_counterparty AS cp FROM accounts WHERE company_id = ? AND archived = 0`,
    [companyId],
  )
  const oc = otherCode ? otherCode.trim().toLowerCase() : null
  let net = 0
  for (const a of accts) {
    // Inter-company balances live on the BALANCE SHEET (due-from = asset,
    // due-to = liability). Income/expense/equity accounts that merely reference
    // the other company are flows, not balances — never part of the loan tie-out.
    if (a.type !== 'asset' && a.type !== 'liability') continue
    const tag = a.cp ? a.cp.trim().toLowerCase() : null
    let include: boolean
    if (tag) {
      include = oc != null && tag === oc
    } else {
      if (!isTransferAccount(a.name)) continue
      const words = new Set(tokenize(a.name))
      include = otherTokens.some((t) => words.has(t))
    }
    if (!include) continue
    // Asset (due-from): debit balance = they owe us → +. Liability (due-to):
    // credit balance (negative raw) = we owe → −.
    net += accountBalanceCents(a.id)
  }
  return net
}

/** Each company's own inter-company short code (ONT/AV/SSP), by id. */
function companyCodeById(): Map<number, string | null> {
  return new Map(
    all<{ id: number; c: string | null }>('SELECT id, interco_code AS c FROM companies').map((r) => [r.id, r.c]),
  )
}

/** A/P or A/R balance in `companyId` attributable to a contact naming `otherTokens`. */
function subledgerBalance(companyId: number, otherTokens: string[], want: 'AP' | 'AR'): number {
  const docTypes = want === 'AP' ? ['bill', 'expense', 'payment_made'] : ['invoice', 'payment_received', 'sales_receipt']
  const placeholders = docTypes.map(() => '?').join(',')
  const rows = all<{ balance_cents: number; total_cents: number; name: string }>(
    `SELECT d.balance_cents, d.total_cents, ct.name
       FROM documents d JOIN contacts ct ON ct.id = d.contact_id
      WHERE d.company_id = ? AND d.type IN (${placeholders}) AND d.status <> 'void'`,
    [companyId, ...docTypes],
  )
  let sum = 0
  for (const r of rows) {
    const words = new Set(tokenize(r.name ?? ''))
    if (!otherTokens.some((t) => words.has(t))) continue
    sum += r.balance_cents
  }
  return sum
}

/**
 * Cross-company balance-sheet tie-outs (loan + vendor/customer) for every pair.
 * Deterministic and cheap (no movement gathering), so it's safe to feed the AI
 * assistant for "which company isn't representing transfers correctly" questions.
 */
export function interCompanyTieOuts(companies?: { id: number; name: string }[]): PairTieOut[] {
  const cos = companies ?? all<{ id: number; name: string }>('SELECT id, name FROM companies ORDER BY name')
  const distinct = distinctiveTokens(cos)
  const codeById = companyCodeById()
  const pairs: PairTieOut[] = []
  for (let i = 0; i < cos.length; i++) {
    for (let j = i + 1; j < cos.length; j++) {
      const a = cos[i]
      const b = cos[j]
      const aTok = distinct.get(a.id) ?? []
      const bTok = distinct.get(b.id) ?? []
      const loanPerA = loanPositionToward(a.id, bTok, codeById.get(b.id)) // + = B owes A
      const loanPerB = loanPositionToward(b.id, aTok, codeById.get(a.id)) // + = A owes B
      const apFromA = subledgerBalance(a.id, bTok, 'AP')
      const arFromB = subledgerBalance(b.id, aTok, 'AR')
      const loanDiff = loanPerA + loanPerB
      const tradeDiff = apFromA - arFromB
      const balanced = Math.abs(loanDiff) < 1 && Math.abs(tradeDiff) < 1
      if (loanPerA || loanPerB || apFromA || arFromB) {
        pairs.push({ aId: a.id, aName: a.name, bId: b.id, bName: b.name, loanPerA, loanPerB, loanDiff, apFromA, arFromB, tradeDiff, balanced })
      }
    }
  }
  return pairs
}

/** Per-company inter-company / loan / due-to-from accounts that name another
 *  group company, with their display balances. Lets the AI see both raw sides. */
export interface InterCoAccountBalance {
  companyId: number
  companyName: string
  accountName: string
  /** The other group company this account references, if identifiable. */
  otherCompany: string | null
  /** Display balance in cents: + = asset/receivable (owed to this company),
   *  − = liability/payable (this company owes). */
  balanceCents: number
}

export function interCompanyLoanAccounts(companies?: { id: number; name: string }[]): InterCoAccountBalance[] {
  const cos = companies ?? all<{ id: number; name: string }>('SELECT id, name FROM companies ORDER BY name')
  const distinct = distinctiveTokens(cos)
  const codeToName = new Map<string, string>()
  for (const r of all<{ name: string; code: string | null }>('SELECT name, interco_code AS code FROM companies')) {
    if (r.code) codeToName.set(r.code.trim().toLowerCase(), r.name)
  }
  const out: InterCoAccountBalance[] = []
  for (const c of cos) {
    const accts = all<{ id: number; name: string; type: string; cp: string | null }>('SELECT id, name, type, interco_counterparty AS cp FROM accounts WHERE company_id = ? AND archived = 0', [c.id])
    for (const a of accts) {
      if (a.type !== 'asset' && a.type !== 'liability') continue // balance-sheet only
      const tag = a.cp ? a.cp.trim().toLowerCase() : null
      if (!tag && !isTransferAccount(a.name)) continue
      const raw = accountBalanceCents(a.id) // debit-positive
      if (raw === 0) continue
      let other: string | null = null
      if (tag) {
        other = codeToName.get(tag) ?? tag.toUpperCase()
      } else {
        const words = new Set(tokenize(a.name))
        for (const o of cos) {
          if (o.id === c.id) continue
          if ((distinct.get(o.id) ?? []).some((t) => words.has(t))) { other = o.name; break }
        }
      }
      out.push({ companyId: c.id, companyName: c.name, accountName: a.name, otherCompany: other, balanceCents: raw })
    }
  }
  return out
}

/** One loan/transfer account on one side of a company pair. */
export interface PairSideAccount {
  accountId: number
  name: string
  type: string
  /** Debit-positive balance: + = asset/receivable (owed to us), − = liability/payable (we owe). */
  balanceCents: number
  /** True when the account name references the other company (so the tie-out counts it). */
  namesOther: boolean
}

export interface InterCoPairDetail {
  aId: number
  aName: string
  bId: number
  bName: string
  /** Every loan/transfer account with a non-zero balance on each side. */
  aAccounts: PairSideAccount[]
  bAccounts: PairSideAccount[]
  /** Net of the accounts that name the other company — what the tie-out actually compares. */
  loanPerA: number
  loanPerB: number
  loanDiff: number
}

/**
 * Account-level breakdown of a company pair's loan/transfer position, so the UI
 * can show exactly which accounts drive (or are missed by) a tie-out mismatch.
 * Accounts that name the other company are the ones the tie-out counts; accounts
 * named by property/other (e.g. "Loans to other parties: 88 King") are shown too
 * but flagged as not-counted, since a real inter-company loan can hide there.
 */
export function interCompanyPairDetail(aId: number, bId: number): InterCoPairDetail | null {
  const cos = all<{ id: number; name: string; code: string | null }>('SELECT id, name, interco_code AS code FROM companies')
  const a = cos.find((c) => c.id === aId)
  const b = cos.find((c) => c.id === bId)
  if (!a || !b) return null
  const distinct = distinctiveTokens(cos)
  const aTok = distinct.get(aId) ?? []
  const bTok = distinct.get(bId) ?? []

  const side = (companyId: number, otherTokens: string[], otherCode: string | null): PairSideAccount[] => {
    const oc = otherCode ? otherCode.trim().toLowerCase() : null
    const accts = all<{ id: number; name: string; type: string; cp: string | null }>(
      'SELECT id, name, type, interco_counterparty AS cp FROM accounts WHERE company_id = ? AND archived = 0',
      [companyId],
    )
    const out: PairSideAccount[] = []
    for (const ac of accts) {
      if (ac.type !== 'asset' && ac.type !== 'liability') continue // balance-sheet only
      const tag = ac.cp ? ac.cp.trim().toLowerCase() : null
      if (!tag && !isTransferAccount(ac.name)) continue
      const bal = accountBalanceCents(ac.id)
      if (bal === 0) continue
      const counted = tag ? oc != null && tag === oc : otherTokens.some((t) => new Set(tokenize(ac.name)).has(t))
      out.push({ accountId: ac.id, name: ac.name, type: ac.type, balanceCents: bal, namesOther: counted })
    }
    return out.sort((x, y) => Math.abs(y.balanceCents) - Math.abs(x.balanceCents))
  }

  const aAccounts = side(aId, bTok, b.code)
  const bAccounts = side(bId, aTok, a.code)
  const loanPerA = aAccounts.filter((x) => x.namesOther).reduce((s, x) => s + x.balanceCents, 0)
  const loanPerB = bAccounts.filter((x) => x.namesOther).reduce((s, x) => s + x.balanceCents, 0)
  return { aId, aName: a.name, bId, bName: b.name, aAccounts, bAccounts, loanPerA, loanPerB, loanDiff: loanPerA + loanPerB }
}

export function reviewInterCompanyTransfers(opts: ReviewOptions = {}): TransferReview {
  const windowDays = opts.matchWindowDays ?? 7
  const recipientMinCount = opts.recipientMinCount ?? 2

  const companies = all<{ id: number; name: string }>('SELECT id, name FROM companies ORDER BY name')
  const distinct = distinctiveTokens(companies)
  const movements = gatherBankMovements(opts)

  // Recurring-recipient tally over external outflows.
  const recipientCounts = new Map<string, number>()
  for (const m of movements) {
    if (m.selfTransfer) continue
    if (m.direction === 'out' && m.contactName) {
      const key = m.contactName.trim().toLowerCase()
      recipientCounts.set(key, (recipientCounts.get(key) ?? 0) + 1)
    }
  }

  const reviews = loadReviews()
  const reviewByTxn = new Map<string, InterCoReview>()
  for (const r of reviews) reviewByTxn.set(`${r.company_id}:${r.txn_id}`, r)

  const rules = loadRules()
  const ruleFor = (m: BankMovement): InterCoRule | null => {
    for (const r of rules) {
      if (r.company_id != null && r.company_id !== m.companyId) continue
      if (r.scope === 'recipient') {
        if (m.contactName && m.contactName.trim().toLowerCase() === r.match_text) return r
      } else {
        const t = r.match_text
        if ((m.primaryAccountName ?? '').toLowerCase() === t) return r
        if (m.otherLegs.some((l) => l.accountName.toLowerCase() === t)) return r
      }
    }
    return null
  }

  // Pre-split by direction for matching (self-transfers are never a counter-side).
  const byDirection = { in: [] as BankMovement[], out: [] as BankMovement[] }
  for (const m of movements) if (!m.selfTransfer) byDirection[m.direction].push(m)

  const reviewed: ReviewedMovement[] = movements.map((m) => {
    const counterparty = identifyCounterparty(m, companies, distinct, recipientMinCount, recipientCounts)
    const confirmed = reviewByTxn.get(`${m.companyId}:${m.txnId}`) ?? null
    const ruled = confirmed ? null : ruleFor(m)

    const flags: TransferFlag[] = []
    const notes: string[] = []

    // A self-contained transfer between the company's own cash accounts is
    // already balanced — show it, but it needs no matching or flags.
    if (m.selfTransfer) {
      return { movement: m, counterparty, candidates: [], confirmed, ruled, flags, notes, autoMatch: false }
    }

    // Look for the other side when this looks like a transfer: it names another
    // company, or it was coded to a transfer / loan / due-to-from account.
    const isTransferish = m.kind === 'transfer_out' || m.kind === 'transfer_in'
    const shouldSearch = counterparty.type === 'internal' || isTransferish

    let candidates: MatchCandidate[] = []
    if (shouldSearch) {
      const pool = m.direction === 'out' ? byDirection.in : byDirection.out
      candidates = pool
        .filter((c) => {
          if (c.selfTransfer) return false
          if (c.companyId === m.companyId) {
            // Intra-company: a move to a DIFFERENT own account, and only when
            // both sides were coded as transfers (keeps ordinary same-company
            // sales/expenses that happen to share an amount out of the list).
            if (c.bankAccountId === m.bankAccountId) return false
            return isTransferish && (c.kind === 'transfer_out' || c.kind === 'transfer_in')
          }
          return true // cross-company: any opposite-direction movement
        })
        .map((c) => scoreCandidate(m, c, windowDays, distinct))
        .filter((c): c is MatchCandidate => c !== null)
        // Prefer the named counterparty company's books first.
        .map((c) =>
          counterparty.type === 'internal' && c.movement.companyId === counterparty.companyId
            ? { ...c, score: c.score + 20 }
            : c,
        )
        .sort((a, b) => b.score - a.score)
        .slice(0, 6)
    }

    if (!ruled && m.kind === 'vague') {
      flags.push('vague_account')
      notes.push(`Coded to "${m.primaryAccountName ?? 'no account'}" — needs a real category.`)
    }

    let autoMatch = false
    if (!ruled && shouldSearch && confirmed?.resolution !== 'external' && confirmed?.resolution !== 'ignored') {
      const best = candidates[0]
      const chosen =
        confirmed?.resolution === 'matched' && confirmed.matched_txn_id != null
          ? candidates.find((c) => c.movement.txnId === confirmed.matched_txn_id) ?? null
          : best
      const where = counterparty.type === 'internal' ? counterparty.companyName : 'the group'
      if (!chosen) {
        flags.push(m.direction === 'out' ? 'unmatched_out' : 'unmatched_in')
        notes.push(
          m.direction === 'out'
            ? `Money out with no matching deposit found in ${where} (exact amount, within ${windowDays} days).`
            : `Money in with no matching withdrawal found in ${where} (exact amount, within ${windowDays} days).`,
        )
      } else {
        // Type agreement: compare out-side vs in-side classification.
        const outK = m.direction === 'out' ? m.kind : chosen.movement.kind
        const inK = m.direction === 'out' ? chosen.movement.kind : m.kind
        if (!kindsAgree(outK, inK)) {
          flags.push('type_disagreement')
          notes.push(`One side booked this as "${outK}", the other as "${inK}" — the books won't tie out.`)
        }
        // Confident, unique, mutually-named best match on the OUT side can be
        // accepted in bulk (dedup: match each pair from its out leg only).
        if (!confirmed && m.direction === 'out') {
          const second = candidates[1]
          const unique = !second || best.score - second.score >= 25
          const named = best.reasons.some((r) => r.includes('reference'))
          autoMatch = best.sameAmount && best.dayGap <= 2 && named && unique
        }
      }
    }

    return { movement: m, counterparty, candidates, confirmed, ruled, flags, notes, autoMatch }
  })

  // Balance-sheet tie-outs per company pair.
  const pairs = interCompanyTieOuts(companies)
  const unbalancedPairs = pairs.filter((p) => !p.balanced).length
  // Surface an unbalanced pair on each internal movement touching that pair.
  if (unbalancedPairs) {
    const bad = new Set(pairs.filter((p) => !p.balanced).flatMap((p) => [`${p.aId}:${p.bId}`, `${p.bId}:${p.aId}`]))
    for (const rm of reviewed) {
      if (rm.ruled || rm.confirmed) continue
      if (rm.counterparty.type !== 'internal') continue
      if (bad.has(`${rm.movement.companyId}:${rm.counterparty.companyId}`)) {
        if (!rm.flags.includes('unbalanced_pair')) {
          rm.flags.push('unbalanced_pair')
          rm.notes.push(`The ${rm.movement.companyName} ↔ ${rm.counterparty.companyName} balances don't tie out.`)
        }
      }
    }
  }

  const recipients: RecipientSummary[] = buildRecipients(movements, recipientMinCount)
  const isOpen = (r: ReviewedMovement) => r.flags.length > 0 && !r.confirmed && !r.ruled

  return {
    movements: reviewed,
    pairs,
    recipients,
    companies,
    rules,
    counts: {
      total: reviewed.length,
      internal: reviewed.filter((r) => r.counterparty.type === 'internal').length,
      unmatched: reviewed.filter((r) => r.flags.includes('unmatched_out') || r.flags.includes('unmatched_in')).length,
      typeDisagreements: reviewed.filter((r) => r.flags.includes('type_disagreement')).length,
      vague: reviewed.filter((r) => r.flags.includes('vague_account')).length,
      unbalancedPairs,
      needsReview: reviewed.filter(isOpen).length,
      autoMatchable: reviewed.filter((r) => r.autoMatch).length,
    },
  }
}

/** Export the `isOpen` predicate shape the UI uses for "needs review". */
export function needsReview(r: ReviewedMovement): boolean {
  return r.flags.length > 0 && !r.confirmed && !r.ruled
}

function buildRecipients(movements: BankMovement[], minCount: number): RecipientSummary[] {
  const map = new Map<string, RecipientSummary>()
  for (const m of movements) {
    if (m.selfTransfer || m.direction !== 'out' || !m.contactName) continue
    const key = m.contactName.trim().toLowerCase()
    const row = map.get(key) ?? { name: m.contactName.trim(), count: 0, totalOutCents: 0, companies: [] }
    row.count++
    row.totalOutCents += Math.abs(m.signedCents)
    if (!row.companies.includes(m.companyName)) row.companies.push(m.companyName)
    map.set(key, row)
  }
  return [...map.values()].filter((r) => r.count >= minCount).sort((a, b) => b.totalOutCents - a.totalOutCents)
}

// ---------------------------------------------------------------------------
// Persistence of user decisions
// ---------------------------------------------------------------------------

export function loadReviews(): InterCoReview[] {
  return all<InterCoReview>('SELECT * FROM interco_reviews')
}

/** Confirm that `txn` in `companyId` is matched to `matchedTxn` in `matchedCompanyId`.
 *  Writes both sides so either reads as resolved. */
export function confirmMatch(
  companyId: number,
  txnId: number,
  matchedCompanyId: number,
  matchedTxnId: number,
  note?: string,
): void {
  tx(() => {
    upsertReview({ company_id: companyId, txn_id: txnId, matched_company_id: matchedCompanyId, matched_txn_id: matchedTxnId, resolution: 'matched', recipient: null, note: note ?? null })
    upsertReview({ company_id: matchedCompanyId, txn_id: matchedTxnId, matched_company_id: companyId, matched_txn_id: txnId, resolution: 'matched', recipient: null, note: note ?? null })
  })
}

/** Mark a movement as a genuine external payment (optionally labelling the recipient). */
export function markExternal(companyId: number, txnId: number, recipient?: string, note?: string): void {
  tx(() => upsertReview({ company_id: companyId, txn_id: txnId, matched_company_id: null, matched_txn_id: null, resolution: 'external', recipient: recipient ?? null, note: note ?? null }))
}

/** Mark a movement reviewed and not a concern. */
export function markIgnored(companyId: number, txnId: number, note?: string): void {
  tx(() => upsertReview({ company_id: companyId, txn_id: txnId, matched_company_id: null, matched_txn_id: null, resolution: 'ignored', recipient: null, note: note ?? null }))
}

/** Remove any stored decision for a movement (re-opens it for review). */
export function clearReview(companyId: number, txnId: number): void {
  tx(() => {
    // If it was a match, clear the paired side too.
    const existing = one<InterCoReview>('SELECT * FROM interco_reviews WHERE company_id = ? AND txn_id = ?', [companyId, txnId])
    run('DELETE FROM interco_reviews WHERE company_id = ? AND txn_id = ?', [companyId, txnId])
    if (existing?.matched_company_id != null && existing.matched_txn_id != null) {
      run('DELETE FROM interco_reviews WHERE company_id = ? AND txn_id = ?', [existing.matched_company_id, existing.matched_txn_id])
    }
  })
}

function upsertReview(r: Omit<InterCoReview, 'id' | 'created_at'>): void {
  run(
    `INSERT INTO interco_reviews (company_id, txn_id, matched_company_id, matched_txn_id, resolution, recipient, note)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(company_id, txn_id) DO UPDATE SET
       matched_company_id = excluded.matched_company_id,
       matched_txn_id = excluded.matched_txn_id,
       resolution = excluded.resolution,
       recipient = excluded.recipient,
       note = excluded.note`,
    [r.company_id, r.txn_id, r.matched_company_id, r.matched_txn_id, r.resolution, r.recipient, r.note],
  )
}

// ---------------------------------------------------------------------------
// Bulk operations
// ---------------------------------------------------------------------------

/** Confirm every auto-matchable pair in one transaction. Returns how many. */
export function acceptAutoMatches(review: TransferReview): number {
  const pairs = review.movements.filter((r) => r.autoMatch && r.candidates[0])
  if (pairs.length === 0) return 0
  tx(() => {
    for (const rm of pairs) {
      const c = rm.candidates[0]
      upsertReview({ company_id: rm.movement.companyId, txn_id: rm.movement.txnId, matched_company_id: c.movement.companyId, matched_txn_id: c.movement.txnId, resolution: 'matched', recipient: null, note: 'auto-matched' })
      upsertReview({ company_id: c.movement.companyId, txn_id: c.movement.txnId, matched_company_id: rm.movement.companyId, matched_txn_id: rm.movement.txnId, resolution: 'matched', recipient: null, note: 'auto-matched' })
    }
  })
  return pairs.length
}

/** Mark a batch of movements ignored in one transaction. */
export function ignoreBatch(items: { companyId: number; txnId: number }[], note?: string): void {
  if (items.length === 0) return
  tx(() => {
    for (const it of items) {
      upsertReview({ company_id: it.companyId, txn_id: it.txnId, matched_company_id: null, matched_txn_id: null, resolution: 'ignored', recipient: null, note: note ?? null })
    }
  })
}

// ---------------------------------------------------------------------------
// Standing rules
// ---------------------------------------------------------------------------

export function loadRules(): InterCoRule[] {
  return all<InterCoRule>('SELECT * FROM interco_rules ORDER BY scope, match_text')
}

/** Add an ignore rule. match_text is stored lower-cased for matching. */
export function addRule(scope: 'account' | 'recipient', matchText: string, companyId?: number | null, note?: string): number {
  const text = matchText.trim().toLowerCase()
  if (!text) return 0
  // Avoid duplicates.
  const existing = one<{ id: number }>(
    'SELECT id FROM interco_rules WHERE scope = ? AND match_text = ? AND IFNULL(company_id,-1) = IFNULL(?,-1)',
    [scope, text, companyId ?? null],
  )
  if (existing) return existing.id
  let id = 0
  tx(() => {
    id = insert(
      'INSERT INTO interco_rules (scope, company_id, match_text, action, note) VALUES (?, ?, ?, ?, ?)',
      [scope, companyId ?? null, text, 'ignore', note ?? null],
    )
  })
  return id
}

export function deleteRule(id: number): void {
  tx(() => run('DELETE FROM interco_rules WHERE id = ?', [id]))
}
