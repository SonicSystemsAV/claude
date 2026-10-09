export type AccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense'
export type NormalBalance = 'debit' | 'credit'
export type BankStatus = 'unmatched' | 'matched' | 'ignored'
export type ContactKind = 'customer' | 'supplier' | 'both' | 'other'

export interface Contact {
  id: number
  company_id: number
  name: string
  kind: ContactKind
  email: string | null
  phone: string | null
  address_line1: string | null
  address_line2: string | null
  city: string | null
  province: string | null
  postal: string | null
  country: string | null
  website: string | null
  notes: string | null
  created_at: string
}

export type ItemType = 'service' | 'non_inventory'

export interface Item {
  id: number
  company_id: number
  name: string
  type: ItemType
  description: string | null
  sell: number
  income_account_id: number | null
  sales_price_cents: number
  buy: number
  expense_account_id: number | null
  cost_cents: number
  taxable: number
  active: number
  created_at: string
}

export interface Company {
  id: number
  name: string
  legal_name: string | null
  base_currency: string
  locked_through: string | null
  created_at: string
}

export interface CompanyProfile {
  company_id: number
  display_name: string | null
  address_line1: string | null
  address_line2: string | null
  city: string | null
  province: string | null
  postal: string | null
  country: string | null
  phone: string | null
  email: string | null
  website: string | null
  tax_number: string | null
  logo_data_url: string | null
  use_letterhead: number
  footer_note: string | null
}

export interface Account {
  id: number
  company_id: number
  code: string
  name: string
  type: AccountType
  normal_balance: NormalBalance
  is_bank: number
  parent_id: number | null
  archived: number
}

export interface Transaction {
  id: number
  company_id: number
  date: string
  memo: string | null
  reference: string | null
  contact_id: number | null
  status: string
  source: string
  created_at: string
}

export interface Entry {
  id: number
  transaction_id: number
  account_id: number
  amount_cents: number
  memo: string | null
}

export interface BankTxn {
  id: number
  company_id: number
  account_id: number
  date: string
  description: string
  amount_cents: number
  fitid: string | null
  status: BankStatus
  matched_txn_id: number | null
  reconciliation_id: number | null
  imported_at: string
}

export interface Rule {
  id: number
  company_id: number
  pattern: string
  match_kind: 'contains' | 'regex' | 'exact'
  account_id: number
  priority: number
  enabled: number
  created_at: string
}

export interface TxnLine {
  account_id: number
  amount_cents: number
  memo?: string | null
}

export type DocType =
  | 'invoice'
  | 'bill'
  | 'expense'
  | 'sales_receipt'
  | 'payment_received'
  | 'payment_made'
export type DocStatus = 'open' | 'partial' | 'paid' | 'void'

export interface DocumentRow {
  id: number
  company_id: number
  type: DocType
  contact_id: number | null
  date: string
  due_date: string | null
  number: string | null
  memo: string | null
  tax_code_id: number | null
  payment_method: string | null
  status: DocStatus
  subtotal_cents: number
  tax_cents: number
  total_cents: number
  balance_cents: number
  transaction_id: number | null
  created_at: string
}

export interface DocumentLineInput {
  account_id: number
  item_id?: number | null
  description?: string | null
  qty?: number
  unit_price_cents?: number
  amount_cents: number
  taxable?: boolean
}
