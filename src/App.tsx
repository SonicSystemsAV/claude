import { useEffect, useMemo, useState } from 'react'
import { NavLink, Route, Routes } from 'react-router-dom'
import {
  LayoutDashboard,
  Scale,
  BookOpen,
  ListChecks,
  Users,
  Package,
  Wand2,
  Receipt,
  ShoppingCart,
  BarChart3,
  Calculator,
  History,
  BadgeCheck,
  FileCheck2,
  Building2,
  ArrowLeftRight,
  ShieldCheck,
  Trash2,
  LogOut,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  Settings as SettingsIcon,
} from 'lucide-react'
import { clsx } from 'clsx'
import { useStore } from './state/store'
import logoDark from './assets/logo-dark.png'
import coin from './assets/coin-512.png'
import Dashboard from './pages/Dashboard'
import Companies from './pages/Companies'
import TransferReview from './pages/TransferReview'
import ReviewCenter from './pages/ReviewCenter'
import Reconcile from './pages/Reconcile'
import ReconcileTB from './pages/ReconcileTB'
import StatementRec from './pages/StatementRec'
import Accounts from './pages/Accounts'
import StandardizeChart from './pages/StandardizeChart'
import Transactions from './pages/Transactions'
import Contacts from './pages/Contacts'
import Items from './pages/Items'
import Sales from './pages/Sales'
import Purchases from './pages/Purchases'
import Reports from './pages/Reports'
import Subledger from './pages/Subledger'
import Tax from './pages/Tax'
import Audit from './pages/Audit'
import RecycleBin from './pages/RecycleBin'
import Rules from './pages/Rules'
import Settings from './pages/Settings'
import AssistantWidget from './components/AssistantWidget'
import DevUpdateButton from './components/DevUpdateButton'
import { countUnmatched } from './db/repo'
import { runHealthChecks } from './db/healthChecks'

interface NavItem { to: string; label: string; icon: typeof LayoutDashboard; end?: boolean }

const NAV_GROUPS: { label: string | null; items: NavItem[] }[] = [
  {
    label: null,
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
      { to: '/review', label: 'Review Center', icon: ShieldCheck },
      { to: '/companies', label: 'Companies', icon: Building2 },
      { to: '/transfers', label: 'Transfer Review', icon: ArrowLeftRight },
    ],
  },
  {
    label: 'Transactions',
    items: [
      { to: '/sales', label: 'Sales', icon: Receipt },
      { to: '/purchases', label: 'Purchases', icon: ShoppingCart },
      { to: '/reconcile', label: 'Reconcile', icon: Scale },
      { to: '/reconcile-tb', label: 'Verify vs QBO', icon: FileCheck2 },
      { to: '/statements', label: 'Statement Rec', icon: BadgeCheck },
      { to: '/transactions', label: 'All Transactions', icon: ListChecks },
    ],
  },
  {
    label: 'Lists',
    items: [
      { to: '/accounts', label: 'Chart of Accounts', icon: BookOpen },
      { to: '/items', label: 'Products & Services', icon: Package },
      { to: '/contacts', label: 'Customers & Suppliers', icon: Users },
    ],
  },
  {
    label: 'Reports',
    items: [
      { to: '/reports', label: 'Reports', icon: BarChart3 },
      { to: '/subledger', label: 'A/R & A/P by Contact', icon: Users },
      { to: '/tax', label: 'Tax', icon: Calculator },
    ],
  },
  {
    label: 'Manage',
    items: [
      { to: '/rules', label: 'Rules', icon: Wand2 },
      { to: '/audit', label: 'Audit Log', icon: History },
      { to: '/trash', label: 'Recycle Bin', icon: Trash2 },
      { to: '/settings', label: 'Settings', icon: SettingsIcon },
    ],
  },
]

const NAV_COLLAPSE_KEY = 'sonic.navGroups'
function loadNavCollapsed(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(NAV_COLLAPSE_KEY) ?? '{}')
  } catch {
    return {}
  }
}

const RAIL_KEY = 'sonic.sidebarRail'
function loadRail(): boolean {
  try {
    return localStorage.getItem(RAIL_KEY) === '1'
  } catch {
    return false
  }
}

function NavItemLink({ item, badge, rail }: { item: NavItem; badge?: number; rail?: boolean }) {
  if (rail) {
    return (
      <NavLink to={item.to} end={item.end} className="nav-item relative justify-center px-0" title={item.label}>
        <item.icon size={20} strokeWidth={1.8} />
        {badge ? (
          <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-sonic-orange px-1 text-[10px] font-bold leading-none text-sonic-black">
            {badge > 99 ? '99+' : badge}
          </span>
        ) : null}
      </NavLink>
    )
  }
  return (
    <NavLink to={item.to} end={item.end} className="nav-item">
      <item.icon size={18} strokeWidth={1.8} />
      <span className="flex-1 text-[14px]">{item.label}</span>
      {badge ? <span className="nav-pill">{badge}</span> : null}
    </NavLink>
  )
}

function Sidebar() {
  const { companies, currentCompanyId, setCompany, rev } = useStore()
  const unmatched = currentCompanyId ? countUnmatched(currentCompanyId) : 0
  // Health checks are heavier than a single query, so only recompute the badge
  // when the ledger actually changes (rev), not on every render.
  const issueCount = useMemo(() => {
    try {
      return runHealthChecks().length
    } catch {
      return 0
    }
  }, [rev])
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(loadNavCollapsed)
  const [rail, setRail] = useState<boolean>(loadRail)
  void rev

  function toggle(label: string) {
    setCollapsed((prev) => {
      const next = { ...prev, [label]: !prev[label] }
      try { localStorage.setItem(NAV_COLLAPSE_KEY, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }

  function toggleRail() {
    setRail((prev) => {
      const next = !prev
      try { localStorage.setItem(RAIL_KEY, next ? '1' : '0') } catch { /* ignore */ }
      return next
    })
  }

  const badgeFor = (to: string) => {
    if (to === '/reconcile' && unmatched > 0) return unmatched
    if (to === '/review' && issueCount > 0) return issueCount
    return undefined
  }

  return (
    <aside
      className={clsx(
        'sidebar shrink-0 overflow-y-auto overflow-x-hidden transition-[flex-basis] duration-150',
        rail ? '!basis-[72px] w-[72px] px-2' : 'w-sidebar',
      )}
    >
      {/* Brand + collapse toggle */}
      <div className={clsx('flex', rail ? 'flex-col items-center gap-3' : 'items-center justify-between')}>
        {rail ? (
          <img src={coin} alt="Sonic the Ledgerhog" className="h-9 w-9" />
        ) : (
          <img src={logoDark} alt="Sonic the Ledgerhog" className="w-[180px]" />
        )}
        <button
          onClick={toggleRail}
          title={rail ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={rail ? 'Expand sidebar' : 'Collapse sidebar'}
          className="grid h-8 w-8 place-items-center rounded-nav text-nav-text hover:bg-nav-active"
        >
          {rail ? <ChevronsRight size={18} /> : <ChevronsLeft size={18} />}
        </button>
      </div>

      {!rail && (
        <select
          value={currentCompanyId ?? ''}
          onChange={(e) => setCompany(Number(e.target.value))}
          className="min-h-touch w-full rounded-control border border-nav-line bg-nav-input px-3 text-sm font-medium text-nav-text focus:border-sonic-orange focus:outline-none"
        >
          {companies.map((c) => (
            <option key={c.id} value={c.id} className="bg-sonic-black text-nav-text">
              {c.name}
            </option>
          ))}
        </select>
      )}

      <nav className="flex flex-1 flex-col gap-2">
        {NAV_GROUPS.map((group, gi) => {
          // Rail mode: icon-only, no group headers, everything visible.
          if (rail) {
            return (
              <div key={gi} className="flex flex-col gap-0.5">
                {gi > 0 && <div className="mx-auto my-1 h-px w-8 bg-nav-line" />}
                {group.items.map((item) => <NavItemLink key={item.to} item={item} badge={badgeFor(item.to)} rail />)}
              </div>
            )
          }
          if (!group.label) {
            return (
              <div key={gi} className="flex flex-col gap-0.5">
                {group.items.map((item) => <NavItemLink key={item.to} item={item} badge={badgeFor(item.to)} />)}
              </div>
            )
          }
          const isCollapsed = collapsed[group.label]
          const groupBadge = group.items.reduce((n, it) => n + (badgeFor(it.to) ?? 0), 0)
          return (
            <div key={gi} className="flex flex-col gap-0.5">
              <button
                className="flex items-center gap-1 px-3 pt-1 text-[11px] font-semibold uppercase tracking-[1px] text-subtle hover:text-nav-text"
                onClick={() => toggle(group.label!)}
              >
                <ChevronDown size={12} className={clsx('transition-transform', isCollapsed && '-rotate-90')} />
                <span className="flex-1 text-left">{group.label}</span>
                {isCollapsed && groupBadge > 0 && <span className="nav-pill">{groupBadge}</span>}
              </button>
              {!isCollapsed && group.items.map((item) => <NavItemLink key={item.to} item={item} badge={badgeFor(item.to)} />)}
            </div>
          )
        })}
      </nav>

      <UserFooter rail={rail} />
    </aside>
  )
}

export default function App() {
  const { ready, error, init, currentUser, userCount } = useStore()

  useEffect(() => {
    void init()
  }, [init])

  if (error) {
    return (
      <div className="grid h-full place-items-center p-8">
        <div className="card max-w-lg p-6">
          <h1 className="mb-2 text-lg font-semibold text-rose-600">Failed to start</h1>
          <pre className="whitespace-pre-wrap rounded bg-slate-100 p-3 text-xs text-slate-700">
            {error}
          </pre>
        </div>
      </div>
    )
  }

  if (!ready) {
    return (
      <div className="grid h-full place-items-center">
        <div className="flex items-center gap-3 text-slate-500">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
          Loading your books…
        </div>
      </div>
    )
  }

  if (!currentUser) {
    return <AuthScreen setup={userCount === 0} />
  }

  return (
    <div className="flex h-full min-h-0">
      <Sidebar />
      <main className="min-h-0 min-w-0 flex-[999_1_560px] overflow-auto">
        <Routes>
          <Route path="/" element={<Dashboard />} />
            <Route path="/companies" element={<Companies />} />
            <Route path="/review" element={<ReviewCenter />} />
            <Route path="/transfers" element={<TransferReview />} />
            <Route path="/sales" element={<Sales />} />
            <Route path="/purchases" element={<Purchases />} />
            <Route path="/reconcile" element={<Reconcile />} />
            <Route path="/reconcile-tb" element={<ReconcileTB />} />
            <Route path="/statements" element={<StatementRec />} />
            <Route path="/accounts" element={<Accounts />} />
            <Route path="/accounts/standardize" element={<StandardizeChart />} />
            <Route path="/transactions" element={<Transactions />} />
            <Route path="/contacts" element={<Contacts />} />
            <Route path="/items" element={<Items />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/subledger" element={<Subledger />} />
            <Route path="/tax" element={<Tax />} />
            <Route path="/audit" element={<Audit />} />
            <Route path="/trash" element={<RecycleBin />} />
            <Route path="/rules" element={<Rules />} />
            <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
      <AssistantWidget />
      <DevUpdateButton />
    </div>
  )
}

function UserFooter({ rail }: { rail?: boolean }) {
  const user = useStore((s) => s.currentUser)
  const logout = useStore((s) => s.logout)
  if (!user) return null
  const roleColor =
    user.role === 'admin'
      ? 'text-sonic-orange'
      : user.role === 'accountant'
        ? 'text-nav-text'
        : 'text-subtle'
  if (rail) {
    return (
      <div className="mt-auto border-t border-nav-line pt-4">
        <button
          className="mx-auto grid h-9 w-9 place-items-center rounded-nav text-nav-text hover:bg-nav-active"
          onClick={logout}
          title={`Log out (${user.name})`}
          aria-label="Log out"
        >
          <LogOut size={18} strokeWidth={1.8} />
        </button>
      </div>
    )
  }
  return (
    <div className="mt-auto border-t border-nav-line pt-4">
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <div className="truncate text-[14px] font-medium text-white">{user.name}</div>
          <div className={clsx('text-[12px] font-medium capitalize', roleColor)}>{user.role}</div>
        </div>
        <button
          className="flex min-h-touch items-center gap-1.5 rounded-nav px-2 text-[13px] text-nav-text hover:bg-nav-active"
          onClick={logout}
          title="Log out"
        >
          <LogOut size={16} strokeWidth={1.8} /> Log out
        </button>
      </div>
      <BuildStamp />
    </div>
  )
}

/** Small git build stamp so a refresh is self-verifying: match this against the
 *  commit Claude says is latest. Baked in at build / dev-server start. */
function BuildStamp() {
  const rev = typeof __BUILD_REV__ === 'string' ? __BUILD_REV__ : 'unknown'
  const time = typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : ''
  return (
    <div className="mt-3 select-text text-[11px] text-subtle" title="Code version currently running">
      build <span className="font-mono text-nav-text">{rev}</span>
      {time ? ` · ${time}` : ''}
    </div>
  )
}

function AuthScreen({ setup }: { setup: boolean }) {
  const login = useStore((s) => s.login)
  const setupAdmin = useStore((s) => s.setupAdmin)
  const [name, setName] = useState('')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    setErr(null)
    setBusy(true)
    try {
      if (setup) {
        await setupAdmin(name, pw)
      } else {
        const ok = await login(name, pw)
        if (!ok) setErr('Invalid name or password.')
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid h-full place-items-center bg-ground">
      <div className="card w-full max-w-sm p-6">
        <div className="mb-5 flex flex-col items-center text-center">
          <img src={coin} alt="Sonic the Ledgerhog" className="h-16 w-16" />
          <span className="mt-2 font-display text-[22px] font-semibold text-ink">Sonic the Ledgerhog</span>
        </div>
        <h1 className="mb-1 section-title text-ink">{setup ? 'Create your admin account' : 'Sign in'}</h1>
        <p className="mb-4 text-sm text-muted">{setup ? 'This first account has full admin access.' : 'Enter your credentials to continue.'}</p>
        <div className="space-y-3">
          <input className="input w-full text-sm" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <input type="password" className="input w-full text-sm" placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
          {err && <div className="rounded-control bg-debit-bg px-3 py-2 text-sm text-debit">{err}</div>}
          <button className="btn-primary w-full" disabled={busy || !name || !pw} onClick={submit}>
            {busy ? '…' : setup ? 'Create account' : 'Sign in'}
          </button>
        </div>
      </div>
    </div>
  )
}
