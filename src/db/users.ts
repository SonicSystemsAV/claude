import { all, one, insert, run } from './db'

export type Role = 'admin' | 'accountant' | 'viewer'

export interface User {
  id: number
  name: string
  role: Role
  active: number
  created_at: string
}

interface UserRow extends User {
  salt: string
  hash: string
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}
function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

async function derive(password: string, salt: Uint8Array): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations: 100_000, hash: 'SHA-256' },
    key,
    256,
  )
  return toHex(new Uint8Array(bits))
}

export function countUsers(): number {
  return one<{ n: number }>('SELECT COUNT(*) AS n FROM users')?.n ?? 0
}

export function listUsers(): User[] {
  return all<User>('SELECT id, name, role, active, created_at FROM users ORDER BY name')
}

export async function createUser(name: string, role: Role, password: string): Promise<number> {
  if (!name.trim()) throw new Error('Name is required.')
  if (password.length < 4) throw new Error('Password must be at least 4 characters.')
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const hash = await derive(password, salt)
  return insert('INSERT INTO users (name, role, salt, hash) VALUES (?, ?, ?, ?)', [name.trim(), role, toHex(salt), hash])
}

export async function verifyLogin(name: string, password: string): Promise<User | null> {
  const u = one<UserRow>('SELECT * FROM users WHERE name = ? AND active = 1', [name.trim()])
  if (!u) return null
  const hash = await derive(password, fromHex(u.salt))
  if (hash !== u.hash) return null
  return { id: u.id, name: u.name, role: u.role, active: u.active, created_at: u.created_at }
}

export function setUserRole(id: number, role: Role): void {
  run('UPDATE users SET role = ? WHERE id = ?', [role, id])
}
export function setUserActive(id: number, active: boolean): void {
  run('UPDATE users SET active = ? WHERE id = ?', [active ? 1 : 0, id])
}
export async function setUserPassword(id: number, password: string): Promise<void> {
  if (password.length < 4) throw new Error('Password must be at least 4 characters.')
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const hash = await derive(password, salt)
  run('UPDATE users SET salt = ?, hash = ? WHERE id = ?', [toHex(salt), hash, id])
}
export function deleteUser(id: number): void {
  run('DELETE FROM users WHERE id = ?', [id])
}

// ---- capability model ------------------------------------------------------

export type Capability = 'edit' | 'delete' | 'admin'

/** Role → capability. edit = create/edit/void/reconcile; delete = purge/recycle; admin = users/settings/locks. */
export function can(role: Role | undefined, cap: Capability): boolean {
  if (!role) return false
  if (role === 'admin') return true
  if (role === 'accountant') return cap === 'edit' || cap === 'delete'
  return false // viewer: read-only
}
