export function toCSV(headers: string[], rows: (string | number)[][]): string {
  const esc = (v: string | number) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  return [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\r\n')
}

export function downloadCSV(filename: string, headers: string[], rows: (string | number)[][]): void {
  const blob = new Blob([toCSV(headers, rows)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** Dollars string for CSV (no symbol, no thousands separators). */
export function csvAmount(cents: number): string {
  return (cents / 100).toFixed(2)
}

/** Parse CSV text into rows of fields (handles quotes, escaped quotes, CRLF). */
export function parseCSV(text: string): string[][] {
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

/** Parse CSV with a header row into objects keyed by lowercased, trimmed headers. */
export function parseCSVObjects(text: string): Record<string, string>[] {
  const rows = parseCSV(text).filter((r) => r.some((c) => c.trim() !== ''))
  if (rows.length < 2) return []
  const headers = rows[0].map((h) => h.trim().toLowerCase())
  return rows.slice(1).map((r) => {
    const o: Record<string, string> = {}
    headers.forEach((h, i) => { o[h] = (r[i] ?? '').trim() })
    return o
  })
}
