import { all, one, insert, run, tx } from './db'
import { getAccounts, createAccountQuick } from './repo'
import { parseCSVObjects } from '../lib/csv'
import { parseMoney } from '../lib/money'
import type { AccountType, Item } from './types'

export function listItems(companyId: number, includeInactive = false): Item[] {
  return all<Item>(
    `SELECT * FROM items WHERE company_id = ? ${includeInactive ? '' : 'AND active = 1'} ORDER BY name`,
    [companyId],
  )
}

/** Items that can be sold — for invoices and sales receipts. */
export function sellItems(companyId: number): Item[] {
  return all<Item>('SELECT * FROM items WHERE company_id = ? AND active = 1 AND sell = 1 ORDER BY name', [companyId])
}

/** Items that can be bought — for bills and expenses. */
export function buyItems(companyId: number): Item[] {
  return all<Item>('SELECT * FROM items WHERE company_id = ? AND active = 1 AND buy = 1 ORDER BY name', [companyId])
}

export function getItem(id: number): Item | undefined {
  return one<Item>('SELECT * FROM items WHERE id = ?', [id])
}

export interface ItemInput {
  name: string
  type?: 'service' | 'non_inventory'
  description?: string | null
  sell?: boolean
  incomeAccountId?: number | null
  salesPriceCents?: number
  buy?: boolean
  expenseAccountId?: number | null
  costCents?: number
  taxable?: boolean
}

export function createItem(companyId: number, p: ItemInput): number {
  if (!p.name.trim()) throw new Error('Item name is required.')
  const sell = p.sell ?? true
  const buy = p.buy ?? false
  if (sell && !p.incomeAccountId) throw new Error('A sellable item needs an income account.')
  if (buy && !p.expenseAccountId) throw new Error('A purchasable item needs an expense account.')
  return insert(
    `INSERT INTO items
       (company_id, name, type, description, sell, income_account_id, sales_price_cents,
        buy, expense_account_id, cost_cents, taxable)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      companyId, p.name.trim(), p.type ?? 'service', p.description ?? null,
      sell ? 1 : 0, p.incomeAccountId ?? null, p.salesPriceCents ?? 0,
      buy ? 1 : 0, p.expenseAccountId ?? null, p.costCents ?? 0,
      p.taxable === false ? 0 : 1,
    ],
  )
}

export function updateItem(id: number, p: ItemInput): void {
  const cur = getItem(id)
  if (!cur) return
  const sell = p.sell ?? cur.sell === 1
  const buy = p.buy ?? cur.buy === 1
  run(
    `UPDATE items SET name = ?, type = ?, description = ?, sell = ?, income_account_id = ?, sales_price_cents = ?,
       buy = ?, expense_account_id = ?, cost_cents = ?, taxable = ? WHERE id = ?`,
    [
      p.name.trim(), p.type ?? cur.type, p.description ?? null,
      sell ? 1 : 0, p.incomeAccountId ?? null, p.salesPriceCents ?? cur.sales_price_cents,
      buy ? 1 : 0, p.expenseAccountId ?? null, p.costCents ?? cur.cost_cents,
      p.taxable === false ? 0 : 1, id,
    ],
  )
}

/** Soft-delete (deactivate) — keeps historical document lines intact. */
export function deactivateItem(id: number): void {
  run('UPDATE items SET active = 0 WHERE id = ?', [id])
}

// ---- CSV import ------------------------------------------------------------

export interface ItemImportResult {
  created: number
  skipped: number
  accountsCreated: number
  errors: string[]
}

function pick(row: Record<string, string>, keys: string[]): string {
  for (const k of keys) if (row[k] != null && row[k] !== '') return row[k]
  return ''
}
function truthy(s: string): boolean {
  return /^(y|yes|true|1|x|✓)$/i.test(s.trim())
}

/**
 * Import items from a CSV. Flexible headers (case-insensitive):
 * name, type, description, sell, income account, price, buy, expense account, cost, taxable.
 * Accounts are matched by name or code; a named account that doesn't exist is created.
 */
export function importItemsCSV(companyId: number, csvText: string): ItemImportResult {
  const rows = parseCSVObjects(csvText)
  if (rows.length === 0) throw new Error('No rows found in the CSV (need a header row).')

  return tx(() => {
    const result: ItemImportResult = { created: 0, skipped: 0, accountsCreated: 0, errors: [] }
    const existing = new Set(listItems(companyId, true).map((i) => i.name.toLowerCase()))

    const findOrCreateAccount = (label: string, type: AccountType): number | null => {
      if (!label.trim()) return null
      const accts = getAccounts(companyId, true)
      const found = accts.find(
        (a) => a.name.toLowerCase() === label.toLowerCase() || a.code.toLowerCase() === label.toLowerCase(),
      )
      if (found) return found.id
      const id = createAccountQuick(companyId, label.trim(), type)
      result.accountsCreated++
      return id
    }

    for (const row of rows) {
      const name = pick(row, ['name', 'item', 'item name', 'product/service', 'product'])
      if (!name) { result.skipped++; continue }
      if (existing.has(name.toLowerCase())) { result.skipped++; continue }

      try {
        const incomeLabel = pick(row, ['income account', 'income', 'sales account', 'revenue account'])
        const expenseLabel = pick(row, ['expense account', 'expense', 'cost account'])
        const sellCol = pick(row, ['sell', 'i sell this'])
        const buyCol = pick(row, ['buy', 'i buy this'])
        let sell = sellCol ? truthy(sellCol) : !!incomeLabel
        let buy = buyCol ? truthy(buyCol) : !!expenseLabel
        if (!sell && !buy) sell = true // default to a sellable item

        let incomeAccountId = findOrCreateAccount(incomeLabel, 'income')
        let expenseAccountId = findOrCreateAccount(expenseLabel, 'expense')
        if (sell && incomeAccountId == null) incomeAccountId = findOrCreateAccount('Sales Income', 'income')
        if (buy && expenseAccountId == null) expenseAccountId = findOrCreateAccount('Other Expenses', 'expense')

        const typeRaw = pick(row, ['type']).toLowerCase()
        const taxCol = pick(row, ['taxable', 'tax'])
        createItem(companyId, {
          name,
          type: typeRaw.includes('product') || typeRaw.includes('non') ? 'non_inventory' : 'service',
          description: pick(row, ['description', 'desc']) || null,
          sell,
          incomeAccountId,
          salesPriceCents: parseMoney(pick(row, ['price', 'sales price', 'rate', 'unit price'])),
          buy,
          expenseAccountId,
          costCents: parseMoney(pick(row, ['cost', 'unit cost'])),
          taxable: taxCol ? truthy(taxCol) : true,
        })
        existing.add(name.toLowerCase())
        result.created++
      } catch (e) {
        result.errors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    if (result.created === 0 && result.errors.length === 0 && result.skipped > 0) {
      // nothing imported but rows existed → likely all duplicates
    }
    return result
  })
}

/** Sales by item (income side), for entity/company reporting. */
export function salesByItem(companyId: number, startISO: string, endISO: string) {
  return all<{ item_id: number; name: string; qty: number; amount_cents: number }>(
    `SELECT i.id AS item_id, i.name AS name,
            COALESCE(SUM(dl.qty), 0) AS qty,
            COALESCE(SUM(dl.amount_cents), 0) AS amount_cents
     FROM document_lines dl
     JOIN items i ON i.id = dl.item_id
     JOIN documents d ON d.id = dl.document_id
     WHERE d.company_id = ? AND d.type IN ('invoice','sales_receipt') AND d.status != 'void'
       AND d.date >= ? AND d.date <= ?
     GROUP BY i.id, i.name
     ORDER BY amount_cents DESC`,
    [companyId, startISO, endISO],
  )
}
