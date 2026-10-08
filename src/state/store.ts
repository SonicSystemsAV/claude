import { create } from 'zustand'
import { initDb, importBytes, createEmptyDatabase, exportBytes, setPersistListener } from '../db/db'
import { seedIfEmpty } from '../db/seed'
import { listCompanies, setAuditUser } from '../db/repo'
import { ensureDefaultTaxCodes } from '../db/documents'
import { countUsers, listUsers, verifyLogin, createUser, can, type Role, type Capability } from '../db/users'
import {
  isTauri,
  basename,
  pickOpenPath,
  pickSavePath,
  readBook,
  writeBook,
} from '../lib/desktop'
import type { Company } from '../db/types'

export interface CurrentUser {
  id: number
  name: string
  role: Role
}

/** A book file on disk (desktop file-based storage). */
export interface BookRef {
  path: string
  name: string
}

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

const SESSION_KEY = 'ledgerly.session'
const LAST_BOOK_KEY = 'sonic.lastBook'
const RECENT_KEY = 'sonic.recentFiles'

function loadSession(): CurrentUser | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    return raw ? (JSON.parse(raw) as CurrentUser) : null
  } catch {
    return null
  }
}
function saveSession(u: CurrentUser | null) {
  try {
    if (u) localStorage.setItem(SESSION_KEY, JSON.stringify(u))
    else localStorage.removeItem(SESSION_KEY)
  } catch {
    /* ignore */
  }
}
function loadRecent(): BookRef[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    return raw ? (JSON.parse(raw) as BookRef[]) : []
  } catch {
    return []
  }
}
function saveRecent(list: BookRef[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list))
  } catch {
    /* ignore */
  }
}

let bookWriteTimer: ReturnType<typeof setTimeout> | null = null

interface AppState {
  ready: boolean
  error: string | null
  companies: Company[]
  currentCompanyId: number | null
  userCount: number
  currentUser: CurrentUser | null
  rev: number
  // File-based storage (desktop)
  currentFile: BookRef | null
  recentFiles: BookRef[]
  saveState: SaveState
  init: () => Promise<void>
  login: (name: string, password: string) => Promise<boolean>
  setupAdmin: (name: string, password: string) => Promise<void>
  logout: () => void
  setCompany: (id: number) => void
  refresh: () => void
  reloadCompanies: () => void
  // Book-file actions (desktop)
  openBookFile: () => Promise<void>
  openBookPath: (path: string) => Promise<void>
  newBookFile: () => Promise<void>
  saveBookAs: () => Promise<void>
  _scheduleBookWrite: () => void
}

export const useStore = create<AppState>((set, get) => {
  /** Recompute companies / tax codes / auth after the underlying DB is swapped. */
  function refreshDomainState() {
    const companies = listCompanies()
    for (const c of companies) ensureDefaultTaxCodes(c.id)
    const n = countUsers()
    let cu = get().currentUser
    if (n === 0) cu = null
    else if (cu && !listUsers().some((u) => u.name === cu!.name && u.active === 1)) cu = null
    setAuditUser(cu?.name ?? null)
    saveSession(cu)
    set({ companies, currentCompanyId: companies[0]?.id ?? null, userCount: n, currentUser: cu })
  }

  /** Record a newly opened/created book as current + remember it. */
  function markBookOpen(path: string) {
    const ref: BookRef = { path, name: basename(path) }
    const recent = [ref, ...get().recentFiles.filter((r) => r.path !== path)].slice(0, 8)
    saveRecent(recent)
    try {
      localStorage.setItem(LAST_BOOK_KEY, path)
    } catch {
      /* ignore */
    }
    set({ currentFile: ref, recentFiles: recent, saveState: 'saved' })
  }

  async function openBookPath(path: string) {
    if (!isTauri()) throw new Error('Opening book files requires the desktop app.')
    const bytes = await readBook(path)
    await importBytes(bytes)
    refreshDomainState()
    markBookOpen(path)
    set({ rev: get().rev + 1 })
  }

  return {
    ready: false,
    error: null,
    companies: [],
    currentCompanyId: null,
    userCount: 0,
    currentUser: null,
    rev: 0,
    currentFile: null,
    recentFiles: [],
    saveState: 'idle',

    init: async () => {
      try {
        await initDb()
        // Desktop: if a book file was open last session, make it the source of truth.
        let openedPath: string | null = null
        if (isTauri()) {
          const last = localStorage.getItem(LAST_BOOK_KEY)
          if (last) {
            try {
              const bytes = await readBook(last)
              await importBytes(bytes)
              openedPath = last
            } catch {
              // File moved/deleted — fall back to the local cache.
            }
          }
        }
        if (!openedPath) seedIfEmpty()
        const companies = listCompanies()
        for (const c of companies) ensureDefaultTaxCodes(c.id)
        const n = countUsers()
        const session = loadSession()
        let restored = session && n > 0 ? session : null
        if (restored && !listUsers().some((u) => u.name === restored!.name && u.active === 1)) restored = null
        if (restored) setAuditUser(restored.name)
        set({
          ready: true,
          companies,
          currentCompanyId: companies[0]?.id ?? null,
          userCount: n,
          currentUser: restored,
          recentFiles: loadRecent(),
          currentFile: openedPath ? { path: openedPath, name: basename(openedPath) } : null,
          saveState: openedPath ? 'saved' : 'idle',
        })
        if (isTauri()) setPersistListener(() => get()._scheduleBookWrite())
      } catch (e) {
        set({ error: e instanceof Error ? e.message : String(e) })
      }
    },
    login: async (name, password) => {
      const u = await verifyLogin(name, password)
      if (!u) return false
      const cu: CurrentUser = { id: u.id, name: u.name, role: u.role }
      setAuditUser(cu.name)
      saveSession(cu)
      set({ currentUser: cu })
      return true
    },
    setupAdmin: async (name, password) => {
      await createUser(name, 'admin', password)
      const u = await verifyLogin(name, password)
      if (!u) throw new Error('Setup failed.')
      const cu: CurrentUser = { id: u.id, name: u.name, role: u.role }
      setAuditUser(cu.name)
      saveSession(cu)
      set({ currentUser: cu, userCount: 1 })
    },
    logout: () => {
      setAuditUser(null)
      saveSession(null)
      set({ currentUser: null })
    },
    setCompany: (id) => {
      ensureDefaultTaxCodes(id)
      set({ currentCompanyId: id, rev: get().rev + 1 })
    },
    refresh: () => set({ rev: get().rev + 1 }),
    reloadCompanies: () => set({ companies: listCompanies(), rev: get().rev + 1 }),

    openBookPath,
    openBookFile: async () => {
      if (!isTauri()) throw new Error('Opening book files requires the desktop app.')
      const path = await pickOpenPath()
      if (!path) return
      await openBookPath(path)
    },
    newBookFile: async () => {
      if (!isTauri()) throw new Error('Creating book files requires the desktop app.')
      const path = await pickSavePath('My Company Books')
      if (!path) return
      await createEmptyDatabase()
      await writeBook(path, exportBytes())
      refreshDomainState()
      markBookOpen(path)
      set({ rev: get().rev + 1 })
    },
    saveBookAs: async () => {
      if (!isTauri()) throw new Error('Saving book files requires the desktop app.')
      const suggested = get().currentFile?.name ?? 'My Company Books'
      const path = await pickSavePath(suggested)
      if (!path) return
      set({ saveState: 'saving' })
      try {
        await writeBook(path, exportBytes())
        markBookOpen(path)
      } catch (e) {
        set({ saveState: 'error' })
        throw e
      }
    },
    _scheduleBookWrite: () => {
      const { currentFile } = get()
      if (!isTauri() || !currentFile) return
      set({ saveState: 'saving' })
      if (bookWriteTimer) clearTimeout(bookWriteTimer)
      bookWriteTimer = setTimeout(() => {
        bookWriteTimer = null
        const file = get().currentFile
        if (!file) return
        void writeBook(file.path, exportBytes())
          .then(() => set({ saveState: 'saved' }))
          .catch(() => set({ saveState: 'error' }))
      }, 1200)
    },
  }
})

export function useCurrentCompanyId(): number {
  const id = useStore((s) => s.currentCompanyId)
  if (id == null) throw new Error('No company selected')
  return id
}

/** Current user's role (undefined if not logged in). */
export function useRole(): Role | undefined {
  return useStore((s) => s.currentUser?.role)
}

/** Whether the current user has a capability (edit / delete / admin). */
export function useCan(cap: Capability): boolean {
  return useStore((s) => can(s.currentUser?.role, cap))
}
