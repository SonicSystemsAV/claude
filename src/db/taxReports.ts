import { all, one, run, insert } from './db'
import { getAccounts, profitAndLossRange, balanceSheet, type ReportLine } from './repo'
import {
  suggestGifi,
  suggestT2125,
  gifiLabel,
  t2125Label,
  GIFI_INCOME,
  GIFI_BALANCE,
} from './taxCodes'
import type { Account } from './types'

export interface TaxMapEntry {
  account: Account
  gifi_code: string
  t2125_line: string | null
  gifi_overridden: boolean
  t2125_overridden: boolean
}

interface StoredMap {
  account_id: number
  gifi_code: string | null
  t2125_line: string | null
}

/** Effective account -> code mapping: stored overrides merged over heuristics. */
export function getTaxMap(companyId: number): TaxMapEntry[] {
  const stored = new Map<number, StoredMap>()
  for (const r of all<StoredMap>('SELECT account_id, gifi_code, t2125_line FROM tax_map WHERE company_id = ?', [companyId])) {
    stored.set(r.account_id, r)
  }
  return getAccounts(companyId).map((account) => {
    const s = stored.get(account.id)
    return {
      account,
      gifi_code: s?.gifi_code ?? suggestGifi(account),
      t2125_line: s?.t2125_line ?? suggestT2125(account),
      gifi_overridden: !!s?.gifi_code,
      t2125_overridden: !!s?.t2125_line,
    }
  })
}

function codeMaps(companyId: number): { gifi: Map<number, string>; t2125: Map<number, string | null> } {
  const gifi = new Map<number, string>()
  const t2125 = new Map<number, string | null>()
  for (const e of getTaxMap(companyId)) {
    gifi.set(e.account.id, e.gifi_code)
    t2125.set(e.account.id, e.t2125_line)
  }
  return { gifi, t2125 }
}

export function setTaxMapping(
  companyId: number,
  accountId: number,
  patch: { gifi_code?: string | null; t2125_line?: string | null },
): void {
  const existing = one<{ id: number; gifi_code: string | null; t2125_line: string | null }>(
    'SELECT id, gifi_code, t2125_line FROM tax_map WHERE company_id = ? AND account_id = ?',
    [companyId, accountId],
  )
  const gifi = patch.gifi_code !== undefined ? patch.gifi_code : existing?.gifi_code ?? null
  const t2125 = patch.t2125_line !== undefined ? patch.t2125_line : existing?.t2125_line ?? null
  if (existing) {
    run('UPDATE tax_map SET gifi_code = ?, t2125_line = ? WHERE id = ?', [gifi, t2125, existing.id])
  } else {
    insert('INSERT INTO tax_map (company_id, account_id, gifi_code, t2125_line) VALUES (?, ?, ?, ?)', [
      companyId, accountId, gifi, t2125,
    ])
  }
}

// ---- Grouping --------------------------------------------------------------

export interface CodeTotal {
  code: string
  label: string
  amount: number
  accounts: string[]
}

function group(lines: ReportLine[], resolver: (id: number) => string | null, labeler: (c: string) => string): CodeTotal[] {
  const m = new Map<string, CodeTotal>()
  for (const l of lines) {
    const code = resolver(l.account.id)
    if (!code) continue
    const cur = m.get(code) ?? { code, label: labeler(code), amount: 0, accounts: [] }
    cur.amount += l.amount
    cur.accounts.push(`${l.account.code} ${l.account.name}`)
    m.set(code, cur)
  }
  return [...m.values()].sort((a, b) => a.code.localeCompare(b.code))
}

// ---- GIFI (T2) -------------------------------------------------------------

export interface GifiIncomeStatement {
  revenue: CodeTotal[]
  costOfSales: CodeTotal[]
  expenses: CodeTotal[]
  totalRevenue: number
  totalCostOfSales: number
  totalExpenses: number
  netIncome: number
}

export function gifiIncomeStatement(companyId: number, start: string, end: string): GifiIncomeStatement {
  const { gifi } = codeMaps(companyId)
  const pnl = profitAndLossRange(companyId, start, end)
  const all = group([...pnl.income, ...pnl.expenses], (id) => gifi.get(id) ?? null, gifiLabel)
  const revenueCodes = new Set(GIFI_INCOME.filter((c) => c.section === 'Revenue').map((c) => c.code))
  const cosCodes = new Set(GIFI_INCOME.filter((c) => c.section === 'Cost of sales').map((c) => c.code))
  const revenue = all.filter((c) => revenueCodes.has(c.code))
  const costOfSales = all.filter((c) => cosCodes.has(c.code))
  const expenses = all.filter((c) => !revenueCodes.has(c.code) && !cosCodes.has(c.code))
  const totalRevenue = revenue.reduce((s, c) => s + c.amount, 0)
  const totalCostOfSales = costOfSales.reduce((s, c) => s + c.amount, 0)
  const totalExpenses = expenses.reduce((s, c) => s + c.amount, 0)
  return {
    revenue, costOfSales, expenses,
    totalRevenue, totalCostOfSales, totalExpenses,
    netIncome: totalRevenue - totalCostOfSales - totalExpenses,
  }
}

export interface GifiBalanceSheet {
  assets: CodeTotal[]
  liabilities: CodeTotal[]
  equity: CodeTotal[]
  totalAssets: number
  totalLiabilities: number
  totalEquity: number
}

export function gifiBalanceSheet(companyId: number, asOf: string): GifiBalanceSheet {
  const { gifi } = codeMaps(companyId)
  const bs = balanceSheet(companyId, asOf)
  const assets = group(bs.assets, (id) => gifi.get(id) ?? null, gifiLabel).filter((c) =>
    GIFI_BALANCE.some((g) => g.code === c.code && g.section === 'Assets'),
  )
  const liabilities = group(bs.liabilities, (id) => gifi.get(id) ?? null, gifiLabel).filter((c) =>
    GIFI_BALANCE.some((g) => g.code === c.code && g.section === 'Liabilities'),
  )
  const equity = group(bs.equity, (id) => gifi.get(id) ?? null, gifiLabel)
  // fold current-period earnings into retained earnings (3600) so it balances
  if (bs.netIncome !== 0) {
    const re = equity.find((c) => c.code === '3600')
    if (re) re.amount += bs.netIncome
    else equity.push({ code: '3600', label: gifiLabel('3600'), amount: bs.netIncome, accounts: ['Current earnings'] })
  }
  equity.sort((a, b) => a.code.localeCompare(b.code))
  return {
    assets, liabilities, equity,
    totalAssets: assets.reduce((s, c) => s + c.amount, 0),
    totalLiabilities: liabilities.reduce((s, c) => s + c.amount, 0),
    totalEquity: equity.reduce((s, c) => s + c.amount, 0),
  }
}

// ---- T2125 (T1 self-employment) -------------------------------------------

export interface T2125Summary {
  income: CodeTotal[]
  expenses: CodeTotal[]
  grossIncome: number
  totalExpenses: number
  netIncome: number
}

export function t2125Summary(companyId: number, start: string, end: string): T2125Summary {
  const { t2125 } = codeMaps(companyId)
  const pnl = profitAndLossRange(companyId, start, end)
  const income = group(pnl.income, (id) => t2125.get(id) ?? null, t2125Label)
  const expenses = group(pnl.expenses, (id) => t2125.get(id) ?? null, t2125Label)
  const grossIncome = income.reduce((s, c) => s + c.amount, 0)
  const totalExpenses = expenses.reduce((s, c) => s + c.amount, 0)
  return { income, expenses, grossIncome, totalExpenses, netIncome: grossIncome - totalExpenses }
}
