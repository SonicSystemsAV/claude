/**
 * Provider-agnostic payment-connector scaffolding.
 *
 * A "payment connector" pulls sales from a point-of-sale / payment processor
 * (Square, Stripe, Clover, …) and posts them into an existing company's books
 * as exact double-entry so the ledger is identical regardless of which POS a
 * user — or their accountant's other clients — happen to run.
 *
 * The design mirrors `importQBOData` in ../qboImport.ts: every provider funnels
 * a NORMALIZED model through one posting engine, so adding a second POS is just
 * another `PaymentConnector` implementation. Nothing here talks to the network;
 * live OAuth + HTTP lives behind each connector's own (stubbed) methods and can
 * only run in the Tauri desktop shell (see src/lib/desktop.ts, isTauri()).
 */

import { one } from '../db'
import { getAccounts, createAccountQuick, postTransaction, audit, insertBankTransactions, matchBankToTxn } from '../repo'
import { ensureTaxAccountId } from '../documents'
import { listItems, createItem } from '../items'
import type { AccountType, TxnLine } from '../types'

// ---------------------------------------------------------------------------
// Normalized model — every connector maps its provider's shapes to THIS.
// ---------------------------------------------------------------------------

export interface DateRange {
  /** Inclusive start, ISO yyyy-mm-dd. */
  start: string
  /** Inclusive end, ISO yyyy-mm-dd. */
  end: string
}

/** One sold line within a payment — maps to the app's ITEMS catalog. */
export interface NormalizedLineItem {
  /** Product/service name as it appears on the POS. */
  name: string
  quantity: number
  /** Ex-tax unit price in integer cents. */
  unitPriceCents: number
  /** Ex-tax extended amount in integer cents (quantity × unit, after discounts). */
  amountCents: number
  /** Whether tax applied to this line (drives item.taxable when the catalog entry is created). */
  taxable?: boolean
}

/**
 * A single customer payment, normalized to integer cents.
 * Invariant the posting engine relies on: `gross === net + fee` and
 * `gross === (sum of items' amountCents) + tax` (a `rounding` safety net
 * absorbs any provider penny drift, exactly like the QBO importer).
 */
export interface NormalizedPayment {
  /** Stable provider id (idempotency key); e.g. a Square payment id. */
  externalId: string
  /** ISO yyyy-mm-dd the sale was taken. */
  date: string
  /** Total charged to the customer, incl. tax, in cents. */
  gross: number
  /** Processor fee withheld, in cents (positive). */
  fee: number
  /** Amount that actually settles into a payout, in cents (gross + tip − fee). */
  net: number
  /** Tax portion of `gross`, in cents. */
  tax: number
  /** Tip collected on top of the sale, in cents (booked to a Tips liability). */
  tip?: number
  /** Tender: 'card' | 'cash' | 'gift_card' | 'other' (free-form, provider-labelled). */
  method: string
  /** Buyer name if the POS captured one. */
  customerName?: string | null
  /** Line items, if the provider exposes an itemized order. */
  items?: NormalizedLineItem[]
  /** The payout/batch this payment settles in, if known at pull time. */
  payoutId?: string | null
}

/**
 * A payout: the lump sum the processor deposits into the bank, net of fees,
 * bundling many payments. This is what the bank statement line matches against.
 */
export interface NormalizedPayout {
  externalId: string
  /** ISO yyyy-mm-dd the money hit the bank. */
  date: string
  /** Net deposited to the bank account, in cents (positive). */
  amountCents: number
  /** The payments bundled into this payout, by externalId (may be empty if the provider doesn't itemize). */
  paymentIds?: string[]
  /** Free-form description for the bank-feed row. */
  description?: string
}

/**
 * A refund to a customer — the reversal of (part of) a sale. Booked as the
 * opposite of a sale: reduces income + tax and the clearing balance.
 */
export interface NormalizedRefund {
  externalId: string
  /** ISO yyyy-mm-dd the refund was issued. */
  date: string
  /** Amount refunded to the customer incl. tax, in cents (positive). */
  gross: number
  /** Processing fee returned by the processor, in cents (usually 0 — fees are kept). */
  fee: number
  /** Tax portion of the refund, in cents. */
  tax: number
  method: string
  payoutId?: string | null
}

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface ConnectorStatus {
  provider: string
  state: ConnectionState
  /** Account/merchant label once connected (e.g. the Square location name). */
  accountLabel?: string | null
  /** Human-readable reason when state === 'error'. */
  error?: string | null
}

/**
 * The contract every POS integration implements. A second processor is just a
 * new class implementing this — the posting engine below never names a provider.
 */
export interface PaymentConnector {
  /** Short machine id, e.g. 'square', 'stripe'. */
  readonly provider: string

  /** Begin OAuth / token setup. Desktop-only (needs the Tauri loopback listener). */
  connect(): Promise<ConnectorStatus>

  /** Drop stored tokens. */
  disconnect(): Promise<void>

  /** Current connection state (sync, cheap — reads cached token metadata). */
  status(): ConnectorStatus

  /** Pull customer payments in the range, normalized to the model above. */
  listPayments(range: DateRange): Promise<NormalizedPayment[]>

  /** Pull payouts (bank deposits) in the range. */
  listPayouts(range: DateRange): Promise<NormalizedPayout[]>

  /** Pull customer refunds in the range, if the provider supports it. */
  listRefunds?(range: DateRange): Promise<NormalizedRefund[]>
}

// ---------------------------------------------------------------------------
// Posting configuration — account names the engine ensures/uses.
// ---------------------------------------------------------------------------

/** Default account names the engine creates on first import (overridable). */
export const DEFAULT_PAYMENT_ACCOUNTS = {
  /** Undeposited funds held by the processor between sale and payout (asset). */
  clearing: 'Square Clearing',
  /** Processing fees expense. */
  fees: 'Merchant Processing Fees',
  /** Fallback sales income when a line item has no mapped income account. */
  income: 'Sales Income',
  /** Tips collected on behalf of staff (liability), kept out of income. */
  tips: 'Tips Collected',
  /** Penny-drift safety net, mirrors QBO Import Rounding. */
  rounding: 'POS Import Rounding',
} as const

export interface ImportPaymentConfig {
  /** GL bank account the payouts land in. Required — this is the reconciled account. */
  bankAccountId: number
  /** Override the clearing-account name (per provider, e.g. 'Stripe Clearing'). */
  clearingAccountName?: string
  /** Override the fees-account name. */
  feesAccountName?: string
  /** Override the default income-account name. */
  incomeAccountName?: string
  /** Override the tips-liability account name. */
  tipsAccountName?: string
  /** Tax liability account; defaults to the company's via ensureTaxAccountId. */
  taxAccountId?: number
  /** Create catalog Items for each distinct line-item name (default true). */
  syncItems?: boolean
  /** Auto-match each payout's bank-feed row to its GL deposit transaction (default true). */
  autoMatchPayouts?: boolean
  /** Skip payments whose gross is zero (default true). */
  skipZero?: boolean
}

export interface ImportPaymentSummary {
  provider: string
  companyId: number
  payments: number
  payouts: number
  /** Distinct catalog items ensured. */
  itemsSynced: number
  grossCents: number
  feeCents: number
  taxCents: number
  tipCents: number
  netCents: number
  refunds: number
  refundTotalCents: number
  payoutTotalCents: number
  bankRowsInserted: number
  payoutsMatched: number
  skippedZero: number
  roundingAdjustments: number
  roundingTotalCents: number
}

// ---------------------------------------------------------------------------
// Pure line builders — unit-testable, no DB. amount_cents: debit +, credit −.
// (Account *ids* are injected so these stay independent of persistence.)
// ---------------------------------------------------------------------------

export interface PostingAccounts {
  clearing: number
  fees: number
  income: number
  tax: number
  tips: number
  bank: number
}

/**
 * Balanced GL lines for one sale:
 *   DR Clearing (net) + DR Fees (fee) = CR Income (subtotal) + CR Tax + CR Tips
 * where net = gross + tip − fee. Any penny drift is returned in `imbalance`.
 */
export function buildSaleLines(p: NormalizedPayment, acct: PostingAccounts): { lines: TxnLine[]; imbalance: number } {
  const tip = p.tip ?? 0
  const subtotal = p.gross - p.tax
  const lines: TxnLine[] = []
  // Debits: the money owed to us lands in clearing (net) and the fee is an expense.
  if (p.net !== 0) lines.push({ account_id: acct.clearing, amount_cents: p.net, memo: p.method })
  if (p.fee !== 0) lines.push({ account_id: acct.fees, amount_cents: p.fee, memo: 'Processing fee' })
  // Credits: income (ex-tax), tax collected, and any tip (a liability owed out).
  if (subtotal !== 0) lines.push({ account_id: acct.income, amount_cents: -subtotal, memo: p.customerName ?? null })
  if (p.tax !== 0) lines.push({ account_id: acct.tax, amount_cents: -p.tax, memo: 'Sales tax collected' })
  if (tip !== 0) lines.push({ account_id: acct.tips, amount_cents: -tip, memo: 'Tip collected' })
  const imbalance = lines.reduce((s, l) => s + l.amount_cents, 0)
  return { lines, imbalance }
}

/**
 * Balanced GL lines for one refund (the reversal of a sale):
 *   CR Clearing (gross − fee) + CR Fees (fee returned) = DR Income (subtotal) + DR Tax (tax)
 */
export function buildRefundLines(r: NormalizedRefund, acct: PostingAccounts): { lines: TxnLine[]; imbalance: number } {
  const subtotal = r.gross - r.tax
  const net = r.gross - r.fee
  const lines: TxnLine[] = []
  if (net !== 0) lines.push({ account_id: acct.clearing, amount_cents: -net, memo: `${r.method} refund` })
  if (r.fee !== 0) lines.push({ account_id: acct.fees, amount_cents: -r.fee, memo: 'Processing fee returned' })
  if (subtotal !== 0) lines.push({ account_id: acct.income, amount_cents: subtotal, memo: 'Refund' })
  if (r.tax !== 0) lines.push({ account_id: acct.tax, amount_cents: r.tax, memo: 'Sales tax refunded' })
  const imbalance = lines.reduce((s, l) => s + l.amount_cents, 0)
  return { lines, imbalance }
}

/** Balanced GL lines for one payout: DR Bank / CR Clearing. */
export function buildPayoutLines(p: NormalizedPayout, acct: PostingAccounts): TxnLine[] {
  return [
    { account_id: acct.bank, amount_cents: p.amountCents, memo: p.description ?? 'POS payout' },
    { account_id: acct.clearing, amount_cents: -p.amountCents, memo: 'POS payout' },
  ]
}

// ---------------------------------------------------------------------------
// Posting engine — provider-agnostic. Mirrors importQBOData's structure, but
// posts INTO an existing company (the POS-feed reality) rather than creating one.
// ---------------------------------------------------------------------------

function ensureAccountByName(companyId: number, name: string, type: AccountType, isBank = false): number {
  const existing = getAccounts(companyId, true).find((a) => a.name.toLowerCase() === name.toLowerCase())
  return existing ? existing.id : createAccountQuick(companyId, name, type, isBank)
}

/**
 * Post normalized payments + payouts into `companyId`'s books.
 *
 * Reuses the app's primitives (postTransaction, createAccountQuick,
 * insertBankTransactions, matchBankToTxn) so the result is ordinary
 * double-entry — reports, tax and reconciliation all work unchanged.
 */
export function importPaymentData(opts: {
  companyId: number
  provider: string
  payments: NormalizedPayment[]
  payouts: NormalizedPayout[]
  refunds?: NormalizedRefund[]
  config: ImportPaymentConfig
}): ImportPaymentSummary {
  const { companyId, provider, payments, payouts, config } = opts
  const refunds = opts.refunds ?? []
  const skipZero = config.skipZero ?? true
  const syncItems = config.syncItems ?? true
  const autoMatch = config.autoMatchPayouts ?? true

  const anyTips = payments.some((p) => (p.tip ?? 0) !== 0)
  const acct: PostingAccounts = {
    clearing: ensureAccountByName(companyId, config.clearingAccountName ?? DEFAULT_PAYMENT_ACCOUNTS.clearing, 'asset'),
    fees: ensureAccountByName(companyId, config.feesAccountName ?? DEFAULT_PAYMENT_ACCOUNTS.fees, 'expense'),
    income: ensureAccountByName(companyId, config.incomeAccountName ?? DEFAULT_PAYMENT_ACCOUNTS.income, 'income'),
    tax: config.taxAccountId ?? ensureTaxAccountId(companyId),
    tips: anyTips ? ensureAccountByName(companyId, config.tipsAccountName ?? DEFAULT_PAYMENT_ACCOUNTS.tips, 'liability') : 0,
    bank: config.bankAccountId,
  }
  let roundingId: number | null = null
  const ensureRounding = () => (roundingId ??= ensureAccountByName(companyId, DEFAULT_PAYMENT_ACCOUNTS.rounding, 'expense'))

  const summary: ImportPaymentSummary = {
    provider, companyId, payments: 0, payouts: 0, itemsSynced: 0,
    grossCents: 0, feeCents: 0, taxCents: 0, tipCents: 0, netCents: 0,
    refunds: 0, refundTotalCents: 0, payoutTotalCents: 0,
    bankRowsInserted: 0, payoutsMatched: 0, skippedZero: 0,
    roundingAdjustments: 0, roundingTotalCents: 0,
  }

  // 1) Sync the catalog from line items (names → sellable Items on the income account).
  if (syncItems) {
    const existing = new Set(listItems(companyId, true).map((i) => i.name.toLowerCase()))
    const seen = new Set<string>()
    for (const pmt of payments) {
      for (const li of pmt.items ?? []) {
        const key = li.name.trim().toLowerCase()
        if (!key || seen.has(key)) continue
        seen.add(key)
        if (existing.has(key)) continue
        createItem(companyId, {
          name: li.name.trim(),
          type: 'service',
          sell: true,
          incomeAccountId: acct.income,
          salesPriceCents: li.unitPriceCents,
          taxable: li.taxable !== false,
        })
        summary.itemsSynced++
      }
    }
  }

  // 2) Post each payment as a balanced sale.
  for (const pmt of payments) {
    if (skipZero && pmt.gross === 0) { summary.skippedZero++; continue }
    const { lines, imbalance } = buildSaleLines(pmt, acct)
    if (lines.length < 2) { summary.skippedZero++; continue }
    if (imbalance !== 0) {
      lines.push({ account_id: ensureRounding(), amount_cents: -imbalance, memo: 'Rounding' })
      summary.roundingAdjustments++
      summary.roundingTotalCents += imbalance
    }
    postTransaction({
      company_id: companyId,
      date: pmt.date,
      memo: pmt.customerName ? `${provider} sale — ${pmt.customerName}` : `${provider} sale`,
      reference: pmt.externalId,
      source: 'sales_receipt',
      lines,
    })
    summary.payments++
    summary.grossCents += pmt.gross
    summary.feeCents += pmt.fee
    summary.taxCents += pmt.tax
    summary.tipCents += pmt.tip ?? 0
    summary.netCents += pmt.net
    // TODO(desktop): also create a sales_receipt *document* with item lines and
    // payment_method once the documents engine supports explicit tax + a split
    // deposit (fee withheld). Today createSalesReceipt computes tax from a rate
    // and deposits the full total, so posting GL directly keeps amounts exact.
  }

  // 2b) Post each refund as a reversing entry against clearing.
  for (const rf of refunds) {
    if (rf.gross === 0) continue
    const { lines, imbalance } = buildRefundLines(rf, acct)
    if (lines.length < 2) continue
    if (imbalance !== 0) {
      lines.push({ account_id: ensureRounding(), amount_cents: -imbalance, memo: 'Rounding' })
      summary.roundingAdjustments++
      summary.roundingTotalCents += imbalance
    }
    postTransaction({
      company_id: companyId,
      date: rf.date,
      memo: `${provider} refund`,
      reference: rf.externalId,
      source: 'refund',
      lines,
    })
    summary.refunds++
    summary.refundTotalCents += rf.gross
  }

  // 3) Post each payout (DR Bank / CR Clearing) + a bank-feed row for reconciliation.
  for (const po of payouts) {
    if (po.amountCents === 0) continue
    const txnId = postTransaction({
      company_id: companyId,
      date: po.date,
      memo: po.description ?? `${provider} payout`,
      reference: po.externalId,
      source: 'deposit',
      lines: buildPayoutLines(po, acct),
    })
    summary.payouts++
    summary.payoutTotalCents += po.amountCents
    const inserted = insertBankTransactions(companyId, acct.bank, [{
      date: po.date,
      description: po.description ?? `${provider} payout ${po.externalId}`,
      amount_cents: po.amountCents,
      fitid: `${provider}:payout:${po.externalId}`,
    }])
    summary.bankRowsInserted += inserted
    // The payout deposit and its bank-feed row are the same event — pre-match
    // them so the reconciliation grid shows them reconciled out of the box.
    if (autoMatch && inserted > 0) {
      const row = findBankRowByFitid(companyId, acct.bank, `${provider}:payout:${po.externalId}`)
      if (row != null) { matchBankToTxn(row, txnId); summary.payoutsMatched++ }
    }
  }

  audit(companyId, 'import', 'import', companyId,
    `Imported ${summary.payments} ${provider} payments, ${summary.refunds} refunds and ${summary.payouts} payouts`)
  return summary
}

/** Pull-and-post convenience: any connector → the engine above. */
export async function importFromConnector(
  companyId: number,
  connector: PaymentConnector,
  range: DateRange,
  config: ImportPaymentConfig,
): Promise<ImportPaymentSummary> {
  const [payments, payouts, refunds] = await Promise.all([
    connector.listPayments(range),
    connector.listPayouts(range),
    connector.listRefunds ? connector.listRefunds(range) : Promise.resolve([]),
  ])
  return importPaymentData({ companyId, provider: connector.provider, payments, payouts, refunds, config })
}

// Local helper (not exported from repo) — look up a just-inserted bank row id by fitid.
function findBankRowByFitid(companyId: number, accountId: number, fitid: string): number | null {
  const r = one<{ id: number }>(
    'SELECT id FROM bank_transactions WHERE company_id = ? AND account_id = ? AND fitid = ? ORDER BY id DESC LIMIT 1',
    [companyId, accountId, fitid],
  )
  return r?.id ?? null
}
