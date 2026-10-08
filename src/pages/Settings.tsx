import { useEffect, useRef, useState } from 'react'
import { Download, Upload, RotateCcw, Plus, Database, FileSpreadsheet, Lock, Percent, Trash2, Users, KeyRound, FolderOpen, FilePlus, Save, HardDrive, Clock, CreditCard } from 'lucide-react'
import { clsx } from 'clsx'
import { useStore, useCan } from '../state/store'
import { isTauri } from '../lib/desktop'
import { exportBytes, importBytes, resetDatabase } from '../db/db'
import { seedIfEmpty } from '../db/seed'
import { createCompany, listCompanies, getCompany, setLockedThrough, getAccounts, deleteCompany } from '../db/repo'
import { getTaxCodes, createTaxCode, deleteTaxCode } from '../db/documents'
import { formatDate } from '../lib/format'
import { importQBOJournal, type QBOImportSummary } from '../db/qboImport'
import { createSquareConnector } from '../db/payments/square'
import { importFromConnector, type ConnectorStatus, type ImportPaymentSummary } from '../db/payments/connector'
import { formatMoney } from '../lib/money'
import { listUsers, createUser, setUserRole, setUserActive, setUserPassword, deleteUser, type Role, type User } from '../db/users'

export default function Settings() {
  const reloadCompanies = useStore((s) => s.reloadCompanies)
  const setCompany = useStore((s) => s.setCompany)
  const isAdmin = useCan('admin')
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [newName, setNewName] = useState('')

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
    const id = createCompany(newName.trim())
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
          <button className="btn-primary" onClick={addCompany}>
            Create
          </button>
        </div>
      </Section>

      {isAdmin && <ManageCompaniesSection />}
      <QBOImportSection />
      <SquareConnectSection />
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

function SquareConnectSection() {
  const currentCompanyId = useStore((s) => s.currentCompanyId)
  const rev = useStore((s) => s.rev)
  void rev
  const [appId, setAppId] = useState('')
  const [environment, setEnvironment] = useState<'sandbox' | 'production'>('sandbox')
  const [bankAccountId, setBankAccountId] = useState<number | ''>('')
  const today = new Date().toISOString().slice(0, 10)
  const [start, setStart] = useState(`${today.slice(0, 4)}-01-01`)
  const [end, setEnd] = useState(today)
  const [status, setStatus] = useState<ConnectorStatus | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ImportPaymentSummary | null>(null)

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
      const connector = createSquareConnector({ applicationId: appId.trim(), environment })
      const st = await connector.connect()
      setStatus(st)
      if (st.state === 'error' && st.error) setError(st.error)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  async function sync() {
    if (currentCompanyId == null || bankAccountId === '') return
    setError(null)
    setResult(null)
    setBusy('Syncing…')
    try {
      const connector = createSquareConnector({ applicationId: appId.trim(), environment })
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
        <button className="btn-outline" disabled={!!busy || !appId.trim()} onClick={connect}>
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
            <button className="btn-primary" disabled={!!busy || bankAccountId === ''} onClick={sync}>
              {busy === 'Syncing…' ? 'Syncing…' : 'Sync Square sales'}
            </button>
          </>
        )}

        {error && <div className="rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</div>}
        {result && (
          <div className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <div className="font-semibold">Synced from Square ✓</div>
            <ul className="mt-1 space-y-0.5 text-emerald-700">
              <li>{result.payments.toLocaleString()} sales · {formatMoney(result.grossCents)} gross · {formatMoney(result.feeCents)} fees · {formatMoney(result.taxCents)} tax</li>
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
