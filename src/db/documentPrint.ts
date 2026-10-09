/**
 * Assemble printable invoices / receipts / statements from the ledger and send
 * them to the print view (lib/printHtml). DB reads live here; the HTML is built
 * by the pure renderers so they stay testable.
 */

import { all, one } from './db'
import { getCompany, getCompanyProfile } from './repo'
import { getDocument } from './documents'
import { formatDate } from '../lib/format'
import type { DocType, Contact } from './types'
import {
  invoiceHtml,
  statementHtml,
  printHTML,
  type PrintDocumentData,
  type PrintLineItem,
  type StatementRow,
  type CompanyHeader,
} from '../lib/printHtml'

/** Compose the letterhead for a company from its profile (defaults when unset). */
function companyHeader(companyId: number): CompanyHeader {
  const c = getCompany(companyId)
  if (!c) throw new Error('Company not found.')
  const p = getCompanyProfile(companyId)
  const cityLine = [p?.city, p?.province, p?.postal].filter(Boolean).join(', ')
  const addressLines = [p?.address_line1, p?.address_line2, cityLine, p?.country].filter(Boolean) as string[]
  return {
    name: p?.display_name || c.name,
    legalName: c.legal_name,
    addressLines,
    phone: p?.phone ?? null,
    email: p?.email ?? null,
    website: p?.website ?? null,
    taxNumber: p?.tax_number ?? null,
    logoDataUrl: p?.logo_data_url ?? null,
    useLetterhead: p ? p.use_letterhead === 1 : true,
    footerNote: p?.footer_note ?? null,
  }
}

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
    company: companyHeader(doc.company_id),
    party: {
      label: isPurchase ? 'Vendor' : 'Bill to',
      name: doc.contact_name ?? '',
      addressLines: addressLines(contact),
      email: contact?.email ?? null,
    },
    number: doc.number ?? String(doc.id),
    date: formatDate(doc.date),
    dueDate: doc.due_date ? formatDate(doc.due_date) : null,
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
      date: formatDate(d.date),
      description: KIND_LABEL[d.type],
      number: d.number ?? '',
      chargeCents: charge,
      paymentCents: payment,
      balanceCents: balance,
    })
  }

  return {
    company: companyHeader(companyId),
    party: { name: contact?.name ?? '', addressLines: addressLines(contact), email: contact?.email ?? null },
    heading: 'Statement of Account',
    start: formatDate(start),
    end: formatDate(end),
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

/** Print a sample invoice using the current company letterhead — for the profile editor. */
export function previewLetterhead(companyId: number): void {
  const company = getCompany(companyId)
  const data: PrintDocumentData = {
    kind: 'Invoice',
    company: companyHeader(companyId),
    party: {
      label: 'Bill to',
      name: 'Sample Customer Inc.',
      addressLines: ['123 Example Street', 'Toronto, ON, M5H 1A1', 'Canada'],
      email: 'accounts@example.com',
    },
    number: 'INV-PREVIEW',
    date: formatDate(new Date().toISOString().slice(0, 10)),
    dueDate: null,
    paymentMethod: null,
    status: 'open',
    currency: company?.base_currency ?? 'CAD',
    lineItems: [
      { description: 'Sample product or service', qty: 2, unitPriceCents: 5000, amountCents: 10000 },
      { description: 'On-site labour', qty: 1, unitPriceCents: 7500, amountCents: 7500 },
    ],
    subtotalCents: 17500,
    taxCents: 2275,
    totalCents: 19775,
    balanceCents: 19775,
    memo: 'This is a preview — dummy data to show your letterhead.',
  }
  printHTML(invoiceHtml(data), 'Letterhead preview')
}
