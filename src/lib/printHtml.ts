/**
 * Zero-dependency printable documents (invoices, receipts, statements).
 *
 * We render a clean, self-contained HTML document and print it through a hidden
 * iframe — the user's print dialog then offers "Save as PDF". This needs no PDF
 * library and works in both the browser build and the Tauri desktop webview.
 * These functions are pure (string in → string out) except printHTML(), which
 * touches the DOM.
 */

import { formatMoney } from './money'

export function escapeHtml(s: string | null | undefined): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const BASE_CSS = `
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font: 13px/1.5 -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color: #1e293b; }
  .page { max-width: 760px; margin: 0 auto; padding: 40px; }
  h1 { font-size: 26px; margin: 0 0 2px; letter-spacing: -0.5px; }
  .muted { color: #64748b; }
  .small { font-size: 11px; }
  .row { display: flex; justify-content: space-between; gap: 24px; }
  .mt { margin-top: 28px; }
  .mt-sm { margin-top: 12px; }
  .right { text-align: right; }
  .brand { font-size: 20px; font-weight: 700; color: #0f172a; }
  table { width: 100%; border-collapse: collapse; margin-top: 20px; }
  th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b; border-bottom: 2px solid #e2e8f0; padding: 8px 10px; }
  th.num, td.num { text-align: right; }
  td { padding: 9px 10px; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
  .totals { margin-top: 16px; margin-left: auto; width: 280px; }
  .totals .line { display: flex; justify-content: space-between; padding: 5px 10px; }
  .totals .grand { border-top: 2px solid #e2e8f0; font-weight: 700; font-size: 15px; }
  .pill { display: inline-block; border-radius: 4px; padding: 2px 8px; font-size: 11px; font-weight: 600; }
  .status-paid { background: #ecfdf5; color: #047857; }
  .status-open { background: #fffbeb; color: #b45309; }
  .status-void { background: #f1f5f9; color: #94a3b8; text-decoration: line-through; }
  .memo { margin-top: 24px; padding-top: 14px; border-top: 1px solid #f1f5f9; color: #475569; }
  .foot { margin-top: 40px; color: #94a3b8; font-size: 11px; text-align: center; }
  @media print { .page { padding: 0; } @page { margin: 18mm; } }
`

function docShell(title: string, bodyHtml: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${BASE_CSS}</style></head><body><div class="page">${bodyHtml}</div></body></html>`
}

// ---------------------------------------------------------------------------
// Invoice / receipt / bill
// ---------------------------------------------------------------------------

export interface PrintLineItem {
  description: string
  qty: number
  unitPriceCents: number
  amountCents: number
}

export interface PrintDocumentData {
  /** "Invoice" | "Sales Receipt" | "Bill" | "Expense". */
  kind: string
  company: { name: string; legalName?: string | null }
  /** The other party block — e.g. { label: 'Bill to', ... } for an invoice. */
  party: { label: string; name: string; addressLines: string[]; email?: string | null }
  number: string
  date: string
  dueDate?: string | null
  paymentMethod?: string | null
  status: string
  currency: string
  lineItems: PrintLineItem[]
  subtotalCents: number
  taxCents: number
  totalCents: number
  balanceCents: number
  memo?: string | null
}

function statusClass(status: string): string {
  if (status === 'paid') return 'status-paid'
  if (status === 'void') return 'status-void'
  return 'status-open'
}

export function invoiceHtml(d: PrintDocumentData): string {
  const m = (c: number) => escapeHtml(formatMoney(c, d.currency))
  const rows = d.lineItems
    .map(
      (li) => `<tr>
        <td>${escapeHtml(li.description || '—')}</td>
        <td class="num">${li.qty}</td>
        <td class="num">${m(li.unitPriceCents)}</td>
        <td class="num">${m(li.amountCents)}</td>
      </tr>`,
    )
    .join('')
  const partyAddr = d.party.addressLines.filter(Boolean).map((l) => `<div>${escapeHtml(l)}</div>`).join('')
  const dueRow = d.dueDate ? `<div><span class="muted">Due</span> ${escapeHtml(d.dueDate)}</div>` : ''
  const payRow = d.paymentMethod ? `<div><span class="muted">Paid via</span> ${escapeHtml(d.paymentMethod)}</div>` : ''
  const balanceRow =
    d.balanceCents > 0
      ? `<div class="line grand"><span>Balance due</span><span>${m(d.balanceCents)}</span></div>`
      : `<div class="line grand"><span>Total</span><span>${m(d.totalCents)}</span></div>`
  const memo = d.memo ? `<div class="memo">${escapeHtml(d.memo)}</div>` : ''

  const body = `
    <div class="row">
      <div>
        <div class="brand">${escapeHtml(d.company.name)}</div>
        ${d.company.legalName && d.company.legalName !== d.company.name ? `<div class="muted small">${escapeHtml(d.company.legalName)}</div>` : ''}
      </div>
      <div class="right">
        <h1>${escapeHtml(d.kind)}</h1>
        <div class="muted">#${escapeHtml(d.number)}</div>
        <div class="mt-sm"><span class="pill ${statusClass(d.status)}">${escapeHtml(d.status)}</span></div>
      </div>
    </div>

    <div class="row mt">
      <div>
        <div class="muted small">${escapeHtml(d.party.label)}</div>
        <div><strong>${escapeHtml(d.party.name || '—')}</strong></div>
        ${partyAddr}
        ${d.party.email ? `<div class="muted">${escapeHtml(d.party.email)}</div>` : ''}
      </div>
      <div class="right">
        <div><span class="muted">Date</span> ${escapeHtml(d.date)}</div>
        ${dueRow}
        ${payRow}
      </div>
    </div>

    <table>
      <thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Unit</th><th class="num">Amount</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4" class="muted">No line items.</td></tr>'}</tbody>
    </table>

    <div class="totals">
      <div class="line"><span class="muted">Subtotal</span><span>${m(d.subtotalCents)}</span></div>
      ${d.taxCents ? `<div class="line"><span class="muted">Tax</span><span>${m(d.taxCents)}</span></div>` : ''}
      ${balanceRow}
    </div>
    ${memo}
    <div class="foot">Generated by Sonic the Ledgerhog</div>
  `
  return docShell(`${d.kind} ${d.number}`, body)
}

// ---------------------------------------------------------------------------
// Statement of account
// ---------------------------------------------------------------------------

export interface StatementRow {
  date: string
  description: string
  number: string
  chargeCents: number
  paymentCents: number
  balanceCents: number
}

export interface PrintStatementData {
  company: { name: string; legalName?: string | null }
  party: { name: string; addressLines: string[]; email?: string | null }
  heading: string // e.g. "Statement of Account"
  start: string
  end: string
  currency: string
  openingBalanceCents: number
  rows: StatementRow[]
  closingBalanceCents: number
}

export function statementHtml(d: PrintStatementData): string {
  const m = (c: number) => escapeHtml(formatMoney(c, d.currency))
  const rows = d.rows
    .map(
      (r) => `<tr>
        <td class="small">${escapeHtml(r.date)}</td>
        <td>${escapeHtml(r.description)}${r.number ? ` <span class="muted small">#${escapeHtml(r.number)}</span>` : ''}</td>
        <td class="num">${r.chargeCents ? m(r.chargeCents) : ''}</td>
        <td class="num">${r.paymentCents ? m(r.paymentCents) : ''}</td>
        <td class="num">${m(r.balanceCents)}</td>
      </tr>`,
    )
    .join('')
  const partyAddr = d.party.addressLines.filter(Boolean).map((l) => `<div>${escapeHtml(l)}</div>`).join('')

  const body = `
    <div class="row">
      <div><div class="brand">${escapeHtml(d.company.name)}</div></div>
      <div class="right"><h1>${escapeHtml(d.heading)}</h1><div class="muted">${escapeHtml(d.start)} – ${escapeHtml(d.end)}</div></div>
    </div>
    <div class="row mt">
      <div>
        <div class="muted small">For</div>
        <div><strong>${escapeHtml(d.party.name)}</strong></div>
        ${partyAddr}
        ${d.party.email ? `<div class="muted">${escapeHtml(d.party.email)}</div>` : ''}
      </div>
      <div class="right">
        <div><span class="muted">Opening balance</span> ${m(d.openingBalanceCents)}</div>
        <div><strong>Balance due ${m(d.closingBalanceCents)}</strong></div>
      </div>
    </div>
    <table>
      <thead><tr><th>Date</th><th>Activity</th><th class="num">Charges</th><th class="num">Payments</th><th class="num">Balance</th></tr></thead>
      <tbody>
        <tr><td></td><td class="muted">Opening balance</td><td class="num"></td><td class="num"></td><td class="num">${m(d.openingBalanceCents)}</td></tr>
        ${rows}
      </tbody>
    </table>
    <div class="totals"><div class="line grand"><span>Balance due</span><span>${m(d.closingBalanceCents)}</span></div></div>
    <div class="foot">Generated by Sonic the Ledgerhog</div>
  `
  return docShell(d.heading, body)
}

// ---------------------------------------------------------------------------
// Print via a hidden iframe (works in browser + Tauri webview)
// ---------------------------------------------------------------------------

export function printHTML(html: string, title: string): void {
  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;'
  document.body.appendChild(iframe)
  const remove = () => { try { document.body.removeChild(iframe) } catch { /* already gone */ } }
  const doc = iframe.contentWindow?.document
  if (!doc) { remove(); throw new Error('Could not open a print view.') }
  doc.open()
  doc.write(html)
  doc.close()
  iframe.contentWindow!.document.title = title
  iframe.onload = () => {
    const win = iframe.contentWindow
    if (!win) { remove(); return }
    win.onafterprint = () => setTimeout(remove, 100)
    try {
      win.focus()
      win.print()
    } catch {
      remove()
    }
    // Fallback cleanup in case onafterprint never fires.
    setTimeout(remove, 60_000)
  }
}
