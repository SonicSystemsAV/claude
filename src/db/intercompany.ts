import { all, insert, tx } from './db'
import { postTransaction, audit, getAccounts, getCompany } from './repo'
import { formatMoney } from '../lib/money'

export interface InterCompanyLink {
  id: number
  from_company_id: number
  from_txn_id: number | null
  to_company_id: number
  to_txn_id: number | null
  amount_cents: number
  date: string
  memo: string | null
  created_at: string
  from_name: string
  to_name: string
}

/** Suggest an inter-company "due from / due to" account for a company. */
export function suggestDueAccount(companyId: number, otherName: string, kind: 'from' | 'to'): number | null {
  const accts = getAccounts(companyId)
  const other = otherName.toLowerCase().split(/\s+/).filter((w) => w.length > 2)
  const nameHas = (n: string, words: string[]) => words.some((w) => n.includes(w))
  // prefer an account that mentions the other company
  const byOther = accts.find((a) => other.some((w) => a.name.toLowerCase().includes(w)))
  if (byOther) return byOther.id
  if (kind === 'from') {
    return accts.find((a) => a.type === 'asset' && nameHas(a.name.toLowerCase(), ['due from', 'receivable from', 'loan to', 'loans to', 'intercompany']))?.id ?? null
  }
  return accts.find((a) => a.type === 'liability' && nameHas(a.name.toLowerCase(), ['due to', 'payable to', 'loan from', 'notes payable', 'intercompany']))?.id ?? null
}

export function postInterCompany(p: {
  date: string
  amountCents: number
  memo?: string | null
  from: { companyId: number; accountId: number; dueAccountId: number }
  to: { companyId: number; accountId: number; dueAccountId: number }
}): number {
  if (p.amountCents <= 0) throw new Error('Amount must be greater than zero.')
  if (p.from.companyId === p.to.companyId) throw new Error('Pick two different companies.')
  return tx(() => {
    const fromName = getCompany(p.from.companyId)?.name ?? 'company'
    const toName = getCompany(p.to.companyId)?.name ?? 'company'
    // From company: it gives value out and records a receivable (Due from To).
    const fromTxn = postTransaction({
      company_id: p.from.companyId, date: p.date, memo: p.memo ?? `Inter-company → ${toName}`,
      source: 'intercompany',
      lines: [
        { account_id: p.from.dueAccountId, amount_cents: p.amountCents },
        { account_id: p.from.accountId, amount_cents: -p.amountCents },
      ],
    })
    // To company: it receives value / books the cost and records a payable (Due to From).
    const toTxn = postTransaction({
      company_id: p.to.companyId, date: p.date, memo: p.memo ?? `Inter-company ← ${fromName}`,
      source: 'intercompany',
      lines: [
        { account_id: p.to.accountId, amount_cents: p.amountCents },
        { account_id: p.to.dueAccountId, amount_cents: -p.amountCents },
      ],
    })
    const linkId = insert(
      `INSERT INTO intercompany_links (from_company_id, from_txn_id, to_company_id, to_txn_id, amount_cents, date, memo)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [p.from.companyId, fromTxn, p.to.companyId, toTxn, p.amountCents, p.date, p.memo ?? null],
    )
    audit(p.from.companyId, 'create', 'intercompany', linkId, `Inter-company to ${toName} — ${formatMoney(p.amountCents)}`)
    audit(p.to.companyId, 'create', 'intercompany', linkId, `Inter-company from ${fromName} — ${formatMoney(p.amountCents)}`)
    return linkId
  })
}

export function getInterCompanyLinks(companyId?: number): InterCompanyLink[] {
  const params: unknown[] = []
  let where = ''
  if (companyId) {
    where = 'WHERE l.from_company_id = ? OR l.to_company_id = ?'
    params.push(companyId, companyId)
  }
  return all<InterCompanyLink>(
    `SELECT l.*, fc.name AS from_name, tc.name AS to_name
     FROM intercompany_links l
     JOIN companies fc ON fc.id = l.from_company_id
     JOIN companies tc ON tc.id = l.to_company_id
     ${where} ORDER BY l.id DESC`,
    params,
  )
}
