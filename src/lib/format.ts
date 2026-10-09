import { format, parseISO, differenceInCalendarDays } from 'date-fns'

/**
 * Date display is configurable and consistent app-wide: every screen, report,
 * and printed document formats dates through formatDate()/shortDate(), which
 * read a single user-chosen pattern. The choice is persisted per device.
 */

export interface DateFormatOption {
  id: string
  label: string
  /** date-fns pattern. */
  pattern: string
}

export const DATE_FORMATS: DateFormatOption[] = [
  { id: 'med', label: 'Mmm D, YYYY (Oct 9, 2026)', pattern: 'MMM d, yyyy' },
  { id: 'long', label: 'Month D, YYYY (October 9, 2026)', pattern: 'MMMM d, yyyy' },
  { id: 'dmy_short', label: 'D Mmm YYYY (9 Oct 2026)', pattern: 'd MMM yyyy' },
  { id: 'iso', label: 'YYYY-MM-DD (2026-10-09)', pattern: 'yyyy-MM-dd' },
  { id: 'us', label: 'MM/DD/YYYY (10/09/2026)', pattern: 'MM/dd/yyyy' },
  { id: 'uk', label: 'DD/MM/YYYY (09/10/2026)', pattern: 'dd/MM/yyyy' },
]

const DEFAULT_ID = 'med'
const LS_KEY = 'sonic.dateFormat'

function patternFor(id: string): string {
  return (DATE_FORMATS.find((f) => f.id === id) ?? DATE_FORMATS[0]).pattern
}

let currentId = DEFAULT_ID
let currentPattern = patternFor(DEFAULT_ID)
try {
  const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(LS_KEY) : null
  if (saved && DATE_FORMATS.some((f) => f.id === saved)) {
    currentId = saved
    currentPattern = patternFor(saved)
  }
} catch {
  /* storage blocked — keep default */
}

export function getDateFormatId(): string {
  return currentId
}

/** Set the app-wide date format and persist it. Callers bump the store rev to re-render. */
export function setDateFormat(id: string): void {
  if (!DATE_FORMATS.some((f) => f.id === id)) return
  currentId = id
  currentPattern = patternFor(id)
  try {
    localStorage.setItem(LS_KEY, id)
  } catch {
    /* ignore */
  }
}

/** Format an ISO yyyy-mm-dd string for display, using the chosen app-wide format. */
export function formatDate(iso: string): string {
  if (!iso) return ''
  try {
    return format(parseISO(iso), currentPattern)
  } catch {
    return iso
  }
}

/** Alias kept for dense tables — same format as formatDate for full consistency. */
export function shortDate(iso: string): string {
  return formatDate(iso)
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
