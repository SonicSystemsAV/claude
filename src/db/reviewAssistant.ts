/**
 * Review Center assistant — the AI's cross-company home base.
 *
 * The Transfer Review "Ask AI" panel (assistantActions.ts) is scoped to one
 * company and the transfer queue. This module is the same propose → approve →
 * apply loop, but seeded from the whole Review Center: every company's chart of
 * accounts, the suspense / uncategorized buckets that are actually fixable by a
 * reclass, the inter-company tie-outs, and the health-check issue list itself.
 *
 * It reuses the shared action types and the audited apply primitives from
 * assistantActions.ts unchanged — a `reclassify` action is keyed by account id,
 * so it already works in whichever company those accounts live in. Only the
 * context and the system prompt are new here.
 */

import type { AnthropicRequest, AssistantConfig } from './assistant'
import { DEFAULT_ASSISTANT_MODEL, getAssistantTransport } from './assistant'
import { all } from './db'
import { getAccounts } from './repo'
import { formatMoney } from '../lib/money'
import { parseProposal, type Proposal } from './assistantActions'
import type { Issue } from './healthChecks'

const RE_VAGUE = /\b(uncategor|ask my accountant|suspense|to be (determined|classified)|unknown|unapplied cash|undeposited)\b/i

interface Co {
  id: number
  name: string
  currency: string
}

function listCos(): Co[] {
  return all<{ id: number; name: string; base_currency: string }>(
    'SELECT id, name, base_currency FROM companies ORDER BY name',
  ).map((c) => ({ id: c.id, name: c.name, currency: c.base_currency || 'CAD' }))
}

/** Entries sitting on a suspense / uncategorized account in one company — the
 *  reclass sources the AI can actually act on, with examples for context. */
function suspenseBuckets(co: Co): string[] {
  const lines: string[] = []
  const vague = getAccounts(co.id).filter((a) => RE_VAGUE.test(a.name))
  for (const a of vague) {
    const agg = all<{ n: number; total: number }>(
      `SELECT COUNT(*) AS n, SUM(ABS(e.amount_cents)) AS total
         FROM entries e JOIN transactions t ON t.id = e.transaction_id
        WHERE e.account_id = ? AND t.deleted = 0 AND t.status = 'posted'`,
      [a.id],
    )[0]
    if (!agg || agg.n === 0) continue
    lines.push(`    account #${a.id} "${a.code} ${a.name}" · ${agg.n} entries · ${formatMoney(agg.total, co.currency)}`)
    const examples = all<{ date: string; memo: string | null; contact: string | null }>(
      `SELECT t.date AS date, t.memo AS memo, c.name AS contact
         FROM entries e JOIN transactions t ON t.id = e.transaction_id
         LEFT JOIN contacts c ON c.id = t.contact_id
        WHERE e.account_id = ? AND t.deleted = 0 AND t.status = 'posted'
        ORDER BY t.date DESC LIMIT 4`,
      [a.id],
    )
    for (const ex of examples) {
      const bits = [ex.date, ex.contact, ex.memo].filter(Boolean).join(' · ')
      if (bits) lines.push(`        e.g. ${bits}`)
    }
  }
  return lines
}

/** Compact, cross-company snapshot for the Review Center assistant. */
export function buildReviewContext(issues: Issue[]): string {
  const cos = listCos()
  const lines: string[] = []

  lines.push('OPEN ISSUES (the Review Center worklist, most severe first):')
  if (!issues.length) {
    lines.push('  (none — every health check passed)')
  } else {
    for (const i of issues) {
      lines.push(
        `  [${i.severity}] ${i.companyName} · ${i.category} · ${i.title}` +
          (i.amountCents > 0 ? ` · ${formatMoney(i.amountCents, i.currency)}` : ''),
      )
    }
  }
  lines.push('')

  for (const co of cos) {
    lines.push(`===== COMPANY #${co.id}: ${co.name} (base ${co.currency}) =====`)
    lines.push('CHART OF ACCOUNTS (id · code · name · type) — only use these ids as reclassify targets, and from/to must be the SAME company:')
    for (const a of getAccounts(co.id)) lines.push(`  #${a.id} · ${a.code} · ${a.name} · ${a.type}`)
    const buckets = suspenseBuckets(co)
    if (buckets.length) {
      lines.push('  SUSPENSE / UNCATEGORIZED postings you can reclassify away:')
      lines.push(...buckets)
    }
    lines.push('')
  }

  return lines.join('\n')
}

const REVIEW_SYSTEM = [
  'You are the bookkeeping assistant inside Sonic the Ledgerhog, working the Review Center — the cross-company worklist of everything that needs fixing across ALL of the owner\'s companies.',
  'You NEVER change the books directly. You propose actions the owner approves with a checklist; only then are they applied.',
  'You can act across companies in a single plan — each action names its companyId.',
  '',
  'Reply with ONE JSON object and NOTHING else (no markdown, no text before or after). Schema:',
  '{',
  '  "message": "<short plain-English explanation of what you propose and why; if some issues can\'t be fixed by these actions, say which and tell the owner where to handle them>",',
  '  "actions": [',
  '    {"type":"reclassify","companyId":<id>,"fromAccountId":<id>,"toAccountId":<id>,"remember":true|false,"reason":"<why>"},',
  '    {"type":"ignore_account","companyId":<id or null>,"accountName":"<exact account name>","reason":"<why>"},',
  '    {"type":"ignore_recipient","companyId":<id or null>,"recipientName":"<exact name>","reason":"<why>"}',
  '  ]',
  '}',
  '',
  'Rules:',
  '- Use ONLY account ids that appear in that company\'s chart of accounts. fromAccountId and toAccountId MUST belong to the same company as companyId. Never invent ids, names, or figures.',
  '- "reclassify" moves every entry from fromAccountId to toAccountId (a pure, balanced reclass). Set "remember":true to save it as a standing rule that re-applies to future imports.',
  '- The actions you can apply are reclassify and ignore only. You CANNOT delete, merge, edit amounts, or re-date. For issues that need those (unbalanced transactions, suspected duplicates, future-dated entries, inter-company tie-outs), do NOT invent an action — explain in "message" what the owner should check and point them to the issue\'s fix link.',
  '- Be conservative and specific: only propose what the context supports. Prefer moving a clearly-identifiable suspense bucket to the obviously-correct account. If unsure, propose fewer actions and explain.',
  '- If no action is warranted, return an empty "actions" array and give your advice in "message".',
].join('\n')

export function buildReviewRequest(userMessage: string, issues: Issue[], config: AssistantConfig): AnthropicRequest {
  const context = buildReviewContext(issues)
  return {
    model: config.model ?? DEFAULT_ASSISTANT_MODEL,
    max_tokens: 4096,
    thinking: { type: 'adaptive' },
    system: `${REVIEW_SYSTEM}\n\n===== CONTEXT =====\n${context}\n===== END CONTEXT =====`,
    messages: [{ role: 'user', content: userMessage }],
  }
}

/** Build + send + parse a cross-company proposal from the Review Center. */
export async function runReviewProposal(userMessage: string, issues: Issue[], config: AssistantConfig): Promise<Proposal> {
  if (!config.apiKey.trim()) throw new Error('Add your Anthropic API key in Settings → AI assistant first.')
  const req = buildReviewRequest(userMessage, issues, config)
  const resp = await getAssistantTransport().send(req, config.apiKey, config.workspaceId)
  return parseProposal(resp.text)
}
