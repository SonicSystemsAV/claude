/**
 * Multi-currency scaffolding.
 *
 * The ledger today is single-currency per company (companies.base_currency,
 * default 'CAD'); money is integer minor units (cents). This module lays the
 * groundwork for foreign-currency transactions WITHOUT rewiring posting yet:
 *   • a currency registry (symbol, name, minor-unit digits),
 *   • locale-correct formatting for any currency,
 *   • exact integer conversion between currencies at a rate,
 *   • realized / unrealized FX gain-loss math.
 *
 * Adoption path (incremental, later): add `currency` + `fx_rate` columns to
 * entries (or a per-transaction currency + rate), store amounts in their own
 * currency, and post a base-currency equivalent using convertMinorUnits(); book
 * the difference on settlement to an "FX gain/loss" account via realizedFxGain().
 * Nothing here changes the schema, so it's safe to land ahead of that work.
 */

export interface CurrencyInfo {
  /** ISO 4217 code, e.g. 'CAD'. */
  code: string
  symbol: string
  name: string
  /** Number of minor-unit digits (2 for CAD/USD, 0 for JPY, 3 for BHD). */
  minorDigits: number
}

/** Common currencies; extend as needed. Kept small and explicit on purpose. */
export const CURRENCIES: CurrencyInfo[] = [
  { code: 'CAD', symbol: '$', name: 'Canadian Dollar', minorDigits: 2 },
  { code: 'USD', symbol: '$', name: 'US Dollar', minorDigits: 2 },
  { code: 'EUR', symbol: '€', name: 'Euro', minorDigits: 2 },
  { code: 'GBP', symbol: '£', name: 'British Pound', minorDigits: 2 },
  { code: 'AUD', symbol: '$', name: 'Australian Dollar', minorDigits: 2 },
  { code: 'JPY', symbol: '¥', name: 'Japanese Yen', minorDigits: 0 },
  { code: 'CHF', symbol: 'CHF', name: 'Swiss Franc', minorDigits: 2 },
  { code: 'MXN', symbol: '$', name: 'Mexican Peso', minorDigits: 2 },
  { code: 'INR', symbol: '₹', name: 'Indian Rupee', minorDigits: 2 },
  { code: 'CNY', symbol: '¥', name: 'Chinese Yuan', minorDigits: 2 },
]

const BY_CODE = new Map(CURRENCIES.map((c) => [c.code, c]))

export const DEFAULT_CURRENCY = 'CAD'

/** Look up a currency, falling back to a 2-digit entry for unknown codes. */
export function getCurrency(code: string): CurrencyInfo {
  return BY_CODE.get(code) ?? { code, symbol: code, name: code, minorDigits: 2 }
}

export function minorDigits(code: string): number {
  return getCurrency(code).minorDigits
}

/**
 * Format integer minor units in a currency, locale-correct.
 * (The app-wide formatMoney in lib/money is CAD-only; use this for foreign.)
 */
export function formatCurrency(minorUnits: number, code = DEFAULT_CURRENCY, locale = 'en-CA'): string {
  const info = getCurrency(code)
  const safe = minorUnits === 0 ? 0 : minorUnits // normalize -0
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: code }).format(
      safe / 10 ** info.minorDigits,
    )
  } catch {
    // Unknown ISO code → plain symbol + number.
    return `${info.symbol}${(safe / 10 ** info.minorDigits).toFixed(info.minorDigits)}`
  }
}

// ---------------------------------------------------------------------------
// Exchange rates + conversion
// ---------------------------------------------------------------------------

/**
 * A quote: 1 unit of `from` = `rate` units of `to`, as of `asOf`.
 * Rate is a decimal number (not minor units); e.g. CAD→USD ≈ 0.73.
 */
export interface ExchangeRate {
  from: string
  to: string
  rate: number
  /** ISO yyyy-mm-dd the rate applies to. */
  asOf: string
}

/**
 * Convert integer minor units from one currency to another at `rate`,
 * respecting each currency's minor-unit digits. Banker-free half-up rounding
 * to the target currency's smallest unit.
 *
 * Example: 10000 CAD cents → USD at 0.73 → round(100.00 × 0.73 × 100) = 7300.
 */
export function convertMinorUnits(amountMinor: number, from: string, to: string, rate: number): number {
  if (rate <= 0) throw new Error('Exchange rate must be greater than zero.')
  const fromDigits = minorDigits(from)
  const toDigits = minorDigits(to)
  const major = amountMinor / 10 ** fromDigits
  const convertedMajor = major * rate
  return Math.round(convertedMajor * 10 ** toDigits)
}

/** The base-currency value of a foreign amount at `rate` (from → base). */
export function toBase(amountMinor: number, foreign: string, base: string, rate: number): number {
  return convertMinorUnits(amountMinor, foreign, base, rate)
}

/**
 * Realized FX gain/loss (in base minor units) on settling a foreign balance.
 * Positive = gain. `amountForeignMinor` is the foreign amount settled; the
 * booked rate is when it was recorded, the settle rate when paid/received.
 *   gain = base@settle − base@booked
 */
export function realizedFxGain(
  amountForeignMinor: number,
  foreign: string,
  base: string,
  bookedRate: number,
  settledRate: number,
): number {
  const atBooked = toBase(amountForeignMinor, foreign, base, bookedRate)
  const atSettled = toBase(amountForeignMinor, foreign, base, settledRate)
  return atSettled - atBooked
}

/**
 * Unrealized FX gain/loss (in base minor units) on revaluing an open foreign
 * balance at a period-end rate versus the rate it was booked at.
 */
export function unrealizedFxGain(
  amountForeignMinor: number,
  foreign: string,
  base: string,
  bookedRate: number,
  periodEndRate: number,
): number {
  return realizedFxGain(amountForeignMinor, foreign, base, bookedRate, periodEndRate)
}
