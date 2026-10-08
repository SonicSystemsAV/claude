import initSqlJs, { Database, SqlJsStatic } from 'sql.js'
// Load the wasm as a URL and hand it to locateFile (Vite-friendly).
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import localforage from 'localforage'
import schema from './schema.sql?raw'

const STORAGE_KEY = 'db'

const store = localforage.createInstance({ name: 'ledgerly', storeName: 'sqlite' })

let SQL: SqlJsStatic | null = null
let db: Database | null = null
let txDepth = 0
let persistTimer: ReturnType<typeof setTimeout> | null = null

export async function initDb(): Promise<Database> {
  if (db) return db
  if (!SQL) SQL = await initSqlJs({ locateFile: () => wasmUrl })
  const saved = (await store.getItem(STORAGE_KEY)) as Uint8Array | ArrayBuffer | null
  if (saved) {
    const bytes = saved instanceof Uint8Array ? saved : new Uint8Array(saved)
    db = new SQL.Database(bytes)
  } else {
    db = new SQL.Database()
  }
  // CREATE IF NOT EXISTS statements — idempotent, also applies to fresh DBs.
  db.run(schema)
  migrate(db)
  return db
}

/** Lightweight additive migrations for databases created before a column existed. */
function migrate(database: Database): void {
  if (!hasColumn(database, 'transactions', 'contact_id')) {
    database.run('ALTER TABLE transactions ADD COLUMN contact_id INTEGER')
  }
  if (!hasColumn(database, 'companies', 'locked_through')) {
    database.run('ALTER TABLE companies ADD COLUMN locked_through TEXT')
  }
  if (!hasColumn(database, 'documents', 'tax_code_id')) {
    database.run('ALTER TABLE documents ADD COLUMN tax_code_id INTEGER')
  }
  if (!hasColumn(database, 'bank_transactions', 'reconciliation_id')) {
    database.run('ALTER TABLE bank_transactions ADD COLUMN reconciliation_id INTEGER')
  }
  if (!hasColumn(database, 'transactions', 'deleted')) {
    database.run('ALTER TABLE transactions ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0')
  }
  if (!hasColumn(database, 'audit_log', 'user')) {
    database.run('ALTER TABLE audit_log ADD COLUMN user TEXT')
  }
  if (!hasColumn(database, 'documents', 'payment_method')) {
    database.run('ALTER TABLE documents ADD COLUMN payment_method TEXT')
  }
  if (!hasColumn(database, 'document_lines', 'item_id')) {
    database.run('ALTER TABLE document_lines ADD COLUMN item_id INTEGER')
  }
  // Contact detail columns (added when contacts grew beyond name/kind).
  for (const col of ['email', 'phone', 'address_line1', 'address_line2', 'city', 'province', 'postal', 'country', 'website', 'notes']) {
    if (!hasColumn(database, 'contacts', col)) {
      database.run(`ALTER TABLE contacts ADD COLUMN ${col} TEXT`)
    }
  }
}

function hasColumn(database: Database, table: string, column: string): boolean {
  const stmt = database.prepare(`PRAGMA table_info(${table})`)
  try {
    while (stmt.step()) {
      const row = stmt.getAsObject() as { name?: string }
      if (row.name === column) return true
    }
  } finally {
    stmt.free()
  }
  return false
}

export function getDb(): Database {
  if (!db) throw new Error('Database not initialized — call initDb() first')
  return db
}

let persistListener: (() => void) | null = null

/**
 * Register a callback fired after every IndexedDB persist. The store uses this
 * to mirror changes to the open .sonicledger file (desktop file-based storage).
 */
export function setPersistListener(fn: (() => void) | null): void {
  persistListener = fn
}

export async function persist(): Promise<void> {
  if (!db) return
  const data = db.export()
  await store.setItem(STORAGE_KEY, data)
  persistListener?.()
}

function schedulePersist() {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persistTimer = null
    void persist()
  }, 150)
}

/**
 * Reentrant transaction wrapper. SQLite has no nested transactions, so only
 * the OUTERMOST tx() issues BEGIN/COMMIT; inner calls (repo fns composing
 * other repo fns) just run inline. Prevents "cannot start a transaction
 * within a transaction".
 */
export function tx<T>(fn: () => T): T {
  const database = getDb()
  const outer = txDepth === 0
  if (outer) database.run('BEGIN')
  txDepth++
  let ok = false
  try {
    const result = fn()
    ok = true
    return result
  } finally {
    txDepth--
    if (outer) {
      if (ok) database.run('COMMIT')
      else {
        try {
          database.run('ROLLBACK')
        } catch {
          /* ignore */
        }
      }
      schedulePersist()
    }
  }
}

// ---- Query helpers ---------------------------------------------------------
// NOTE: binding MORE params than there are `?` placeholders throws and crashes
// the React tree. Keep params arrays exactly matched to the SQL.

export function all<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
  const stmt = getDb().prepare(sql)
  try {
    stmt.bind(params as never)
    const rows: T[] = []
    while (stmt.step()) rows.push(stmt.getAsObject() as T)
    return rows
  } finally {
    stmt.free()
  }
}

export function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T | undefined {
  return all<T>(sql, params)[0]
}

export function run(sql: string, params: unknown[] = []): void {
  const stmt = getDb().prepare(sql)
  try {
    stmt.bind(params as never)
    stmt.step()
  } finally {
    stmt.free()
  }
}

export function insert(sql: string, params: unknown[] = []): number {
  run(sql, params)
  const r = one<{ id: number }>('SELECT last_insert_rowid() AS id')
  return r?.id ?? 0
}

/** Drop everything and reload the seed. Used by Settings > Reset demo data. */
export async function resetDatabase(): Promise<void> {
  if (!db) await initDb()
  const d = getDb()
  d.run(`
    PRAGMA foreign_keys = OFF;
    DROP TABLE IF EXISTS items;
    DROP TABLE IF EXISTS intercompany_links;
    DROP TABLE IF EXISTS reconciliations;
    DROP TABLE IF EXISTS audit_log;
    DROP TABLE IF EXISTS tax_codes;
    DROP TABLE IF EXISTS tax_map;
    DROP TABLE IF EXISTS payment_applications;
    DROP TABLE IF EXISTS document_lines;
    DROP TABLE IF EXISTS documents;
    DROP TABLE IF EXISTS entries;
    DROP TABLE IF EXISTS transactions;
    DROP TABLE IF EXISTS bank_transactions;
    DROP TABLE IF EXISTS rules;
    DROP TABLE IF EXISTS contacts;
    DROP TABLE IF EXISTS accounts;
    DROP TABLE IF EXISTS companies;
    PRAGMA foreign_keys = ON;
  `)
  d.run(schema)
  await persist()
}

/** Replace the current DB with a brand-new, empty book (schema only — no seed, no users). */
export async function createEmptyDatabase(): Promise<void> {
  if (!SQL) SQL = await initSqlJs({ locateFile: () => wasmUrl })
  db = new SQL.Database()
  db.run(schema)
  await persist()
}

/** Export the raw SQLite bytes (Settings > Back up database). */
export function exportBytes(): Uint8Array {
  return getDb().export()
}

/** Replace the DB from uploaded bytes (restore). */
export async function importBytes(bytes: Uint8Array): Promise<void> {
  if (!SQL) SQL = await initSqlJs({ locateFile: () => wasmUrl })
  db = new SQL.Database(bytes)
  db.run(schema)
  migrate(db)
  await persist()
}
