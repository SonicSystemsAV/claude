import { all, one, insert, run, tx } from './db'
import { postTransaction, getAccounts, audit, assertNotLocked, createAccountQuick } from './repo'
import { formatMoney } from '../lib/money'
import type { DocType, DocumentLineInput, DocumentRow } from './types'

// ---- Control-account resolution -------------------------------------------

export function getARAccountId(companyId: number): number | null {
  const accts = getAccounts(companyId)
  return (
    accts.find((a) => a.type === 'asset' && /receivable/i.test(a.name))?.id ??
    accts.find((a) => a.type === 'asset' && /receivable|a\/r/i.test(a.code))?.id ??
    null
  )
}

export function getAPAccountId(companyId: number): number | null {
  const accts = getAccounts(companyId)
  return accts.find((a) => a.type === 'liability' && /payable/i.test(a.name))?.id ?? null
}

export function getTaxAccountId(companyId: number): number | null {
  const accts = getAccounts(companyId)
  return (
    accts.find((a) => a.type === 'liability' && /(gst|hst|sales tax|tax payable)/i.test(a.name))?.id ??
    null
  )
}

/** The sales-tax liability account, creating a "Sales Tax Payable" one if none exists. */
export function ensureTaxAccountId(companyId: number): number {
  return getTaxAccountId(companyId) ?? createAccountQuick(companyId, 'Sales Tax Payable', 'liability')
}

// ---- Tax codes -------------------------------------------------------------

export interface TaxCode {
  id: number
  company_id: number
  name: string
  rate: number
  account_id: number | null
  is_default: number
  active: number
}

export function getTaxCodes(companyId: number): TaxCode[] {
  return all<TaxCode>(
    'SELECT * FROM tax_codes WHERE company_id = ? AND active = 1 ORDER BY is_default DESC, rate DESC',
    [companyId],
  )
}

export function getTaxCode(id: number): TaxCode | undefined {
  return one<TaxCode>('SELECT * FROM tax_codes WHERE id = ?', [id])
}

/** Seed a sensible default set of tax codes the first time (idempotent). */
export function ensureDefaultTaxCodes(companyId: number): void {
  const n = one<{ n: number }>('SELECT COUNT(*) AS n FROM tax_codes WHERE company_id = ?', [companyId])
  if ((n?.n ?? 0) > 0) return
  const acct = getTaxAccountId(companyId)
  tx(() => {
    insert('INSERT INTO tax_codes (company_id, name, rate, account_id, is_default) VALUES (?, ?, ?, ?, 1)', [companyId, 'HST 13%', 0.13, acct])
    insert('INSERT INTO tax_codes (company_id, name, rate, account_id) VALUES (?, ?, ?, ?)', [companyId, 'GST 5%', 0.05, acct])
    insert('INSERT INTO tax_codes (company_id, name, rate, account_id) VALUES (?, ?, ?, ?)', [companyId, 'Zero-rated', 0, null])
    insert('INSERT INTO tax_codes (company_id, name, rate, account_id) VALUES (?, ?, ?, ?)', [companyId, 'Exempt', 0, null])
  })
}

export function defaultTaxCodeId(companyId: number): number | null {
  const d = one<{ id: number }>(
    'SELECT id FROM tax_codes WHERE company_id = ? AND active = 1 ORDER BY is_default DESC, rate DESC LIMIT 1',
    [companyId],
  )
  return d?.id ?? null
}

export function resolveTaxCode(taxCodeId: number | null): { rate: number; accountId: number | null } {
  if (taxCodeId == null) return { rate: 0, accountId: null }
  const c = getTaxCode(taxCodeId)
  return c ? { rate: c.rate, accountId: c.account_id } : { rate: 0, accountId: null }
}

export function createTaxCode(companyId: number, name: string, rate: number, accountId: number | null): number {
  return insert('INSERT INTO tax_codes (company_id, name, rate, account_id) VALUES (?, ?, ?, ?)', [companyId, name, rate, accountId])
}

export function updateTaxCode(id: number, patch: { name?: string; rate?: number; account_id?: number | null }): void {
  const c = getTaxCode(id)
  if (!c) return
  run('UPDATE tax_codes SET name = ?, rate = ?, account_id = ? WHERE id = ?', [
    patch.name ?? c.name,
    patch.rate ?? c.rate,
    patch.account_id !== undefined ? patch.account_id : c.account_id,
    id,
  ])
}

export function deleteTaxCode(id: number): void {
  run('UPDATE tax_codes SET active = 0 WHERE id = ?', [id])
}

// ---- helpers ---------------------------------------------------------------

function totals(lines: DocumentLineInput[], rate: number, taxEnabled: boolean) {
  let subtotal = 0
  let taxable = 0
  for (const l of lines) {
    subtotal += l.amount_cents
    if (l.taxable !== false) taxable += l.amount_cents
  }
  const tax = taxEnabled && rate > 0 ? Math.round(taxable * rate) : 0
  return { subtotal, tax, total: subtotal + tax }
}

function insertDocument(d: {
  companyId: number
  type: DocType
  contactId: number | null
  date: string
  dueDate?: string | null
  number?: string | null
  memo?: string | null
  taxCodeId?: number | null
  paymentMethod?: string | null
  status: string
  subtotal: number
  tax: number
  total: number
  balance: number
  transactionId: number | null
}): number {
  return insert(
    `INSERT INTO documents
       (company_id, type, contact_id, date, due_date, number, memo, tax_code_id, payment_method, status,
        subtotal_cents, tax_cents, total_cents, balance_cents, transaction_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      d.companyId, d.type, d.contactId, d.date, d.dueDate ?? null, d.number ?? null,
      d.memo ?? null, d.taxCodeId ?? null, d.paymentMethod ?? null, d.status,
      d.subtotal, d.tax, d.total, d.balance, d.transactionId,
    ],
  )
}

function insertLines(docId: number, lines: DocumentLineInput[]): void {
  for (const l of lines) {
    insert(
      `INSERT INTO document_lines
         (document_id, account_id, item_id, description, qty, unit_price_cents, amount_cents, taxable)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        docId, l.account_id, l.item_id ?? null, l.description ?? null, l.qty ?? 1,
        l.unit_price_cents ?? l.amount_cents, l.amount_cents, l.taxable === false ? 0 : 1,
      ],
    )
  }
}

export function nextDocNumber(companyId: number, type: DocType): string {
  const prefix: Record<DocType, string> = {
    invoice: 'INV',
    bill: 'BILL',
    expense: 'EXP',
    sales_receipt: 'SR',
    payment_received: 'RCPT',
    payment_made: 'PAY',
  }
  const r = one<{ n: number }>(
    'SELECT COUNT(*) AS n FROM documents WHERE company_id = ? AND type = ?',
    [companyId, type],
  )
  const seq = (r?.n ?? 0) + 1
  return `${prefix[type]}-${String(seq).padStart(4, '0')}`
}

// ---- Create documents ------------------------------------------------------

interface DocInput {
  companyId: number
  contactId: number | null
  date: string
  dueDate?: string | null
  number?: string | null
  memo?: string | null
  paymentMethod?: string | null
  lines: DocumentLineInput[]
  taxCodeId: number | null
}

/** Invoice (AR): debit Accounts Receivable, credit income lines + tax. */
export function createInvoice(p: DocInput): number {
  return tx(() => {
    const ar = getARAccountId(p.companyId)
    if (!ar) throw new Error('No Accounts Receivable account found in this company.')
    const code = resolveTaxCode(p.taxCodeId)
    const { subtotal, tax, total } = totals(p.lines, code.rate, code.rate > 0)
    const taxAcct = tax > 0 ? (code.accountId ?? ensureTaxAccountId(p.companyId)) : null
    const gl = [{ account_id: ar, amount_cents: total }]
    for (const l of p.lines) gl.push({ account_id: l.account_id, amount_cents: -l.amount_cents })
    if (tax > 0) gl.push({ account_id: taxAcct!, amount_cents: -tax })
    const txnId = postTransaction({
      company_id: p.companyId, date: p.date, memo: p.memo ?? `Invoice ${p.number ?? ''}`.trim(),
      reference: p.number, contact_id: p.contactId, source: 'invoice', lines: gl,
    })
    const docId = insertDocument({
      companyId: p.companyId, type: 'invoice', contactId: p.contactId, date: p.date, taxCodeId: p.taxCodeId,
      dueDate: p.dueDate, number: p.number, memo: p.memo, status: 'open',
      subtotal, tax, total, balance: total, transactionId: txnId,
    })
    insertLines(docId, p.lines)
    audit(p.companyId, 'create', 'invoice', docId, `Invoice ${p.number ?? docId} — ${formatMoney(total)}`)
    return docId
  })
}

/** Sales receipt: debit a bank/deposit account, credit income + tax. Paid immediately. */
export function createSalesReceipt(p: DocInput & { depositAccountId: number }): number {
  return tx(() => {
    const code = resolveTaxCode(p.taxCodeId)
    const { subtotal, tax, total } = totals(p.lines, code.rate, code.rate > 0)
    const taxAcct = tax > 0 ? (code.accountId ?? ensureTaxAccountId(p.companyId)) : null
    const gl = [{ account_id: p.depositAccountId, amount_cents: total }]
    for (const l of p.lines) gl.push({ account_id: l.account_id, amount_cents: -l.amount_cents })
    if (tax > 0) gl.push({ account_id: taxAcct!, amount_cents: -tax })
    const txnId = postTransaction({
      company_id: p.companyId, date: p.date, memo: p.memo ?? `Sales receipt ${p.number ?? ''}`.trim(),
      reference: p.number, contact_id: p.contactId, source: 'sales_receipt', lines: gl,
    })
    const docId = insertDocument({
      companyId: p.companyId, type: 'sales_receipt', contactId: p.contactId, date: p.date, taxCodeId: p.taxCodeId,
      paymentMethod: p.paymentMethod, dueDate: null, number: p.number, memo: p.memo, status: 'paid',
      subtotal, tax, total, balance: 0, transactionId: txnId,
    })
    insertLines(docId, p.lines)
    audit(p.companyId, 'create', 'sales_receipt', docId, `Sales receipt ${p.number ?? docId} — ${formatMoney(total)}`)
    return docId
  })
}

/** Bill (AP): credit Accounts Payable, debit expense/asset lines + tax (ITC). */
export function createBill(p: DocInput): number {
  return tx(() => {
    const ap = getAPAccountId(p.companyId)
    if (!ap) throw new Error('No Accounts Payable account found in this company.')
    const code = resolveTaxCode(p.taxCodeId)
    const { subtotal, tax, total } = totals(p.lines, code.rate, code.rate > 0)
    const taxAcct = tax > 0 ? (code.accountId ?? ensureTaxAccountId(p.companyId)) : null
    const gl = [{ account_id: ap, amount_cents: -total }]
    for (const l of p.lines) gl.push({ account_id: l.account_id, amount_cents: l.amount_cents })
    if (tax > 0) gl.push({ account_id: taxAcct!, amount_cents: tax })
    const txnId = postTransaction({
      company_id: p.companyId, date: p.date, memo: p.memo ?? `Bill ${p.number ?? ''}`.trim(),
      reference: p.number, contact_id: p.contactId, source: 'bill', lines: gl,
    })
    const docId = insertDocument({
      companyId: p.companyId, type: 'bill', contactId: p.contactId, date: p.date, taxCodeId: p.taxCodeId,
      dueDate: p.dueDate, number: p.number, memo: p.memo, status: 'open',
      subtotal, tax, total, balance: total, transactionId: txnId,
    })
    insertLines(docId, p.lines)
    audit(p.companyId, 'create', 'bill', docId, `Bill ${p.number ?? docId} — ${formatMoney(total)}`)
    return docId
  })
}

/** Expense: credit a bank/credit-card account, debit expense lines + tax. Paid immediately. */
export function createExpense(p: DocInput & { paidFromAccountId: number }): number {
  return tx(() => {
    const code = resolveTaxCode(p.taxCodeId)
    const { subtotal, tax, total } = totals(p.lines, code.rate, code.rate > 0)
    const taxAcct = tax > 0 ? (code.accountId ?? ensureTaxAccountId(p.companyId)) : null
    const gl = [{ account_id: p.paidFromAccountId, amount_cents: -total }]
    for (const l of p.lines) gl.push({ account_id: l.account_id, amount_cents: l.amount_cents })
    if (tax > 0) gl.push({ account_id: taxAcct!, amount_cents: tax })
    const txnId = postTransaction({
      company_id: p.companyId, date: p.date, memo: p.memo ?? `Expense ${p.number ?? ''}`.trim(),
      reference: p.number, contact_id: p.contactId, source: 'expense', lines: gl,
    })
    const docId = insertDocument({
      companyId: p.companyId, type: 'expense', contactId: p.contactId, date: p.date, taxCodeId: p.taxCodeId,
      paymentMethod: p.paymentMethod, dueDate: null, number: p.number, memo: p.memo, status: 'paid',
      subtotal, tax, total, balance: 0, transactionId: txnId,
    })
    insertLines(docId, p.lines)
    audit(p.companyId, 'create', 'expense', docId, `Expense ${p.number ?? docId} — ${formatMoney(total)}`)
    return docId
  })
}

/** Edit a document: reverse its old ledger entries and re-post from the new inputs. */
export function updateDocument(
  docId: number,
  input: DocInput & { depositAccountId?: number; paidFromAccountId?: number },
): number {
  return tx(() => {
    const doc = one<DocumentRow>('SELECT * FROM documents WHERE id = ?', [docId])
    if (!doc) throw new Error('Document not found')
    if (doc.status === 'void') throw new Error('Cannot edit a void document.')
    const applied = one<{ n: number }>(
      'SELECT COUNT(*) AS n FROM payment_applications WHERE applied_document_id = ?',
      [docId],
    )
    if ((applied?.n ?? 0) > 0) throw new Error('Remove the payment(s) applied to this document before editing it.')
    assertNotLocked(doc.company_id, doc.date)
    assertNotLocked(input.companyId, input.date)

    if (doc.transaction_id) {
      run('DELETE FROM entries WHERE transaction_id = ?', [doc.transaction_id])
      run('DELETE FROM transactions WHERE id = ?', [doc.transaction_id])
    }
    run('DELETE FROM document_lines WHERE document_id = ?', [docId])

    const code = resolveTaxCode(input.taxCodeId)
    const { subtotal, tax, total } = totals(input.lines, code.rate, code.rate > 0)
    const taxAcct = tax > 0 ? (code.accountId ?? ensureTaxAccountId(input.companyId)) : null
    const type = doc.type
    const gl: { account_id: number; amount_cents: number }[] = []
    let status: string
    let balance: number
    let dueDate: string | null

    if (type === 'invoice') {
      const ar = getARAccountId(input.companyId)
      if (!ar) throw new Error('No Accounts Receivable account found.')
      gl.push({ account_id: ar, amount_cents: total })
      for (const l of input.lines) gl.push({ account_id: l.account_id, amount_cents: -l.amount_cents })
      if (tax > 0) gl.push({ account_id: taxAcct!, amount_cents: -tax })
      status = 'open'; balance = total; dueDate = input.dueDate ?? null
    } else if (type === 'bill') {
      const ap = getAPAccountId(input.companyId)
      if (!ap) throw new Error('No Accounts Payable account found.')
      gl.push({ account_id: ap, amount_cents: -total })
      for (const l of input.lines) gl.push({ account_id: l.account_id, amount_cents: l.amount_cents })
      if (tax > 0) gl.push({ account_id: taxAcct!, amount_cents: tax })
      status = 'open'; balance = total; dueDate = input.dueDate ?? null
    } else if (type === 'expense') {
      if (!input.paidFromAccountId) throw new Error('Choose an account to pay from.')
      gl.push({ account_id: input.paidFromAccountId, amount_cents: -total })
      for (const l of input.lines) gl.push({ account_id: l.account_id, amount_cents: l.amount_cents })
      if (tax > 0) gl.push({ account_id: taxAcct!, amount_cents: tax })
      status = 'paid'; balance = 0; dueDate = null
    } else if (type === 'sales_receipt') {
      if (!input.depositAccountId) throw new Error('Choose a deposit account.')
      gl.push({ account_id: input.depositAccountId, amount_cents: total })
      for (const l of input.lines) gl.push({ account_id: l.account_id, amount_cents: -l.amount_cents })
      if (tax > 0) gl.push({ account_id: taxAcct!, amount_cents: -tax })
      status = 'paid'; balance = 0; dueDate = null
    } else {
      throw new Error('This document type cannot be edited.')
    }

    const txnId = postTransaction({
      company_id: input.companyId, date: input.date, memo: input.memo ?? doc.memo,
      reference: input.number, contact_id: input.contactId, source: type, lines: gl,
    })
    run(
      `UPDATE documents SET contact_id = ?, date = ?, due_date = ?, number = ?, memo = ?, tax_code_id = ?, payment_method = ?, status = ?,
        subtotal_cents = ?, tax_cents = ?, total_cents = ?, balance_cents = ?, transaction_id = ? WHERE id = ?`,
      [input.contactId, input.date, dueDate, input.number ?? doc.number, input.memo ?? doc.memo, input.taxCodeId,
       input.paymentMethod !== undefined ? input.paymentMethod : doc.payment_method, status,
       subtotal, tax, total, balance, txnId, docId],
    )
    insertLines(docId, input.lines)
    audit(input.companyId, 'update', type, docId, `Edited ${type.replace('_', ' ')} ${input.number ?? docId} — ${formatMoney(total)}`)
    return docId
  })
}

export interface DocumentEditData {
  doc: DocumentRow
  contactName: string
  bankAccountId: number | null
  lines: { account_id: number; item_id: number | null; description: string | null; amount_cents: number; taxable: boolean }[]
}

/** Load a document and resolve the fields the edit form needs. */
export function getDocumentForEdit(docId: number): DocumentEditData | null {
  const doc = one<DocumentRow>('SELECT * FROM documents WHERE id = ?', [docId])
  if (!doc) return null
  const contact = doc.contact_id
    ? one<{ name: string }>('SELECT name FROM contacts WHERE id = ?', [doc.contact_id])
    : null
  const lines = all<{ account_id: number; item_id: number | null; description: string | null; amount_cents: number; taxable: number }>(
    'SELECT account_id, item_id, description, amount_cents, taxable FROM document_lines WHERE document_id = ? ORDER BY id',
    [docId],
  ).map((l) => ({ account_id: l.account_id, item_id: l.item_id, description: l.description, amount_cents: l.amount_cents, taxable: l.taxable === 1 }))
  // bank account used (for expense / sales receipt), read from the GL transaction
  let bankAccountId: number | null = null
  if (doc.transaction_id && (doc.type === 'expense' || doc.type === 'sales_receipt')) {
    const b = one<{ account_id: number }>(
      `SELECT e.account_id FROM entries e JOIN accounts a ON a.id = e.account_id
       WHERE e.transaction_id = ? AND a.is_bank = 1 LIMIT 1`,
      [doc.transaction_id],
    )
    bankAccountId = b?.account_id ?? null
  }
  return { doc, contactName: contact?.name ?? '', bankAccountId, lines }
}

// ---- Payments --------------------------------------------------------------

interface PaymentInput {
  companyId: number
  contactId: number | null
  date: string
  bankAccountId: number
  memo?: string | null
  paymentMethod?: string | null
  applications: { documentId: number; amount_cents: number }[]
}

/** Receive payment (AR): debit bank, credit Accounts Receivable; apply to invoices. */
export function receivePayment(p: PaymentInput): number {
  return tx(() => {
    const ar = getARAccountId(p.companyId)
    if (!ar) throw new Error('No Accounts Receivable account found.')
    const total = p.applications.reduce((s, a) => s + a.amount_cents, 0)
    if (total <= 0) throw new Error('Nothing to apply.')
    const txnId = postTransaction({
      company_id: p.companyId, date: p.date, memo: p.memo ?? 'Payment received',
      contact_id: p.contactId, source: 'payment_received',
      lines: [
        { account_id: p.bankAccountId, amount_cents: total },
        { account_id: ar, amount_cents: -total },
      ],
    })
    const payId = insertDocument({
      companyId: p.companyId, type: 'payment_received', contactId: p.contactId, date: p.date,
      dueDate: null, number: nextDocNumber(p.companyId, 'payment_received'), memo: p.memo,
      paymentMethod: p.paymentMethod,
      status: 'paid', subtotal: total, tax: 0, total, balance: 0, transactionId: txnId,
    })
    applyPayments(payId, p.applications)
    audit(p.companyId, 'payment', 'payment_received', payId, `Payment received — ${formatMoney(total)}`)
    return payId
  })
}

/** Pay bills (AP): debit Accounts Payable, credit bank; apply to bills. */
export function payBills(p: PaymentInput): number {
  return tx(() => {
    const ap = getAPAccountId(p.companyId)
    if (!ap) throw new Error('No Accounts Payable account found.')
    const total = p.applications.reduce((s, a) => s + a.amount_cents, 0)
    if (total <= 0) throw new Error('Nothing to apply.')
    const txnId = postTransaction({
      company_id: p.companyId, date: p.date, memo: p.memo ?? 'Bill payment',
      contact_id: p.contactId, source: 'payment_made',
      lines: [
        { account_id: ap, amount_cents: total },
        { account_id: p.bankAccountId, amount_cents: -total },
      ],
    })
    const payId = insertDocument({
      companyId: p.companyId, type: 'payment_made', contactId: p.contactId, date: p.date,
      dueDate: null, number: nextDocNumber(p.companyId, 'payment_made'), memo: p.memo,
      paymentMethod: p.paymentMethod,
      status: 'paid', subtotal: total, tax: 0, total, balance: 0, transactionId: txnId,
    })
    applyPayments(payId, p.applications)
    audit(p.companyId, 'payment', 'payment_made', payId, `Bill payment — ${formatMoney(total)}`)
    return payId
  })
}

function applyPayments(
  paymentDocId: number,
  applications: { documentId: number; amount_cents: number }[],
): void {
  for (const a of applications) {
    if (a.amount_cents <= 0) continue
    insert(
      'INSERT INTO payment_applications (payment_document_id, applied_document_id, amount_cents) VALUES (?, ?, ?)',
      [paymentDocId, a.documentId, a.amount_cents],
    )
    const doc = one<DocumentRow>('SELECT * FROM documents WHERE id = ?', [a.documentId])
    if (!doc) continue
    const newBalance = doc.balance_cents - a.amount_cents
    const status = newBalance <= 0 ? 'paid' : 'partial'
    run('UPDATE documents SET balance_cents = ?, status = ? WHERE id = ?', [
      Math.max(0, newBalance),
      status,
      a.documentId,
    ])
  }
}

// ---- Queries ---------------------------------------------------------------

export interface DocumentWithContact extends DocumentRow {
  contact_name: string | null
}

export function listDocuments(companyId: number, type: DocType): DocumentWithContact[] {
  return all<DocumentWithContact>(
    `SELECT d.*, c.name AS contact_name
     FROM documents d LEFT JOIN contacts c ON c.id = d.contact_id
     WHERE d.company_id = ? AND d.type = ?
     ORDER BY d.date DESC, d.id DESC`,
    [companyId, type],
  )
}

export function openDocuments(companyId: number, type: 'invoice' | 'bill', contactId?: number): DocumentWithContact[] {
  const params: unknown[] = [companyId, type]
  let where = "d.company_id = ? AND d.type = ? AND d.status IN ('open','partial')"
  if (contactId) {
    where += ' AND d.contact_id = ?'
    params.push(contactId)
  }
  return all<DocumentWithContact>(
    `SELECT d.*, c.name AS contact_name
     FROM documents d LEFT JOIN contacts c ON c.id = d.contact_id
     WHERE ${where} ORDER BY d.due_date, d.date`,
    params,
  )
}

/** Find the document backing a ledger transaction, if any (to route "open/edit"). */
export function getDocumentByTxnId(txnId: number): DocumentRow | undefined {
  return one<DocumentRow>('SELECT * FROM documents WHERE transaction_id = ?', [txnId])
}

export function getDocument(id: number): DocumentWithContact | undefined {
  return one<DocumentWithContact>(
    `SELECT d.*, c.name AS contact_name
     FROM documents d LEFT JOIN contacts c ON c.id = d.contact_id WHERE d.id = ?`,
    [id],
  )
}

export interface AgingBuckets {
  current: number
  d1_30: number
  d31_60: number
  d61_90: number
  d90_plus: number
  total: number
}

export interface AgingRow extends DocumentWithContact {
  days_overdue: number
  bucket: keyof AgingBuckets
}

export function aging(companyId: number, which: 'ar' | 'ap', asOfISO: string): {
  rows: AgingRow[]
  totals: AgingBuckets
} {
  const type = which === 'ar' ? 'invoice' : 'bill'
  const docs = openDocuments(companyId, type)
  const asOf = new Date(asOfISO).getTime()
  const totals: AgingBuckets = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0, total: 0 }
  const rows: AgingRow[] = docs.map((d) => {
    const due = d.due_date ? new Date(d.due_date).getTime() : new Date(d.date).getTime()
    const days = Math.floor((asOf - due) / 86400000)
    let bucket: keyof AgingBuckets = 'current'
    if (days <= 0) bucket = 'current'
    else if (days <= 30) bucket = 'd1_30'
    else if (days <= 60) bucket = 'd31_60'
    else if (days <= 90) bucket = 'd61_90'
    else bucket = 'd90_plus'
    totals[bucket] += d.balance_cents
    totals.total += d.balance_cents
    return { ...d, days_overdue: Math.max(0, days), bucket }
  })
  return { rows, totals }
}

export function getDocumentLines(docId: number) {
  return all(
    `SELECT dl.*, a.code AS account_code, a.name AS account_name
     FROM document_lines dl JOIN accounts a ON a.id = dl.account_id
     WHERE dl.document_id = ? ORDER BY dl.id`,
    [docId],
  )
}

/** Void: remove the GL transaction (entries cascade) and mark the document void. */
export function voidDocument(id: number): void {
  tx(() => {
    const doc = one<DocumentRow>('SELECT * FROM documents WHERE id = ?', [id])
    if (!doc) return
    assertNotLocked(doc.company_id, doc.date)
    if (doc.transaction_id) {
      run('DELETE FROM entries WHERE transaction_id = ?', [doc.transaction_id])
      run('DELETE FROM transactions WHERE id = ?', [doc.transaction_id])
    }
    run("UPDATE documents SET status = 'void', balance_cents = 0 WHERE id = ?", [id])
    audit(doc.company_id, 'void', doc.type, id, `Voided ${doc.type.replace('_', ' ')} ${doc.number ?? id}`)
  })
}
