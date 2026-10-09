import { all, one, insert, run, tx } from './db'
import type {
  Account,
  AccountType,
  BankTxn,
  Company,
  CompanyProfile,
  Contact,
  ContactKind,
  Entry,
  NormalBalance,
  Rule,
  Transaction,
  TxnLine,
} from './types'

// ---- Companies -------------------------------------------------------------

export function listCompanies(): Company[] {
  return all<Company>('SELECT * FROM companies ORDER BY name')
}

export function getCompany(id: number): Company | undefined {
  return one<Company>('SELECT * FROM companies WHERE id = ?', [id])
}

// ---- Company profile (letterhead) -----------------------------------------

export function getCompanyProfile(companyId: number): CompanyProfile | undefined {
  return one<CompanyProfile>('SELECT * FROM company_profiles WHERE company_id = ?', [companyId])
}

export interface CompanyProfileInput {
  display_name?: string | null
  address_line1?: string | null
  address_line2?: string | null
  city?: string | null
  province?: string | null
  postal?: string | null
  country?: string | null
  phone?: string | null
  email?: string | null
  website?: string | null
  tax_number?: string | null
  logo_data_url?: string | null
  use_letterhead?: boolean
  footer_note?: string | null
}

/** Upsert the company's letterhead profile (form submits the full set). */
export function saveCompanyProfile(companyId: number, p: CompanyProfileInput): void {
  const cur = getCompanyProfile(companyId)
  const v = <K extends keyof CompanyProfileInput>(k: K, fallback: unknown) =>
    p[k] !== undefined ? (p[k] as unknown) : fallback
  const useLetter = p.use_letterhead !== undefined ? (p.use_letterhead ? 1 : 0) : cur?.use_letterhead ?? 1
  run(
    `INSERT INTO company_profiles
       (company_id, display_name, address_line1, address_line2, city, province, postal, country,
        phone, email, website, tax_number, logo_data_url, use_letterhead, footer_note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(company_id) DO UPDATE SET
       display_name = excluded.display_name, address_line1 = excluded.address_line1,
       address_line2 = excluded.address_line2, city = excluded.city, province = excluded.province,
       postal = excluded.postal, country = excluded.country, phone = excluded.phone,
       email = excluded.email, website = excluded.website, tax_number = excluded.tax_number,
       logo_data_url = excluded.logo_data_url, use_letterhead = excluded.use_letterhead,
       footer_note = excluded.footer_note`,
    [
      companyId,
      v('display_name', cur?.display_name ?? null),
      v('address_line1', cur?.address_line1 ?? null),
      v('address_line2', cur?.address_line2 ?? null),
      v('city', cur?.city ?? null),
      v('province', cur?.province ?? null),
      v('postal', cur?.postal ?? null),
      v('country', cur?.country ?? null),
      v('phone', cur?.phone ?? null),
      v('email', cur?.email ?? null),
      v('website', cur?.website ?? null),
      v('tax_number', cur?.tax_number ?? null),
      v('logo_data_url', cur?.logo_data_url ?? null),
      useLetter,
      v('footer_note', cur?.footer_note ?? null),
    ],
  )
}

export function createCompany(name: string, legalName?: string, currency = 'CAD'): number {
  return insert(
    'INSERT INTO companies (name, legal_name, base_currency) VALUES (?, ?, ?)',
    [name, legalName ?? null, currency],
  )
}

/**
 * Permanently delete a company and ALL of its data. sql.js does not enforce
 * ON DELETE CASCADE, so every child/related table is cleared explicitly, in
 * child→parent order, inside one transaction. Irreversible (not the recycle bin).
 */
export function deleteCompany(companyId: number): void {
  tx(() => {
    // Children reached through transactions / documents first.
    run('DELETE FROM entries WHERE transaction_id IN (SELECT id FROM transactions WHERE company_id = ?)', [companyId])
    run(
      `DELETE FROM payment_applications
       WHERE payment_document_id IN (SELECT id FROM documents WHERE company_id = ?)
          OR applied_document_id IN (SELECT id FROM documents WHERE company_id = ?)`,
      [companyId, companyId],
    )
    run('DELETE FROM document_lines WHERE document_id IN (SELECT id FROM documents WHERE company_id = ?)', [companyId])
    run('DELETE FROM documents WHERE company_id = ?', [companyId])
    run('DELETE FROM bank_transactions WHERE company_id = ?', [companyId])
    run('DELETE FROM reconciliations WHERE company_id = ?', [companyId])
    run('DELETE FROM rules WHERE company_id = ?', [companyId])
    run('DELETE FROM items WHERE company_id = ?', [companyId])
    run('DELETE FROM tax_codes WHERE company_id = ?', [companyId])
    run('DELETE FROM tax_map WHERE company_id = ?', [companyId])
    run('DELETE FROM intercompany_links WHERE from_company_id = ? OR to_company_id = ?', [companyId, companyId])
    run('DELETE FROM transactions WHERE company_id = ?', [companyId])
    run('DELETE FROM contacts WHERE company_id = ?', [companyId])
    run('DELETE FROM accounts WHERE company_id = ?', [companyId])
    run('DELETE FROM audit_log WHERE company_id = ?', [companyId])
    run('DELETE FROM companies WHERE id = ?', [companyId])
  })
}

/** Lock (or unlock, with null) all periods on/before this date against new postings/edits. */
export function setLockedThrough(companyId: number, date: string | null): void {
  run('UPDATE companies SET locked_through = ? WHERE id = ?', [date, companyId])
  audit(companyId, 'update', 'company', companyId, date ? `Locked periods through ${date}` : 'Removed period lock')
}

export function assertNotLocked(companyId: number, date: string): void {
  const c = getCompany(companyId)
  if (c?.locked_through && date <= c.locked_through) {
    throw new Error(`Period is locked through ${c.locked_through}. Unlock it in Settings to change entries on or before that date.`)
  }
}

// ---- Accounts --------------------------------------------------------------

export function getAccounts(companyId: number, includeArchived = false): Account[] {
  return all<Account>(
    `SELECT * FROM accounts
     WHERE company_id = ? ${includeArchived ? '' : 'AND archived = 0'}
     ORDER BY code`,
    [companyId],
  )
}

export function getAccount(id: number): Account | undefined {
  return one<Account>('SELECT * FROM accounts WHERE id = ?', [id])
}

export function getBankAccounts(companyId: number): Account[] {
  return all<Account>(
    'SELECT * FROM accounts WHERE company_id = ? AND is_bank = 1 AND archived = 0 ORDER BY code',
    [companyId],
  )
}

export function createAccount(a: {
  company_id: number
  code: string
  name: string
  type: AccountType
  normal_balance: NormalBalance
  is_bank?: boolean
  parent_id?: number | null
}): number {
  return insert(
    `INSERT INTO accounts (company_id, code, name, type, normal_balance, is_bank, parent_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [a.company_id, a.code, a.name, a.type, a.normal_balance, a.is_bank ? 1 : 0, a.parent_id ?? null],
  )
}

export function setAccountArchived(id: number, archived: boolean): void {
  run('UPDATE accounts SET archived = ? WHERE id = ?', [archived ? 1 : 0, id])
}

export function normalBalanceFor(type: AccountType): NormalBalance {
  return type === 'asset' || type === 'expense' ? 'debit' : 'credit'
}

/** Create an account with an auto-assigned code + normal balance (inline "new account"). */
export function createAccountQuick(
  companyId: number,
  name: string,
  type: AccountType,
  isBank = false,
): number {
  if (!name.trim()) throw new Error('Account name is required.')
  const base: Record<AccountType, number> = { asset: 1000, liability: 2000, equity: 3000, income: 4000, expense: 5000 }
  const lo = base[type]
  const hi = lo + 999
  const max = one<{ m: number }>(
    `SELECT MAX(CAST(code AS INTEGER)) AS m FROM accounts
     WHERE company_id = ? AND CAST(code AS INTEGER) BETWEEN ? AND ?`,
    [companyId, lo, hi],
  )
  const code = String(max?.m ? max.m + 1 : lo)
  const id = createAccount({ company_id: companyId, code, name: name.trim(), type, normal_balance: normalBalanceFor(type), is_bank: isBank })
  audit(companyId, 'create', 'account', id, `Added ${type} account ${code} ${name.trim()}`)
  return id
}

/** Raw signed balance (debit-positive) for an account. Excludes void/orphaned entries. */
export function accountBalance(accountId: number): number {
  const r = one<{ bal: number }>(
    `SELECT COALESCE(SUM(e.amount_cents), 0) AS bal
     FROM entries e JOIN transactions t ON t.id = e.transaction_id
     WHERE e.account_id = ? AND t.status != 'void' AND t.deleted = 0`,
    [accountId],
  )
  return r?.bal ?? 0
}

/** Display balance: positive in the account's natural direction. */
export function displayBalance(account: Account): number {
  const raw = accountBalance(account.id)
  return account.normal_balance === 'credit' ? -raw : raw
}

export interface TrialBalanceRow {
  account: Account
  debit: number
  credit: number
}

export function trialBalance(companyId: number): TrialBalanceRow[] {
  const accounts = getAccounts(companyId)
  return accounts
    .map((account) => {
      const raw = accountBalance(account.id)
      return {
        account,
        debit: raw > 0 ? raw : 0,
        credit: raw < 0 ? -raw : 0,
      }
    })
    .filter((r) => r.debit !== 0 || r.credit !== 0)
}

// ---- Transactions / entries ------------------------------------------------

export function postTransaction(t: {
  company_id: number
  date: string
  memo?: string | null
  reference?: string | null
  contact_id?: number | null
  source?: string
  lines: TxnLine[]
}): number {
  const sum = t.lines.reduce((s, l) => s + l.amount_cents, 0)
  if (sum !== 0) {
    throw new Error(`Unbalanced transaction: entries sum to ${sum} cents, must be 0`)
  }
  if (t.lines.length < 2) {
    throw new Error('A transaction needs at least two entries')
  }
  assertNotLocked(t.company_id, t.date)
  return tx(() => {
    const txnId = insert(
      `INSERT INTO transactions (company_id, date, memo, reference, contact_id, source)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [t.company_id, t.date, t.memo ?? null, t.reference ?? null, t.contact_id ?? null, t.source ?? 'manual'],
    )
    for (const line of t.lines) {
      insert(
        'INSERT INTO entries (transaction_id, account_id, amount_cents, memo) VALUES (?, ?, ?, ?)',
        [txnId, line.account_id, line.amount_cents, line.memo ?? null],
      )
    }
    return txnId
  })
}

export interface TransactionWithEntries extends Transaction {
  contact_name: string | null
  entries: (Entry & { account_code: string; account_name: string })[]
}

export function getTransactions(
  companyId: number,
  opts: { limit?: number; accountId?: number; contactId?: number } = {},
): TransactionWithEntries[] {
  const params: unknown[] = [companyId]
  let where = 't.company_id = ? AND t.deleted = 0'
  if (opts.accountId) {
    where += ' AND t.id IN (SELECT transaction_id FROM entries WHERE account_id = ?)'
    params.push(opts.accountId)
  }
  if (opts.contactId) {
    where += ' AND t.contact_id = ?'
    params.push(opts.contactId)
  }
  let sql = `SELECT t.*, c.name AS contact_name
             FROM transactions t LEFT JOIN contacts c ON c.id = t.contact_id
             WHERE ${where} ORDER BY t.date DESC, t.id DESC`
  if (opts.limit) {
    sql += ' LIMIT ?'
    params.push(opts.limit)
  }
  const txns = all<Transaction & { contact_name: string | null }>(sql, params)
  return txns.map((t) => ({
    ...t,
    entries: all<Entry & { account_code: string; account_name: string }>(
      `SELECT e.*, a.code AS account_code, a.name AS account_name
       FROM entries e JOIN accounts a ON a.id = e.account_id
       WHERE e.transaction_id = ? ORDER BY e.amount_cents DESC`,
      [t.id],
    ),
  }))
}

/** A single transaction with its entries (for the journal editor / opener). */
export function getTransaction(id: number): TransactionWithEntries | undefined {
  const t = one<Transaction & { contact_name: string | null }>(
    `SELECT t.*, c.name AS contact_name FROM transactions t LEFT JOIN contacts c ON c.id = t.contact_id WHERE t.id = ?`,
    [id],
  )
  if (!t) return undefined
  const entries = all<Entry & { account_code: string; account_name: string }>(
    `SELECT e.*, a.code AS account_code, a.name AS account_name
     FROM entries e JOIN accounts a ON a.id = e.account_id WHERE e.transaction_id = ? ORDER BY e.amount_cents DESC`,
    [id],
  )
  return { ...t, entries }
}

export interface JournalInput {
  company_id: number
  date: string
  memo?: string | null
  reference?: string | null
  contact_id?: number | null
  lines: TxnLine[]
}

/** Edit a manual/raw transaction in place (keeps its id — so bank matches survive). */
export function updateJournalEntry(txnId: number, input: JournalInput): void {
  const sum = input.lines.reduce((s, l) => s + l.amount_cents, 0)
  if (sum !== 0) throw new Error(`Unbalanced transaction: entries sum to ${sum} cents, must be 0`)
  if (input.lines.length < 2) throw new Error('A transaction needs at least two entries.')
  tx(() => {
    const old = one<Transaction>('SELECT * FROM transactions WHERE id = ?', [txnId])
    if (!old) throw new Error('Transaction not found.')
    assertNotLocked(old.company_id, old.date)
    assertNotLocked(input.company_id, input.date)
    run('UPDATE transactions SET date = ?, memo = ?, reference = ?, contact_id = ? WHERE id = ?', [
      input.date, input.memo ?? null, input.reference ?? null, input.contact_id ?? null, txnId,
    ])
    run('DELETE FROM entries WHERE transaction_id = ?', [txnId])
    for (const l of input.lines) {
      insert('INSERT INTO entries (transaction_id, account_id, amount_cents, memo) VALUES (?, ?, ?, ?)', [
        txnId, l.account_id, l.amount_cents, l.memo ?? null,
      ])
    }
    audit(input.company_id, 'update', 'transaction', txnId, `Edited journal entry — ${formatMoneyAbs(input.lines)}`)
  })
}

function formatMoneyAbs(lines: TxnLine[]): string {
  const debits = lines.filter((l) => l.amount_cents > 0).reduce((s, l) => s + l.amount_cents, 0)
  return `${(debits / 100).toFixed(2)}`
}

export function voidTransaction(txnId: number): void {
  run("UPDATE transactions SET status = 'void' WHERE id = ?", [txnId])
}

// ---- Recycle bin (soft delete) ---------------------------------------------

export function softDeleteTransactions(companyId: number, ids: number[]): number {
  if (ids.length === 0) return 0
  return tx(() => {
    const c = getCompany(companyId)
    const ph = ids.map(() => '?').join(',')
    if (c?.locked_through) {
      const locked = one<{ n: number }>(
        `SELECT COUNT(*) AS n FROM transactions WHERE id IN (${ph}) AND date <= ?`,
        [...ids, c.locked_through],
      )
      if ((locked?.n ?? 0) > 0) throw new Error(`Some selected items are in a locked period (through ${c.locked_through}).`)
    }
    run(`UPDATE transactions SET deleted = 1 WHERE id IN (${ph}) AND company_id = ?`, [...ids, companyId])
    audit(companyId, 'void', 'transaction', null, `Moved ${ids.length} transaction(s) to the recycle bin`)
    return ids.length
  })
}

export function restoreTransactions(companyId: number, ids: number[]): number {
  if (ids.length === 0) return 0
  return tx(() => {
    const ph = ids.map(() => '?').join(',')
    run(`UPDATE transactions SET deleted = 0 WHERE id IN (${ph}) AND company_id = ?`, [...ids, companyId])
    audit(companyId, 'update', 'transaction', null, `Restored ${ids.length} transaction(s) from the recycle bin`)
    return ids.length
  })
}

export function purgeTransactions(companyId: number, ids: number[]): number {
  if (ids.length === 0) return 0
  return tx(() => {
    const ph = ids.map(() => '?').join(',')
    run(`DELETE FROM entries WHERE transaction_id IN (${ph})`, ids)
    run(`DELETE FROM transactions WHERE id IN (${ph}) AND company_id = ?`, [...ids, companyId])
    audit(companyId, 'void', 'transaction', null, `Permanently deleted ${ids.length} transaction(s)`)
    return ids.length
  })
}

export interface DeletedTxn extends Transaction {
  contact_name: string | null
  total: number
}

export function getDeletedTransactions(companyId: number): DeletedTxn[] {
  return all<DeletedTxn>(
    `SELECT t.*, c.name AS contact_name,
            (SELECT COALESCE(SUM(amount_cents), 0) FROM entries e WHERE e.transaction_id = t.id AND e.amount_cents > 0) AS total
     FROM transactions t LEFT JOIN contacts c ON c.id = t.contact_id
     WHERE t.company_id = ? AND t.deleted = 1 ORDER BY t.date DESC, t.id DESC`,
    [companyId],
  )
}

// ---- Bank transactions (feed) ---------------------------------------------

export function getBankTransactions(
  companyId: number,
  opts: { status?: string; accountId?: number } = {},
): BankTxn[] {
  const params: unknown[] = [companyId]
  let where = 'company_id = ?'
  if (opts.status) {
    where += ' AND status = ?'
    params.push(opts.status)
  }
  if (opts.accountId) {
    where += ' AND account_id = ?'
    params.push(opts.accountId)
  }
  return all<BankTxn>(
    `SELECT * FROM bank_transactions WHERE ${where} ORDER BY date DESC, id DESC`,
    params,
  )
}

export function countUnmatched(companyId: number): number {
  const r = one<{ n: number }>(
    "SELECT COUNT(*) AS n FROM bank_transactions WHERE company_id = ? AND status = 'unmatched'",
    [companyId],
  )
  return r?.n ?? 0
}

/** Insert imported bank rows, skipping FITID duplicates. Returns inserted count. */
export function insertBankTransactions(
  companyId: number,
  accountId: number,
  rows: { date: string; description: string; amount_cents: number; fitid?: string | null }[],
): number {
  return tx(() => {
    let inserted = 0
    for (const r of rows) {
      if (r.fitid) {
        const dup = one<{ id: number }>(
          'SELECT id FROM bank_transactions WHERE company_id = ? AND account_id = ? AND fitid = ?',
          [companyId, accountId, r.fitid],
        )
        if (dup) continue
      }
      insert(
        `INSERT INTO bank_transactions (company_id, account_id, date, description, amount_cents, fitid)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [companyId, accountId, r.date, r.description, r.amount_cents, r.fitid ?? null],
      )
      inserted++
    }
    return inserted
  })
}

export function matchBankToTxn(bankTxnId: number, txnId: number): void {
  run(
    "UPDATE bank_transactions SET status = 'matched', matched_txn_id = ? WHERE id = ?",
    [txnId, bankTxnId],
  )
}

export function unmatchBank(bankTxnId: number): void {
  run(
    "UPDATE bank_transactions SET status = 'unmatched', matched_txn_id = NULL WHERE id = ?",
    [bankTxnId],
  )
}

export function ignoreBank(bankTxnId: number): void {
  run("UPDATE bank_transactions SET status = 'ignored', matched_txn_id = NULL WHERE id = ?", [
    bankTxnId,
  ])
}

/** IDs of transactions already claimed by a bank line (so we don't double-match). */
export function usedTransactionIds(companyId: number): Set<number> {
  const rows = all<{ matched_txn_id: number }>(
    'SELECT matched_txn_id FROM bank_transactions WHERE company_id = ? AND matched_txn_id IS NOT NULL',
    [companyId],
  )
  return new Set(rows.map((r) => r.matched_txn_id))
}

/**
 * Categorize a bank line by creating a balanced transaction: the bank account
 * takes the bank-signed amount (debit if +, credit if -), the counter account
 * takes the opposite. Then mark the bank line matched to it.
 */
export function categorizeBank(bankTxnId: number, counterAccountId: number, memo?: string): number {
  return tx(() => {
    const bt = one<BankTxn>('SELECT * FROM bank_transactions WHERE id = ?', [bankTxnId])
    if (!bt) throw new Error('Bank transaction not found')
    const txnId = postTransaction({
      company_id: bt.company_id,
      date: bt.date,
      memo: memo ?? bt.description,
      source: 'reconcile',
      lines: [
        { account_id: bt.account_id, amount_cents: bt.amount_cents },
        { account_id: counterAccountId, amount_cents: -bt.amount_cents },
      ],
    })
    matchBankToTxn(bankTxnId, txnId)
    return txnId
  })
}

/** Categorize several bank lines to the same counter account in one transaction batch. */
export function categorizeMany(bankTxnIds: number[], counterAccountId: number): number {
  return tx(() => {
    let n = 0
    for (const id of bankTxnIds) {
      categorizeBank(id, counterAccountId)
      n++
    }
    return n
  })
}

// ---- Rules -----------------------------------------------------------------

export function getRules(companyId: number): Rule[] {
  return all<Rule>(
    'SELECT * FROM rules WHERE company_id = ? ORDER BY priority, id',
    [companyId],
  )
}

export function createRule(r: {
  company_id: number
  pattern: string
  match_kind?: 'contains' | 'regex' | 'exact'
  account_id: number
  priority?: number
}): number {
  return insert(
    `INSERT INTO rules (company_id, pattern, match_kind, account_id, priority)
     VALUES (?, ?, ?, ?, ?)`,
    [r.company_id, r.pattern, r.match_kind ?? 'contains', r.account_id, r.priority ?? 100],
  )
}

export function deleteRule(id: number): void {
  run('DELETE FROM rules WHERE id = ?', [id])
}

export function setRuleEnabled(id: number, enabled: boolean): void {
  run('UPDATE rules SET enabled = ? WHERE id = ?', [enabled ? 1 : 0, id])
}

function ruleMatches(rule: Rule, description: string): boolean {
  const d = description.toLowerCase()
  const p = rule.pattern.toLowerCase()
  if (rule.match_kind === 'exact') return d === p
  if (rule.match_kind === 'regex') {
    try {
      return new RegExp(rule.pattern, 'i').test(description)
    } catch {
      return false
    }
  }
  return d.includes(p)
}

/** Suggest a counter account for a bank line from the rules, if any. */
export function suggestAccountByRules(companyId: number, description: string): number | null {
  const rules = getRules(companyId).filter((r) => r.enabled)
  for (const r of rules) {
    if (ruleMatches(r, description)) return r.account_id
  }
  return null
}

/** Auto-categorize every unmatched bank line that a rule matches. Returns count. */
export function applyRules(companyId: number): number {
  return tx(() => {
    const unmatched = getBankTransactions(companyId, { status: 'unmatched' })
    let n = 0
    for (const bt of unmatched) {
      const accountId = suggestAccountByRules(companyId, bt.description)
      if (accountId) {
        categorizeBank(bt.id, accountId)
        n++
      }
    }
    return n
  })
}

// ---- Contacts (customers / suppliers) --------------------------------------

export function getContacts(companyId: number): Contact[] {
  return all<Contact>('SELECT * FROM contacts WHERE company_id = ? ORDER BY name', [companyId])
}

export function getContact(id: number): Contact | undefined {
  return one<Contact>('SELECT * FROM contacts WHERE id = ?', [id])
}

/** Insert a contact or return the existing one, merging kind to 'both' on conflict. */
export function ensureContact(companyId: number, name: string, kind: ContactKind): number {
  const existing = one<Contact>('SELECT * FROM contacts WHERE company_id = ? AND name = ?', [
    companyId,
    name,
  ])
  if (existing) {
    let nk: ContactKind = existing.kind
    if (kind !== 'other') {
      if (existing.kind === 'other') nk = kind
      else if (existing.kind !== kind && existing.kind !== 'both') nk = 'both'
    }
    if (nk !== existing.kind) run('UPDATE contacts SET kind = ? WHERE id = ?', [nk, existing.id])
    return existing.id
  }
  return insert('INSERT INTO contacts (company_id, name, kind) VALUES (?, ?, ?)', [
    companyId,
    name,
    kind,
  ])
}

export interface ContactInput {
  name: string
  kind: ContactKind
  email?: string | null
  phone?: string | null
  address_line1?: string | null
  address_line2?: string | null
  city?: string | null
  province?: string | null
  postal?: string | null
  country?: string | null
  website?: string | null
  notes?: string | null
}

const CONTACT_COLS = ['email', 'phone', 'address_line1', 'address_line2', 'city', 'province', 'postal', 'country', 'website', 'notes'] as const

export function createContact(companyId: number, p: ContactInput): number {
  if (!p.name.trim()) throw new Error('Contact name is required.')
  const id = insert(
    `INSERT INTO contacts (company_id, name, kind, email, phone, address_line1, address_line2, city, province, postal, country, website, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [companyId, p.name.trim(), p.kind, ...CONTACT_COLS.map((c) => p[c] ?? null)],
  )
  audit(companyId, 'create', 'contact', id, `Added ${p.kind} “${p.name.trim()}”`)
  return id
}

export function updateContact(id: number, p: ContactInput): void {
  const c = getContact(id)
  if (!c) return
  if (!p.name.trim()) throw new Error('Contact name is required.')
  run(
    `UPDATE contacts SET name = ?, kind = ?, email = ?, phone = ?, address_line1 = ?, address_line2 = ?,
       city = ?, province = ?, postal = ?, country = ?, website = ?, notes = ? WHERE id = ?`,
    [p.name.trim(), p.kind, ...CONTACT_COLS.map((col) => p[col] ?? null), id],
  )
  audit(c.company_id, 'update', 'contact', id, `Edited contact “${p.name.trim()}”`)
}

export interface ContactSummary extends Contact {
  txn_count: number
  gross: number
  ar_balance: number // owed to us (receivable), debit-positive
  ap_balance: number // we owe (payable), positive = owed
  last_date: string | null
}

export function contactSummaries(companyId: number): ContactSummary[] {
  return all<ContactSummary>(
    `SELECT c.*,
            COUNT(DISTINCT t.id) AS txn_count,
            COALESCE(SUM(CASE WHEN e.amount_cents > 0 THEN e.amount_cents ELSE 0 END), 0) AS gross,
            COALESCE(SUM(CASE WHEN a.type = 'asset' AND lower(a.name) LIKE '%receivable%'
                              THEN e.amount_cents ELSE 0 END), 0) AS ar_balance,
            COALESCE(SUM(CASE WHEN a.type = 'liability' AND lower(a.name) LIKE '%payable%'
                              THEN -e.amount_cents ELSE 0 END), 0) AS ap_balance,
            MAX(t.date) AS last_date
     FROM contacts c
     LEFT JOIN transactions t ON t.contact_id = c.id AND t.status != 'void' AND t.deleted = 0
     LEFT JOIN entries e ON e.transaction_id = t.id
     LEFT JOIN accounts a ON a.id = e.account_id
     WHERE c.company_id = ?
     GROUP BY c.id
     ORDER BY gross DESC, c.name`,
    [companyId],
  )
}

// ---- Dashboard metrics -----------------------------------------------------

export interface PnlRow {
  account: Account
  amount: number
}

export function profitAndLoss(companyId: number): {
  income: PnlRow[]
  expenses: PnlRow[]
  totalIncome: number
  totalExpense: number
  net: number
} {
  const accounts = getAccounts(companyId)
  const income: PnlRow[] = []
  const expenses: PnlRow[] = []
  for (const a of accounts) {
    if (a.type !== 'income' && a.type !== 'expense') continue
    const bal = displayBalance(a)
    if (bal === 0) continue
    if (a.type === 'income') income.push({ account: a, amount: bal })
    else expenses.push({ account: a, amount: bal })
  }
  const totalIncome = income.reduce((s, r) => s + r.amount, 0)
  const totalExpense = expenses.reduce((s, r) => s + r.amount, 0)
  return { income, expenses, totalIncome, totalExpense, net: totalIncome - totalExpense }
}

// ---- Multi-company overview ------------------------------------------------

export interface CompanyOverview {
  cash: number
  income: number
  expense: number
  net: number
  ar: number
  ap: number
  unreconciled: number
}

export function companyOverview(companyId: number): CompanyOverview {
  const banks = getBankAccounts(companyId)
  const cash = banks.reduce((s, a) => s + displayBalance(a), 0)
  const pnl = profitAndLoss(companyId)
  const accts = getAccounts(companyId)
  const ar = accts.filter((a) => a.type === 'asset' && /receivable/i.test(a.name)).reduce((s, a) => s + displayBalance(a), 0)
  const ap = accts.filter((a) => a.type === 'liability' && /payable/i.test(a.name)).reduce((s, a) => s + displayBalance(a), 0)
  return { cash, income: pnl.totalIncome, expense: pnl.totalExpense, net: pnl.net, ar, ap, unreconciled: countUnmatched(companyId) }
}

// ---- Audit log -------------------------------------------------------------

export interface AuditEntry {
  id: number
  company_id: number | null
  ts: string
  action: string
  entity: string
  entity_id: number | null
  user: string | null
  summary: string
}

let auditUser: string | null = null
/** Set by the store on login so every audit row records who did it. */
export function setAuditUser(name: string | null): void {
  auditUser = name
}

export function audit(
  companyId: number | null,
  action: string,
  entity: string,
  entityId: number | null,
  summary: string,
): void {
  insert(
    'INSERT INTO audit_log (company_id, action, entity, entity_id, user, summary) VALUES (?, ?, ?, ?, ?, ?)',
    [companyId, action, entity, entityId, auditUser, summary],
  )
}

export function getAuditLog(companyId: number, limit = 500): AuditEntry[] {
  return all<AuditEntry>(
    'SELECT * FROM audit_log WHERE company_id = ? OR company_id IS NULL ORDER BY id DESC LIMIT ?',
    [companyId, limit],
  )
}

// ---- Detailed reports ------------------------------------------------------

export interface LedgerRow {
  date: string
  memo: string | null
  reference: string | null
  contact_name: string | null
  amount_cents: number
  running: number
}

/** Account ledger: every posting to one account with a running balance (debit-positive). */
export function generalLedger(
  companyId: number,
  accountId: number,
  start?: string,
  end?: string,
): { opening: number; rows: LedgerRow[]; closing: number } {
  const openingRow = one<{ bal: number }>(
    `SELECT COALESCE(SUM(e.amount_cents), 0) AS bal
     FROM entries e JOIN transactions t ON t.id = e.transaction_id
     WHERE t.company_id = ? AND e.account_id = ? AND t.status != 'void' AND t.deleted = 0
       ${start ? 'AND t.date < ?' : 'AND 1=0'}`,
    start ? [companyId, accountId, start] : [companyId, accountId],
  )
  const opening = start ? openingRow?.bal ?? 0 : 0
  const params: unknown[] = [companyId, accountId]
  let where = "t.company_id = ? AND e.account_id = ? AND t.status != 'void' AND t.deleted = 0"
  if (start) { where += ' AND t.date >= ?'; params.push(start) }
  if (end) { where += ' AND t.date <= ?'; params.push(end) }
  const raw = all<{ date: string; memo: string | null; reference: string | null; contact_name: string | null; amount_cents: number }>(
    `SELECT t.date, t.memo, t.reference, c.name AS contact_name, e.amount_cents
     FROM entries e JOIN transactions t ON t.id = e.transaction_id
     LEFT JOIN contacts c ON c.id = t.contact_id
     WHERE ${where} ORDER BY t.date, t.id, e.id`,
    params,
  )
  let running = opening
  const rows: LedgerRow[] = raw.map((r) => {
    running += r.amount_cents
    return { ...r, running }
  })
  return { opening, rows, closing: running }
}

export interface SalesByCustomerRow {
  contact_id: number
  name: string
  revenue: number
  txns: number
}

export function salesByCustomer(companyId: number, start: string, end: string): SalesByCustomerRow[] {
  return all<SalesByCustomerRow>(
    `SELECT c.id AS contact_id, c.name AS name,
            COALESCE(SUM(CASE WHEN a.type = 'income' THEN -e.amount_cents ELSE 0 END), 0) AS revenue,
            COUNT(DISTINCT t.id) AS txns
     FROM transactions t
     JOIN entries e ON e.transaction_id = t.id
     JOIN accounts a ON a.id = e.account_id
     JOIN contacts c ON c.id = t.contact_id
     WHERE t.company_id = ? AND t.date >= ? AND t.date <= ? AND t.status != 'void' AND t.deleted = 0 AND a.type = 'income'
     GROUP BY c.id HAVING revenue <> 0 ORDER BY revenue DESC`,
    [companyId, start, end],
  )
}

// ---- Reports (date-aware) --------------------------------------------------

/** Raw (debit-positive) balance per account id, optionally bounded by date. */
function accountBalances(companyId: number, start?: string, end?: string): Map<number, number> {
  const params: unknown[] = [companyId]
  let where = "t.company_id = ? AND t.status != 'void' AND t.deleted = 0"
  if (start) { where += ' AND t.date >= ?'; params.push(start) }
  if (end) { where += ' AND t.date <= ?'; params.push(end) }
  const rows = all<{ id: number; bal: number }>(
    `SELECT e.account_id AS id, COALESCE(SUM(e.amount_cents), 0) AS bal
     FROM entries e JOIN transactions t ON t.id = e.transaction_id
     WHERE ${where} GROUP BY e.account_id`,
    params,
  )
  const m = new Map<number, number>()
  for (const r of rows) m.set(r.id, r.bal)
  return m
}

export interface ReportLine {
  account: Account
  amount: number
}

export function profitAndLossRange(companyId: number, start: string, end: string): {
  income: ReportLine[]
  expenses: ReportLine[]
  totalIncome: number
  totalExpense: number
  net: number
} {
  const bal = accountBalances(companyId, start, end)
  const accounts = getAccounts(companyId)
  const income: ReportLine[] = []
  const expenses: ReportLine[] = []
  for (const a of accounts) {
    const raw = bal.get(a.id) ?? 0
    if (raw === 0) continue
    const display = a.normal_balance === 'credit' ? -raw : raw
    if (a.type === 'income') income.push({ account: a, amount: display })
    else if (a.type === 'expense') expenses.push({ account: a, amount: display })
  }
  const totalIncome = income.reduce((s, r) => s + r.amount, 0)
  const totalExpense = expenses.reduce((s, r) => s + r.amount, 0)
  return { income, expenses, totalIncome, totalExpense, net: totalIncome - totalExpense }
}

export function balanceSheet(companyId: number, asOf: string): {
  assets: ReportLine[]
  liabilities: ReportLine[]
  equity: ReportLine[]
  totalAssets: number
  totalLiabilities: number
  totalEquity: number
  netIncome: number
  totalLiabEquity: number
  balanced: boolean
} {
  const bal = accountBalances(companyId, undefined, asOf)
  const accounts = getAccounts(companyId)
  const assets: ReportLine[] = []
  const liabilities: ReportLine[] = []
  const equity: ReportLine[] = []
  let income = 0
  let expense = 0
  for (const a of accounts) {
    const raw = bal.get(a.id) ?? 0
    const display = a.normal_balance === 'credit' ? -raw : raw
    if (a.type === 'asset') { if (raw !== 0) assets.push({ account: a, amount: display }) }
    else if (a.type === 'liability') { if (raw !== 0) liabilities.push({ account: a, amount: display }) }
    else if (a.type === 'equity') { if (raw !== 0) equity.push({ account: a, amount: display }) }
    else if (a.type === 'income') income += display
    else if (a.type === 'expense') expense += display
  }
  const netIncome = income - expense
  const totalAssets = assets.reduce((s, r) => s + r.amount, 0)
  const totalLiabilities = liabilities.reduce((s, r) => s + r.amount, 0)
  const totalEquity = equity.reduce((s, r) => s + r.amount, 0)
  const totalLiabEquity = totalLiabilities + totalEquity + netIncome
  return {
    assets, liabilities, equity,
    totalAssets, totalLiabilities, totalEquity, netIncome, totalLiabEquity,
    balanced: Math.abs(totalAssets - totalLiabEquity) < 1,
  }
}

export interface TrialBalanceAsOfRow {
  account: Account
  debit: number
  credit: number
}

export function trialBalanceAsOf(companyId: number, asOf?: string): TrialBalanceAsOfRow[] {
  const bal = accountBalances(companyId, undefined, asOf)
  return getAccounts(companyId)
    .map((account) => {
      const raw = bal.get(account.id) ?? 0
      return { account, debit: raw > 0 ? raw : 0, credit: raw < 0 ? -raw : 0 }
    })
    .filter((r) => r.debit !== 0 || r.credit !== 0)
}

export interface GstHstReturn {
  taxAccounts: Account[]
  line101_revenue: number
  line103_collected: number
  line106_itc: number
  line109_netTax: number
}

/**
 * GST/HST return figures for a period, derived from the ledger:
 * - Line 101: total sales & other revenue (income accounts)
 * - Line 103: GST/HST collected on sales (credits to the tax account)
 * - Line 106: input tax credits — GST/HST paid on purchases (debits to the tax account)
 * - Line 109: net tax (103 − 106); positive = remit, negative = refund
 */
export function gstHstReturn(companyId: number, start: string, end: string): GstHstReturn {
  const taxAccounts = getAccounts(companyId).filter(
    (a) => a.type === 'liability' && /gst|hst/i.test(a.name),
  )
  let collected = 0
  let itc = 0
  if (taxAccounts.length > 0) {
    const ph = taxAccounts.map(() => '?').join(',')
    const r = one<{ collected: number; itc: number }>(
      `SELECT
         COALESCE(SUM(CASE WHEN e.amount_cents < 0 THEN -e.amount_cents ELSE 0 END), 0) AS collected,
         COALESCE(SUM(CASE WHEN e.amount_cents > 0 THEN e.amount_cents ELSE 0 END), 0) AS itc
       FROM entries e JOIN transactions t ON t.id = e.transaction_id
       WHERE t.company_id = ? AND t.date >= ? AND t.date <= ? AND t.status != 'void' AND t.deleted = 0 AND e.account_id IN (${ph})`,
      [companyId, start, end, ...taxAccounts.map((a) => a.id)],
    )
    collected = r?.collected ?? 0
    itc = r?.itc ?? 0
  }
  const pnl = profitAndLossRange(companyId, start, end)
  return {
    taxAccounts,
    line101_revenue: pnl.totalIncome,
    line103_collected: collected,
    line106_itc: itc,
    line109_netTax: collected - itc,
  }
}
