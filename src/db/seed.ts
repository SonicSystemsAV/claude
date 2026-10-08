import { listCompanies } from './repo'
import {
  createAccount,
  createCompany,
  createRule,
  insertBankTransactions,
  postTransaction,
} from './repo'
import { tx } from './db'
import type { AccountType, NormalBalance } from './types'

interface AcctDef {
  code: string
  name: string
  type: AccountType
  normal: NormalBalance
  bank?: boolean
}

const NB = 'debit' as const
const CR = 'credit' as const

function createAccounts(companyId: number, defs: AcctDef[]): Record<string, number> {
  const map: Record<string, number> = {}
  for (const d of defs) {
    map[d.code] = createAccount({
      company_id: companyId,
      code: d.code,
      name: d.name,
      type: d.type,
      normal_balance: d.normal,
      is_bank: d.bank,
    })
  }
  return map
}

/** A book transaction that posts `amount` (bank sign) to the bank account and the opposite to `counter`. */
function book(
  companyId: number,
  bank: number,
  counter: number,
  date: string,
  amount: number,
  memo: string,
) {
  postTransaction({
    company_id: companyId,
    date,
    memo,
    source: 'manual',
    lines: [
      { account_id: bank, amount_cents: amount },
      { account_id: counter, amount_cents: -amount },
    ],
  })
}

function seedNorthwind() {
  const id = createCompany('Northwind Coffee', 'Northwind Coffee Roasters Inc.', 'CAD')
  const a = createAccounts(id, [
    { code: '1000', name: 'Chequing', type: 'asset', normal: NB, bank: true },
    { code: '1010', name: 'Savings', type: 'asset', normal: NB, bank: true },
    { code: '1200', name: 'Accounts Receivable', type: 'asset', normal: NB },
    { code: '1500', name: 'Equipment', type: 'asset', normal: NB },
    { code: '2000', name: 'Accounts Payable', type: 'liability', normal: CR },
    { code: '2100', name: 'Sales Tax Payable', type: 'liability', normal: CR },
    { code: '2300', name: 'Gift Card Liability', type: 'liability', normal: CR },
    { code: '3000', name: 'Opening Balance Equity', type: 'equity', normal: CR },
    { code: '3100', name: 'Owner Contributions', type: 'equity', normal: CR },
    { code: '3900', name: 'Retained Earnings', type: 'equity', normal: CR },
    { code: '4000', name: 'Sales — Coffee', type: 'income', normal: CR },
    { code: '4100', name: 'Sales — Food', type: 'income', normal: CR },
    { code: '4200', name: 'Wholesale Revenue', type: 'income', normal: CR },
    { code: '5000', name: 'COGS — Coffee Beans', type: 'expense', normal: NB },
    { code: '5100', name: 'COGS — Food & Beverage', type: 'expense', normal: NB },
    { code: '6000', name: 'Rent', type: 'expense', normal: NB },
    { code: '6100', name: 'Utilities', type: 'expense', normal: NB },
    { code: '6200', name: 'Payroll', type: 'expense', normal: NB },
    { code: '6300', name: 'Supplies', type: 'expense', normal: NB },
    { code: '6400', name: 'Marketing', type: 'expense', normal: NB },
    { code: '6500', name: 'Bank Fees', type: 'expense', normal: NB },
    { code: '6600', name: 'Insurance', type: 'expense', normal: NB },
    { code: '6700', name: 'Software & Subscriptions', type: 'expense', normal: NB },
    { code: '6800', name: 'Vehicle & Fuel', type: 'expense', normal: NB },
    { code: '6900', name: 'Licenses & Fees', type: 'expense', normal: NB },
  ])

  // Opening balances.
  book(id, a['1000'], a['3000'], '2026-09-01', 1_500_000, 'Opening balance — Chequing')
  book(id, a['1010'], a['3000'], '2026-09-01', 500_000, 'Opening balance — Savings')

  // 11 book transactions that correspond 1:1 to bank-feed lines (for Auto-match).
  book(id, a['1000'], a['3100'], '2026-09-02', 100_000, 'Owner contribution — Chris')
  book(id, a['1000'], a['4200'], '2026-09-03', 125_000, 'Blue Bottle wholesale order')
  book(id, a['1000'], a['4200'], '2026-09-05', 82_050, 'Corner Cafe wholesale order')
  book(id, a['1000'], a['4100'], '2026-09-07', 210_000, 'Catering event — downtown')
  book(id, a['1000'], a['6000'], '2026-09-01', -180_000, 'Rent — Dundas Property Mgmt')
  book(id, a['1000'], a['6100'], '2026-09-08', -43_218, 'Hydro One electricity')
  book(id, a['1000'], a['6100'], '2026-09-09', -15_673, 'Rogers internet')
  book(id, a['1000'], a['6200'], '2026-09-10', -245_000, 'ADP payroll run')
  book(id, a['1000'], a['5000'], '2026-09-11', -98_000, 'Pacific Green Coffee Importers beans')
  book(id, a['1000'], a['4000'], '2026-09-13', 54_025, 'Farmers Market Saturday sales')
  book(id, a['1000'], a['1500'], '2026-09-14', -22_000, 'Square reader hardware')

  // The bank feed: 25 lines, all unmatched. 11 mirror the book txns above.
  insertBankTransactions(id, a['1000'], [
    // --- matched set (11) ---
    { date: '2026-09-02', description: 'DEPOSIT OWNER CONTRIBUTION CHRIS', amount_cents: 100_000 },
    { date: '2026-09-03', description: 'DEPOSIT BLUE BOTTLE WHOLESALE', amount_cents: 125_000 },
    { date: '2026-09-05', description: 'DEPOSIT CORNER CAFE WHOLESALE', amount_cents: 82_050 },
    { date: '2026-09-07', description: 'DEPOSIT CATERING EVENT DOWNTOWN', amount_cents: 210_000 },
    { date: '2026-09-01', description: 'RENT DUNDAS PROPERTY MGMT', amount_cents: -180_000 },
    { date: '2026-09-08', description: 'HYDRO ONE ELECTRICITY', amount_cents: -43_218 },
    { date: '2026-09-09', description: 'ROGERS INTERNET', amount_cents: -15_673 },
    { date: '2026-09-10', description: 'ADP PAYROLL RUN', amount_cents: -245_000 },
    { date: '2026-09-11', description: 'PACIFIC GREEN COFFEE IMPORTERS', amount_cents: -98_000 },
    { date: '2026-09-13', description: 'FARMERS MARKET SATURDAY SALES', amount_cents: 54_025 },
    { date: '2026-09-14', description: 'SQUARE READER HARDWARE', amount_cents: -22_000 },
    // --- unmatched set (14), to be categorized ---
    { date: '2026-09-04', description: 'SHELL GAS STATION #4471', amount_cents: -6_420 },
    { date: '2026-09-06', description: 'STAPLES STORE #123', amount_cents: -3_850 },
    { date: '2026-09-06', description: 'RESTAURANT DEPOT', amount_cents: -11_200 },
    { date: '2026-09-07', description: 'ADOBE SYSTEMS SUBSCRIPTION', amount_cents: -1_999 },
    { date: '2026-09-08', description: 'INSTAGRAM ADS', amount_cents: -4_500 },
    { date: '2026-09-10', description: 'CITY OF TORONTO BUSINESS LICENSE', amount_cents: -30_000 },
    { date: '2026-09-12', description: 'COSTCO WHOLESALE #556', amount_cents: -7_834 },
    { date: '2026-09-12', description: 'MONTHLY ACCOUNT FEE', amount_cents: -1_250 },
    { date: '2026-09-15', description: 'SYSCO FOOD SERVICE', amount_cents: -21_075 },
    { date: '2026-09-15', description: 'GIFT CARD SALES DEPOSIT', amount_cents: 32_500 },
    { date: '2026-09-16', description: 'INTACT INSURANCE PREMIUM', amount_cents: -8_900 },
    { date: '2026-09-17', description: 'ULINE SHIPPING SUPPLIES', amount_cents: -5_460 },
    { date: '2026-09-18', description: 'SIGNWORKS CONTRACTOR SIGN INSTALL', amount_cents: -60_000 },
    { date: '2026-09-19', description: 'SPOTIFY BUSINESS', amount_cents: -2_745 },
  ])

  // Rules that auto-categorize some of the unmatched lines.
  createRule({ company_id: id, pattern: 'SHELL', account_id: a['6800'] })
  createRule({ company_id: id, pattern: 'STAPLES', account_id: a['6300'] })
  createRule({ company_id: id, pattern: 'ADOBE', account_id: a['6700'] })
  createRule({ company_id: id, pattern: 'SPOTIFY', account_id: a['6700'] })
  createRule({ company_id: id, pattern: 'INTACT', account_id: a['6600'] })
  createRule({ company_id: id, pattern: 'ULINE', account_id: a['6300'] })
}

function seedCascade() {
  const id = createCompany('Cascade Consulting', 'Cascade Consulting', 'CAD')
  const a = createAccounts(id, [
    { code: '1000', name: 'Chequing', type: 'asset', normal: NB, bank: true },
    { code: '1200', name: 'Accounts Receivable', type: 'asset', normal: NB },
    { code: '2000', name: 'Accounts Payable', type: 'liability', normal: CR },
    { code: '3000', name: 'Opening Balance Equity', type: 'equity', normal: CR },
    { code: '3900', name: 'Retained Earnings', type: 'equity', normal: CR },
    { code: '4000', name: 'Consulting Revenue', type: 'income', normal: CR },
    { code: '5000', name: 'Subcontractors', type: 'expense', normal: NB },
    { code: '6000', name: 'Software & Subscriptions', type: 'expense', normal: NB },
    { code: '6100', name: 'Office', type: 'expense', normal: NB },
    { code: '6200', name: 'Travel', type: 'expense', normal: NB },
    { code: '6300', name: 'Meals & Entertainment', type: 'expense', normal: NB },
    { code: '6500', name: 'Bank Fees', type: 'expense', normal: NB },
  ])

  book(id, a['1000'], a['3000'], '2026-09-01', 800_000, 'Opening balance — Chequing')

  // 3 book transactions mirroring 3 bank lines.
  book(id, a['1000'], a['4000'], '2026-09-04', 350_000, 'Acme Corp consulting invoice')
  book(id, a['1000'], a['4000'], '2026-09-09', 180_000, 'Beta LLC monthly retainer')
  book(id, a['1000'], a['5000'], '2026-09-11', -120_000, 'Subcontractor J. Smith')

  insertBankTransactions(id, a['1000'], [
    { date: '2026-09-04', description: 'ACME CORP CONSULTING', amount_cents: 350_000 },
    { date: '2026-09-09', description: 'BETA LLC RETAINER', amount_cents: 180_000 },
    { date: '2026-09-11', description: 'SUBCONTRACTOR J SMITH', amount_cents: -120_000 },
    { date: '2026-09-05', description: 'NOTION LABS', amount_cents: -4_999 },
    { date: '2026-09-06', description: 'GOOGLE WORKSPACE', amount_cents: -1_500 },
    { date: '2026-09-10', description: 'PORTER AIRLINES', amount_cents: -8_650 },
    { date: '2026-09-12', description: 'THE KEG RESTAURANT', amount_cents: -4_210 },
    { date: '2026-09-13', description: 'MONTHLY ACCOUNT FEE', amount_cents: -1_200 },
  ])

  createRule({ company_id: id, pattern: 'NOTION', account_id: a['6000'] })
  createRule({ company_id: id, pattern: 'GOOGLE', account_id: a['6000'] })
}

/** Seed the two demo companies if the database is empty. Returns true if seeded. */
export function seedIfEmpty(): boolean {
  if (listCompanies().length > 0) return false
  tx(() => {
    seedNorthwind()
    seedCascade()
  })
  return true
}
