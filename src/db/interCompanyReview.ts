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

import { all, one, run, tx } from './db'

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
  | 'equity' // owner draw / contribution / shareholder loan
  | 'bank_transfer' // moved between two of this same company's bank accounts
  | 'vague' // uncategorized / suspense / ask-my-accountant / no other leg
  | 'other' // a leg we could not confidently bucket

export interface MovementLeg {
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
  bankAccountId: number
  bankAccountName: string
  /** Bank sign: + money in (deposit), − money out (withdrawal). */
  signedCents: number
  direction: 'in' | 'out'
  /** Non-bank GL legs — what the money was for. */
  otherLegs: MovementLeg[]
  /** Linked source-document type, when the txn came from a document. */
  docType: string | null
  kind: MovementKind
  /** The account name the classification keyed on (for display / debugging). */
  primaryAccountName: string | null
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
  flags: TransferFlag[]
  /** Short human-readable notes for each flag. */
  notes: string[]
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
  counts: {
    total: number
    internal: number
    unmatched: number
    typeDisagreements: number
    vague: number
    unbalancedPairs: number
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
const RE_VAGUE = /\b(uncategor|ask my accountant|suspense|misc|miscellaneous|to be (determined|classified)|unknown|clearing|opening balance|unapplied|undeposited|holding|pending|other)\b/i

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

  // Every posted, non-recycled txn that has at least one entry on a bank account.
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
      WHERE a.is_bank = 1 AND t.deleted = 0 AND t.status <> 'void' ${dateWhere}
      ORDER BY t.date, t.id`,
    params,
  )

  const movements: BankMovement[] = []
  for (const r of rows) {
    const legs = all<{
      account_id: number
      name: string
      code: string
      type: string
      is_bank: number
      amount_cents: number
    }>(
      `SELECT e.account_id, a.name, a.code, a.type, a.is_bank, e.amount_cents
         FROM entries e JOIN accounts a ON a.id = e.account_id
        WHERE e.transaction_id = ?`,
      [r.txn_id],
    )
    const bankLegs = legs.filter((l) => l.is_bank === 1)
    const otherLegs = legs.filter((l) => l.is_bank !== 1)
    const signedCents = bankLegs.reduce((s, l) => s + l.amount_cents, 0)
    if (signedCents === 0) continue // not a real cash movement (e.g. two bank legs netting)

    const m: BankMovement = {
      companyId: r.company_id,
      companyName: r.company_name,
      txnId: r.txn_id,
      date: r.date,
      memo: r.memo,
      reference: r.reference,
      source: r.source,
      contactId: r.contact_id,
      contactName: r.contact_name,
      bankAccountId: bankLegs[0].account_id,
      bankAccountName: bankLegs.map((l) => l.name).join(' / '),
      signedCents,
      direction: signedCents > 0 ? 'in' : 'out',
      otherLegs: otherLegs.map((l) => ({
        accountId: l.account_id,
        accountName: l.name,
        accountCode: l.code,
        accountType: l.type,
        amountCents: l.amount_cents,
      })),
      docType: r.doc_type,
      kind: 'other',
      primaryAccountName: null,
    }
    // Both-sides-bank => a transfer between this company's own bank accounts.
    const classified = classifyMovement(m, otherLegs.length === 0 && bankLegs.length > 1)
    m.kind = classified.kind
    m.primaryAccountName = classified.primaryAccountName
    movements.push(m)
  }
  return movements
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
  // An asset/liability leg we couldn't name-match: treat a plain asset/liability
  // move as a transfer of value, everything else as "other".
  if (type === 'asset' || type === 'liability') {
    return { kind: m.direction === 'out' ? 'transfer_out' : 'transfer_in', primaryAccountName: name }
  }
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

function dayGap(a: string, b: string): number {
  const da = Date.parse(a)
  const db = Date.parse(b)
  if (Number.isNaN(da) || Number.isNaN(db)) return 9999
  return Math.round(Math.abs(da - db) / 86_400_000)
}

/** Score a candidate inflow against an outflow (mirror amounts, near dates). */
function scoreCandidate(
  src: BankMovement,
  cand: BankMovement,
  windowDays: number,
  distinct: Map<number, string[]>,
): MatchCandidate | null {
  const sameAmount = Math.abs(src.signedCents) === Math.abs(cand.signedCents)
  const gap = dayGap(src.date, cand.date)
  // Allow a near-amount candidate within 1% or $5, so true matches that were
  // keyed slightly differently (fees, rounding) still surface for review.
  const amtDelta = Math.abs(Math.abs(src.signedCents) - Math.abs(cand.signedCents))
  const nearAmount = amtDelta <= Math.max(500, Math.round(Math.abs(src.signedCents) * 0.01))
  if (!sameAmount && !nearAmount) return null
  if (gap > Math.max(windowDays, 45)) return null // hard ceiling

  const reasons: string[] = []
  let score = 0
  if (sameAmount) {
    score += 100
    reasons.push('exact amount')
  } else {
    score += 40
    reasons.push('amount within tolerance')
  }
  if (gap === 0) {
    score += 60
    reasons.push('same day')
  } else if (gap <= 2) {
    score += 45
    reasons.push(`${gap}d apart`)
  } else if (gap <= windowDays) {
    score += 25
    reasons.push(`${gap}d apart`)
  } else {
    score += 5
    reasons.push(`${gap}d apart`)
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
  return { movement: cand, score, reasons, sameAmount, dayGap: gap }
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

/** Net inter-company loan position in `companyId`'s books toward `otherName`.
 *  + = the other company owes us, − = we owe the other company. */
function loanPositionToward(companyId: number, otherTokens: string[]): number {
  const accts = all<{ id: number; name: string; type: string }>(
    `SELECT id, name, type FROM accounts WHERE company_id = ? AND archived = 0`,
    [companyId],
  )
  let net = 0
  for (const a of accts) {
    if (!isTransferAccount(a.name)) continue
    const words = new Set(tokenize(a.name))
    if (!otherTokens.some((t) => words.has(t))) continue
    const bal = accountBalanceCents(a.id) // debit-positive raw balance
    // Asset (due-from / loan-to): debit balance = they owe us → +.
    // Liability (due-to / loan-from): credit balance (negative raw) = we owe → −.
    net += bal
  }
  return net
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

export function reviewInterCompanyTransfers(opts: ReviewOptions = {}): TransferReview {
  const windowDays = opts.matchWindowDays ?? 7
  const recipientMinCount = opts.recipientMinCount ?? 2

  const companies = all<{ id: number; name: string }>('SELECT id, name FROM companies ORDER BY name')
  const distinct = distinctiveTokens(companies)
  const movements = gatherBankMovements(opts)

  // Recurring-recipient tally over external outflows.
  const recipientCounts = new Map<string, number>()
  for (const m of movements) {
    if (m.direction === 'out' && m.contactName) {
      const key = m.contactName.trim().toLowerCase()
      recipientCounts.set(key, (recipientCounts.get(key) ?? 0) + 1)
    }
  }

  const reviews = loadReviews()
  const reviewByTxn = new Map<string, InterCoReview>()
  for (const r of reviews) reviewByTxn.set(`${r.company_id}:${r.txn_id}`, r)

  // Pre-split by direction for matching.
  const byDirection = { in: [] as BankMovement[], out: [] as BankMovement[] }
  for (const m of movements) byDirection[m.direction].push(m)

  const reviewed: ReviewedMovement[] = movements.map((m) => {
    const counterparty = identifyCounterparty(m, companies, distinct, recipientMinCount, recipientCounts)
    const confirmed = reviewByTxn.get(`${m.companyId}:${m.txnId}`) ?? null

    // Candidates: only for internal movements — look at the opposite direction
    // in OTHER companies (an outflow here should meet an inflow there).
    let candidates: MatchCandidate[] = []
    if (counterparty.type === 'internal') {
      const pool = m.direction === 'out' ? byDirection.in : byDirection.out
      candidates = pool
        .filter((c) => c.companyId !== m.companyId)
        .map((c) => scoreCandidate(m, c, windowDays, distinct))
        .filter((c): c is MatchCandidate => c !== null)
        // Prefer the named counterparty company's books first.
        .map((c) =>
          c.movement.companyId === counterparty.companyId ? { ...c, score: c.score + 20 } : c,
        )
        .sort((a, b) => b.score - a.score)
        .slice(0, 6)
    }

    const flags: TransferFlag[] = []
    const notes: string[] = []

    if (m.kind === 'vague') {
      flags.push('vague_account')
      notes.push(`Coded to "${m.primaryAccountName ?? 'no account'}" — needs a real category.`)
    }

    if (counterparty.type === 'internal' && confirmed?.resolution !== 'external' && confirmed?.resolution !== 'ignored') {
      const best = candidates[0]
      const chosen =
        confirmed?.resolution === 'matched' && confirmed.matched_txn_id != null
          ? candidates.find((c) => c.movement.txnId === confirmed.matched_txn_id) ?? null
          : best
      if (!chosen) {
        flags.push(m.direction === 'out' ? 'unmatched_out' : 'unmatched_in')
        notes.push(
          m.direction === 'out'
            ? `Money out to ${counterparty.companyName} with no matching deposit found on their books.`
            : `Money in from ${counterparty.companyName} with no matching withdrawal found on their books.`,
        )
      } else {
        if (!chosen.sameAmount) {
          flags.push('amount_mismatch')
          notes.push('Closest match differs in amount — confirm it is the right transaction.')
        }
        if (chosen.dayGap > windowDays) {
          flags.push('date_mismatch')
          notes.push(`Closest match is ${chosen.dayGap} days away.`)
        }
        // Type agreement: compare out-side vs in-side classification.
        const outK = m.direction === 'out' ? m.kind : chosen.movement.kind
        const inK = m.direction === 'out' ? chosen.movement.kind : m.kind
        if (!kindsAgree(outK, inK)) {
          flags.push('type_disagreement')
          notes.push(`One side booked this as "${outK}", the other as "${inK}" — the books won't tie out.`)
        }
      }
    }

    return { movement: m, counterparty, candidates, confirmed, flags, notes }
  })

  // Balance-sheet tie-outs per company pair.
  const pairs: PairTieOut[] = []
  for (let i = 0; i < companies.length; i++) {
    for (let j = i + 1; j < companies.length; j++) {
      const a = companies[i]
      const b = companies[j]
      const aTok = distinct.get(a.id) ?? []
      const bTok = distinct.get(b.id) ?? []
      const loanPerA = loanPositionToward(a.id, bTok) // + = B owes A
      const loanPerB = loanPositionToward(b.id, aTok) // + = A owes B
      const apFromA = subledgerBalance(a.id, bTok, 'AP') // A owes B (trade)
      const arFromB = subledgerBalance(b.id, aTok, 'AR') // B expects from A (trade)
      const loanDiff = loanPerA + loanPerB // should be ~0 when the books agree
      const tradeDiff = apFromA - arFromB
      const balanced = Math.abs(loanDiff) < 1 && Math.abs(tradeDiff) < 1
      // Only report a pair that actually has inter-company activity.
      if (loanPerA || loanPerB || apFromA || arFromB) {
        pairs.push({
          aId: a.id, aName: a.name, bId: b.id, bName: b.name,
          loanPerA, loanPerB, loanDiff, apFromA, arFromB, tradeDiff, balanced,
        })
      }
    }
  }
  const unbalancedPairs = pairs.filter((p) => !p.balanced).length
  // Surface an unbalanced pair on each internal movement touching that pair.
  if (unbalancedPairs) {
    const bad = new Set(pairs.filter((p) => !p.balanced).flatMap((p) => [`${p.aId}:${p.bId}`, `${p.bId}:${p.aId}`]))
    for (const rm of reviewed) {
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

  return {
    movements: reviewed,
    pairs,
    recipients,
    companies,
    counts: {
      total: reviewed.length,
      internal: reviewed.filter((r) => r.counterparty.type === 'internal').length,
      unmatched: reviewed.filter((r) => r.flags.includes('unmatched_out') || r.flags.includes('unmatched_in')).length,
      typeDisagreements: reviewed.filter((r) => r.flags.includes('type_disagreement')).length,
      vague: reviewed.filter((r) => r.flags.includes('vague_account')).length,
      unbalancedPairs,
    },
  }
}

function buildRecipients(movements: BankMovement[], minCount: number): RecipientSummary[] {
  const map = new Map<string, RecipientSummary>()
  for (const m of movements) {
    if (m.direction !== 'out' || !m.contactName) continue
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
