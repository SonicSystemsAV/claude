import { clsx } from 'clsx'
import { formatMoney } from '../lib/money'
import { useStore } from '../state/store'

export function Money({
  cents,
  currency,
  colored = false,
  className,
}: {
  cents: number
  /** Override the currency; defaults to the active company's base currency. */
  currency?: string
  colored?: boolean
  className?: string
}) {
  const base = useStore((s) => s.companies.find((c) => c.id === s.currentCompanyId)?.base_currency ?? 'CAD')
  const cur = currency ?? base
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
      {formatMoney(safe, cur)}
    </span>
  )
}
