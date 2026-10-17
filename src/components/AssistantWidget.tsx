import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { X, Send, Loader2, CheckCircle2, Sparkles } from 'lucide-react'
import { clsx } from 'clsx'
import { useStore } from '../state/store'
import { loadAssistantConfig, type AnthropicMessage } from '../db/assistant'
import { runAgent } from '../db/agent'
import { describeAction, applyProposedAction, type ProposedAction } from '../db/assistantActions'
import coin from '../assets/coin-512.png'

/**
 * The single assistant, available on every page. Converses across ALL
 * companies and can propose changes (reclassify / merge / rename accounts /
 * ignore rules) that the owner approves inline. Replaces the old separate
 * read-only widget and the Transfer Review / Review Center proposal panels.
 */

interface ChatMsg {
  role: 'user' | 'assistant'
  content: string
  /** Assistant-proposed actions awaiting approval. */
  actions?: ProposedAction[]
  /** A system note (e.g. "applied …"), styled centered/muted. */
  note?: boolean
}

export default function AssistantWidget() {
  const refresh = useStore((s) => s.refresh)
  const rev = useStore((s) => s.rev)
  void rev
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [checked, setChecked] = useState<Record<number, Set<number>>>({})
  const [appliedAt, setAppliedAt] = useState<Record<number, string[]>>({})
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, busy])

  const hasKey = loadAssistantConfig().apiKey.trim().length > 0

  async function send() {
    const q = input.trim()
    if (!q || busy) return
    const config = loadAssistantConfig()
    if (!config.apiKey.trim()) { setError('Add your Anthropic API key in Settings → AI assistant first.'); return }
    setError(null)
    setBusy(true)
    const next = [...messages, { role: 'user' as const, content: q }]
    setMessages(next)
    setInput('')
    try {
      const history: AnthropicMessage[] = next.map((m) => ({ role: m.role, content: m.content }))
      const reply = await runAgent(history, config)
      setMessages((m) => {
        const idx = m.length
        if (reply.actions.length) setChecked((c) => ({ ...c, [idx]: new Set(reply.actions.map((_, i) => i)) }))
        return [...m, { role: 'assistant', content: reply.text || '(no text returned)', actions: reply.actions.length ? reply.actions : undefined }]
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  function applyActions(msgIdx: number, actions: ProposedAction[]) {
    const sel = checked[msgIdx] ?? new Set(actions.map((_, i) => i))
    const results: string[] = []
    actions.forEach((a, i) => {
      if (!sel.has(i)) return
      try { results.push(applyProposedAction(a)) } catch (e) { results.push(`Failed: ${e instanceof Error ? e.message : String(e)}`) }
    })
    setAppliedAt((p) => ({ ...p, [msgIdx]: results }))
    setMessages((m) => [...m, { role: 'user', content: `(Approved and applied: ${results.join(' ')})`, note: true }])
    refresh()
  }

  function toggle(msgIdx: number, i: number) {
    setChecked((c) => {
      const set = new Set(c[msgIdx] ?? [])
      if (set.has(i)) set.delete(i); else set.add(i)
      return { ...c, [msgIdx]: set }
    })
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        title="Ask the assistant"
        className="fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-white shadow-lg ring-1 ring-slate-200 transition hover:scale-105"
      >
        <img src={coin} alt="Assistant" className="h-10 w-10" />
      </button>
    )
  }

  return (
    <div className="fixed bottom-5 right-5 z-50 flex h-[34rem] max-h-[85vh] w-[25rem] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
      <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-2.5">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <img src={coin} alt="" className="h-5 w-5" /> Assistant
          <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">all companies</span>
        </div>
        <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600" title="Close"><X size={18} /></button>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {messages.length === 0 && (
          <div className="mt-2 space-y-2 text-center text-xs text-slate-400">
            {hasKey ? (
              <>
                <p>Ask anything across all your companies — and I can make the fix once you approve it.</p>
                <p className="text-slate-400">e.g. “why did the 1933230 ↔ SSP spread get worse?”, “merge the duplicate Chris loan accounts”, “reclassify the ATM cash to shareholder draws”.</p>
              </>
            ) : (
              <>Add your Anthropic API key in <Link to="/settings" className="text-brand-600 underline" onClick={() => setOpen(false)}>Settings → AI assistant</Link> to get started.</>
            )}
          </div>
        )}
        {messages.map((m, i) => {
          if (m.note) {
            return <div key={i} className="text-center text-[11px] text-slate-400">{m.content}</div>
          }
          return (
            <div key={i} className={clsx('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
              <div className={clsx('max-w-[88%] space-y-2', m.role === 'user' ? '' : 'w-full')}>
                <div className={clsx(
                  'whitespace-pre-wrap rounded-lg px-3 py-2 text-sm',
                  m.role === 'user' ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-700',
                )}>
                  {m.content}
                </div>
                {m.actions && (
                  <ActionBlock
                    actions={m.actions}
                    checked={checked[i] ?? new Set(m.actions.map((_, k) => k))}
                    applied={appliedAt[i]}
                    onToggle={(k) => toggle(i, k)}
                    onApply={() => applyActions(i, m.actions!)}
                  />
                )}
              </div>
            </div>
          )
        })}
        {busy && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-500">
              <Loader2 size={14} className="animate-spin" /> Thinking…
            </div>
          </div>
        )}
        {error && (
          <div className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {error} {error.includes('API key') && <Link to="/settings" className="underline" onClick={() => setOpen(false)}>Open Settings</Link>}
          </div>
        )}
      </div>

      <div className="border-t border-slate-100 p-2">
        <div className="flex items-end gap-2">
          <textarea
            className="max-h-28 flex-1 resize-none rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
            rows={1}
            placeholder="Ask or tell me what to fix…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }}
          />
          <button
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand-600 text-white transition hover:bg-brand-700 disabled:opacity-40"
            disabled={busy || !input.trim()}
            onClick={() => void send()}
            title="Send"
          >
            <Send size={16} />
          </button>
        </div>
        <p className="mt-1 px-1 text-[10px] text-slate-400">Proposals apply only when you approve. Every change is balanced, logged, and reversible.</p>
      </div>
    </div>
  )
}

function ActionBlock({ actions, checked, applied, onToggle, onApply }: {
  actions: ProposedAction[]
  checked: Set<number>
  applied?: string[]
  onToggle: (i: number) => void
  onApply: () => void
}) {
  if (applied) {
    return (
      <ul className="space-y-0.5 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-xs text-emerald-700">
        {applied.map((r, i) => <li key={i} className="flex items-start gap-1.5"><CheckCircle2 size={12} className="mt-0.5 shrink-0" /> {r}</li>)}
      </ul>
    )
  }
  return (
    <div className="space-y-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        <Sparkles size={11} /> Proposed — review &amp; approve
      </div>
      <ul className="space-y-1">
        {actions.map((a, i) => {
          const d = describeAction(a)
          return (
            <li key={i} className="flex items-start gap-2 text-xs">
              <input type="checkbox" className="mt-0.5" checked={checked.has(i)} onChange={() => onToggle(i)} />
              <div className="min-w-0 flex-1">
                <div className="font-medium text-slate-800">{d.label} <span className="font-normal text-slate-400">· {d.impact}</span></div>
                {a.reason && <div className="text-slate-500">{a.reason}</div>}
              </div>
            </li>
          )
        })}
      </ul>
      <button className="btn-primary px-2 py-1 text-xs" disabled={checked.size === 0} onClick={onApply}>Apply {checked.size} selected</button>
    </div>
  )
}
