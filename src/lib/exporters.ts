/**
 * Report exporters: CSV, Excel (.xlsx), and PDF (via the print dialog).
 *
 * All dependency-free. The .xlsx writer emits a minimal but valid OOXML
 * spreadsheet packaged as a store-only (uncompressed) ZIP, so there's no
 * third-party library to install or audit. PDF uses the OS print dialog's
 * "Save as PDF", which every desktop has.
 */

import { downloadCSV } from './csv'
import { printHTML, tableReportHtml } from './printHtml'

export type CellValue = string | number | null | undefined

export interface ExportTable {
  /** Column headers. */
  headers: string[]
  /** Row data; each row aligns to headers. Numbers export as numbers in xlsx. */
  rows: CellValue[][]
  /** Base filename without extension. */
  filename: string
  /** Sheet / document title. */
  title?: string
  /** Per-column alignment; 'right' marks numeric columns (PDF only). */
  align?: ('left' | 'right')[]
}

// ---- CSV -------------------------------------------------------------------

export function exportCSV(t: ExportTable): void {
  downloadCSV(`${t.filename}.csv`, t.headers, t.rows.map((r) => r.map((c) => (c == null ? '' : c))))
}

// ---- XLSX (no dependency) --------------------------------------------------

const xmlEsc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function colName(i: number): string {
  let s = ''
  i++
  while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26) }
  return s
}

function sheetXml(headers: string[], rows: CellValue[][]): string {
  const cell = (r: number, c: number, v: CellValue): string => {
    const ref = `${colName(c)}${r}`
    if (typeof v === 'number' && isFinite(v)) return `<c r="${ref}"><v>${v}</v></c>`
    const s = v == null ? '' : String(v)
    if (s === '') return `<c r="${ref}"/>`
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(s)}</t></is></c>`
  }
  const out: string[] = []
  out.push(`<row r="1">${headers.map((h, c) => cell(1, c, h)).join('')}</row>`)
  rows.forEach((row, i) => {
    const r = i + 2
    out.push(`<row r="${r}">${row.map((v, c) => cell(r, c, v)).join('')}</row>`)
  })
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${out.join('')}</sheetData></worksheet>`
}

// CRC32 for the ZIP container.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

interface ZipEntry { name: string; data: Uint8Array }

/** Build a store-only (uncompressed) ZIP — valid for .xlsx. */
function zip(entries: ZipEntry[]): Uint8Array {
  const enc = new TextEncoder()
  const chunks: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  const u16 = (n: number) => new Uint8Array([n & 0xff, (n >>> 8) & 0xff])
  const u32 = (n: number) => new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff])
  for (const e of entries) {
    const nameBytes = enc.encode(e.name)
    const crc = crc32(e.data)
    const local = concat([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(e.data.length), u32(e.data.length),
      u16(nameBytes.length), u16(0), nameBytes, e.data,
    ])
    chunks.push(local)
    central.push(concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(e.data.length), u32(e.data.length),
      u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameBytes,
    ]))
    offset += local.length
  }
  const centralBlob = concat(central)
  const end = concat([
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(centralBlob.length), u32(offset), u16(0),
  ])
  return concat([...chunks, centralBlob, end])
}

function concat(arrs: Uint8Array[]): Uint8Array {
  const len = arrs.reduce((s, a) => s + a.length, 0)
  const out = new Uint8Array(len)
  let o = 0
  for (const a of arrs) { out.set(a, o); o += a.length }
  return out
}

export function exportXLSX(t: ExportTable): void {
  const enc = new TextEncoder()
  const sheet = t.title ? t.title.slice(0, 31).replace(/[\\/?*[\]:]/g, ' ') : 'Sheet1'
  const files: ZipEntry[] = [
    { name: '[Content_Types].xml', data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`) },
    { name: '_rels/.rels', data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`) },
    { name: 'xl/workbook.xml', data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlEsc(sheet)}" sheetId="1" r:id="rId1"/></sheets></workbook>`) },
    { name: 'xl/_rels/workbook.xml.rels', data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`) },
    { name: 'xl/worksheets/sheet1.xml', data: enc.encode(sheetXml(t.headers, t.rows)) },
  ]
  const blob = new Blob([zip(files) as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  triggerDownload(blob, `${t.filename}.xlsx`)
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ---- PDF (print dialog) ----------------------------------------------------

/** Open the OS print dialog on a clean table document (reusing the proven
 *  hidden-iframe printer), where the user picks "Save as PDF". */
export function exportPDF(t: ExportTable): void {
  const title = t.title ?? t.filename
  printHTML(tableReportHtml(title, t.headers, t.rows, { align: t.align }), title)
}
