import { parse as parseDate, isValid } from 'date-fns'
import { parseMoney } from '../lib/money'

export interface ImportedRow {
  date: string // ISO yyyy-mm-dd
  description: string
  amount_cents: number
  fitid?: string | null
}

const DATE_FORMATS = [
  'yyyy-MM-dd',
  'MM/dd/yyyy',
  'M/d/yyyy',
  'dd/MM/yyyy',
  'MM-dd-yyyy',
  'yyyy/MM/dd',
  'MMM d, yyyy',
  'd MMM yyyy',
  'yyyyMMdd',
]

function toISO(raw: string): string {
  const s = (raw || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  for (const fmt of DATE_FORMATS) {
    const d = parseDate(s, fmt, new Date())
    if (isValid(d)) return d.toISOString().slice(0, 10)
  }
  const d = new Date(s)
  if (isValid(d)) return d.toISOString().slice(0, 10)
  return s
}

// ---- CSV -------------------------------------------------------------------

function splitCSVLine(line: string, delim: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === delim && !inQuotes) {
      out.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out.map((c) => c.trim())
}

function findCol(headers: string[], candidates: string[]): number {
  const lower = headers.map((h) => h.toLowerCase())
  for (const c of candidates) {
    const i = lower.findIndex((h) => h === c || h.includes(c))
    if (i >= 0) return i
  }
  return -1
}

export function parseCSV(text: string): ImportedRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length < 2) return []
  const delim = (lines[0].match(/;/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? ';' : ','
  const headers = splitCSVLine(lines[0], delim)

  const dateCol = findCol(headers, ['date', 'posted', 'transaction date'])
  const descCol = findCol(headers, ['description', 'memo', 'payee', 'name', 'details', 'narrative'])
  const amountCol = findCol(headers, ['amount', 'value'])
  const debitCol = findCol(headers, ['debit', 'withdrawal', 'withdrawals', 'paid out'])
  const creditCol = findCol(headers, ['credit', 'deposit', 'deposits', 'paid in'])

  const rows: ImportedRow[] = []
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCSVLine(lines[i], delim)
    if (cols.length === 0) continue
    const date = toISO(dateCol >= 0 ? cols[dateCol] : cols[0])
    const description = descCol >= 0 ? cols[descCol] : cols.slice(1).join(' ')
    let amount_cents = 0
    if (amountCol >= 0 && cols[amountCol]) {
      amount_cents = parseMoney(cols[amountCol])
    } else {
      const debit = debitCol >= 0 ? parseMoney(cols[debitCol] || '0') : 0
      const credit = creditCol >= 0 ? parseMoney(cols[creditCol] || '0') : 0
      amount_cents = credit - debit // deposits positive, withdrawals negative
    }
    if (!description && amount_cents === 0) continue
    rows.push({ date, description, amount_cents })
  }
  return rows
}

// ---- OFX / QFX / QBO -------------------------------------------------------

function ofxTag(block: string, tag: string): string {
  // OFX/SGML values run from the tag to the next tag or newline.
  const re = new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i')
  const m = block.match(re)
  return m ? m[1].trim() : ''
}

function ofxDate(raw: string): string {
  // DTPOSTED like 20240131 or 20240131120000[-5:EST]
  const s = raw.replace(/\[.*$/, '')
  if (s.length >= 8) {
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
  }
  return toISO(raw)
}

export function parseOFX(text: string): ImportedRow[] {
  const rows: ImportedRow[] = []
  const blocks = text.split(/<STMTTRN>/i).slice(1)
  for (const raw of blocks) {
    const block = raw.split(/<\/STMTTRN>/i)[0]
    const amount = parseMoney(ofxTag(block, 'TRNAMT'))
    const date = ofxDate(ofxTag(block, 'DTPOSTED'))
    const name = ofxTag(block, 'NAME')
    const memo = ofxTag(block, 'MEMO')
    const fitid = ofxTag(block, 'FITID')
    const description = [name, memo].filter(Boolean).join(' — ') || 'Bank transaction'
    rows.push({ date, description, amount_cents: amount, fitid: fitid || null })
  }
  return rows
}

export function parseBankFile(filename: string, text: string): ImportedRow[] {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.ofx') || lower.endsWith('.qfx') || lower.endsWith('.qbo')) {
    return parseOFX(text)
  }
  if (/<OFX>|<STMTTRN>/i.test(text)) return parseOFX(text)
  return parseCSV(text)
}
