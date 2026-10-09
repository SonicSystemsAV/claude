/**
 * In-app Claude assistant — backend stub.
 *
 * Lets a user ask natural-language questions about THEIR local books
 * ("what did I spend on fuel last quarter?", "which invoices are overdue?").
 * It reads the local ledger read-only, builds a compact context, and sends it
 * to Claude with the user's own Anthropic API key (supplied at runtime, never
 * committed or bundled).
 *
 * Transport: the Anthropic API sends no CORS headers and the key must stay off
 * the web context, so in the desktop build the request goes through Tauri's
 * Rust HTTP (same constraint as QuickBooks/Square — see
 * docs/QUICKBOOKS_AND_DATA_FILES.md §B4). The browser dev build has a direct
 * fetch transport for local experimentation only; it will hit CORS and exposes
 * the key to the page, so it is clearly marked dev-only.
 *
 * This is a stub: the request/response shapes and the ledger-context builder
 * are real and typechecked; the live Tauri transport is a TODO.
 */

import { isTauri } from '../lib/desktop'
import { getCompany, trialBalance, companyOverview, getTransactions } from './repo'
import { getTaxCodes } from './documents'
import { formatMoney } from '../lib/money'

// Default to the current Opus; the user can pick a cheaper model in config.
export const DEFAULT_ASSISTANT_MODEL = 'claude-opus-5-5'

/** Per-device localStorage keys for the assistant's runtime config. */
export const ASSISTANT_LS_KEYS = {
  apiKey: 'sonic.assistant.apiKey',
  model: 'sonic.assistant.model',
  workspaceId: 'sonic.assistant.workspaceId',
} as const

/** Read the saved assistant config from localStorage (empty apiKey if unset/blocked). */
export function loadAssistantConfig(): AssistantConfig {
  const read = (k: string): string => {
    try { return localStorage.getItem(k) ?? '' } catch { return '' }
  }
  return {
    apiKey: read(ASSISTANT_LS_KEYS.apiKey),
    workspaceId: read(ASSISTANT_LS_KEYS.workspaceId) || undefined,
    model: read(ASSISTANT_LS_KEYS.model) || DEFAULT_ASSISTANT_MODEL,
  }
}

export interface AssistantConfig {
  /** The user's Anthropic API key (runtime only; store per-device, never in the book file). */
  apiKey: string
  /** Optional Anthropic workspace id — required for org-scoped keys, ignored for workspace-scoped keys. */
  workspaceId?: string
  /** Model id; defaults to DEFAULT_ASSISTANT_MODEL. */
  model?: string
  /** Max transactions to include in the context (keeps token use bounded). */
  maxTransactions?: number
}

// ---- Minimal Anthropic Messages API shapes (dependency-free) --------------

export interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface AnthropicRequest {
  model: string
  max_tokens: number
  system?: string
  thinking?: { type: 'adaptive' }
  messages: AnthropicMessage[]
}

export interface AnthropicResponse {
  /** Concatenated text of the assistant's reply. */
  text: string
  /** Why generation stopped, if the transport surfaces it. */
  stopReason?: string | null
}

/** Pluggable transport so desktop (Tauri Rust) and dev (fetch) differ only here. */
export interface AssistantTransport {
  send(req: AnthropicRequest, apiKey: string, workspaceId?: string): Promise<AnthropicResponse>
}

// ---- Ledger context --------------------------------------------------------

/**
 * Build a compact, read-only snapshot of a company's books for the model:
 * identity, headline figures, trial balance, and recent transactions. Amounts
 * are formatted in the company's base currency so the model never has to guess.
 */
export function buildLedgerContext(companyId: number, maxTransactions = 50): string {
  const company = getCompany(companyId)
  if (!company) throw new Error('Company not found.')
  const cur = company.base_currency
  const o = companyOverview(companyId)
  const tb = trialBalance(companyId)
  const txns = getTransactions(companyId, { limit: maxTransactions })

  const lines: string[] = []
  lines.push(`COMPANY: ${company.name}${company.legal_name && company.legal_name !== company.name ? ` (${company.legal_name})` : ''}`)
  lines.push(`BASE CURRENCY: ${cur}`)
  lines.push('')
  lines.push('HEADLINE (current):')
  lines.push(`  Cash: ${formatMoney(o.cash, cur)} · Income: ${formatMoney(o.income, cur)} · Expenses: ${formatMoney(o.expense, cur)} · Net: ${formatMoney(o.net, cur)}`)
  lines.push(`  A/R: ${formatMoney(o.ar, cur)} · A/P: ${formatMoney(o.ap, cur)} · Unreconciled bank items: ${o.unreconciled}`)
  lines.push('')
  lines.push('TRIAL BALANCE (code · name · debit · credit):')
  for (const r of tb) {
    lines.push(`  ${r.account.code} · ${r.account.name} · ${formatMoney(r.debit, cur)} · ${formatMoney(r.credit, cur)}`)
  }
  lines.push('')
  const taxCodes = getTaxCodes(companyId)
  if (taxCodes.length) {
    lines.push(`TAX CODES: ${taxCodes.map((t) => `${t.name} (${(t.rate * 100).toFixed(2)}%)`).join(', ')}`)
    lines.push('')
  }
  lines.push(`RECENT TRANSACTIONS (latest ${txns.length}):`)
  for (const t of txns) {
    const total = t.entries.reduce((s, e) => s + (e.amount_cents > 0 ? e.amount_cents : 0), 0)
    const accts = t.entries.map((e) => e.account_name).join(' / ')
    lines.push(`  ${t.date} · ${formatMoney(total, cur)} · ${t.memo ?? ''}${t.contact_name ? ` · ${t.contact_name}` : ''} · [${accts}]`)
  }
  return lines.join('\n')
}

const SYSTEM_PROMPT = [
  'You are the built-in accounting assistant inside Sonic the Ledgerhog, a local-first double-entry bookkeeping app.',
  'Answer questions about the company whose books are provided below.',
  'Rules:',
  '- The LEDGER CONTEXT is the only source of truth. If the answer is not derivable from it, say so plainly — never invent figures, accounts, dates, or transactions.',
  '- Money is in the company\'s base currency; quote amounts as shown.',
  '- This is double-entry: every transaction\'s debits equal its credits. Reference accounts by their code and name.',
  '- You are read-only. You cannot post, edit, or delete anything; if asked to, explain how the user would do it in the app instead.',
  '- Be concise and show the numbers you used.',
].join('\n')

/** Compose the full request from a question + the live ledger context. */
export function buildAssistantRequest(opts: {
  companyId: number
  question: string
  config: AssistantConfig
  history?: AnthropicMessage[]
}): AnthropicRequest {
  const context = buildLedgerContext(opts.companyId, opts.config.maxTransactions ?? 50)
  return {
    model: opts.config.model ?? DEFAULT_ASSISTANT_MODEL,
    max_tokens: 4096,
    thinking: { type: 'adaptive' },
    system: `${SYSTEM_PROMPT}\n\n===== LEDGER CONTEXT =====\n${context}\n===== END CONTEXT =====`,
    messages: [...(opts.history ?? []), { role: 'user', content: opts.question }],
  }
}

// ---- Transports ------------------------------------------------------------

/**
 * Desktop transport. Routes the request through the Tauri `assistant_chat`
 * Rust command (src-tauri/src/assistant.rs) so the API key and the CORS-free
 * HTTP stay out of the web context. The Rust command receives `apiKey`
 * (camelCased from `api_key`) and returns the parsed Messages API response.
 */
export const tauriTransport: AssistantTransport = {
  async send(req: AnthropicRequest, apiKey: string, workspaceId?: string): Promise<AnthropicResponse> {
    const { invoke } = await import('@tauri-apps/api/core')
    const data = await invoke<{
      content?: { type: string; text?: string }[]
      stop_reason?: string | null
    }>('assistant_chat', { req, apiKey, workspaceId: workspaceId || null })
    const text = (data.content ?? [])
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text as string)
      .join('')
    return { text, stopReason: data.stop_reason ?? null }
  },
}

/**
 * Browser dev transport — DIRECT fetch to the Anthropic API. For local
 * experimentation only: the Anthropic API does not send CORS headers (so this
 * is usually blocked in a browser) and the key is exposed to the page. Never
 * ship this path; the desktop build uses tauriTransport.
 */
export const browserFetchTransport: AssistantTransport = {
  async send(req: AnthropicRequest, apiKey: string, workspaceId?: string): Promise<AnthropicResponse> {
    const headers: Record<string, string> = {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    }
    if (workspaceId && workspaceId.trim()) headers['anthropic-workspace-id'] = workspaceId.trim()
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify(req),
    })
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '')
      throw new Error(`Anthropic API error ${resp.status}: ${detail.slice(0, 300)}`)
    }
    const data = (await resp.json()) as {
      content?: { type: string; text?: string }[]
      stop_reason?: string | null
    }
    const text = (data.content ?? [])
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text as string)
      .join('')
    return { text, stopReason: data.stop_reason ?? null }
  },
}

/** Pick the transport for the current runtime. */
export function getAssistantTransport(): AssistantTransport {
  return isTauri() ? tauriTransport : browserFetchTransport
}

/**
 * Ask the assistant a question about a company's books.
 * Reads the ledger, builds the request, and sends it via the runtime transport.
 */
export async function askAssistant(opts: {
  companyId: number
  question: string
  config: AssistantConfig
  history?: AnthropicMessage[]
  transport?: AssistantTransport
}): Promise<AnthropicResponse> {
  if (!opts.config.apiKey.trim()) throw new Error('An Anthropic API key is required to use the assistant.')
  if (!opts.question.trim()) throw new Error('Ask a question first.')
  const req = buildAssistantRequest(opts)
  const transport = opts.transport ?? getAssistantTransport()
  return transport.send(req, opts.config.apiKey, opts.config.workspaceId)
}
