/**
 * Assemble printable invoices / receipts / statements from the ledger and send
 * them to the print view (lib/printHtml). DB reads live here; the HTML is built
 * by the pure renderers so they stay testable.
 */

import { all, one } from './db'
import { getCompany } from './repo'
import { getDocument } from './documents'
import type { DocType, Contact } from './types'
import {
  invoiceHtml,
  statementHtml,
  printHTML,
  type PrintDocumentData,
  type PrintLineItem,
  type StatementRow,
} from '../lib/printHtml'

const KIND_LABEL: Record<DocType, string> = {
  invoice: 'Invoice',
  sales_receipt: 'Sales Receipt',
  bill: 'Bill',
  expense: 'Expense',
  payment_received: 'Payment Receipt',
  payment_made: 'Payment',
}

function contactById(id: number | null): Contact | undefined {
  if (id == null) return undefined
  return one<Contact>('SELECT * FROM contacts WHERE id = ?', [id])
}

function addressLines(c: Contact | undefined): string[] {
  if (!c) return []
  const cityLine = [c.city, c.province, c.postal].filter(Boolean).join(', ')
  return [c.address_line1 ?? '', c.address_line2 ?? '', cityLine, c.country ?? ''].filter(Boolean)
}

interface RawLine {
  description: string | null
  qty: number
  unit_price_cents: number
  amount_cents: number
  account_name: string
}

/** Build the printable data for one document (invoice/receipt/bill/expense). */
export function buildDocumentData(docId: number): PrintDocumentData {
  const doc = getDocument(docId)
  if (!doc) throw new Error('Document not found.')
  const company = getCompany(doc.company_id)
  if (!company) throw new Error('Company not found.')
  const contact = contactById(doc.contact_id)
  const lines = all<RawLine>(
    `SELECT dl.description, dl.qty, dl.unit_price_cents, dl.amount_cents, a.name AS account_name
     FROM document_lines dl JOIN accounts a ON a.id = dl.account_id
     WHERE dl.document_id = ? ORDER BY dl.id`,
    [docId],
  )
  const lineItems: PrintLineItem[] = lines.map((l) => ({
    description: l.description || l.account_name,
    qty: l.qty || 1,
    unitPriceCents: l.unit_price_cents,
    amountCents: l.amount_cents,
  }))
  const isPurchase = doc.type === 'bill' || doc.type === 'expense'
  return {
    kind: KIND_LABEL[doc.type],
    company: { name: company.name, legalName: company.legal_name },
    party: {
      label: isPurchase ? 'Vendor' : 'Bill to',
      name: doc.contact_name ?? '',
      addressLines: addressLines(contact),
      email: contact?.email ?? null,
    },
    number: doc.number ?? String(doc.id),
    date: doc.date,
    dueDate: doc.due_date,
    paymentMethod: doc.payment_method,
    status: doc.status,
    currency: company.base_currency,
    lineItems,
    subtotalCents: doc.subtotal_cents,
    taxCents: doc.tax_cents,
    totalCents: doc.total_cents,
    balanceCents: doc.balance_cents,
    memo: doc.memo,
  }
}

/** Render + print one document. */
export function printDocument(docId: number): void {
  const data = buildDocumentData(docId)
  printHTML(invoiceHtml(data), `${data.kind} ${data.number}`)
}

interface StatementDocRow {
  type: DocType
  date: string
  number: string | null
  total_cents: number
}

/**
 * Build a statement of account for a contact. `mode` 'ar' lists invoices (charges)
 * and received payments; 'ap' lists bills and payments made. Opening balance is
 * everything before `start`; rows fall within [start, end].
 */
export function buildStatementData(companyId: number, contactId: number, mode: 'ar' | 'ap', start: string, end: string) {
  const company = getCompany(companyId)
  if (!company) throw new Error('Company not found.')
  const contact = contactById(contactId)
  const chargeType: DocType = mode === 'ar' ? 'invoice' : 'bill'
  const payType: DocType = mode === 'ar' ? 'payment_received' : 'payment_made'
  const docs = all<StatementDocRow>(
    `SELECT type, date, number, total_cents FROM documents
     WHERE company_id = ? AND contact_id = ? AND type IN (?, ?) AND status != 'void'
     ORDER BY date, id`,
    [companyId, contactId, chargeType, payType],
  )

  let opening = 0
  const rows: StatementRow[] = []
  // First pass: opening balance = net of everything strictly before `start`.
  for (const d of docs) {
    if (d.date < start) opening += d.type === chargeType ? d.total_cents : -d.total_cents
  }
  let balance = opening
  for (const d of docs) {
    if (d.date < start || d.date > end) continue
    const charge = d.type === chargeType ? d.total_cents : 0
    const payment = d.type === payType ? d.total_cents : 0
    balance += charge - payment
    rows.push({
      date: d.date,
      description: KIND_LABEL[d.type],
      number: d.number ?? '',
      chargeCents: charge,
      paymentCents: payment,
      balanceCents: balance,
    })
  }

  return {
    company: { name: company.name, legalName: company.legal_name },
    party: { name: contact?.name ?? '', addressLines: addressLines(contact), email: contact?.email ?? null },
    heading: 'Statement of Account',
    start,
    end,
    currency: company.base_currency,
    openingBalanceCents: opening,
    rows,
    closingBalanceCents: balance,
  }
}

export function printStatement(companyId: number, contactId: number, mode: 'ar' | 'ap', start: string, end: string): void {
  const data = buildStatementData(companyId, contactId, mode, start, end)
  printHTML(statementHtml(data), `Statement — ${data.party.name}`)
}
