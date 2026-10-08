/**
 * Desktop (Tauri) integration for file-based book storage.
 *
 * Everything here is guarded by isTauri(); in the browser dev build these
 * functions are no-ops or throw, and the UI falls back to download/upload.
 * Tauri packages are imported dynamically so the browser bundle never touches
 * their runtime internals.
 */

export const BOOK_EXT = 'sonicledger'
export const BOOKS_SUBDIR = 'sonictheledgerhog'

/** True when running inside the Tauri desktop shell. */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/** Last path segment, for display. */
export function basename(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] || path
}

/** Default folder for book files: <Documents>/sonictheledgerhog. Created if missing. */
export async function defaultBooksDir(): Promise<string> {
  const { documentDir, join } = await import('@tauri-apps/api/path')
  const docs = await documentDir()
  const dir = await join(docs, BOOKS_SUBDIR)
  const { mkdir, exists } = await import('@tauri-apps/plugin-fs')
  if (!(await exists(dir))) await mkdir(dir, { recursive: true })
  return dir
}

/** Native "open file" picker filtered to .sonicledger. Returns the path or null if cancelled. */
export async function pickOpenPath(): Promise<string | null> {
  const { open } = await import('@tauri-apps/plugin-dialog')
  const defaultPath = await defaultBooksDir().catch(() => undefined)
  const selected = await open({
    multiple: false,
    directory: false,
    defaultPath,
    filters: [{ name: 'Sonic the Ledgerhog book', extensions: [BOOK_EXT] }],
  })
  return typeof selected === 'string' ? selected : null
}

/** Native "save file" picker. Returns the chosen path (ensuring the extension) or null. */
export async function pickSavePath(suggestedName: string): Promise<string | null> {
  const { save } = await import('@tauri-apps/plugin-dialog')
  const { join } = await import('@tauri-apps/api/path')
  const dir = await defaultBooksDir().catch(() => undefined)
  const name = suggestedName.endsWith(`.${BOOK_EXT}`) ? suggestedName : `${suggestedName}.${BOOK_EXT}`
  const defaultPath = dir ? await join(dir, name) : name
  const chosen = await save({
    defaultPath,
    filters: [{ name: 'Sonic the Ledgerhog book', extensions: [BOOK_EXT] }],
  })
  if (!chosen) return null
  return chosen.endsWith(`.${BOOK_EXT}`) ? chosen : `${chosen}.${BOOK_EXT}`
}

/** Read a book file's raw bytes. */
export async function readBook(path: string): Promise<Uint8Array> {
  const { readFile } = await import('@tauri-apps/plugin-fs')
  return readFile(path)
}

/**
 * Write bytes to a book file atomically: write a temp file in the same folder,
 * then rename over the target, so a cloud sync mid-write can't corrupt the book.
 */
export async function writeBook(path: string, bytes: Uint8Array): Promise<void> {
  const { writeFile, rename, remove, exists } = await import('@tauri-apps/plugin-fs')
  const tmp = `${path}.tmp`
  await writeFile(tmp, bytes)
  try {
    if (await exists(path)) await remove(path)
    await rename(tmp, path)
  } catch (e) {
    // Fall back to a direct write if rename isn't permitted on this filesystem.
    await writeFile(path, bytes)
    try {
      if (await exists(tmp)) await remove(tmp)
    } catch {
      /* ignore */
    }
    throw e instanceof Error ? e : new Error(String(e))
  }
}

/** Last-modified time (ms) of a file, or null if it doesn't exist. Used for external-change detection. */
export async function fileMtimeMs(path: string): Promise<number | null> {
  try {
    const { stat } = await import('@tauri-apps/plugin-fs')
    const info = await stat(path)
    const mtime = info.mtime ? new Date(info.mtime).getTime() : null
    return mtime
  } catch {
    return null
  }
}
