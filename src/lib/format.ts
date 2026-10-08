import { format, parseISO, differenceInCalendarDays } from 'date-fns'

/** Format an ISO yyyy-mm-dd string for display. */
export function formatDate(iso: string): string {
  if (!iso) return ''
  try {
    return format(parseISO(iso), 'MMM d, yyyy')
  } catch {
    return iso
  }
}

export function shortDate(iso: string): string {
  if (!iso) return ''
  try {
    return format(parseISO(iso), 'MM/dd/yy')
  } catch {
    return iso
  }
}

/** Absolute day gap between two ISO dates. */
export function dayGap(a: string, b: string): number {
  try {
    return Math.abs(differenceInCalendarDays(parseISO(a), parseISO(b)))
  } catch {
    return 9999
  }
}

export function todayISO(): string {
  return format(new Date(), 'yyyy-MM-dd')
}
