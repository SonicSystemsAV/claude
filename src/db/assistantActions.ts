/**
 * AI assistant — proposal layer for the Transfer Review.
 *
 * The AI is the "brain"; the audited primitives in categoryRules.ts and
 * interCompanyReview.ts are the "hands". The AI never touches the ledger
 * directly: it returns a structured PROPOSAL (a list of actions), the user
 * reviews a checklist and approves, and only then do we call the same audited,
 * reversible primitives the manual buttons use.
 *
 * To avoid changing the (untestable-from-here) Tauri HTTP transport, the model
 * is asked to reply with a single JSON object matching the Proposal schema; we
 * parse it from the text response. One request/response, no tool-use loop.
 */

import type { AnthropicRequest, AssistantConfig } from './assistant'
import { DEFAULT_ASSISTANT_MODEL, getAssistantTransport } from './assistant'
import { getAccounts, getAccount, getCompany, companyOverview } from './repo'
import { formatMoney } from '../lib/money'
import { reclassAccount, addCategoryRule, countEntriesOnAccount } from './categoryRules'
import { addRule, needsReview, interCompanyLoanAccounts, type TransferReview, type ReviewedMovement } from './interCompanyReview'

export type ProposedAction =
  | { type: 'reclassify'; companyId: number; fromAccountId: number; toAccountId: number; remember: boolean; reason: string }
  | { type: 'ignore_account'; companyId: number | null; accountName: string; reason: string }
  | { type: 'ignore_recipient'; companyId: number | null; recipientName: string; reason: string }

export interface Proposal {
  message: string
  actions: ProposedAction[]
}

// ---------------------------------------------------------------------------
// Context + request
// ---------------------------------------------------------------------------

/** Compact snapshot for the AI: the active company's chart of accounts and the
 *  needs-review buckets (by offsetting account) it can act on. */
export function buildProposalContext(companyId: number, review: TransferReview): string {
  const company = getCompany(companyId)
  const cur = company?.base_currency ?? 'CAD'
  const accts = getAccounts(companyId)
  const lines: string[] = []
  lines.push(`COMPANY: ${company?.name ?? companyId} (base ${cur})`)
  lines.push('')
  lines.push('CHART OF ACCOUNTS (id · code · name · type) — only use these ids as reclassify targets:')
  for (const a of accts) lines.push(`  #${a.id} · ${a.code} · ${a.name} · ${a.type}`)
  lines.push('')

  // Needs-review movements for this company, grouped by offsetting account.
  type Bucket = { accountId: number | null; name: string; count: number; total: number; examples: string[] }
  const buckets = new Map<string, Bucket>()
  const open = review.movements.filter((m) => m.movement.companyId === companyId && needsReview(m))
  for (const m of open) {
    const leg = m.movement.otherLegs[0]
    const key = leg ? `#${leg.accountId}` : 'none'
    const name = leg ? `${leg.accountCode} ${leg.accountName}` : '(no offsetting account)'
    const b = buckets.get(key) ?? { accountId: leg?.accountId ?? null, name, count: 0, total: 0, examples: [] }
    b.count++
    b.total += Math.abs(m.movement.signedCents)
    if (b.examples.length < 3) {
      const ex = [m.movement.date, m.movement.contactName, m.movement.memo].filter(Boolean).join(' · ')
      if (ex) b.examples.push(ex)
    }
    buckets.set(key, b)
  }
  lines.push(`NEEDS-REVIEW BUCKETS (${open.length} open movements), grouped by offsetting account:`)
  for (const b of [...buckets.values()].sort((x, y) => y.count - x.count)) {
    lines.push(`  ${b.accountId != null ? `account #${b.accountId}` : 'NO ACCOUNT'} · ${b.name} · ${b.count} movements · ${formatMoney(b.total, cur)}`)
    for (const ex of b.examples) lines.push(`      e.g. ${ex}`)
  }
  if (review.recipients.length) {
    lines.push('')
    lines.push('RECURRING RECIPIENTS: ' + review.recipients.slice(0, 20).map((r) => `${r.name} (${r.count}×)`).join(', '))
  }
  // Cross-company balance picture, so the assistant can answer questions about
  // the OTHER companies (not just the active one) — headline figures plus the
  // inter-company / loan / due-to-from account balances that drive tie-outs.
  if (review.companies.length > 1) {
    lines.push('')
    lines.push('ALL COMPANIES — headline balances (for cross-company comparison; the active company above also has its full chart):')
    for (const co of review.companies) {
      const o = companyOverview(co.id)
      const cc = getCompany(co.id)?.base_currency ?? cur
      lines.push(`  ${co.name}: Cash ${formatMoney(o.cash, cc)} · A/R ${formatMoney(o.ar, cc)} · A/P ${formatMoney(o.ap, cc)} · Income ${formatMoney(o.income, cc)} · Expenses ${formatMoney(o.expense, cc)} · Net ${formatMoney(o.net, cc)}`)
    }
    const ic = interCompanyLoanAccounts(review.companies.map((c) => ({ id: c.id, name: c.name })))
    if (ic.length) {
      lines.push('')
      lines.push('INTER-COMPANY / LOAN / DUE-TO-FROM BALANCES across all companies (+ = receivable owed TO this company, − = payable this company owes):')
      for (const a of ic) {
        lines.push(`  ${a.companyName} · ${a.accountName}${a.otherCompany ? ` (re ${a.otherCompany})` : ''} · ${formatMoney(a.balanceCents, cur)}`)
      }
    }
  }

  if (review.pairs.length) {
    lines.push('')
    lines.push('INTER-COMPANY TIE-OUTS (all companies; LOAN DIFF should be 0 — non-zero means the two books disagree):')
    for (const p of review.pairs) {
      lines.push(`  ${p.aName} ↔ ${p.bName}: ${p.aName} ${formatMoney(p.loanPerA, cur)} / ${p.bName} ${formatMoney(p.loanPerB, cur)} · DIFF ${formatMoney(p.loanDiff, cur)}${p.balanced ? '' : ' ***OFF***'}`)
    }
  }
  return lines.join('\n')
}

const PROPOSAL_SYSTEM = [
  'You are the bookkeeping assistant inside Sonic the Ledgerhog, helping an owner clean up a double-entry ledger.',
  'You NEVER change the books directly. You propose actions the user approves.',
  'Given the context (chart of accounts + needs-review buckets), propose how to handle the movements the user asks about.',
  '',
  'Reply with ONE JSON object and NOTHING else (no markdown, no text before or after). Schema:',
  '{',
  '  "message": "<short plain-English explanation of what you propose and why>",',
  '  "actions": [',
  '    {"type":"reclassify","companyId":<id>,"fromAccountId":<id>,"toAccountId":<id>,"remember":true|false,"reason":"<why>"},',
  '    {"type":"ignore_account","companyId":<id or null>,"accountName":"<exact account name>","reason":"<why>"},',
  '    {"type":"ignore_recipient","companyId":<id or null>,"recipientName":"<exact name>","reason":"<why>"}',
  '  ]',
  '}',
  '',
  'Rules:',
  '- You can SEE all companies: each company\'s headline balances (cash, A/R, A/P, income, expenses, net), the inter-company / loan / due-to-from balances, and the tie-outs. Use these to answer cross-company questions and to say which company\'s balance sheet is misrecording a transfer. You only have the FULL chart of accounts for the active company, so you can only propose reclassify actions within it; to fix another company, tell the user to switch to it first.',
  '- Use ONLY account ids that appear in the chart of accounts. Never invent ids, names, or figures.',
  '- "reclassify" moves every entry from fromAccountId to toAccountId (a pure, balanced reclass). Set "remember":true to save it as a standing rule that re-applies to future imports.',
  '- Prefer reclassify for miscoded expenses/cash (e.g. undocumented ATM cash to a shareholder-loan account). Prefer ignore for ordinary recurring payments that just need to stop being flagged (mortgages, utilities).',
  '- Be conservative: only propose what the context supports. If unsure, put fewer actions and explain in "message".',
  '- If no action is warranted, return an empty "actions" array and explain in "message".',
].join('\n')

export function buildProposalRequest(companyId: number, userMessage: string, review: TransferReview, config: AssistantConfig): AnthropicRequest {
  const context = buildProposalContext(companyId, review)
  return {
    model: config.model ?? DEFAULT_ASSISTANT_MODEL,
    max_tokens: 4096,
    thinking: { type: 'adaptive' },
    system: `${PROPOSAL_SYSTEM}\n\n===== CONTEXT =====\n${context}\n===== END CONTEXT =====`,
    messages: [{ role: 'user', content: userMessage }],
  }
}

// ---------------------------------------------------------------------------
// Parse + apply
// ---------------------------------------------------------------------------

/** Pull the JSON object out of the model's reply (tolerates code fences / stray text). */
export function parseProposal(text: string): Proposal {
  let raw = text.trim()
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) raw = fence[1].trim()
  if (raw[0] !== '{') {
    const s = raw.indexOf('{')
    const e = raw.lastIndexOf('}')
    if (s >= 0 && e > s) raw = raw.slice(s, e + 1)
  }
  let obj: unknown
  try {
    obj = JSON.parse(raw)
  } catch {
    throw new Error('The assistant did not return a usable plan. Try rephrasing.')
  }
  const o = obj as { message?: unknown; actions?: unknown }
  const message = typeof o.message === 'string' ? o.message : ''
  const actions: ProposedAction[] = Array.isArray(o.actions)
    ? (o.actions as ProposedAction[]).filter((a) => a && typeof a === 'object' && typeof (a as ProposedAction).type === 'string')
    : []
  return { message, actions }
}

/** A human label + impact estimate for an action, for the approval checklist. */
export function describeAction(a: ProposedAction): { label: string; impact: string } {
  if (a.type === 'reclassify') {
    const from = a.fromAccountId
    const to = a.toAccountId
    const n = countEntriesOnAccount(from)
    return {
      label: `Reclassify ${accountLabel(from)} → ${accountLabel(to)}${a.remember ? ' (remember)' : ''}`,
      impact: `${n} entr${n === 1 ? 'y' : 'ies'}`,
    }
  }
  if (a.type === 'ignore_account') return { label: `Always ignore account “${a.accountName}”`, impact: 'rule' }
  return { label: `Always ignore recipient “${a.recipientName}”`, impact: 'rule' }
}

function accountLabel(id: number): string {
  const a = getAccount(id)
  return a ? `${a.code} ${a.name}` : `#${id}`
}

/** Apply one approved action via the audited primitives. Returns a result line. */
export function applyProposedAction(a: ProposedAction): string {
  if (a.type === 'reclassify') {
    if (a.remember) {
      const { moved } = addCategoryRule(a.fromAccountId, a.toAccountId, 'ai', a.reason)
      return `Reclassified ${moved} entries and saved the rule.`
    }
    const moved = reclassAccount(a.fromAccountId, a.toAccountId)
    return `Reclassified ${moved} entries.`
  }
  if (a.type === 'ignore_account') {
    addRule('account', a.accountName, a.companyId ?? undefined, a.reason)
    return `Added ignore rule for account “${a.accountName}”.`
  }
  addRule('recipient', a.recipientName, a.companyId ?? undefined, a.reason)
  return `Added ignore rule for recipient “${a.recipientName}”.`
}

/** Build + send + parse a proposal. UI calls this. */
export async function runProposal(companyId: number, userMessage: string, review: TransferReview, config: AssistantConfig): Promise<Proposal> {
  if (!config.apiKey.trim()) throw new Error('Add your Anthropic API key in Settings → AI assistant first.')
  const req = buildProposalRequest(companyId, userMessage, review, config)
  const resp = await getAssistantTransport().send(req, config.apiKey, config.workspaceId)
  return parseProposal(resp.text)
}

export type { ReviewedMovement }
