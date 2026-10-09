import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { X, Send, Loader2 } from 'lucide-react'
import { clsx } from 'clsx'
import { useStore } from '../state/store'
import { askAssistant, loadAssistantConfig, type AnthropicMessage } from '../db/assistant'
import coin from '../assets/coin-512.png'

/**
 * Floating assistant available on every page. Reads the per-device config
 * (API key / workspace / model) saved in Settings → AI assistant, and chats
 * against the current company's books via askAssistant().
 */
export default function AssistantWidget() {
  const currentCompanyId = useStore((s) => s.currentCompanyId)
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<AnthropicMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, busy])

  const hasKey = loadAssistantConfig().apiKey.trim().length > 0

  async function send() {
    const q = input.trim()
    if (!q || busy || currentCompanyId == null) return
    const config = loadAssistantConfig()
    if (!config.apiKey.trim()) { setError('Add your Anthropic API key in Settings → AI assistant first.'); return }
    setError(null)
    setBusy(true)
    const history = messages
    setMessages((m) => [...m, { role: 'user', content: q }])
    setInput('')
    try {
      const res = await askAssistant({ companyId: currentCompanyId, question: q, config, history })
      setMessages((m) => [...m, { role: 'assistant', content: res.text || '(no text returned)' }])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
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
    <div className="fixed bottom-5 right-5 z-50 flex h-[32rem] max-h-[80vh] w-[22rem] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
      <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-2.5">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <img src={coin} alt="" className="h-5 w-5" /> Assistant
          <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">beta</span>
        </div>
        <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600" title="Close"><X size={18} /></button>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {messages.length === 0 && (
          <div className="mt-2 text-center text-xs text-slate-400">
            {hasKey
              ? 'Ask about this company’s books — balances, expenses, overdue invoices, what’s unreconciled…'
              : <>Add your Anthropic API key in <Link to="/settings" className="text-brand-600 underline" onClick={() => setOpen(false)}>Settings → AI assistant</Link> to get started.</>}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={clsx('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
            <div className={clsx(
              'max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm',
              m.role === 'user' ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-700',
            )}>
              {m.content}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-500">
              <Loader2 size={14} className="animate-spin" /> Thinking…
            </div>
          </div>
        )}
        {error && <div className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>}
      </div>

      <div className="border-t border-slate-100 p-2">
        <div className="flex items-end gap-2">
          <textarea
            className="max-h-28 flex-1 resize-none rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
            rows={1}
            placeholder={currentCompanyId == null ? 'Open a company first…' : 'Ask about your books…'}
            value={input}
            disabled={currentCompanyId == null}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }}
          />
          <button
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand-600 text-white transition hover:bg-brand-700 disabled:opacity-40"
            disabled={busy || !input.trim() || currentCompanyId == null}
            onClick={() => void send()}
            title="Send"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}
