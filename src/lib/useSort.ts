import { useMemo, useState } from 'react'

/**
 * Generic column sorting for list/table views. Pass the rows and a map of
 * column key → value getter; `toggle(key)` cycles asc → desc on a column.
 * Blank/null values always sort last regardless of direction.
 */
export type SortDir = 'asc' | 'desc'
export type SortGetter<T> = (row: T) => string | number | null | undefined

export function useSort<T>(
  rows: T[],
  getters: Record<string, SortGetter<T>>,
  initial?: { key: string; dir?: SortDir },
) {
  const [key, setKey] = useState<string>(initial?.key ?? '')
  const [dir, setDir] = useState<SortDir>(initial?.dir ?? 'asc')

  const sorted = useMemo(() => {
    const g = getters[key]
    if (!g) return rows
    const factor = dir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => cmp(g(a), g(b)) * factor)
  }, [rows, key, dir, getters])

  function toggle(k: string) {
    if (k === key) setDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setKey(k); setDir('asc') }
  }

  return { sorted, sortKey: key, sortDir: dir, toggle }
}

function isBlank(v: unknown): boolean {
  return v == null || v === '' || (typeof v === 'number' && Number.isNaN(v))
}

function cmp(a: string | number | null | undefined, b: string | number | null | undefined): number {
  const ab = isBlank(a), bb = isBlank(b)
  if (ab && bb) return 0
  if (ab) return 1 // blanks last
  if (bb) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  // Numeric-aware string compare (so "11000" < "25000" and "Unit 2" < "Unit 10").
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}
