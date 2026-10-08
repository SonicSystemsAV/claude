import { clsx } from 'clsx'
import { formatMoney } from '../lib/money'

export function Money({
  cents,
  currency = 'CAD',
  colored = false,
  className,
}: {
  cents: number
  currency?: string
  colored?: boolean
  className?: string
}) {
  const safe = Object.is(cents, -0) ? 0 : cents
  return (
    <span
      className={clsx(
        'tnum tabular-nums',
        colored && safe < 0 && 'text-rose-600',
        colored && safe > 0 && 'text-emerald-600',
        className,
      )}
    >
      {formatMoney(safe, currency)}
    </span>
  )
}
