/**
 * Pure parser for a QuickBooks Online **General Ledger** report (the native
 * Reports API JSON shape) → source-agnostic transactions for importQBOData().
 *
 * This file has NO database imports so it stays unit-testable in plain Node.
 *
 * Why the GL works as a double-entry source: QBO's GL lists every posting line
 * under its account section, and each line carries the owning transaction's id
 * (on the Transaction Type cell). Regrouping all lines by that id reconstructs
 * the original balanced journal entry — the account for a line is its nearest
 * enclosing section header, the amount is the line's debit (−credit).
 */

import type { ContactKind } from './types'
import type { QBOAccountInput, QBOTxnInput } from './qboImport'

// ---- QBO report JSON (minimal shapes we rely on) ---------------------------

export interface QBOCell { value: string; id?: string }
export interface QBOColumn { ColTitle?: string; ColType?: string; MetaData?: { Name: string; Value: string }[] }
export interface QBORow {
  Header?: { ColData: QBOCell[] }
  Rows?: { Row?: QBORow[] }
  Summary?: { ColData: QBOCell[] }
  ColData?: QBOCell[]
  type?: string
}
export interface QBOReport {
  Header?: Record<string, unknown>
  Columns?: { Column: QBOColumn[] }
  Rows?: { Row?: QBORow[] }
}

// ---- helpers ---------------------------------------------------------------

/** Classify a QBO transaction type as customer- or supplier-facing. Shared with the CSV path. */
export function contactKindForType(type: string): ContactKind {
  const t = (type || '').toLowerCase()
  if (
    t.includes('bill') || t.includes('supplier') || t.includes('vendor') ||
    t.includes('expense') || t.includes('cheque') || t.includes('check') ||
    t.includes('purchase') || t.includes('credit card')
  )
    return 'supplier'
  if (
    t.includes('invoice') || t.includes('sales receipt') || t.includes('payment') ||
    t.includes('receipt') || t.includes('credit memo') || t.includes('refund') ||
    t.includes('estimate')
  )
    return 'customer'
  return 'other'
}

/** Parse a QBO money string ("1,234.56", "(1,234.56)", "-5.00", "") → integer cents. */
export function moneyToCents(s: string | undefined): number {
  if (s == null) return 0
  let t = String(s).trim()
  if (!t) return 0
  let neg = false
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1) }
  t = t.replace(/[$,\s]/g, '')
  if (t.startsWith('-')) { neg = true; t = t.slice(1) }
  const v = parseFloat(t)
  if (isNaN(v)) return 0
  const cents = Math.round(v * 100)
  return neg ? -cents : cents
}

function colKey(col: QBOColumn): string {
  return col.MetaData?.find((x) => x.Name === 'ColKey')?.Value ?? ''
}

/** Map the report's columns to the field indexes we read. */
interface ColMap {
  date: number
  type: number
  num: number
  name: number
  memo: number
  split: number
  /** single signed amount column (debit +, credit −), if present */
  amount: number
  /** separate debit / credit columns, if that's how the report is shaped */
  debit: number
  credit: number
}

function mapColumns(cols: QBOColumn[]): ColMap {
  const idx = (keys: string[]) => cols.findIndex((c) => keys.includes(colKey(c).toLowerCase()))
  return {
    date: idx(['tx_date']),
    type: idx(['txn_type']),
    num: idx(['doc_num']),
    name: idx(['name']),
    memo: idx(['memo']),
    split: idx(['split_acc']),
    amount: idx(['subt_nat_amount', 'nat_amount', 'amount', 'subt_nat_home_amount']),
    debit: idx(['debt_amt', 'debit', 'debit_amt']),
    credit: idx(['credt_amt', 'credit', 'credit_amt']),
  }
}

const cell = (row: QBOCell[], i: number): QBOCell | undefined => (i >= 0 ? row[i] : undefined)

// ---- parse -----------------------------------------------------------------

export interface ParsedGL {
  accounts: QBOAccountInput[]
  transactions: QBOTxnInput[]
  /** Transactions whose lines did not net to zero (before rounding) — for diagnostics. */
  unbalanced: { ref: string; sumCents: number }[]
  hasAmounts: boolean
}

interface RawLine {
  txnId: string
  account: string
  date: string
  type: string
  num: string
  name: string
  memo: string
  amountCents: number
}

/**
 * Parse a QBO GeneralLedger report into accounts + balanced transactions.
 * `accountTypes` (optional, from search_accounts) maps account name → QBO type
 * for accurate classification; otherwise types are inferred from the name.
 */
export function parseGeneralLedger(
  report: QBOReport,
  accountTypes?: Map<string, string>,
): ParsedGL {
  const cols = report.Columns?.Column ?? []
  const cm = mapColumns(cols)
  const hasAmounts = cm.amount >= 0 || cm.debit >= 0 || cm.credit >= 0

  const accountNames = new Set<string>()
  const lines: RawLine[] = []

  const lineAmount = (cd: QBOCell[]): number => {
    if (cm.amount >= 0) return moneyToCents(cell(cd, cm.amount)?.value)
    const d = moneyToCents(cell(cd, cm.debit)?.value)
    const c = moneyToCents(cell(cd, cm.credit)?.value)
    return d - c // debit positive, credit negative
  }

  const walk = (rows: QBORow[], currentAccount: string | null) => {
    for (const row of rows) {
      // A section: its header names the account; recurse into its child rows.
      if (row.Header || row.Rows) {
        const headerName = row.Header?.ColData?.[0]?.value?.trim() || currentAccount || ''
        if (headerName) accountNames.add(headerName)
        if (row.Rows?.Row) walk(row.Rows.Row, headerName || currentAccount)
        continue
      }
      // A data row: one posting line for `currentAccount`.
      const cd = row.ColData
      if (!cd || !currentAccount) continue
      const date = cell(cd, cm.date)?.value?.trim() ?? ''
      const typeCell = cell(cd, cm.type)
      const type = typeCell?.value?.trim() ?? ''
      if (!date || !type) continue // skip "Beginning Balance" and total rows
      const txnId = typeCell?.id?.trim() || `${type}|${date}|${cell(cd, cm.num)?.value ?? ''}`
      lines.push({
        txnId,
        account: currentAccount,
        date,
        type,
        num: cell(cd, cm.num)?.value?.trim() ?? '',
        name: cell(cd, cm.name)?.value?.trim() ?? '',
        memo: cell(cd, cm.memo)?.value?.trim() ?? '',
        amountCents: lineAmount(cd),
      })
    }
  }
  walk(report.Rows?.Row ?? [], null)

  // Group lines into transactions by txn id, preserving first-seen order.
  const order: string[] = []
  const groups = new Map<string, RawLine[]>()
  for (const l of lines) {
    let g = groups.get(l.txnId)
    if (!g) { g = []; groups.set(l.txnId, g); order.push(l.txnId) }
    g.push(l)
  }

  const transactions: QBOTxnInput[] = []
  const unbalanced: { ref: string; sumCents: number }[] = []
  for (const id of order) {
    const g = groups.get(id)!
    const first = g[0]
    const contactName = (g.find((l) => l.name)?.name || '').trim()
    const sum = g.reduce((s, l) => s + l.amountCents, 0)
    if (hasAmounts && sum !== 0) unbalanced.push({ ref: `${first.type} ${first.num || id}`, sumCents: sum })
    transactions.push({
      date: first.date,
      memo: first.name || first.memo || first.type || `QBO ${first.type}`,
      reference: first.num || null,
      contactName: contactName || null,
      contactKind: contactName ? contactKindForType(first.type) : 'other',
      lines: g.map((l) => ({ account: l.account, amount_cents: l.amountCents, memo: l.memo || null })),
    })
  }

  const accounts: QBOAccountInput[] = [...accountNames].map((name) => ({
    name,
    qboType: accountTypes?.get(name),
  }))

  return { accounts, transactions, unbalanced, hasAmounts }
}
