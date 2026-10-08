// Money is stored everywhere as integer CENTS (never floats).
// Positive/negative convention is caller-defined; formatting handles the sign.

export type Cents = number

/** Format integer cents as a currency string. Normalizes negative zero. */
export function formatMoney(cents: Cents, currency = 'CAD'): string {
  // sign-flipping credit-normal balances can produce -0, which Intl renders
  // as "-$0.00". Normalize it to plain 0.
  const safe = Object.is(cents, -0) || cents === 0 ? 0 : cents
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency,
    currencyDisplay: 'symbol',
  }).format(safe / 100)
}

/** Format cents without the currency symbol (for dense tables). */
export function formatAmount(cents: Cents): string {
  const safe = Object.is(cents, -0) || cents === 0 ? 0 : cents
  return new Intl.NumberFormat('en-CA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(safe / 100)
}

/** Parse a user-typed money string (e.g. "1,234.56", "$1234.5", "(12.00)") to cents. */
export function parseMoney(input: string): Cents {
  if (input == null) return 0
  let s = String(input).trim()
  let negative = false
  if (/^\(.*\)$/.test(s)) {
    negative = true
    s = s.slice(1, -1)
  }
  s = s.replace(/[^0-9.\-]/g, '')
  if (s.startsWith('-')) {
    negative = true
    s = s.replace(/-/g, '')
  }
  const value = parseFloat(s)
  if (isNaN(value)) return 0
  const cents = Math.round(value * 100)
  return negative ? -cents : cents
}

export function absCents(c: Cents): Cents {
  return c < 0 ? -c : c
}
