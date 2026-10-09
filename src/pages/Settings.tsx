import { useEffect, useRef, useState } from 'react'
import { Download, Upload, RotateCcw, Plus, Database, FileSpreadsheet, Lock, Percent, Trash2, Users, KeyRound, FolderOpen, FilePlus, Save, HardDrive, Clock, CreditCard, Bot, Link2, Building2, Image as ImageIcon } from 'lucide-react'
import { clsx } from 'clsx'
import { useStore, useCan } from '../state/store'
import { isTauri } from '../lib/desktop'
import { exportBytes, importBytes, resetDatabase } from '../db/db'
import { seedIfEmpty } from '../db/seed'
import { createCompany, listCompanies, getCompany, setLockedThrough, getAccounts, deleteCompany, getCompanyProfile, saveCompanyProfile, type CompanyProfileInput } from '../db/repo'
import { getTaxCodes, createTaxCode, deleteTaxCode } from '../db/documents'
import { formatDate, DATE_FORMATS, getDateFormatId, setDateFormat } from '../lib/format'
import { importQBOJournal, type QBOImportSummary } from '../db/qboImport'
import { createSquareConnector } from '../db/payments/square'
import { importFromConnector, type ConnectorStatus, type ImportPaymentSummary } from '../db/payments/connector'
import { askAssistant, DEFAULT_ASSISTANT_MODEL, ASSISTANT_LS_KEYS } from '../db/assistant'
import { createQuickBooksConnector, QBO_DEFAULT_REDIRECT_PORT, type QboConnectStatus } from '../db/qboLive'
import { previewLetterhead } from '../db/documentPrint'
import { formatMoney } from '../lib/money'
import { CURRENCIES, DEFAULT_CURRENCY } from '../db/currency'
import { listUsers, createUser, setUserRole, setUserActive, setUserPassword, deleteUser, type Role, type User } from '../db/users'

export default function Settings() {
  const reloadCompanies = useStore((s) => s.reloadCompanies)
  const setCompany = useStore((s) => s.setCompany)
  const isAdmin = useCan('admin')
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [newCurrency, setNewCurrency] = useState(DEFAULT_CURRENCY)

  function backup() {
    const bytes = exportBytes()
    const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const stamp = new Date().toISOString().slice(0, 10)
    a.download = `sonic-the-ledgerhog-backup-${stamp}.sqlite`
    a.click()
    URL.revokeObjectURL(url)
    setNote('Database exported.')
  }

  async function restore(file: File) {
    setBusy('Restoring…')
    const buf = await file.arrayBuffer()
    await importBytes(new Uint8Array(buf))
    const companies = listCompanies()
    reloadCompanies()
    if (companies[0]) setCompany(companies[0].id)
    setBusy(null)
    setNote(`Restored — ${companies.length} compan${companies.length === 1 ? 'y' : 'ies'} loaded.`)
  }

  async function reset() {
    if (!confirm('Reset to demo data? This replaces everything currently in Sonic the Ledgerhog.')) return
    setBusy('Resetting…')
    await resetDatabase()
    seedIfEmpty()
    const companies = listCompanies()
    reloadCompanies()
    if (companies[0]) setCompany(companies[0].id)
    setBusy(null)
    setNote('Demo data restored.')
  }

  function addCompany() {
    if (!newName.trim()) return
    const id = createCompany(newName.trim(), undefined, newCurrency)
    setNewName('')
    reloadCompanies()
    setCompany(id)
    setNote(`Created “${newName.trim()}”.`)
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
        <p className="text-sm text-slate-500">Your data lives on this PC only.</p>
      </div>

      {(note || busy) && (
        <div className="rounded-lg bg-brand-50 px-4 py-2 text-sm text-brand-700">{busy ?? note}</div>
      )}

      <BookFileSection />
      <PreferencesSection />

      <Section icon={<Database size={18} />} title="Data" subtitle="Back up, restore, or reset.">
        <div className="flex flex-wrap gap-2">
          <button className="btn-outline" onClick={backup}>
            <Download size={16} /> Back up database
          </button>
          <button className="btn-outline" onClick={() => fileRef.current?.click()}>
            <Upload size={16} /> Restore from backup
          </button>
          {isAdmin && (
            <button className="btn-outline text-rose-600 hover:bg-rose-50" onClick={reset}>
              <RotateCcw size={16} /> Reset demo data
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept=".sqlite,.db,application/octet-stream"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void restore(f)
              e.target.value = ''
            }}
          />
        </div>
        <p className="mt-3 text-xs text-slate-400">
          Backup downloads the real SQLite file. Restore replaces the current database.
        </p>
      </Section>

      <Section icon={<Plus size={18} />} title="New company" subtitle="Add another set of books.">
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            placeholder="Company name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addCompany()}
          />
          <select
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            value={newCurrency}
            onChange={(e) => setNewCurrency(e.target.value)}
            title="Base currency for this company's books"
          >
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>{c.code} — {c.symbol}</option>
            ))}
          </select>
          <button className="btn-primary" onClick={addCompany}>
            Create
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-400">
          Base currency is fixed per set of books. Foreign-currency transactions within a company are coming;
          the groundwork (conversion and FX gain/loss) is in place.
        </p>
      </Section>

      {isAdmin && <ManageCompaniesSection />}
      <CompanyProfileSection />
      <QBOImportSection />
      <QBOLiveSection />
      <SquareConnectSection />
      <AssistantSection />
      <TaxCodesSection />
      <PeriodLockSection />
      {isAdmin && <UsersSection />}
    </div>
  )
}

function BookFileSection() {
  const currentFile = useStore((s) => s.currentFile)
  const recentFiles = useStore((s) => s.recentFiles)
  const saveState = useStore((s) => s.saveState)
  const openBookFile = useStore((s) => s.openBookFile)
  const openBookPath = useStore((s) => s.openBookPath)
  const newBookFile = useStore((s) => s.newBookFile)
  const saveBookAs = useStore((s) => s.saveBookAs)
  const [err, setErr] = useState<string | null>(null)

  async function run(fn: () => Promise<void>) {
    setErr(null)
    try {
      await fn()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  if (!isTauri()) {
    return (
      <Section icon={<HardDrive size={18} />} title="Book file" subtitle="Where your company data is stored.">
        <p className="text-sm text-slate-600">
          In the desktop app, all your books live in a single <code className="rounded bg-slate-100 px-1 text-xs">.sonicledger</code> file
          you keep in <span className="font-mono text-xs">Documents/sonictheledgerhog/</span> — or any cloud-synced folder
          (OneDrive, Dropbox, Google Drive) to sync across devices.
        </p>
        <p className="mt-2 text-xs text-slate-400">
          You're viewing the browser version, so data is stored in this browser. Use <strong>Back up</strong> / <strong>Restore</strong> below to move it as a file.
        </p>
      </Section>
    )
  }

  const badge =
    saveState === 'saving'
      ? { t: 'Saving…', c: 'bg-amber-50 text-amber-700' }
      : saveState === 'saved'
        ? { t: 'All changes saved', c: 'bg-emerald-50 text-emerald-700' }
        : saveState === 'error'
          ? { t: 'Save failed', c: 'bg-rose-50 text-rose-700' }
          : { t: '', c: '' }

  return (
    <Section icon={<HardDrive size={18} />} title="Book file" subtitle="Your single .sonicledger book — local or cloud-synced folder.">
      <div className="space-y-3">
        {currentFile ? (
          <div className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3">
            <div className="min-w-0">
              <div className="truncate font-medium text-slate-800">{currentFile.name}</div>
              <div className="truncate font-mono text-xs text-slate-400">{currentFile.path}</div>
            </div>
            {badge.t && <span className={clsx('ml-3 shrink-0 rounded px-2 py-0.5 text-xs font-medium', badge.c)}>{badge.t}</span>}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-500">
            No book file open — changes are saved to this device only. Use <strong>Save as…</strong> to give your books a file.
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <button className="btn-outline" onClick={() => run(openBookFile)}><FolderOpen size={16} /> Open…</button>
          <button className="btn-outline" onClick={() => run(newBookFile)}><FilePlus size={16} /> New book…</button>
          <button className="btn-primary" onClick={() => run(saveBookAs)}><Save size={16} /> Save as…</button>
        </div>
        {recentFiles.length > 0 && (
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Recent</div>
            <div className="space-y-1">
              {recentFiles.map((r) => (
                <button
                  key={r.path}
                  className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm text-slate-600 hover:bg-slate-50"
                  onClick={() => run(() => openBookPath(r.path))}
                  title={r.path}
                >
                  <Clock size={13} className="shrink-0 text-slate-300" />
                  <span className="shrink-0">{r.name}</span>
                  <span className="truncate font-mono text-xs text-slate-300">{r.path}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {err && <div className="rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-700">{err}</div>}
        <p className="text-xs text-slate-400">Changes autosave to the open file. Keep the file in a OneDrive/Dropbox/Google Drive folder to sync across devices.</p>
      </div>
    </Section>
  )
}

function ManageCompaniesSection() {
  const companies = useStore((s) => s.companies)
  const currentCompanyId = useStore((s) => s.currentCompanyId)
  const setCompany = useStore((s) => s.setCompany)
  const reloadCompanies = useStore((s) => s.reloadCompanies)
  const rev = useStore((s) => s.rev)
  void rev
  const [note, setNote] = useState<string | null>(null)

  function remove(id: number, name: string) {
    if (companies.length <= 1) {
      alert('You can’t delete the only company. Create another first.')
      return
    }
    if (!confirm(`Permanently delete “${name}” and ALL of its data — accounts, transactions, documents, contacts, reconciliations?\n\nThis cannot be undone and is separate from the Recycle Bin.`)) return
    deleteCompany(id)
    const remaining = companies.filter((c) => c.id !== id)
    reloadCompanies()
    if (currentCompanyId === id && remaining[0]) setCompany(remaining[0].id)
    setNote(`Deleted “${name}”.`)
  }

  return (
    <Section icon={<Trash2 size={18} />} title="Manage companies" subtitle="Remove a company file for good — including the sample companies.">
      <div className="space-y-3">
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <tbody>
              {companies.map((c) => (
                <tr key={c.id} className="border-b border-slate-50 last:border-0">
                  <td className="px-4 py-2.5 text-slate-800">
                    {c.name}
                    {c.id === currentCompanyId && <span className="ml-2 rounded bg-brand-50 px-1.5 py-0.5 text-xs text-brand-600">current</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      className="inline-flex items-center gap-1 text-slate-300 hover:text-rose-600 disabled:opacity-40"
                      title={companies.length <= 1 ? 'Can’t delete the only company' : `Delete ${c.name}`}
                      disabled={companies.length <= 1}
                      onClick={() => remove(c.id, c.name)}
                    >
                      <Trash2 size={15} /> Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {note && <div className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{note}</div>}
        <p className="text-xs text-slate-400">Deleting a company wipes its data permanently. To remove just some transactions, use the Recycle Bin instead.</p>
      </div>
    </Section>
  )
}

const ROLE_HELP: Record<Role, string> = {
  admin: 'Full access — manage users, unlock periods, permanently delete.',
  accountant: 'Create, edit, void and recycle transactions. No user or lock control.',
  viewer: 'Read-only — can view and export, but change nothing.',
}

function UsersSection() {
  const currentUser = useStore((s) => s.currentUser)
  const [users, setUsers] = useState<User[]>([])
  const [name, setName] = useState('')
  const [pw, setPw] = useState('')
  const [role, setRole] = useState<Role>('accountant')
  const [note, setNote] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function reload() {
    setUsers(listUsers())
  }
  useEffect(() => { reload() }, [])

  async function add() {
    setErr(null); setNote(null)
    setBusy(true)
    try {
      await createUser(name, role, pw)
      setName(''); setPw(''); setRole('accountant')
      reload()
      setNote(`Added ${name.trim()}.`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function resetPw(u: User) {
    const next = prompt(`New password for ${u.name} (min 4 characters):`)
    if (next == null) return
    try {
      await setUserPassword(u.id, next)
      setNote(`Password updated for ${u.name}.`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  function changeRole(u: User, r: Role) {
    setUserRole(u.id, r); reload()
  }
  function toggleActive(u: User) {
    setUserActive(u.id, u.active !== 1); reload()
  }
  function remove(u: User) {
    if (!confirm(`Delete user ${u.name}? Their recorded activity in the audit log is kept.`)) return
    deleteUser(u.id); reload()
  }

  return (
    <Section icon={<Users size={18} />} title="Users & access" subtitle="Who can sign in, and what they can change.">
      <div className="space-y-4">
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2">Name</th>
                <th className="px-2 py-2">Role</th>
                <th className="px-2 py-2">Status</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isSelf = u.id === currentUser?.id
                return (
                  <tr key={u.id} className="border-b border-slate-50 last:border-0">
                    <td className="px-4 py-2 text-slate-800">
                      {u.name}
                      {isSelf && <span className="ml-2 rounded bg-brand-50 px-1.5 py-0.5 text-xs text-brand-600">you</span>}
                    </td>
                    <td className="px-2 py-2">
                      <select
                        className="rounded-md border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-50 disabled:text-slate-400"
                        value={u.role}
                        disabled={isSelf}
                        title={isSelf ? "You can't change your own role." : ROLE_HELP[u.role]}
                        onChange={(e) => changeRole(u, e.target.value as Role)}
                      >
                        <option value="admin">Admin</option>
                        <option value="accountant">Accountant</option>
                        <option value="viewer">Viewer</option>
                      </select>
                    </td>
                    <td className="px-2 py-2">
                      <span className={u.active === 1 ? 'text-emerald-600' : 'text-slate-400'}>
                        {u.active === 1 ? 'Active' : 'Disabled'}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      <button className="btn-ghost text-slate-500" onClick={() => resetPw(u)} title="Reset password">
                        <KeyRound size={15} />
                      </button>
                      {!isSelf && (
                        <>
                          <button className="btn-ghost text-slate-500" onClick={() => toggleActive(u)}>
                            {u.active === 1 ? 'Disable' : 'Enable'}
                          </button>
                          <button className="btn-ghost text-rose-500" onClick={() => remove(u)} title="Delete user">
                            <Trash2 size={15} />
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="rounded-lg border border-slate-200 p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Add a user</div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto_auto]">
            <input className="rounded-md border border-slate-300 px-3 py-1.5 text-sm" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
            <input type="password" className="rounded-md border border-slate-300 px-3 py-1.5 text-sm" placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} />
            <select className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              <option value="admin">Admin</option>
              <option value="accountant">Accountant</option>
              <option value="viewer">Viewer</option>
            </select>
            <button className="btn-primary" disabled={busy || !name.trim() || !pw} onClick={add}><Plus size={15} /> Add</button>
          </div>
          <p className="mt-2 text-xs text-slate-400">{ROLE_HELP[role]}</p>
        </div>

        {note && <div className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{note}</div>}
        {err && <div className="rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-700">{err}</div>}
      </div>
    </Section>
  )
}

function TaxCodesSection() {
  const companyId = useStore((s) => s.currentCompanyId)
  const refresh = useStore((s) => s.refresh)
  const rev = useStore((s) => s.rev)
  void rev
  const [name, setName] = useState('')
  const [rate, setRate] = useState('')
  const [acct, setAcct] = useState<number | ''>('')
  if (companyId == null) return null
  const codes = getTaxCodes(companyId)
  const liabilityAccounts = getAccounts(companyId).filter((a) => a.type === 'liability')
  const acctName = (id: number | null) => (id == null ? '—' : getAccounts(companyId).find((a) => a.id === id)?.name ?? '—')

  function add() {
    if (!name.trim()) return
    const r = parseFloat(rate) || 0
    createTaxCode(companyId!, name.trim(), r / 100, acct === '' ? null : Number(acct))
    setName(''); setRate(''); setAcct('')
    refresh()
  }

  return (
    <Section icon={<Percent size={18} />} title="Tax codes" subtitle="Sales-tax rates applied on invoices, bills and expenses.">
      <div className="space-y-3">
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <tbody>
              {codes.map((c) => (
                <tr key={c.id} className="border-b border-slate-50 last:border-0">
                  <td className="px-4 py-2 text-slate-800">{c.name}{c.is_default === 1 && <span className="ml-2 rounded bg-brand-50 px-1.5 py-0.5 text-xs text-brand-600">default</span>}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-slate-600">{(c.rate * 100).toFixed(2)}%</td>
                  <td className="px-2 py-2 text-slate-500">{acctName(c.account_id)}</td>
                  <td className="px-4 py-2 text-right">
                    <button className="text-slate-300 hover:text-rose-600" onClick={() => { deleteTaxCode(c.id); refresh() }}><Trash2 size={15} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_1fr_auto]">
          <input className="rounded-md border border-slate-300 px-3 py-1.5 text-sm" placeholder="Name (e.g. PST 7%)" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="w-24 rounded-md border border-slate-300 px-3 py-1.5 text-sm" placeholder="Rate %" value={rate} onChange={(e) => setRate(e.target.value)} />
          <select className="rounded-md border border-slate-300 px-3 py-1.5 text-sm" value={acct} onChange={(e) => setAcct(e.target.value === '' ? '' : Number(e.target.value))}>
            <option value="">Tax account (none for 0%)</option>
            {liabilityAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
          </select>
          <button className="btn-primary" onClick={add}><Plus size={15} /> Add</button>
        </div>
      </div>
    </Section>
  )
}

function PeriodLockSection() {
  const companyId = useStore((s) => s.currentCompanyId)
  const refresh = useStore((s) => s.refresh)
  const rev = useStore((s) => s.rev)
  const isAdmin = useCan('admin')
  void rev
  const [date, setDate] = useState('')
  const [note, setNote] = useState<string | null>(null)
  if (companyId == null) return null
  const company = getCompany(companyId)
  const locked = company?.locked_through ?? null

  function lock(d: string) {
    if (!d) return
    setLockedThrough(companyId!, d)
    setNote(`Periods locked through ${formatDate(d)}.`)
    refresh()
  }
  function unlock() {
    setLockedThrough(companyId!, null)
    setNote('Period lock removed.')
    refresh()
  }

  const year = new Date().getFullYear() - 1

  return (
    <Section icon={<Lock size={18} />} title="Period lock & year-end" subtitle="Freeze closed periods so they can't be changed.">
      <div className="space-y-3">
        <div className="text-sm">
          {locked ? (
            <span className="text-slate-700">Currently locked through <span className="font-semibold">{formatDate(locked)}</span>. Entries on or before that date can't be added, edited or voided.</span>
          ) : (
            <span className="text-slate-500">No period lock set — all dates are open.</span>
          )}
        </div>
        {isAdmin ? (
          <div className="flex flex-wrap items-center gap-2">
            <input type="date" className="rounded-md border border-slate-300 px-3 py-1.5 text-sm" value={date} onChange={(e) => setDate(e.target.value)} />
            <button className="btn-primary" disabled={!date} onClick={() => lock(date)}>Lock through date</button>
            <button className="btn-outline" onClick={() => lock(`${year}-12-31`)}>Close &amp; lock {year}</button>
            {locked && <button className="btn-ghost text-rose-600" onClick={unlock}>Unlock</button>}
          </div>
        ) : (
          <p className="text-xs text-slate-400">Only an administrator can change the period lock.</p>
        )}
        {note && <div className="rounded-lg bg-brand-50 px-4 py-2 text-sm text-brand-700">{note}</div>}
      </div>
    </Section>
  )
}

const ASSISTANT_KEY_LS = ASSISTANT_LS_KEYS.apiKey
const ASSISTANT_MODEL_LS = ASSISTANT_LS_KEYS.model
const ASSISTANT_WS_LS = ASSISTANT_LS_KEYS.workspaceId

function AssistantSection() {
  const currentCompanyId = useStore((s) => s.currentCompanyId)
  const [apiKey, setApiKey] = useState('')
  const [workspaceId, setWorkspaceId] = useState('')
  const [model, setModel] = useState(DEFAULT_ASSISTANT_MODEL)
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    try {
      setApiKey(localStorage.getItem(ASSISTANT_KEY_LS) ?? '')
      setModel(localStorage.getItem(ASSISTANT_MODEL_LS) ?? DEFAULT_ASSISTANT_MODEL)
      setWorkspaceId(localStorage.getItem(ASSISTANT_WS_LS) ?? '')
    } catch { /* storage blocked — leave defaults */ }
  }, [])

  function persist(patch: { key?: string; mdl?: string; ws?: string }) {
    try {
      if (patch.key !== undefined) localStorage.setItem(ASSISTANT_KEY_LS, patch.key)
      if (patch.mdl !== undefined) localStorage.setItem(ASSISTANT_MODEL_LS, patch.mdl)
      if (patch.ws !== undefined) localStorage.setItem(ASSISTANT_WS_LS, patch.ws)
    } catch { /* ignore */ }
  }

  async function ask() {
    if (currentCompanyId == null || !apiKey.trim() || !question.trim()) return
    setBusy(true)
    setError(null)
    setAnswer(null)
    try {
      const res = await askAssistant({
        companyId: currentCompanyId,
        question: question.trim(),
        config: { apiKey: apiKey.trim(), workspaceId: workspaceId.trim() || undefined, model },
      })
      setAnswer(res.text || '(no text returned)')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section
      icon={<Bot size={18} />}
      title="AI assistant (beta)"
      subtitle="Ask questions about your books, answered by Claude using your own API key."
    >
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <input
            type="password"
            className="col-span-2 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            placeholder="Anthropic API key (sk-ant-…)"
            value={apiKey}
            onChange={(e) => { setApiKey(e.target.value); persist({ key: e.target.value }) }}
          />
          <select
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            value={model}
            onChange={(e) => { setModel(e.target.value); persist({ mdl: e.target.value }) }}
            title="Model"
          >
            <option value="claude-opus-5-5">Opus (best)</option>
            <option value="claude-sonnet-5-5">Sonnet (cheaper)</option>
            <option value="claude-haiku-5-5">Haiku (cheapest)</option>
          </select>
          <input
            className="col-span-3 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            placeholder="Workspace ID (only for org-scoped keys — leave blank if your key is workspace-scoped)"
            value={workspaceId}
            onChange={(e) => { setWorkspaceId(e.target.value); persist({ ws: e.target.value }) }}
          />
        </div>
        <textarea
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          rows={2}
          placeholder="e.g. What were my top three expense accounts, and how much is unreconciled?"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <button className="btn-primary" disabled={busy || !apiKey.trim() || !question.trim() || currentCompanyId == null} onClick={ask}>
          {busy ? 'Thinking…' : 'Ask'}
        </button>

        {error && <div className="rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</div>}
        {answer && (
          <div className="whitespace-pre-wrap rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-700">{answer}</div>
        )}
        <p className="text-xs text-slate-400">
          Your key is stored on this device only (never in the book file) and is used to call Claude directly with a
          read-only snapshot of this company’s books. Live calls run in the desktop app; in the browser this is a
          dev-only path and will be blocked by the API’s cross-origin policy.
        </p>
      </div>
    </Section>
  )
}

function SquareConnectSection() {
  const currentCompanyId = useStore((s) => s.currentCompanyId)
  const rev = useStore((s) => s.rev)
  void rev
  const [appId, setAppId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [environment, setEnvironment] = useState<'sandbox' | 'production'>('sandbox')
  const [redirectPort] = useState(8787)
  const [bankAccountId, setBankAccountId] = useState<number | ''>('')
  const today = new Date().toISOString().slice(0, 10)
  const [start, setStart] = useState(`${today.slice(0, 4)}-01-01`)
  const [end, setEnd] = useState(today)
  const [status, setStatus] = useState<ConnectorStatus | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ImportPaymentSummary | null>(null)
  const connectorRef = useRef<ReturnType<typeof createSquareConnector> | null>(null)
  const redirectUri = `http://localhost:${redirectPort}/callback`

  // Per-device persistence so a connection survives app restarts. The OAuth
  // secret + refresh token live in localStorage on this machine only (a
  // single-user local-first tradeoff; an OS secure store would be stricter).
  const SQ = { app: 'sonic.square.appId', secret: 'sonic.square.secret', env: 'sonic.square.env', tokens: 'sonic.square.tokens' }
  const saveTokens = (t: unknown) => { try { localStorage.setItem(SQ.tokens, JSON.stringify(t)) } catch { /* ignore */ } }

  useEffect(() => {
    try {
      const sa = localStorage.getItem(SQ.app) ?? ''
      const ss = localStorage.getItem(SQ.secret) ?? ''
      const se = (localStorage.getItem(SQ.env) as 'sandbox' | 'production') || 'sandbox'
      if (sa) setAppId(sa)
      if (ss) setClientSecret(ss)
      setEnvironment(se)
      const st = localStorage.getItem(SQ.tokens)
      if (st && sa && isTauri()) {
        const connector = createSquareConnector({ applicationId: sa, clientSecret: ss, environment: se, redirectPort })
        connector.onTokensChanged(saveTokens)
        connector.setTokens(JSON.parse(st))
        connectorRef.current = connector
        setStatus(connector.status())
      }
    } catch { /* storage blocked — start fresh */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const bankAccounts =
    currentCompanyId != null ? getAccounts(currentCompanyId).filter((a) => a.is_bank === 1) : []

  // Browser build can't do OAuth or CORS-free HTTP — mirror the Book file fallback.
  if (!isTauri()) {
    return (
      <Section
        icon={<CreditCard size={18} />}
        title="Connect to Square"
        subtitle="Pull Square sales, fees, and payouts straight into your books."
      >
        <div className="rounded-lg border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-500">
          <strong>Desktop app required.</strong> Connecting to Square needs the desktop app — it holds the
          secure sign-in and makes the API calls a browser can’t (Square doesn’t allow direct browser access).
        </div>
        <p className="mt-2 text-xs text-slate-400">
          In the desktop app this is where you’ll sign in to Square once; afterwards each sync maps your Square
          items, sales (income + tax), processing fees, and payouts into this company — payouts land in your
          bank register ready to reconcile. Works the same for other processors (Stripe, Clover) as they’re added.
        </p>
      </Section>
    )
  }

  async function connect() {
    setError(null)
    setBusy('Connecting…')
    try {
      const connector = createSquareConnector({
        applicationId: appId.trim(),
        clientSecret: clientSecret.trim(),
        environment,
        redirectPort,
      })
      connector.onTokensChanged(saveTokens)
      const st = await connector.connect()
      if (st.state === 'connected') {
        connectorRef.current = connector
        try {
          localStorage.setItem(SQ.app, appId.trim())
          localStorage.setItem(SQ.secret, clientSecret.trim())
          localStorage.setItem(SQ.env, environment)
          const t = connector.tokensSnapshot()
          if (t) saveTokens(t)
        } catch { /* ignore */ }
      } else {
        connectorRef.current = null
      }
      setStatus(st)
      if (st.state === 'error' && st.error) setError(st.error)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  async function disconnect() {
    await connectorRef.current?.disconnect()
    connectorRef.current = null
    setStatus(null)
    setResult(null)
    try { localStorage.removeItem(SQ.tokens) } catch { /* ignore */ }
  }

  async function sync() {
    if (currentCompanyId == null || bankAccountId === '') return
    const connector = connectorRef.current
    if (!connector) { setError('Connect to Square first.'); return }
    setError(null)
    setResult(null)
    setBusy('Syncing…')
    try {
      const summary = await importFromConnector(
        currentCompanyId,
        connector,
        { start, end },
        { bankAccountId: Number(bankAccountId) },
      )
      setResult(summary)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const connected = status?.state === 'connected'

  return (
    <Section
      icon={<CreditCard size={18} />}
      title="Connect to Square"
      subtitle="Pull Square sales, fees, and payouts straight into your books."
    >
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input
            className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            placeholder="Square Application ID"
            value={appId}
            onChange={(e) => setAppId(e.target.value)}
          />
          <select
            className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            value={environment}
            onChange={(e) => setEnvironment(e.target.value as 'sandbox' | 'production')}
          >
            <option value="sandbox">Sandbox (testing)</option>
            <option value="production">Production</option>
          </select>
        </div>
        <input
          type="password"
          className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          placeholder="Square OAuth Application Secret"
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
        />
        <div className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-500">
          In your Square app’s OAuth settings, add this exact Redirect URL:{' '}
          <span className="font-mono text-slate-700">{redirectUri}</span>
        </div>
        <button className="btn-outline" disabled={!!busy || !appId.trim() || !clientSecret.trim()} onClick={connect}>
          {busy === 'Connecting…' ? 'Connecting…' : connected ? 'Reconnect' : 'Connect to Square'}
        </button>

        {connected && (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className="text-sm">
                <span className="mb-1 block text-xs font-medium text-slate-500">Deposit bank account</span>
                <select
                  className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                  value={bankAccountId}
                  onChange={(e) => setBankAccountId(e.target.value ? Number(e.target.value) : '')}
                >
                  <option value="">Select…</option>
                  {bankAccounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-xs font-medium text-slate-500">From</span>
                <input type="date" className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm" value={start} onChange={(e) => setStart(e.target.value)} />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-xs font-medium text-slate-500">To</span>
                <input type="date" className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm" value={end} onChange={(e) => setEnd(e.target.value)} />
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button className="btn-primary" disabled={!!busy || bankAccountId === ''} onClick={sync}>
                {busy === 'Syncing…' ? 'Syncing…' : 'Sync Square sales'}
              </button>
              <button className="btn-outline" disabled={!!busy} onClick={disconnect}>Disconnect</button>
              {status?.accountLabel && <span className="text-xs text-slate-400">Connected: {status.accountLabel}</span>}
            </div>
          </>
        )}

        {error && <div className="rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</div>}
        {result && (
          <div className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <div className="font-semibold">Synced from Square ✓</div>
            <ul className="mt-1 space-y-0.5 text-emerald-700">
              <li>{result.payments.toLocaleString()} sales · {formatMoney(result.grossCents)} gross · {formatMoney(result.feeCents)} fees · {formatMoney(result.taxCents)} tax</li>
              {result.tipCents > 0 && <li>{formatMoney(result.tipCents)} tips (booked to Tips Collected)</li>}
              {result.refunds > 0 && <li>{result.refunds.toLocaleString()} refunds · {formatMoney(result.refundTotalCents)} reversed</li>}
              <li>{result.payouts.toLocaleString()} payouts · {formatMoney(result.payoutTotalCents)} to bank ({result.payoutsMatched} auto-matched)</li>
              {result.itemsSynced > 0 && <li>{result.itemsSynced} new catalog item(s)</li>}
              {result.roundingAdjustments > 0 && <li>{result.roundingAdjustments} rounding fix(es), net {formatMoney(result.roundingTotalCents)}</li>}
            </ul>
          </div>
        )}
        <p className="text-xs text-slate-400">
          Square sales post as income + tax (payment method “Square”), processing fees as an expense, and
          payouts as deposits in your bank register for reconciliation. Set up your Square app at{' '}
          <span className="font-mono">developer.squareup.com</span>; start in Sandbox.
        </p>
      </div>
    </Section>
  )
}

interface ProfileForm {
  display_name: string
  address_line1: string
  address_line2: string
  city: string
  province: string
  postal: string
  country: string
  phone: string
  email: string
  website: string
  tax_number: string
  footer_note: string
  use_letterhead: boolean
  logo_data_url: string | null
}

const EMPTY_PROFILE: ProfileForm = {
  display_name: '', address_line1: '', address_line2: '', city: '', province: '', postal: '',
  country: '', phone: '', email: '', website: '', tax_number: '', footer_note: '',
  use_letterhead: true, logo_data_url: null,
}

function PreferencesSection() {
  const refresh = useStore((s) => s.refresh)
  const [fmt, setFmt] = useState(getDateFormatId())
  return (
    <Section icon={<Clock size={18} />} title="Preferences" subtitle="Display options for this device.">
      <label className="block text-sm">
        <span className="mb-1 block text-xs font-medium text-slate-500">Date format</span>
        <select
          className="w-full max-w-sm rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          value={fmt}
          onChange={(e) => { setDateFormat(e.target.value); setFmt(e.target.value); refresh() }}
        >
          {DATE_FORMATS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>
      </label>
      <p className="mt-2 text-xs text-slate-400">Applied consistently everywhere — lists, reports, and printed documents.</p>
    </Section>
  )
}

function CompanyProfileSection() {
  const currentCompanyId = useStore((s) => s.currentCompanyId)
  const companies = useStore((s) => s.companies)
  const [p, setP] = useState<ProfileForm>(EMPTY_PROFILE)
  const [note, setNote] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const logoRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (currentCompanyId == null) return
    const row = getCompanyProfile(currentCompanyId)
    if (row) {
      setP({
        display_name: row.display_name ?? '', address_line1: row.address_line1 ?? '', address_line2: row.address_line2 ?? '',
        city: row.city ?? '', province: row.province ?? '', postal: row.postal ?? '', country: row.country ?? '',
        phone: row.phone ?? '', email: row.email ?? '', website: row.website ?? '', tax_number: row.tax_number ?? '',
        footer_note: row.footer_note ?? '', use_letterhead: row.use_letterhead === 1, logo_data_url: row.logo_data_url ?? null,
      })
    } else {
      setP(EMPTY_PROFILE)
    }
    setNote(null); setErr(null)
  }, [currentCompanyId])

  const companyName = companies.find((c) => c.id === currentCompanyId)?.name ?? ''
  const set = (k: keyof ProfileForm, v: string | boolean | null) => setP((prev) => ({ ...prev, [k]: v }))

  function onLogo(file: File | null) {
    setErr(null)
    if (!file) return
    if (file.size > 500_000) { setErr('Logo is larger than 500 KB — please use a smaller image.'); return }
    const reader = new FileReader()
    reader.onload = () => set('logo_data_url', typeof reader.result === 'string' ? reader.result : null)
    reader.onerror = () => setErr('Could not read that image.')
    reader.readAsDataURL(file)
  }

  function save() {
    if (currentCompanyId == null) return
    const nn = (s: string) => (s.trim() ? s.trim() : null)
    const patch: CompanyProfileInput = {
      display_name: nn(p.display_name), address_line1: nn(p.address_line1), address_line2: nn(p.address_line2),
      city: nn(p.city), province: nn(p.province), postal: nn(p.postal), country: nn(p.country),
      phone: nn(p.phone), email: nn(p.email), website: nn(p.website), tax_number: nn(p.tax_number),
      footer_note: nn(p.footer_note), use_letterhead: p.use_letterhead, logo_data_url: p.logo_data_url,
    }
    saveCompanyProfile(currentCompanyId, patch)
    setNote('Saved. New prints use this letterhead.')
  }

  if (currentCompanyId == null) return null
  const field = (k: keyof ProfileForm, placeholder: string, cls = '') => (
    <input className={clsx('rounded-md border border-slate-300 px-3 py-1.5 text-sm', cls)} placeholder={placeholder}
      value={p[k] as string} onChange={(e) => set(k, e.target.value)} />
  )

  return (
    <Section icon={<Building2 size={18} />} title="Company profile & letterhead" subtitle={`Branding on printed invoices & statements${companyName ? ` — ${companyName}` : ''}.`}>
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          {p.logo_data_url ? (
            <img src={p.logo_data_url} alt="Logo" className="h-14 max-w-[180px] rounded border border-slate-200 object-contain p-1" />
          ) : (
            <div className="grid h-14 w-14 place-items-center rounded border border-dashed border-slate-300 text-slate-300"><ImageIcon size={20} /></div>
          )}
          <div className="flex gap-2">
            <button className="btn-outline" onClick={() => logoRef.current?.click()}><Upload size={15} /> {p.logo_data_url ? 'Replace logo' : 'Upload logo'}</button>
            {p.logo_data_url && <button className="btn-outline text-rose-600 hover:bg-rose-50" onClick={() => set('logo_data_url', null)}>Remove</button>}
            <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={(e) => { onLogo(e.target.files?.[0] ?? null); e.target.value = '' }} />
          </div>
        </div>

        {field('display_name', 'Name shown on documents (defaults to the company name)', 'w-full')}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {field('address_line1', 'Address line 1')}
          {field('address_line2', 'Address line 2')}
          {field('city', 'City')}
          <div className="grid grid-cols-2 gap-3">{field('province', 'Prov/State')}{field('postal', 'Postal/ZIP')}</div>
          {field('country', 'Country')}
          {field('tax_number', 'Tax # (GST/HST, VAT, EIN…)')}
          {field('phone', 'Phone')}
          {field('email', 'Email')}
          {field('website', 'Website')}
        </div>
        <textarea className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" rows={2}
          placeholder="Footer note (payment terms, remittance details…)" value={p.footer_note} onChange={(e) => set('footer_note', e.target.value)} />

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={p.use_letterhead} onChange={(e) => set('use_letterhead', e.target.checked)} />
          Print our letterhead at the top. Uncheck if you print onto your own pre-printed stationery (leaves the top blank).
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-primary" onClick={save}><Save size={15} /> Save profile</button>
          <button className="btn-outline" onClick={() => previewLetterhead(currentCompanyId)}>Preview</button>
        </div>
        {err && <div className="rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-700">{err}</div>}
        {note && <div className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{note}</div>}
      </div>
    </Section>
  )
}

function QBOLiveSection() {
  const reloadCompanies = useStore((s) => s.reloadCompanies)
  const setCompany = useStore((s) => s.setCompany)
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [environment, setEnvironment] = useState<'sandbox' | 'production'>('sandbox')
  const [name, setName] = useState('')
  const today = new Date().toISOString().slice(0, 10)
  const [start, setStart] = useState(`${today.slice(0, 4)}-01-01`)
  const [end, setEnd] = useState(today)
  const [status, setStatus] = useState<QboConnectStatus | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<QBOImportSummary | null>(null)
  const connectorRef = useRef<ReturnType<typeof createQuickBooksConnector> | null>(null)
  const redirectUri = `http://localhost:${QBO_DEFAULT_REDIRECT_PORT}/callback`

  // Per-device persistence (secret + refresh token on this machine only).
  const QK = { id: 'sonic.qbo.clientId', secret: 'sonic.qbo.secret', env: 'sonic.qbo.env', tokens: 'sonic.qbo.tokens' }
  const saveTokens = (t: unknown) => { try { localStorage.setItem(QK.tokens, JSON.stringify(t)) } catch { /* ignore */ } }

  useEffect(() => {
    try {
      const ci = localStorage.getItem(QK.id) ?? ''
      const cs = localStorage.getItem(QK.secret) ?? ''
      const ce = (localStorage.getItem(QK.env) as 'sandbox' | 'production') || 'sandbox'
      if (ci) setClientId(ci)
      if (cs) setClientSecret(cs)
      setEnvironment(ce)
      const st = localStorage.getItem(QK.tokens)
      if (st && ci && isTauri()) {
        const connector = createQuickBooksConnector({ clientId: ci, clientSecret: cs, environment: ce })
        connector.onTokensChanged(saveTokens)
        connector.setTokens(JSON.parse(st))
        connectorRef.current = connector
        setStatus(connector.status())
      }
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!isTauri()) {
    return (
      <Section icon={<Link2 size={18} />} title="Connect to QuickBooks (live)" subtitle="Import directly from QuickBooks Online over the API.">
        <div className="rounded-lg border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-500">
          <strong>Desktop app required.</strong> The live QuickBooks sign-in and API pull run in the desktop app
          (QuickBooks blocks direct browser access). In the browser you can still use the CSV import above.
        </div>
      </Section>
    )
  }

  async function connect() {
    setError(null)
    setBusy('Connecting…')
    try {
      const connector = createQuickBooksConnector({ clientId: clientId.trim(), clientSecret: clientSecret.trim(), environment })
      connector.onTokensChanged(saveTokens)
      const st = await connector.connect()
      if (st.state === 'connected') {
        connectorRef.current = connector
        try {
          localStorage.setItem(QK.id, clientId.trim())
          localStorage.setItem(QK.secret, clientSecret.trim())
          localStorage.setItem(QK.env, environment)
          const t = connector.tokensSnapshot()
          if (t) saveTokens(t)
        } catch { /* ignore */ }
      } else {
        connectorRef.current = null
      }
      setStatus(st)
      if (st.state === 'error' && st.error) setError(st.error)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  function disconnect() {
    connectorRef.current?.disconnect()
    connectorRef.current = null
    setStatus(null)
    setResult(null)
    try { localStorage.removeItem(QK.tokens) } catch { /* ignore */ }
  }

  async function runImport() {
    const connector = connectorRef.current
    if (!connector || !name.trim()) { if (!name.trim()) setError('Enter a company name.'); return }
    setError(null)
    setResult(null)
    setBusy('Importing…')
    try {
      const summary = await connector.importRange(name.trim(), start, end)
      setResult(summary)
      reloadCompanies()
      setCompany(summary.companyId)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const connected = status?.state === 'connected'

  return (
    <Section icon={<Link2 size={18} />} title="Connect to QuickBooks (live)" subtitle="Sign in to QuickBooks Online and import over the API.">
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm" placeholder="QuickBooks Client ID" value={clientId} onChange={(e) => setClientId(e.target.value)} />
          <select className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm" value={environment} onChange={(e) => setEnvironment(e.target.value as 'sandbox' | 'production')}>
            <option value="sandbox">Sandbox (testing)</option>
            <option value="production">Production</option>
          </select>
        </div>
        <input type="password" className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm" placeholder="QuickBooks Client Secret" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} />
        <div className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-500">
          In your Intuit app’s Redirect URIs, add this exactly: <span className="font-mono text-slate-700">{redirectUri}</span>
        </div>
        <button className="btn-outline" disabled={!!busy || !clientId.trim() || !clientSecret.trim()} onClick={connect}>
          {busy === 'Connecting…' ? 'Connecting…' : connected ? 'Reconnect' : 'Connect to QuickBooks'}
        </button>

        {connected && (
          <>
            <input className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm" placeholder="New company name (e.g. Sonic Systems AV Ltd.)" value={name} onChange={(e) => setName(e.target.value)} />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="text-sm"><span className="mb-1 block text-xs font-medium text-slate-500">From</span>
                <input type="date" className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm" value={start} onChange={(e) => setStart(e.target.value)} /></label>
              <label className="text-sm"><span className="mb-1 block text-xs font-medium text-slate-500">To</span>
                <input type="date" className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button className="btn-primary" disabled={!!busy || !name.trim()} onClick={runImport}>{busy === 'Importing…' ? 'Importing…' : 'Import from QuickBooks'}</button>
              <button className="btn-outline" disabled={!!busy} onClick={disconnect}>Disconnect</button>
              {status?.realmId && <span className="text-xs text-slate-400">Company {status.realmId}</span>}
            </div>
          </>
        )}

        {error && <div className="rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</div>}
        {result && (
          <div className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <div className="font-semibold">Imported “{result.companyName}” ✓</div>
            <ul className="mt-1 space-y-0.5 text-emerald-700">
              <li>{result.transactions.toLocaleString()} transactions · {result.entries.toLocaleString()} entries</li>
              <li>{result.accounts} accounts · {result.contacts} contacts ({result.customers} customers, {result.suppliers} suppliers)</li>
              {result.roundingAdjustments > 0 && <li>{result.roundingAdjustments} rounding fix(es), net {formatMoney(result.roundingTotalCents)}</li>}
            </ul>
          </div>
        )}
        <p className="text-xs text-slate-400">
          Pulls the General Ledger for the date range and rebuilds it as balanced double-entry (a new company).
          Create your app at <span className="font-mono">developer.intuit.com</span>; start in Sandbox. Production
          needs Intuit’s app review before other users can connect.
        </p>
      </div>
    </Section>
  )
}

function QBOImportSection() {
  const reloadCompanies = useStore((s) => s.reloadCompanies)
  const setCompany = useStore((s) => s.setCompany)
  const [name, setName] = useState('')
  const [journal, setJournal] = useState<File | null>(null)
  const [accountList, setAccountList] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<QBOImportSummary | null>(null)

  async function runImport() {
    if (!journal || !name.trim()) return
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const journalCsv = await journal.text()
      const accountListCsv = accountList ? await accountList.text() : ''
      const summary = importQBOJournal({ companyName: name.trim(), journalCsv, accountListCsv })
      setResult(summary)
      reloadCompanies()
      setCompany(summary.companyId)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section
      icon={<FileSpreadsheet size={18} />}
      title="Import from QuickBooks"
      subtitle="Load a QBO Journal (All Dates) export as a new company."
    >
      <div className="space-y-3">
        <input
          className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          placeholder="New company name (e.g. Sonic Systems AV Ltd.)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FilePick label="Journal CSV (required)" file={journal} onPick={setJournal} />
          <FilePick label="Account List CSV (optional)" file={accountList} onPick={setAccountList} />
        </div>
        <button className="btn-primary" disabled={busy || !journal || !name.trim()} onClick={runImport}>
          {busy ? 'Importing…' : 'Import'}
        </button>

        {error && (
          <div className="rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</div>
        )}
        {result && (
          <div className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <div className="font-semibold">Imported “{result.companyName}” ✓</div>
            <ul className="mt-1 space-y-0.5 text-emerald-700">
              <li>{result.transactions.toLocaleString()} transactions · {result.entries.toLocaleString()} entries</li>
              <li>{result.accounts} accounts · {result.contacts} contacts ({result.customers} customers, {result.suppliers} suppliers)</li>
              {result.skippedZero > 0 && <li>{result.skippedZero.toLocaleString()} zero-value lines skipped</li>}
              {result.roundingAdjustments > 0 && (
                <li>
                  {result.roundingAdjustments} rounding fix(es), net {formatMoney(result.roundingTotalCents)}
                </li>
              )}
              {result.unknownAccounts.length > 0 && (
                <li>{result.unknownAccounts.length} account(s) inferred by name (not in Account List)</li>
              )}
            </ul>
          </div>
        )}
        <p className="text-xs text-slate-400">
          Export in QBO via Reports → Journal → All Dates → Export to CSV. The Account List export
          improves account-type accuracy.
        </p>
      </div>
    </Section>
  )
}

function FilePick({
  label,
  file,
  onPick,
}: {
  label: string
  file: File | null
  onPick: (f: File | null) => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <div>
      <button className="btn-outline w-full justify-start" onClick={() => ref.current?.click()}>
        <Upload size={15} /> {file ? file.name : label}
      </button>
      <input
        ref={ref}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          onPick(e.target.files?.[0] ?? null)
          e.target.value = ''
        }}
      />
    </div>
  )
}

function Section({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: React.ReactNode
  title: string
  subtitle: string
  children: React.ReactNode
}) {
  return (
    <div className="card p-5">
      <div className="mb-4 flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-slate-100 text-slate-600">
          {icon}
        </span>
        <div>
          <h2 className="font-semibold text-slate-800">{title}</h2>
          <p className="text-xs text-slate-400">{subtitle}</p>
        </div>
      </div>
      {children}
    </div>
  )
}
