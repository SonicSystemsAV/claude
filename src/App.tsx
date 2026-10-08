import { useEffect, useState } from 'react'
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
  Building2,
  Trash2,
  LogOut,
  ChevronDown,
  Settings as SettingsIcon,
} from 'lucide-react'
import { clsx } from 'clsx'
import { useStore } from './state/store'
import logoDark from './assets/logo-dark.png'
import coin from './assets/coin-512.png'
import Dashboard from './pages/Dashboard'
import Companies from './pages/Companies'
import Reconcile from './pages/Reconcile'
import StatementRec from './pages/StatementRec'
import Accounts from './pages/Accounts'
import Transactions from './pages/Transactions'
import Contacts from './pages/Contacts'
import Items from './pages/Items'
import Sales from './pages/Sales'
import Purchases from './pages/Purchases'
import Reports from './pages/Reports'
import Tax from './pages/Tax'
import Audit from './pages/Audit'
import RecycleBin from './pages/RecycleBin'
import Rules from './pages/Rules'
import Settings from './pages/Settings'
import { countUnmatched } from './db/repo'

interface NavItem { to: string; label: string; icon: typeof LayoutDashboard; end?: boolean }

const NAV_GROUPS: { label: string | null; items: NavItem[] }[] = [
  {
    label: null,
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
      { to: '/companies', label: 'Companies', icon: Building2 },
    ],
  },
  {
    label: 'Transactions',
    items: [
      { to: '/sales', label: 'Sales', icon: Receipt },
      { to: '/purchases', label: 'Purchases', icon: ShoppingCart },
      { to: '/reconcile', label: 'Reconcile', icon: Scale },
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

function NavItemLink({ item, badge }: { item: NavItem; badge?: number }) {
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
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(loadNavCollapsed)
  void rev

  function toggle(label: string) {
    setCollapsed((prev) => {
      const next = { ...prev, [label]: !prev[label] }
      try { localStorage.setItem(NAV_COLLAPSE_KEY, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }

  return (
    <aside className="sidebar w-sidebar shrink-0 overflow-y-auto">
      <img src={logoDark} alt="Sonic the Ledgerhog" className="w-[200px] self-start" />

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

      <nav className="flex flex-1 flex-col gap-2">
        {NAV_GROUPS.map((group, gi) => {
          const badgeFor = (to: string) => (to === '/reconcile' && unmatched > 0 ? unmatched : undefined)
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

      <UserFooter />
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
            <Route path="/sales" element={<Sales />} />
            <Route path="/purchases" element={<Purchases />} />
            <Route path="/reconcile" element={<Reconcile />} />
            <Route path="/statements" element={<StatementRec />} />
            <Route path="/accounts" element={<Accounts />} />
            <Route path="/transactions" element={<Transactions />} />
            <Route path="/contacts" element={<Contacts />} />
            <Route path="/items" element={<Items />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/tax" element={<Tax />} />
            <Route path="/audit" element={<Audit />} />
            <Route path="/trash" element={<RecycleBin />} />
            <Route path="/rules" element={<Rules />} />
            <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  )
}

function UserFooter() {
  const user = useStore((s) => s.currentUser)
  const logout = useStore((s) => s.logout)
  if (!user) return null
  const roleColor =
    user.role === 'admin'
      ? 'text-sonic-orange'
      : user.role === 'accountant'
        ? 'text-nav-text'
        : 'text-subtle'
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
