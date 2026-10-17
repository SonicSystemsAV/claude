/**
 * Unified conversational assistant — one agent, available everywhere (the
 * floating widget), that can both ANSWER questions about the whole group of
 * companies and PROPOSE changes the owner approves. It replaces the three old
 * separate AI surfaces (the read-only widget + the Transfer Review and Review
 * Center proposal panels).
 *
 * Each turn the model gets the full cross-company context and the conversation
 * so far, replies in plain English, and — when it wants to change the books —
 * appends a fenced ```actions block (JSON array). The UI shows those as an
 * approval checklist; nothing applies until the owner says so, and every
 * applied action goes through the same audited, reversible primitives the
 * manual buttons use.
 */

import {
  type AnthropicMessage,
  type AnthropicRequest,
  type AssistantConfig,
  DEFAULT_ASSISTANT_MODEL,
  getAssistantTransport,
} from './assistant'
import { listCompanies, companyOverview, getAccounts, displayBalance } from './repo'
import { interCompanyTieOuts, interCompanyPairDetail } from './interCompanyReview'
import { runHealthChecks, type Issue } from './healthChecks'
import { formatMoney } from '../lib/money'
import type { ProposedAction } from './assistantActions'

export interface AgentReply {
  /** Plain-English message to show (the actions block stripped out). */
  text: string
  /** Proposed actions parsed from the reply, if any. */
  actions: ProposedAction[]
}

/** Full cross-company snapshot: every company's headline + chart of accounts
 *  (with ids and balances), the inter-company tie-outs and their account
 *  breakdown, and the open health-check issues. */
export function buildAgentContext(): string {
  const companies = listCompanies()
  const lines: string[] = []

  lines.push('===== COMPANIES =====')
  for (const c of companies) {
    const cur = c.base_currency || 'CAD'
    const o = companyOverview(c.id)
    lines.push(`COMPANY #${c.id}: ${c.name} (base ${cur})`)
    lines.push(`  Cash ${formatMoney(o.cash, cur)} · Income ${formatMoney(o.income, cur)} · Expenses ${formatMoney(o.expense, cur)} · Net ${formatMoney(o.net, cur)} · A/R ${formatMoney(o.ar, cur)} · A/P ${formatMoney(o.ap, cur)}`)
    lines.push('  CHART OF ACCOUNTS (id · code · name · type · balance) — use these ids for actions; from/to must share a company:')
    for (const a of getAccounts(c.id)) {
      lines.push(`    #${a.id} · ${a.code} · ${a.name} · ${a.type} · ${formatMoney(displayBalance(a), cur)}`)
    }
    lines.push('')
  }

  const pairs = interCompanyTieOuts(companies.map((c) => ({ id: c.id, name: c.name })))
  if (pairs.length) {
    lines.push('===== INTER-COMPANY TIE-OUTS (loan diff should be 0; non-zero = the two books disagree) =====')
    for (const p of pairs) {
      lines.push(`${p.aName} ↔ ${p.bName}: ${p.aName} ${formatMoney(p.loanPerA, 'CAD')} / ${p.bName} ${formatMoney(p.loanPerB, 'CAD')} · DIFF ${formatMoney(p.loanDiff, 'CAD')}${p.balanced ? '' : ' ***OFF***'}`)
      if (!p.balanced) {
        const d = interCompanyPairDetail(p.aId, p.bId)
        if (d) {
          const side = (name: string, accts: typeof d.aAccounts) =>
            `    ${name}: ` + (accts.length ? accts.map((x) => `${x.name} ${formatMoney(x.balanceCents, 'CAD')}${x.namesOther ? '✓' : '(unnamed)'}`).join('; ') : '(no loan accounts)')
          lines.push(side(d.aName, d.aAccounts))
          lines.push(side(d.bName, d.bAccounts))
        }
      }
    }
    lines.push('')
  }

  let issues: Issue[]
  try { issues = runHealthChecks() } catch { issues = [] }
  if (issues.length) {
    lines.push('===== OPEN ISSUES (Review Center, most severe first) =====')
    for (const i of issues.slice(0, 40)) {
      lines.push(`  [${i.severity}] ${i.companyName} · ${i.category} · ${i.title}${i.amountCents > 0 ? ` · ${formatMoney(i.amountCents, i.currency)}` : ''}`)
    }
  }
  return lines.join('\n')
}

const AGENT_SYSTEM = [
  'You are the single built-in assistant inside Sonic the Ledgerhog, a local-first double-entry bookkeeping app. You help the owner understand and FIX a group of related companies\' books, conversationally.',
  'You can see ALL companies at once (context below) and you keep the conversation going — ask clarifying questions, explain, then act when the owner is ready.',
  '',
  'You do not change anything directly. When you want to change the books, append ONE fenced code block at the very end of your message, exactly like:',
  '```actions',
  '[ {"type":"...", ...}, {"type":"...", ...} ]',
  '```',
  'Everything before that block is shown to the owner as your message; the block is turned into an approval checklist. Omit the block entirely when you are only answering or asking.',
  '',
  'Action types (ids and account ids must come from the context; from/to accounts must be in the SAME company):',
  '  {"type":"reclassify","companyId":N,"fromAccountId":N,"toAccountId":N,"remember":true|false,"reason":"…"}  — move every entry from one account to another (balanced). remember=true saves a standing rule.',
  '  {"type":"merge_account","companyId":N,"fromAccountId":N,"toAccountId":N,"reason":"…"}  — combine a duplicate account into another (moves entries, archives the source).',
  '  {"type":"rename_account","companyId":N,"accountId":N,"newCode":"2230","newName":"…","newType":"asset|liability|equity|income|expense","reason":"…"}  — renumber/rename/retype (any field optional).',
  '  {"type":"ignore_account","companyId":N or null,"accountName":"exact name","reason":"…"}  — stop flagging movements coded to this account in Transfer Review.',
  '  {"type":"ignore_recipient","companyId":N or null,"recipientName":"exact name","reason":"…"}  — stop flagging this payee.',
  '',
  'Rules:',
  '- Never invent ids, account names, or figures — use only what is in the context.',
  '- You can reclassify, merge, rename, and set ignore rules. You CANNOT yet post new journal entries, so you cannot create a missing mirror entry or change an amount — if that is what is needed (e.g. an inter-company balance that is simply absent on one side), say so plainly and explain what the owner should post, rather than inventing an action.',
  '- Money is integer-exact and already balanced; reclass/merge only move entries between accounts, never change amounts.',
  '- Be concise, show the figures you used, and propose a few conservative actions at a time rather than a huge batch. If unsure, ask.',
].join('\n')

/** Pull the ```actions block out of the reply; return prose + parsed actions. */
export function parseAgentReply(text: string): AgentReply {
  const fence = text.match(/```actions\s*([\s\S]*?)```/i)
  let actions: ProposedAction[] = []
  let prose = text
  if (fence) {
    prose = text.slice(0, fence.index).trim() + text.slice(fence.index! + fence[0].length).trim()
    try {
      const parsed = JSON.parse(fence[1].trim())
      if (Array.isArray(parsed)) {
        actions = parsed.filter((a) => a && typeof a === 'object' && typeof a.type === 'string')
      }
    } catch {
      // Leave the block visible in prose if it didn't parse, so nothing is hidden.
      prose = text
    }
  }
  return { text: prose.trim(), actions }
}

export function buildAgentRequest(history: AnthropicMessage[], config: AssistantConfig): AnthropicRequest {
  const context = buildAgentContext()
  return {
    model: config.model ?? DEFAULT_ASSISTANT_MODEL,
    max_tokens: 4096,
    thinking: { type: 'adaptive' },
    system: `${AGENT_SYSTEM}\n\n===== LIVE CONTEXT (all companies) =====\n${context}\n===== END CONTEXT =====`,
    messages: history,
  }
}

/** Send the conversation + live context; return the assistant's prose + actions. */
export async function runAgent(history: AnthropicMessage[], config: AssistantConfig): Promise<AgentReply> {
  if (!config.apiKey.trim()) throw new Error('Add your Anthropic API key in Settings → AI assistant first.')
  const req = buildAgentRequest(history, config)
  const resp = await getAssistantTransport().send(req, config.apiKey, config.workspaceId)
  return parseAgentReply(resp.text)
}
