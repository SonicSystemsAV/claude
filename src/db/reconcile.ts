import { all, one, insert, run, tx } from './db'
import { audit } from './repo'
import type { BankTxn } from './types'

export interface Reconciliation {
  id: number
  company_id: number
  account_id: number
  statement_date: string
  ending_balance_cents: number
  cleared_count: number
  status: 'completed' | 'reopened'
  created_at: string
  reopened_at: string | null
}

/** Sum of all already-reconciled bank lines for an account (the opening balance of a new rec). */
export function reconciledBalance(companyId: number, accountId: number): number {
  const r = one<{ bal: number }>(
    'SELECT COALESCE(SUM(amount_cents), 0) AS bal FROM bank_transactions WHERE company_id = ? AND account_id = ? AND reconciliation_id IS NOT NULL',
    [companyId, accountId],
  )
  return r?.bal ?? 0
}

/** Bank lines not yet reconciled (excludes ignored), up to and including a statement date. */
export function unreconciledBankTxns(companyId: number, accountId: number, onOrBefore?: string): BankTxn[] {
  const params: unknown[] = [companyId, accountId]
  let where = "company_id = ? AND account_id = ? AND reconciliation_id IS NULL AND status != 'ignored'"
  if (onOrBefore) {
    where += ' AND date <= ?'
    params.push(onOrBefore)
  }
  return all<BankTxn>(`SELECT * FROM bank_transactions WHERE ${where} ORDER BY date, id`, params)
}

export function finishReconciliation(p: {
  companyId: number
  accountId: number
  statementDate: string
  endingBalanceCents: number
  clearedIds: number[]
}): number {
  if (p.clearedIds.length === 0) throw new Error('Select at least one line to reconcile.')
  return tx(() => {
    const reconId = insert(
      `INSERT INTO reconciliations (company_id, account_id, statement_date, ending_balance_cents, cleared_count)
       VALUES (?, ?, ?, ?, ?)`,
      [p.companyId, p.accountId, p.statementDate, p.endingBalanceCents, p.clearedIds.length],
    )
    const ph = p.clearedIds.map(() => '?').join(',')
    run(`UPDATE bank_transactions SET reconciliation_id = ? WHERE id IN (${ph})`, [reconId, ...p.clearedIds])
    audit(
      p.companyId,
      'create',
      'reconciliation',
      reconId,
      `Reconciled ${p.clearedIds.length} line(s) to statement ${p.statementDate}`,
    )
    return reconId
  })
}

export function getReconciliations(companyId: number, accountId?: number): Reconciliation[] {
  const params: unknown[] = [companyId]
  let where = 'company_id = ?'
  if (accountId) {
    where += ' AND account_id = ?'
    params.push(accountId)
  }
  return all<Reconciliation>(
    `SELECT * FROM reconciliations WHERE ${where} ORDER BY id DESC`,
    params,
  )
}

/** Deliberately reopen a reconciliation: un-reconcile its lines and stamp it for re-reconciling. */
export function reopenReconciliation(reconId: number): void {
  tx(() => {
    const r = one<Reconciliation>('SELECT * FROM reconciliations WHERE id = ?', [reconId])
    if (!r) return
    run("UPDATE reconciliations SET status = 'reopened', reopened_at = datetime('now') WHERE id = ?", [reconId])
    run('UPDATE bank_transactions SET reconciliation_id = NULL WHERE reconciliation_id = ?', [reconId])
    audit(
      r.company_id,
      'update',
      'reconciliation',
      reconId,
      `Reopened reconciliation of ${r.statement_date} — ${r.cleared_count} line(s) un-reconciled for re-reconciling`,
    )
  })
}
