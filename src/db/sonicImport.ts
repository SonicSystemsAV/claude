/**
 * Importer for the standardized Sonic CSV format (the cleaned-up account lists
 * and journals), which is richer than the old QBO exports:
 *
 *  - Account list columns: Account #, Account Name, Parent Account #, Class,
 *    Account Type, Normal Balance, Status, Intercompany Counterparty, Is Header,
 *    QB Original Account(s), Notes.
 *  - Journal columns: Txn ID, Date, Txn Type, Num, Name, Description,
 *    Account #, Account Name, Debit, Credit, QB Original Account.
 *
 * The journal references accounts by their Account # directly, so there's no
 * fuzzy name matching: we build the chart from the account list (preserving the
 * number, parent hierarchy, type, active/inactive status, and the inter-company
 * counterparty tag) and post every journal row to the matching account by
 * number. Transactions are grouped by Txn ID. Imbalances beyond a rounding penny
 * are reported, never force-plugged.
 */

import { run, insert, tx } from './db'
import { createCompany, deleteCompany, normalBalanceFor } from './repo'
import type { AccountType, NormalBalance, ContactKind } from './types'

export interface StandardImportSummary {
  companyId: number
  companyName: string
  accounts: number
  transactions: number
  entries: number
  contacts: number
  unknownAccounts: string[]
  roundingAdjustments: number
  roundingTotalCents: number
  unbalancedSkipped: number
  unbalancedTotalCents: number
  unbalancedSamples: { ref: string; sumCents: number }[]
}

// --- CSV parsing (handles quoted fields with commas / newlines) ------------

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  const s = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++ } else inQuotes = false
      } else field += ch
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(field); field = ''
    } else if (ch === '\n') {
      row.push(field); field = ''
      if (row.some((c) => c.trim() !== '')) rows.push(row)
      row = []
    } else field += ch
  }
  if (field !== '' || row.length) { row.push(field); if (row.some((c) => c.trim() !== '')) rows.push(row) }
  return rows
}

function headerIndex(header: string[]): (name: string) => number {
  const norm = header.map((h) => h.trim().toLowerCase())
  return (name: string) => norm.indexOf(name.trim().toLowerCase())
}

function toCents(v: string | undefined): number {
  if (!v) return 0
  const n = parseFloat(v.replace(/[,$\s]/g, ''))
  return isNaN(n) ? 0 : Math.round(n * 100)
}

function classToType(cls: string, acctType: string): AccountType {
  const c = (cls || '').toLowerCase()
  const t = (acctType || '').toLowerCase()
  if (c.includes('cost of goods') || t.includes('cogs')) return 'expense'
  if (c.includes('other income')) return 'income'
  if (c.includes('other expense')) return 'expense'
  if (c.startsWith('asset')) return 'asset'
  if (c.startsWith('liab')) return 'liability'
  if (c.startsWith('equity')) return 'equity'
  if (c.startsWith('revenue') || c.includes('income')) return 'income'
  if (c.startsWith('expense')) return 'expense'
  return 'asset'
}

// --- Parsed shapes ----------------------------------------------------------

export interface StdAccountRow {
  number: string
  name: string
  parent: string
  type: AccountType
  normal: NormalBalance
  isBank: boolean
  archived: boolean
  counterparty: string | null
}

export function parseStandardAccounts(csv: string): StdAccountRow[] {
  const rows = parseCsv(csv)
  if (rows.length < 2) return []
  const idx = headerIndex(rows[0])
  const cNum = idx('Account #'), cName = idx('Account Name'), cParent = idx('Parent Account #')
  const cClass = idx('Class'), cAcctType = idx('Account Type'), cNormal = idx('Normal Balance')
  const cStatus = idx('Status'), cCounter = idx('Intercompany Counterparty')
  const out: StdAccountRow[] = []
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]
    const number = (r[cNum] ?? '').trim()
    const name = (r[cName] ?? '').trim()
    if (!number || !name) continue
    const type = classToType(r[cClass] ?? '', r[cAcctType] ?? '')
    const normalRaw = (cNormal >= 0 ? r[cNormal] : '').trim().toLowerCase()
    const normal: NormalBalance = normalRaw === 'debit' || normalRaw === 'credit' ? (normalRaw as NormalBalance) : normalBalanceFor(type)
    out.push({
      number,
      name,
      parent: (cParent >= 0 ? r[cParent] : '')?.trim() ?? '',
      type,
      normal,
      isBank: (r[cAcctType] ?? '').trim().toLowerCase() === 'bank',
      archived: (r[cStatus] ?? '').trim().toLowerCase() === 'inactive',
      counterparty: (cCounter >= 0 ? (r[cCounter] ?? '').trim() : '') || null,
    })
  }
  return out
}

interface StdTxn {
  id: string
  date: string
  type: string
  num: string
  name: string
  desc: string
  lines: { acctNum: string; cents: number }[]
}

export function parseStandardJournal(csv: string): StdTxn[] {
  const rows = parseCsv(csv)
  if (rows.length < 2) return []
  const idx = headerIndex(rows[0])
  const cId = idx('Txn ID'), cDate = idx('Date'), cType = idx('Txn Type'), cNum = idx('Num')
  const cName = idx('Name'), cDesc = idx('Description'), cAcct = idx('Account #')
  const cDebit = idx('Debit'), cCredit = idx('Credit')
  const byId = new Map<string, StdTxn>()
  const order: string[] = []
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]
    const id = (r[cId] ?? '').trim()
    const acctNum = (r[cAcct] ?? '').trim()
    if (!id || !acctNum) continue
    let t = byId.get(id)
    if (!t) {
      t = {
        id,
        date: (r[cDate] ?? '').trim(),
        type: (r[cType] ?? '').trim(),
        num: (r[cNum] ?? '').trim(),
        name: (r[cName] ?? '').trim(),
        desc: (r[cDesc] ?? '').trim(),
        lines: [],
      }
      byId.set(id, t)
      order.push(id)
    }
    const cents = toCents(r[cDebit]) - toCents(r[cCredit])
    t.lines.push({ acctNum, cents })
  }
  return order.map((id) => byId.get(id)!)
}

// --- Import -----------------------------------------------------------------

export function importStandard(opts: {
  companyName: string
  intercoCode?: string
  accountsCsv: string
  journalCsv: string
  /** If set, this company is deleted first (wipe & reload). */
  replaceCompanyId?: number
}): StandardImportSummary {
  const acctRows = parseStandardAccounts(opts.accountsCsv)
  if (acctRows.length === 0) throw new Error('No accounts found in the account-list CSV.')
  const txns = parseStandardJournal(opts.journalCsv)
  if (txns.length === 0) throw new Error('No transactions found in the journal CSV.')

  return tx(() => {
    if (opts.replaceCompanyId != null) deleteCompany(opts.replaceCompanyId)
    const companyId = createCompany(opts.companyName, opts.companyName, 'CAD')
    if (opts.intercoCode?.trim()) run('UPDATE companies SET interco_code = ? WHERE id = ?', [opts.intercoCode.trim(), companyId])

    // Pass 1: create every account (parent set in pass 2).
    const idByNumber = new Map<string, number>()
    for (const a of acctRows) {
      if (idByNumber.has(a.number)) continue
      const id = insert(
        `INSERT INTO accounts (company_id, code, name, type, normal_balance, is_bank, archived, interco_counterparty)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [companyId, a.number, a.name, a.type, a.normal, a.isBank ? 1 : 0, a.archived ? 1 : 0, a.counterparty],
      )
      idByNumber.set(a.number, id)
    }
    // Pass 2: wire parent hierarchy.
    for (const a of acctRows) {
      if (!a.parent) continue
      const childId = idByNumber.get(a.number)
      const parentId = idByNumber.get(a.parent)
      if (childId && parentId) run('UPDATE accounts SET parent_id = ? WHERE id = ?', [parentId, childId])
    }

    const unknownAccounts: string[] = []
    const ensureAccount = (acctNum: string): number => {
      const id = idByNumber.get(acctNum)
      if (id != null) return id
      // Journal referenced a number not in the chart — create a placeholder so
      // nothing is dropped, and report it.
      unknownAccounts.push(acctNum)
      const nid = insert(
        `INSERT INTO accounts (company_id, code, name, type, normal_balance, is_bank, archived) VALUES (?, ?, ?, 'expense', 'debit', 0, 0)`,
        [companyId, acctNum, `Unmapped account ${acctNum}`],
      )
      idByNumber.set(acctNum, nid)
      return nid
    }

    const contactCache = new Map<string, number>()
    const resolveContact = (name: string): number => {
      const key = name.trim()
      const cached = contactCache.get(key)
      if (cached != null) return cached
      const id = insert('INSERT INTO contacts (company_id, name, kind) VALUES (?, ?, ?)', [companyId, key, 'other' as ContactKind])
      contactCache.set(key, id)
      return id
    }

    let txCount = 0, entryCount = 0
    let roundingAdjustments = 0, roundingTotalCents = 0
    let unbalancedSkipped = 0, unbalancedTotalCents = 0
    const unbalancedSamples: { ref: string; sumCents: number }[] = []
    let roundingAccountId: number | null = null
    const ensureRounding = (): number => {
      if (roundingAccountId != null) return roundingAccountId
      roundingAccountId = insert(
        `INSERT INTO accounts (company_id, code, name, type, normal_balance, is_bank, archived) VALUES (?, 'ROUND', 'Import Rounding', 'expense', 'debit', 0, 0)`,
        [companyId],
      )
      return roundingAccountId
    }

    for (const t of txns) {
      if (t.lines.length === 0) continue
      const lines = t.lines.map((l) => ({ account_id: ensureAccount(l.acctNum), amount_cents: l.cents, memo: null as string | null }))
      const sum = lines.reduce((s, l) => s + l.amount_cents, 0)
      if (sum !== 0) {
        const cap = Math.max(5, lines.length * 2)
        if (Math.abs(sum) <= cap) {
          lines.push({ account_id: ensureRounding(), amount_cents: -sum, memo: 'Rounding' })
          roundingAdjustments++; roundingTotalCents += sum
        } else {
          unbalancedSkipped++; unbalancedTotalCents += sum
          if (unbalancedSamples.length < 25) unbalancedSamples.push({ ref: t.num || t.desc || t.date, sumCents: sum })
          continue
        }
      }
      const contactId = t.name ? resolveContact(t.name) : null
      const txnId = insert(
        'INSERT INTO transactions (company_id, date, memo, reference, contact_id, status, source) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [companyId, t.date, t.desc || t.type || null, t.num || null, contactId, 'posted', 'import'],
      )
      for (const l of lines) {
        insert('INSERT INTO entries (transaction_id, account_id, amount_cents, memo) VALUES (?, ?, ?, ?)', [txnId, l.account_id, l.amount_cents, l.memo])
        entryCount++
      }
      txCount++
    }

    return {
      companyId,
      companyName: opts.companyName,
      accounts: idByNumber.size,
      transactions: txCount,
      entries: entryCount,
      contacts: contactCache.size,
      unknownAccounts: [...new Set(unknownAccounts)],
      roundingAdjustments,
      roundingTotalCents,
      unbalancedSkipped,
      unbalancedTotalCents,
      unbalancedSamples,
    }
  })
}
