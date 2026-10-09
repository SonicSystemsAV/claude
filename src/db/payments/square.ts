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
  // amount_money is the sale incl. tax but excl. tip; total_money adds tips.
  // We book the sale (amount_money); TODO(sandbox): handle tips + refunds.
  const gross = p.amount_money.amount
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
  /** Square OAuth Application Secret (the merchant's own app; stays on-device). */
  clientSecret: string
  /** 'sandbox' during development, 'production' once the app is approved. */
  environment: 'sandbox' | 'production'
  /** Loopback redirect port; must match the redirect URI registered at Square. Default 8787. */
  redirectPort?: number
  /** Restrict to a single Square location; empty pulls all the token can access. */
  locationIds?: string[]
}

interface SquareTokens {
  accessToken: string
  refreshToken?: string
  merchantId?: string
  expiresAt?: string
}

const SQUARE_SCOPES = 'PAYMENTS_READ ORDERS_READ PAYOUTS_READ MERCHANT_PROFILE_READ'
const DEFAULT_REDIRECT_PORT = 8787

/** RFC3339 window covering whole calendar days. */
function rangeToRfc3339(range: DateRange): { begin: string; end: string } {
  return { begin: `${range.start}T00:00:00Z`, end: `${range.end}T23:59:59Z` }
}

export class SquareConnector implements PaymentConnector {
  readonly provider = 'square'
  private state: ConnectorStatus
  private tokens: SquareTokens | null = null

  constructor(private config: SquareConfig) {
    this.state = { provider: 'square', state: 'disconnected', accountLabel: null, error: null }
  }

  status(): ConnectorStatus {
    return this.state
  }

  /** Preload tokens obtained earlier (e.g. restored from a prior connect). */
  setTokens(tokens: SquareTokens): void {
    this.tokens = tokens
    this.state = { provider: 'square', state: 'connected', accountLabel: tokens.merchantId ?? 'Square', error: null }
  }

  get redirectUri(): string {
    return `http://localhost:${this.config.redirectPort ?? DEFAULT_REDIRECT_PORT}/callback`
  }

  /**
   * Run Square's authorization-code OAuth flow via the Tauri `square_oauth`
   * command (loopback listener + browser + token exchange). Desktop-only.
   */
  async connect(): Promise<ConnectorStatus> {
    if (!isTauri()) {
      this.state = { provider: 'square', state: 'error', error: 'Connecting to Square requires the desktop app (OAuth needs a local redirect listener and CORS-free HTTP).' }
      return this.state
    }
    if (!this.config.applicationId.trim() || !this.config.clientSecret.trim()) {
      this.state = { provider: 'square', state: 'error', error: 'Enter your Square Application ID and secret first.' }
      return this.state
    }
    this.state = { provider: 'square', state: 'connecting', accountLabel: null, error: null }
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const res = await invoke<{ access_token: string; refresh_token?: string; merchant_id?: string; expires_at?: string }>(
        'square_oauth',
        {
          clientId: this.config.applicationId.trim(),
          clientSecret: this.config.clientSecret.trim(),
          environment: this.config.environment,
          redirectPort: this.config.redirectPort ?? DEFAULT_REDIRECT_PORT,
          scopes: SQUARE_SCOPES,
        },
      )
      this.tokens = {
        accessToken: res.access_token,
        refreshToken: res.refresh_token,
        merchantId: res.merchant_id,
        expiresAt: res.expires_at,
      }
      this.state = { provider: 'square', state: 'connected', accountLabel: res.merchant_id ?? 'Square', error: null }
    } catch (e) {
      this.state = { provider: 'square', state: 'error', error: e instanceof Error ? e.message : String(e) }
    }
    return this.state
  }

  async disconnect(): Promise<void> {
    // TODO: revoke the token via Square /oauth2/revoke before clearing.
    this.tokens = null
    this.state = { provider: 'square', state: 'disconnected', accountLabel: null, error: null }
  }

  private async api<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    if (!this.tokens) throw new Error('Not connected to Square. Run Connect first.')
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke<T>('square_api', {
      environment: this.config.environment,
      accessToken: this.tokens.accessToken,
      method,
      path,
      body: body ?? null,
    })
  }

  private locationParam(): string {
    const ids = this.config.locationIds
    return ids && ids.length === 1 ? `&location_id=${encodeURIComponent(ids[0])}` : ''
  }

  /** Pull payments in the range, enriched with their orders (line items + tax). */
  async listPayments(range: DateRange): Promise<NormalizedPayment[]> {
    this.assertReady()
    const { begin, end } = rangeToRfc3339(range)
    const payments: SquarePayment[] = []
    let cursor: string | undefined
    do {
      const q = `/v2/payments?begin_time=${begin}&end_time=${end}&sort_order=ASC&limit=100${this.locationParam()}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
      const page = await this.api<{ payments?: SquarePayment[]; cursor?: string }>('GET', q)
      payments.push(...(page.payments ?? []))
      cursor = page.cursor
    } while (cursor)

    // Batch-retrieve the orders for line items + tax (up to 100 ids per call).
    const orderIds = [...new Set(payments.map((p) => p.order_id).filter((x): x is string => !!x))]
    const orderMap = new Map<string, SquareOrder>()
    for (let i = 0; i < orderIds.length; i += 100) {
      const chunk = orderIds.slice(i, i + 100)
      const res = await this.api<{ orders?: SquareOrder[] }>('POST', '/v2/orders/batch-retrieve', { order_ids: chunk })
      for (const o of res.orders ?? []) orderMap.set(o.id, o)
    }

    return payments.map((p) => mapPayment(p, p.order_id ? orderMap.get(p.order_id) : undefined))
  }

  /** Pull payouts (bank deposits) in the range, excluding failed ones. */
  async listPayouts(range: DateRange): Promise<NormalizedPayout[]> {
    this.assertReady()
    const { begin, end } = rangeToRfc3339(range)
    const payouts: SquarePayout[] = []
    let cursor: string | undefined
    do {
      const q = `/v2/payouts?begin_time=${begin}&end_time=${end}&sort_order=ASC&limit=100${this.locationParam()}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
      const page = await this.api<{ payouts?: SquarePayout[]; cursor?: string }>('GET', q)
      payouts.push(...(page.payouts ?? []))
      cursor = page.cursor
    } while (cursor)
    return payouts.filter((p) => (p.status ?? '').toUpperCase() !== 'FAILED').map(mapPayout)
  }

  private assertReady(): void {
    if (!isTauri()) throw new Error('Square sync requires the desktop app (CORS-free HTTP + stored tokens).')
    if (this.state.state !== 'connected' || !this.tokens) throw new Error('Not connected to Square. Run Connect first.')
  }
}

/** Factory so callers don't import the class directly. */
export function createSquareConnector(config: SquareConfig): SquareConnector {
  return new SquareConnector(config)
}
