/**
 * Square payment connector.
 *
 * Maps Square's API shapes → the normalized model in ./connector.ts:
 *   • Orders (line items)  → NormalizedLineItem[] → the app's ITEMS catalog
 *   • Payments             → sales receipts (income + tax, method = 'Square')
 *   • processing_fee       → a Merchant Processing Fees expense
 *   • Payouts (lump sums)  → bank-feed rows the reconciliation grid matches
 *
 * The actual network calls are STUBBED behind clearly-marked methods. Live
 * OAuth + HTTP must run in the Tauri desktop shell (Square's API sends no CORS
 * headers, so a browser fetch() is blocked — same constraint as QuickBooks,
 * see docs/QUICKBOOKS_AND_DATA_FILES.md §B4). A second POS (Stripe, Clover, …)
 * is just another file implementing PaymentConnector the same way.
 */

import { isTauri } from '../../lib/desktop'
import type {
  PaymentConnector,
  ConnectorStatus,
  DateRange,
  NormalizedPayment,
  NormalizedPayout,
  NormalizedLineItem,
} from './connector'

// ---------------------------------------------------------------------------
// Square API shapes (the subset we consume). Money is integer minor units
// (cents for CAD/USD) — Square already returns cents, so no ×100 needed.
// Ref: developer.squareup.com/reference/square (Payments, Orders, Payouts).
// ---------------------------------------------------------------------------

export interface SquareMoney {
  amount: number
  currency: string
}

export interface SquarePayment {
  id: string
  created_at: string // RFC3339
  amount_money: SquareMoney // total charged incl. tax
  /** Square may return several fee rows (e.g. card + app fee). */
  processing_fee?: { amount_money: SquareMoney }[]
  total_money?: SquareMoney
  source_type?: string // 'CARD' | 'CASH' | 'EXTERNAL' | ...
  order_id?: string
  customer_id?: string
  buyer_email_address?: string
  payout_id?: string
}

export interface SquareOrderLineItem {
  name?: string
  quantity?: string // Square sends quantity as a string
  base_price_money?: SquareMoney
  gross_sales_money?: SquareMoney
  total_tax_money?: SquareMoney
  total_money?: SquareMoney
}

export interface SquareOrder {
  id: string
  line_items?: SquareOrderLineItem[]
  total_tax_money?: SquareMoney
  total_money?: SquareMoney
}

export interface SquarePayout {
  id: string
  created_at: string
  amount_money: SquareMoney
  status?: string // 'PAID' | 'SENT' | 'FAILED' | ...
}

// ---------------------------------------------------------------------------
// Pure mappers: Square → normalized. No network, no DB — unit-testable.
// ---------------------------------------------------------------------------

/** RFC3339 timestamp → ISO yyyy-mm-dd (local calendar day of the sale). */
export function squareDateToISO(ts: string): string {
  // Keep just the date portion; Square timestamps are ISO already.
  const d = ts.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : new Date(ts).toISOString().slice(0, 10)
}

function sumFees(p: SquarePayment): number {
  return (p.processing_fee ?? []).reduce((s, f) => s + (f.amount_money?.amount ?? 0), 0)
}

export function mapOrderLineItems(order: SquareOrder | undefined): NormalizedLineItem[] | undefined {
  if (!order?.line_items?.length) return undefined
  return order.line_items.map((li) => {
    const qty = li.quantity ? parseFloat(li.quantity) || 1 : 1
    // Prefer gross (ex-tax) sales; fall back to base price × qty.
    const amount = li.gross_sales_money?.amount ?? (li.base_price_money?.amount ?? 0) * qty
    const unit = qty !== 0 ? Math.round(amount / qty) : amount
    return {
      name: (li.name ?? 'Item').trim() || 'Item',
      quantity: qty,
      unitPriceCents: unit,
      amountCents: amount,
      taxable: (li.total_tax_money?.amount ?? 0) > 0,
    }
  })
}

/**
 * Map a Square payment (+ its order, if fetched) to a NormalizedPayment.
 * Tax comes from the order's total_tax_money; fee from processing_fee.
 */
export function mapPayment(p: SquarePayment, order?: SquareOrder): NormalizedPayment {
  const gross = p.total_money?.amount ?? p.amount_money.amount
  const fee = sumFees(p)
  const tax = order?.total_tax_money?.amount ?? 0
  return {
    externalId: p.id,
    date: squareDateToISO(p.created_at),
    gross,
    fee,
    net: gross - fee,
    tax,
    method: squareTender(p.source_type),
    customerName: p.buyer_email_address ?? null,
    items: mapOrderLineItems(order),
    payoutId: p.payout_id ?? null,
  }
}

export function mapPayout(po: SquarePayout): NormalizedPayout {
  return {
    externalId: po.id,
    date: squareDateToISO(po.created_at),
    amountCents: po.amount_money.amount,
    description: `Square payout ${po.id}`,
  }
}

function squareTender(sourceType?: string): string {
  switch ((sourceType ?? '').toUpperCase()) {
    case 'CARD': return 'Square — Card'
    case 'CASH': return 'Square — Cash'
    case 'BANK_ACCOUNT': return 'Square — Bank'
    case 'WALLET': return 'Square — Wallet'
    default: return 'Square'
  }
}

// ---------------------------------------------------------------------------
// The connector. Network calls are stubbed; see TODOs for the Tauri layer.
// ---------------------------------------------------------------------------

export interface SquareConfig {
  /** Square OAuth client id (Application ID). Set per install, never committed. */
  applicationId: string
  /** 'sandbox' during development, 'production' once the app is approved. */
  environment: 'sandbox' | 'production'
  /** Which Square location(s) to pull; empty = all locations on the merchant account. */
  locationIds?: string[]
}

/**
 * Where tokens live: the OS secure store (Windows Credential Manager via Tauri),
 * never in the book file or localStorage. The browser build can't hold them.
 */
export class SquareConnector implements PaymentConnector {
  readonly provider = 'square'
  private state: ConnectorStatus

  constructor(private config: SquareConfig) {
    this.state = { provider: 'square', state: 'disconnected', accountLabel: null, error: null }
  }

  status(): ConnectorStatus {
    return this.state
  }

  /**
   * Start the OAuth code+PKCE flow. Desktop-only.
   *
   * TODO(desktop/tauri): invoke the Rust side to
   *   1. spin up a loopback listener on http://localhost:<port>/callback,
   *   2. open the system browser to Square's authorize URL (scopes:
   *      PAYMENTS_READ, ORDERS_READ, PAYOUTS_READ, MERCHANT_PROFILE_READ)
   *      with a PKCE code_challenge,
   *   3. catch the redirect, exchange code (+verifier) for access+refresh
   *      tokens via Square's /oauth2/token (directly if Square allows a public
   *      client, else through a tiny token-exchange proxy — mirror the QBO
   *      B3a/B3b decision in docs/QUICKBOOKS_AND_DATA_FILES.md),
   *   4. store the refresh token in the OS secure store, keyed by merchant id.
   */
  async connect(): Promise<ConnectorStatus> {
    if (!isTauri()) {
      this.state = {
        provider: 'square',
        state: 'error',
        error: 'Connecting to Square requires the desktop app (OAuth needs a local redirect listener and CORS-free HTTP).',
      }
      return this.state
    }
    if (!this.config.applicationId.trim()) {
      this.state = { provider: 'square', state: 'error', error: 'Missing Square Application ID. Add it in Settings → Connect to Square.' }
      return this.state
    }
    // TODO(desktop): call into Tauri Rust to run the flow described above, using
    // this.config.environment ('sandbox' vs 'production') to pick Square's base URL.
    this.state = {
      provider: 'square',
      state: 'error',
      error: `Square OAuth not yet implemented (desktop Tauri layer pending; env: ${this.config.environment}).`,
    }
    return this.state
  }

  async disconnect(): Promise<void> {
    // TODO(desktop): revoke token via Square /oauth2/revoke and clear the secure store.
    this.state = { provider: 'square', state: 'disconnected', accountLabel: null, error: null }
  }

  /**
   * Pull payments in the range, each enriched with its order (for line items + tax).
   *
   * TODO(desktop): via Tauri Rust HTTP (no CORS in Rust), with a valid access token:
   *   • GET /v2/payments?begin_time&end_time&location_id (paginate on `cursor`)
   *   • for each payment with an order_id, GET /v2/orders/{id} (or BatchRetrieveOrders)
   *   • map each with mapPayment(payment, order)
   * Pull in bounded windows (e.g. by month) and report progress, like the QBO GL pull.
   */
  async listPayments(_range: DateRange): Promise<NormalizedPayment[]> {
    this.assertReady()
    // TODO(desktop): real fetch. Returns [] until the Tauri HTTP layer exists.
    return []
  }

  /**
   * Pull payouts in the range.
   *
   * TODO(desktop): GET /v2/payouts?begin_time&end_time&location_id (paginate),
   * map each with mapPayout(). Optionally GET /v2/payouts/{id}/payout-entries to
   * populate paymentIds so a payout can be traced back to its sales.
   */
  async listPayouts(_range: DateRange): Promise<NormalizedPayout[]> {
    this.assertReady()
    // TODO(desktop): real fetch. Returns [] until the Tauri HTTP layer exists.
    return []
  }

  private assertReady(): void {
    if (!isTauri()) {
      throw new Error('Square sync requires the desktop app (CORS-free HTTP + stored tokens).')
    }
    if (this.state.state !== 'connected') {
      throw new Error('Not connected to Square. Run Connect first.')
    }
  }
}

/** Factory so callers don't import the class directly. */
export function createSquareConnector(config: SquareConfig): PaymentConnector {
  return new SquareConnector(config)
}
