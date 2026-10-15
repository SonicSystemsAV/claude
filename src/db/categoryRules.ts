/**
 * Reclassification ("recategorize") primitives + remembered rules.
 *
 * A reclass moves the entries that currently hit account A over to account B,
 * within one company. It only ever changes an entry's `account_id` — never the
 * amount — so every transaction stays balanced by construction. This is the
 * safe, auditable "hand" that the review UI's recategorize actions and (next)
 * the AI assistant's approved proposals both call.
 *
 * A category_rule remembers "A → B" so you can re-run it after future imports
 * (the "apply going forward" the owner asked for). Applying a rule is the same
 * reclass, logged to the audit trail, and reversible by swapping the two
 * accounts.
 */

import { all, one, run, insert, tx } from './db'
import { audit, getAccount } from './repo'

export interface CategoryRule {
  id: number
  company_id: number
  from_account_id: number
  to_account_id: number
  source: 'user' | 'ai'
  note: string | null
  created_at: string
  /** Joined for display. */
  from_name?: string
  to_name?: string
}

function sameCompany(aId: number, bId: number): { company_id: number; aName: string; bName: string } {
  const a = getAccount(aId)
  const b = getAccount(bId)
  if (!a || !b) throw new Error('Account not found.')
  if (a.company_id !== b.company_id) throw new Error('Both accounts must belong to the same company.')
  return { company_id: a.company_id, aName: a.name, bName: b.name }
}

/** How many live entries currently hit `accountId` (preview before reclassing). */
export function countEntriesOnAccount(accountId: number): number {
  const r = one<{ n: number }>(
    `SELECT COUNT(*) AS n
       FROM entries e JOIN transactions t ON t.id = e.transaction_id
      WHERE e.account_id = ? AND t.deleted = 0`,
    [accountId],
  )
  return r?.n ?? 0
}

/**
 * Move every live entry on `fromAccountId` to `toAccountId` (one company).
 * Returns the number of entries moved. Balance is preserved — only the account
 * changes. Reversible by calling again with the accounts swapped.
 */
export function reclassAccount(fromAccountId: number, toAccountId: number): number {
  if (fromAccountId === toAccountId) return 0
  const { company_id, aName, bName } = sameCompany(fromAccountId, toAccountId)
  let n = 0
  tx(() => {
    n = countEntriesOnAccount(fromAccountId)
    if (n === 0) return
    run(
      `UPDATE entries SET account_id = ?
        WHERE account_id = ?
          AND transaction_id IN (SELECT id FROM transactions WHERE company_id = ? AND deleted = 0)`,
      [toAccountId, fromAccountId, company_id],
    )
    audit(company_id, 'reclassify', 'account', toAccountId, `Reclassified ${n} entr${n === 1 ? 'y' : 'ies'}: ${aName} → ${bName}`)
  })
  return n
}

/** Reclassify a single entry (one row's offsetting leg) to another account. */
export function reclassEntry(entryId: number, toAccountId: number): void {
  const e = one<{ account_id: number; transaction_id: number }>('SELECT account_id, transaction_id FROM entries WHERE id = ?', [entryId])
  if (!e) throw new Error('Entry not found.')
  if (e.account_id === toAccountId) return
  const from = getAccount(e.account_id)
  const to = getAccount(toAccountId)
  if (!to) throw new Error('Target account not found.')
  const t = one<{ company_id: number }>('SELECT company_id FROM transactions WHERE id = ?', [e.transaction_id])
  if (!t) throw new Error('Transaction not found.')
  if (to.company_id !== t.company_id) throw new Error('Target account is in a different company.')
  tx(() => {
    run('UPDATE entries SET account_id = ? WHERE id = ?', [toAccountId, entryId])
    audit(t.company_id, 'reclassify', 'entry', entryId, `Reclassified one entry: ${from?.name ?? '?'} → ${to.name}`)
  })
}

// ---------------------------------------------------------------------------
// Remembered rules
// ---------------------------------------------------------------------------

export function loadCategoryRules(companyId?: number): CategoryRule[] {
  const where = companyId ? 'WHERE r.company_id = ?' : ''
  const params = companyId ? [companyId] : []
  return all<CategoryRule>(
    `SELECT r.*, fa.name AS from_name, ta.name AS to_name
       FROM category_rules r
       JOIN accounts fa ON fa.id = r.from_account_id
       JOIN accounts ta ON ta.id = r.to_account_id
       ${where} ORDER BY r.created_at DESC`,
    params,
  )
}

/** Store an A→B rule AND apply it now (backward). Returns entries moved. */
export function addCategoryRule(fromAccountId: number, toAccountId: number, source: 'user' | 'ai' = 'user', note?: string): { ruleId: number; moved: number } {
  const { company_id } = sameCompany(fromAccountId, toAccountId)
  let ruleId = 0
  tx(() => {
    const existing = one<{ id: number }>(
      'SELECT id FROM category_rules WHERE company_id = ? AND from_account_id = ? AND to_account_id = ?',
      [company_id, fromAccountId, toAccountId],
    )
    ruleId = existing?.id ?? insert(
      'INSERT INTO category_rules (company_id, from_account_id, to_account_id, source, note) VALUES (?, ?, ?, ?, ?)',
      [company_id, fromAccountId, toAccountId, source, note ?? null],
    )
  })
  const moved = reclassAccount(fromAccountId, toAccountId)
  return { ruleId, moved }
}

/** Re-run a stored rule (e.g. after a new import). Returns entries moved. */
export function applyCategoryRule(rule: CategoryRule): number {
  return reclassAccount(rule.from_account_id, rule.to_account_id)
}

export function deleteCategoryRule(id: number): void {
  tx(() => run('DELETE FROM category_rules WHERE id = ?', [id]))
}
