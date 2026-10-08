import { tx, insert, run } from './db'
import { createCompany, createAccount, audit } from './repo'
import type { AccountType, ContactKind, NormalBalance } from './types'
import { contactKindForType, parseGeneralLedger, type QBOReport } from './qboGeneralLedger'

// ---- CSV + value helpers ---------------------------------------------------

function parseCSV(text: string): string[][] {
  const rows: string[][] = []
  let cur: string[] = []
  let field = ''
  let inQ = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else inQ = false
      } else field += c
    } else {
      if (c === '"') inQ = true
      else if (c === ',') { cur.push(field); field = '' }
      else if (c === '\r') { /* skip */ }
      else if (c === '\n') { cur.push(field); rows.push(cur); cur = []; field = '' }
      else field += c
    }
  }
  if (field.length || cur.length) { cur.push(field); rows.push(cur) }
  return rows
}

function money(s: string | undefined): number {
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

function isoDate(s: string): string {
  const m = String(s).trim().match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/)
  if (m) return `${m[3]}-${m[2]}-${m[1]}` // DD-MM-YYYY (QBO Canada)
  const m2 = String(s).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m2) return s.trim()
  return String(s).trim()
}

// ---- QBO account type -> Ledgerly -----------------------------------------

export function mapAccountType(qboType: string): {
  type: AccountType
  normal: NormalBalance
  bank: boolean
} {
  const t = (qboType || '').toLowerCase()
  if (t === 'bank') return { type: 'asset', normal: 'debit', bank: true }
  if (t.includes('credit card')) return { type: 'liability', normal: 'credit', bank: true }
  if (t.includes('receivable')) return { type: 'asset', normal: 'debit', bank: false }
  if (t.includes('payable')) return { type: 'liability', normal: 'credit', bank: false }
  if (t.includes('equity') || t.includes('retained')) return { type: 'equity', normal: 'credit', bank: false }
  if (t.includes('cost of goods') || t === 'cogs') return { type: 'expense', normal: 'debit', bank: false }
  if (t.includes('income') || t.includes('revenue')) return { type: 'income', normal: 'credit', bank: false }
  if (t.includes('expense')) return { type: 'expense', normal: 'debit', bank: false }
  if (
    t.includes('liabilit') || t.includes('borrowing') || t.includes('loan') ||
    t.includes('payable') || t.includes('gst') || t.includes('hst') || t.includes('tax') ||
    t.includes('payroll liab')
  )
    return { type: 'liability', normal: 'credit', bank: false }
  if (t.includes('asset') || t.includes('property') || t.includes('plant') || t.includes('equipment') || t.includes('receivable'))
    return { type: 'asset', normal: 'debit', bank: false }
  // fallback: infer from name happens in caller; default asset
  return { type: 'asset', normal: 'debit', bank: false }
}

// ---- Parsers ---------------------------------------------------------------

interface AcctDef {
  name: string
  qboType: string
  balance: number | null
}

function parseAccountList(text: string): AcctDef[] {
  const rows = parseCSV(text)
  const hi = rows.findIndex((r) => (r[0] || '').trim() === 'Account Name')
  if (hi < 0) return []
  const out: AcctDef[] = []
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i]
    const name = (r[0] || '').trim()
    if (!name) continue
    const balStr = (r[4] || '').trim()
    out.push({ name, qboType: (r[1] || '').trim(), balance: balStr === '' ? null : money(balStr) })
  }
  return out
}

interface JLine {
  acct: string
  amount: number
  num: string
  name: string
  desc: string
  type: string
  date: string
}
interface JTxn {
  group: string
  lines: JLine[]
}

function parseJournal(text: string): JTxn[] {
  const rows = parseCSV(text)
  const hi = rows.findIndex((r) => (r[1] || '').trim() === 'Transaction date')
  if (hi < 0) return []
  const txns: JTxn[] = []
  let cur: JTxn | null = null
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i]
    const c0 = (r[0] || '').trim()
    if (c0 && /^total for/i.test(c0)) continue
    if (c0 && !(r[1] || '').trim()) {
      cur = { group: c0, lines: [] }
      txns.push(cur)
      continue
    }
    const date = (r[1] || '').trim()
    if (!date) continue
    const acct = (r[6] || '').trim()
    if (!acct) continue
    if (!cur) { cur = { group: '(none)', lines: [] }; txns.push(cur) }
    cur.lines.push({
      acct,
      amount: money(r[7]) - money(r[8]),
      num: (r[3] || '').trim(),
      name: (r[4] || '').trim(),
      desc: (r[5] || '').trim(),
      type: (r[2] || '').trim(),
      date: isoDate(date),
    })
  }
  return txns
}

// ---- Import ----------------------------------------------------------------

export interface QBOImportSummary {
  companyId: number
  companyName: string
  accounts: number
  contacts: number
  customers: number
  suppliers: number
  transactions: number
  entries: number
  skippedZero: number
  unknownAccounts: string[]
  roundingAdjustments: number
  roundingTotalCents: number
}

/** A chart-of-accounts entry to pre-create (preserves full chart + QBO type). */
export interface QBOAccountInput {
  name: string
  /** QBO account type string (e.g. "Bank", "Accounts Receivable"); blank → inferred from name. */
  qboType?: string
}

/** One posting line within a transaction. amount_cents: debit +, credit −. */
export interface QBOLineInput {
  account: string
  amount_cents: number
  memo?: string | null
}

/** A source-agnostic transaction ready to post as balanced double-entry. */
export interface QBOTxnInput {
  date: string
  memo?: string | null
  reference?: string | null
  contactName?: string | null
  /** Contact classification; omit/'other' to leave unclassified. */
  contactKind?: ContactKind
  lines: QBOLineInput[]
}

/**
 * Source-agnostic import engine. Both the CSV Journal path and the (coming)
 * QuickBooks API/connector path funnel structured data through here, so the
 * resulting books are identical regardless of origin.
 */
export function importQBOData(opts: {
  companyName: string
  accounts: QBOAccountInput[]
  transactions: QBOTxnInput[]
  skipZero?: boolean
}): QBOImportSummary {
  const skipZero = opts.skipZero ?? true
  if (opts.transactions.length === 0) throw new Error('No transactions to import.')

  return tx(() => {
    const companyId = createCompany(opts.companyName, opts.companyName, 'CAD')
    const idByName = new Map<string, number>()
    let codeSeq = 1000
    const unknownAccounts: string[] = []

    const ensureAccount = (name: string, qboType?: string): number => {
      const existing = idByName.get(name)
      if (existing != null) return existing
      let typeInfo
      if (qboType && qboType.trim()) {
        typeInfo = mapAccountType(qboType)
      } else {
        // infer from name
        const n = name.toLowerCase()
        if (n.includes('income') || n.includes('revenue') || n.includes('sales')) typeInfo = { type: 'income' as AccountType, normal: 'credit' as NormalBalance, bank: false }
        else if (n.includes('payable') || n.includes('liabilit') || n.includes('loan') || n.includes('gst') || n.includes('hst') || n.includes('tax')) typeInfo = { type: 'liability' as AccountType, normal: 'credit' as NormalBalance, bank: false }
        else if (n.includes('equity') || n.includes('retained')) typeInfo = { type: 'equity' as AccountType, normal: 'credit' as NormalBalance, bank: false }
        else if (n.includes('expense') || n.includes('cost')) typeInfo = { type: 'expense' as AccountType, normal: 'debit' as NormalBalance, bank: false }
        else typeInfo = { type: 'asset' as AccountType, normal: 'debit' as NormalBalance, bank: false }
        unknownAccounts.push(name)
      }
      const id = createAccount({
        company_id: companyId,
        code: String(codeSeq++),
        name,
        type: typeInfo.type,
        normal_balance: typeInfo.normal,
        is_bank: typeInfo.bank,
      })
      idByName.set(name, id)
      return id
    }

    // Pre-create all accounts from the chart (preserves full chart + types).
    for (const a of opts.accounts) ensureAccount(a.name, a.qboType)

    let roundingAccountId: number | null = null
    const ensureRounding = (): number => {
      if (roundingAccountId != null) return roundingAccountId
      roundingAccountId = createAccount({
        company_id: companyId,
        code: 'ROUND',
        name: 'QBO Import Rounding',
        type: 'expense',
        normal_balance: 'debit',
        is_bank: false,
      })
      return roundingAccountId
    }

    // Contact cache (avoids a SELECT per transaction); merges kind to 'both' on conflict.
    const contactCache = new Map<string, { id: number; kind: ContactKind }>()
    const resolveContact = (name: string, kind: ContactKind): number => {
      const c = contactCache.get(name)
      if (c) {
        if (kind !== 'other' && c.kind !== kind && c.kind !== 'both') {
          const nk: ContactKind = c.kind === 'other' ? kind : 'both'
          run('UPDATE contacts SET kind = ? WHERE id = ?', [nk, c.id])
          c.kind = nk
        }
        return c.id
      }
      const id = insert('INSERT INTO contacts (company_id, name, kind) VALUES (?, ?, ?)', [
        companyId,
        name,
        kind,
      ])
      contactCache.set(name, { id, kind })
      return id
    }

    let txCount = 0
    let entryCount = 0
    let skippedZero = 0
    let roundingAdjustments = 0
    let roundingTotalCents = 0

    for (const t of opts.transactions) {
      if (t.lines.length === 0) continue
      const gross = t.lines.reduce((s, l) => s + Math.abs(l.amount_cents), 0)
      if (skipZero && gross === 0) { skippedZero++; continue }

      const contactName = (t.contactName || '').trim()
      const contactId = contactName
        ? resolveContact(contactName, t.contactKind ?? 'other')
        : null

      const lines = t.lines.map((l) => ({
        account_id: ensureAccount(l.account),
        amount_cents: l.amount_cents,
        memo: l.memo ?? null,
      }))

      const sum = lines.reduce((s, l) => s + l.amount_cents, 0)
      if (sum !== 0) {
        // QBO rounding penny — balance it out so the entry posts.
        lines.push({ account_id: ensureRounding(), amount_cents: -sum, memo: 'Rounding' })
        roundingAdjustments++
        roundingTotalCents += sum
      }

      // Insert transaction + entries directly (we're already inside the outer tx).
      const txnId = insert(
        'INSERT INTO transactions (company_id, date, memo, reference, contact_id, source) VALUES (?, ?, ?, ?, ?, ?)',
        [companyId, t.date, t.memo ?? null, t.reference ?? null, contactId, 'import'],
      )
      for (const l of lines) {
        insert(
          'INSERT INTO entries (transaction_id, account_id, amount_cents, memo) VALUES (?, ?, ?, ?)',
          [txnId, l.account_id, l.amount_cents, l.memo ?? null],
        )
        entryCount++
      }
      txCount++
    }

    let customers = 0
    let suppliers = 0
    for (const { kind } of contactCache.values()) {
      if (kind === 'customer' || kind === 'both') customers++
      if (kind === 'supplier' || kind === 'both') suppliers++
    }

    audit(
      companyId,
      'import',
      'import',
      companyId,
      `Imported ${txCount} transactions, ${idByName.size} accounts, ${contactCache.size} contacts from QuickBooks`,
    )

    return {
      companyId,
      companyName: opts.companyName,
      accounts: idByName.size,
      contacts: contactCache.size,
      customers,
      suppliers,
      transactions: txCount,
      entries: entryCount,
      skippedZero,
      unknownAccounts,
      roundingAdjustments,
      roundingTotalCents,
    }
  })
}

/** CSV Journal import — parses QBO's Journal + Account List exports, then runs the shared engine. */
export function importQBOJournal(opts: {
  companyName: string
  journalCsv: string
  accountListCsv: string
  skipZero?: boolean
}): QBOImportSummary {
  const acctDefs = parseAccountList(opts.accountListCsv)
  const txns = parseJournal(opts.journalCsv)
  if (txns.length === 0) throw new Error('No transactions found in the Journal CSV.')

  const transactions: QBOTxnInput[] = txns
    .filter((t) => t.lines.length > 0)
    .map((t) => {
      const first = t.lines[0]
      const contactName = (t.lines.find((l) => l.name)?.name || '').trim()
      return {
        date: first.date,
        memo: first.name || first.desc || first.type || `QBO ${t.group}`,
        reference: first.num || null,
        contactName: contactName || null,
        contactKind: contactName ? contactKindForType(first.type) : 'other',
        lines: t.lines.map((l) => ({
          account: l.acct,
          amount_cents: l.amount,
          memo: l.desc || l.name || null,
        })),
      }
    })

  return importQBOData({
    companyName: opts.companyName,
    accounts: acctDefs.map((a) => ({ name: a.name, qboType: a.qboType })),
    transactions,
    skipZero: opts.skipZero,
  })
}

/**
 * Connector/API import — takes a QBO General Ledger report (native Reports API
 * JSON) and an optional account-name→QBO-type map (from the Accounts query),
 * regroups GL lines into balanced transactions, then runs the shared engine.
 * This is the path the in-app "Connect to QuickBooks" flow uses.
 */
export function importFromGeneralLedger(opts: {
  companyName: string
  report: QBOReport
  accountTypes?: Map<string, string>
  skipZero?: boolean
}): QBOImportSummary & { unbalanced: { ref: string; sumCents: number }[]; hasAmounts: boolean } {
  const parsed = parseGeneralLedger(opts.report, opts.accountTypes)
  if (parsed.transactions.length === 0) throw new Error('No transactions found in the General Ledger.')
  const summary = importQBOData({
    companyName: opts.companyName,
    accounts: parsed.accounts,
    transactions: parsed.transactions,
    skipZero: opts.skipZero,
  })
  return { ...summary, unbalanced: parsed.unbalanced, hasAmounts: parsed.hasAmounts }
}
