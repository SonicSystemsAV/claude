// Curated CRA tax codes for mapping the chart of accounts.
// GIFI (General Index of Financial Information) for the T2 corporate return
// (Schedule 100 balance sheet + Schedule 125 income statement), and the
// T2125 line numbers for self-employment income on a T1.
// These are the common lines, not the exhaustive catalogue — enough to prepare
// a return and refine by hand where needed.

import type { Account } from './types'

export interface CodeOption {
  code: string
  label: string
  section: string
}

// ---- GIFI — Schedule 125 (income statement) --------------------------------
export const GIFI_INCOME: CodeOption[] = [
  { code: '8000', label: 'Trade sales of goods and services', section: 'Revenue' },
  { code: '8089', label: 'Other revenue', section: 'Revenue' },
  { code: '8210', label: 'Realized gains on disposal of assets', section: 'Revenue' },
  { code: '8300', label: 'Cost of sales', section: 'Cost of sales' },
  { code: '8320', label: 'Purchases / materials', section: 'Cost of sales' },
  { code: '8360', label: 'Direct wages (COGS)', section: 'Cost of sales' },
  { code: '8520', label: 'Advertising and promotion', section: 'Operating expenses' },
  { code: '8620', label: 'Insurance', section: 'Operating expenses' },
  { code: '8710', label: 'Interest and bank charges', section: 'Operating expenses' },
  { code: '8760', label: 'Business taxes, licences, memberships', section: 'Operating expenses' },
  { code: '8810', label: 'Office expenses', section: 'Operating expenses' },
  { code: '8811', label: 'Office stationery and supplies', section: 'Operating expenses' },
  { code: '8860', label: 'Professional fees', section: 'Operating expenses' },
  { code: '8871', label: 'Management and administration fees', section: 'Operating expenses' },
  { code: '8910', label: 'Rental', section: 'Operating expenses' },
  { code: '8960', label: 'Repairs and maintenance', section: 'Operating expenses' },
  { code: '9060', label: 'Salaries and wages', section: 'Operating expenses' },
  { code: '9130', label: 'Supplies', section: 'Operating expenses' },
  { code: '9200', label: 'Travel expenses', section: 'Operating expenses' },
  { code: '9220', label: 'Utilities', section: 'Operating expenses' },
  { code: '9224', label: 'Fuel costs', section: 'Operating expenses' },
  { code: '9281', label: 'Motor vehicle expenses', section: 'Operating expenses' },
  { code: '9270', label: 'Other expenses', section: 'Operating expenses' },
  { code: '9275', label: 'Delivery, freight and express', section: 'Operating expenses' },
  { code: '8230', label: 'Amortization of tangible assets', section: 'Operating expenses' },
]

// ---- GIFI — Schedule 100 (balance sheet) -----------------------------------
export const GIFI_BALANCE: CodeOption[] = [
  { code: '1001', label: 'Cash and deposits', section: 'Assets' },
  { code: '1060', label: 'Accounts receivable', section: 'Assets' },
  { code: '1120', label: 'Inventories', section: 'Assets' },
  { code: '1480', label: 'Prepaid expenses', section: 'Assets' },
  { code: '1600', label: 'Land', section: 'Assets' },
  { code: '1740', label: 'Motor vehicles', section: 'Assets' },
  { code: '1743', label: 'Accumulated amortization of vehicles', section: 'Assets' },
  { code: '1680', label: 'Machinery and equipment', section: 'Assets' },
  { code: '1788', label: 'Other long-term assets', section: 'Assets' },
  { code: '1599', label: 'Other current assets', section: 'Assets' },
  { code: '2620', label: 'Accounts payable and accrued liabilities', section: 'Liabilities' },
  { code: '2680', label: 'Taxes payable', section: 'Liabilities' },
  { code: '2700', label: 'Current portion of long-term debt', section: 'Liabilities' },
  { code: '2770', label: 'Bank loans / long-term debt', section: 'Liabilities' },
  { code: '2960', label: 'Other liabilities', section: 'Liabilities' },
  { code: '3500', label: 'Common shares', section: 'Equity' },
  { code: '3540', label: "Owner / shareholder contributions", section: 'Equity' },
  { code: '3600', label: 'Retained earnings', section: 'Equity' },
  { code: '3620', label: 'Other equity', section: 'Equity' },
]

export const GIFI_ALL = [...GIFI_INCOME, ...GIFI_BALANCE]

// ---- T2125 lines -----------------------------------------------------------
export const T2125_INCOME: CodeOption[] = [
  { code: '8000', label: 'Sales, commissions or fees', section: 'Income' },
  { code: '8230', label: 'Other income', section: 'Income' },
]
export const T2125_EXPENSE: CodeOption[] = [
  { code: '8521', label: 'Advertising', section: 'Expenses' },
  { code: '8523', label: 'Meals and entertainment (50%)', section: 'Expenses' },
  { code: '8590', label: 'Bad debts', section: 'Expenses' },
  { code: '8690', label: 'Insurance', section: 'Expenses' },
  { code: '8710', label: 'Interest and bank charges', section: 'Expenses' },
  { code: '8760', label: 'Business taxes, licences, memberships', section: 'Expenses' },
  { code: '8810', label: 'Office expenses', section: 'Expenses' },
  { code: '8811', label: 'Office stationery and supplies', section: 'Expenses' },
  { code: '8860', label: 'Professional fees', section: 'Expenses' },
  { code: '8871', label: 'Management and administration fees', section: 'Expenses' },
  { code: '8910', label: 'Rent', section: 'Expenses' },
  { code: '8960', label: 'Repairs and maintenance', section: 'Expenses' },
  { code: '9060', label: 'Salaries, wages and benefits', section: 'Expenses' },
  { code: '9180', label: 'Property taxes', section: 'Expenses' },
  { code: '9200', label: 'Travel', section: 'Expenses' },
  { code: '9220', label: 'Utilities', section: 'Expenses' },
  { code: '9224', label: 'Fuel costs', section: 'Expenses' },
  { code: '9275', label: 'Delivery, freight and express', section: 'Expenses' },
  { code: '9281', label: 'Motor vehicle expenses', section: 'Expenses' },
  { code: '9936', label: 'Capital cost allowance (CCA)', section: 'Expenses' },
  { code: '9270', label: 'Other expenses', section: 'Expenses' },
]
export const T2125_ALL = [...T2125_INCOME, ...T2125_EXPENSE]

// ---- Heuristic suggestions -------------------------------------------------

function kw(name: string, ...words: string[]): boolean {
  const n = name.toLowerCase()
  return words.some((w) => n.includes(w))
}

export function suggestGifi(a: Account): string {
  const n = a.name.toLowerCase()
  if (a.type === 'asset') {
    if (a.is_bank || kw(n, 'cash', 'bank', 'chequing', 'savings')) return '1001'
    if (kw(n, 'receivable', 'a/r')) return '1060'
    if (kw(n, 'inventory')) return '1120'
    if (kw(n, 'prepaid')) return '1480'
    if (kw(n, 'accumulated', 'depreciation', 'amortization')) return '1743'
    if (kw(n, 'vehicle', 'auto', 'car', 'truck')) return '1740'
    if (kw(n, 'equipment', 'machinery', 'computer')) return '1680'
    if (kw(n, 'land', 'building', 'property')) return '1600'
    return '1599'
  }
  if (a.type === 'liability') {
    if (kw(n, 'payable', 'a/p')) return '2620'
    if (kw(n, 'gst', 'hst', 'tax')) return '2680'
    if (kw(n, 'loan', 'borrow', 'note', 'debt', 'line of credit', 'loc', 'ceba')) return '2770'
    if (kw(n, 'credit card')) return '2620'
    return '2960'
  }
  if (a.type === 'equity') {
    if (kw(n, 'retained')) return '3600'
    if (kw(n, 'share')) return '3500'
    if (kw(n, 'contribution', 'owner', 'draw', 'opening balance')) return '3540'
    return '3620'
  }
  if (a.type === 'income') return kw(n, 'other', 'interest', 'gain') ? '8089' : '8000'
  // expense / COGS
  if (kw(n, 'cost of goods', 'cogs', 'purchase', 'materials')) return '8300'
  if (kw(n, 'advertis', 'marketing', 'promotion')) return '8520'
  if (kw(n, 'insurance')) return '8620'
  if (kw(n, 'interest', 'bank charge', 'bank fee')) return '8710'
  if (kw(n, 'licence', 'license', 'dues', 'membership', 'business tax')) return '8760'
  if (kw(n, 'office')) return '8810'
  if (kw(n, 'professional', 'legal', 'accounting')) return '8860'
  if (kw(n, 'management', 'admin')) return '8871'
  if (kw(n, 'rent', 'lease')) return '8910'
  if (kw(n, 'repair', 'maintenance')) return '8960'
  if (kw(n, 'salar', 'wage', 'payroll')) return '9060'
  if (kw(n, 'suppl')) return '9130'
  if (kw(n, 'travel')) return '9200'
  if (kw(n, 'utilit', 'hydro', 'phone', 'internet')) return '9220'
  if (kw(n, 'fuel', 'gas')) return '9224'
  if (kw(n, 'vehicle', 'motor', 'auto')) return '9281'
  if (kw(n, 'freight', 'delivery', 'shipping', 'courier')) return '9275'
  if (kw(n, 'deprecia', 'amortiz')) return '8230'
  return '9270'
}

export function suggestT2125(a: Account): string | null {
  const n = a.name.toLowerCase()
  if (a.type === 'income') return '8000'
  if (a.type !== 'expense') return null
  if (kw(n, 'advertis', 'marketing', 'promotion')) return '8521'
  if (kw(n, 'meal', 'entertain')) return '8523'
  if (kw(n, 'bad debt')) return '8590'
  if (kw(n, 'insurance')) return '8690'
  if (kw(n, 'interest', 'bank charge', 'bank fee')) return '8710'
  if (kw(n, 'licence', 'license', 'dues', 'membership', 'business tax')) return '8760'
  if (kw(n, 'office')) return '8810'
  if (kw(n, 'professional', 'legal', 'accounting')) return '8860'
  if (kw(n, 'management', 'admin')) return '8871'
  if (kw(n, 'rent', 'lease')) return '8910'
  if (kw(n, 'repair', 'maintenance')) return '8960'
  if (kw(n, 'salar', 'wage', 'payroll', 'subcontract')) return '9060'
  if (kw(n, 'property tax')) return '9180'
  if (kw(n, 'travel')) return '9200'
  if (kw(n, 'utilit', 'hydro', 'phone', 'internet')) return '9220'
  if (kw(n, 'fuel', 'gas')) return '9224'
  if (kw(n, 'freight', 'delivery', 'shipping', 'courier')) return '9275'
  if (kw(n, 'vehicle', 'motor', 'auto')) return '9281'
  if (kw(n, 'deprecia', 'amortiz', 'cca', 'capital cost')) return '9936'
  return '9270'
}

export function gifiLabel(code: string): string {
  return GIFI_ALL.find((c) => c.code === code)?.label ?? code
}
export function t2125Label(code: string): string {
  return T2125_ALL.find((c) => c.code === code)?.label ?? code
}
