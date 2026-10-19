/**
 * Turn files the owner drops into the assistant chat into Anthropic content
 * blocks the model can actually read — so you can attach an old QuickBooks
 * balance report (PDF, screenshot, or CSV/text export) and ask the assistant
 * to compare it against the live books.
 *
 *   - Images (PNG/JPEG/GIF/WebP) → an image block (base64).
 *   - PDFs                        → a document block (base64).
 *   - CSV / plain text / JSON     → a document block carrying the text.
 *
 * Spreadsheets (.xlsx/.xls) can't be read directly — we ask the owner to
 * export a CSV instead. Everything is read in the browser; nothing is written
 * to disk and no file leaves the device except inside the API request the
 * owner's own key authorizes.
 */

import type { ContentBlock, ImageBlock, DocumentBlock } from '../db/assistant'

export type AttachmentKind = 'image' | 'pdf' | 'text'

export interface Attachment {
  name: string
  kind: AttachmentKind
  mediaType: string
  /** base64 for image/pdf; raw UTF-8 text for text. */
  data: string
  /** Byte size of the original file, for display. */
  size: number
}

/** Hard cap per file so one giant attachment can't blow the request up. */
const MAX_BYTES = 10 * 1024 * 1024 // 10 MB

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
const TEXT_EXT = /\.(csv|tsv|txt|json|md|log|qbo|iif)$/i

function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onerror = () => reject(new Error(`Could not read ${file.name}.`))
    r.onload = () => resolve(String(r.result ?? ''))
    r.readAsText(file)
  })
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onerror = () => reject(new Error(`Could not read ${file.name}.`))
    r.onload = () => {
      const s = String(r.result ?? '')
      const comma = s.indexOf(',')
      resolve(comma >= 0 ? s.slice(comma + 1) : s) // strip the data: prefix
    }
    r.readAsDataURL(file)
  })
}

/** Read one picked file into an Attachment, or throw a friendly error. */
export async function readAttachment(file: File): Promise<Attachment> {
  if (file.size > MAX_BYTES) {
    throw new Error(`${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB — too big to attach (limit 10 MB). Try a smaller export or a single page.`)
  }
  const type = file.type || ''
  const lower = file.name.toLowerCase()

  if (IMAGE_TYPES.has(type) || /\.(png|jpe?g|gif|webp)$/i.test(lower)) {
    const mediaType = IMAGE_TYPES.has(type) ? type : lower.endsWith('.png') ? 'image/png'
      : lower.endsWith('.gif') ? 'image/gif' : lower.endsWith('.webp') ? 'image/webp' : 'image/jpeg'
    return { name: file.name, kind: 'image', mediaType, data: await readAsBase64(file), size: file.size }
  }

  if (type === 'application/pdf' || lower.endsWith('.pdf')) {
    return { name: file.name, kind: 'pdf', mediaType: 'application/pdf', data: await readAsBase64(file), size: file.size }
  }

  if (/\.(xlsx|xls|numbers)$/i.test(lower)) {
    throw new Error(`${file.name} is a spreadsheet, which I can't read directly. Export it as CSV (File → Save As / Export → .csv) and attach that.`)
  }

  if (type.startsWith('text/') || TEXT_EXT.test(lower) || type === 'application/json') {
    return { name: file.name, kind: 'text', mediaType: 'text/plain', data: await readAsText(file), size: file.size }
  }

  throw new Error(`${file.name} isn't a supported type. Attach a PDF, an image (PNG/JPEG), or a CSV/text export.`)
}

/** Turn one attachment into the Anthropic content block the API expects. */
export function attachmentToBlock(a: Attachment): ContentBlock {
  if (a.kind === 'image') {
    const block: ImageBlock = { type: 'image', source: { type: 'base64', media_type: a.mediaType, data: a.data } }
    return block
  }
  if (a.kind === 'pdf') {
    const block: DocumentBlock = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: a.data }, title: a.name }
    return block
  }
  const block: DocumentBlock = { type: 'document', source: { type: 'text', media_type: 'text/plain', data: a.data }, title: a.name }
  return block
}

/** Build the user message content from the typed text + any attachments.
 *  Returns a plain string when there are no attachments (the common case). */
export function buildUserContent(text: string, attachments: Attachment[]): string | ContentBlock[] {
  if (attachments.length === 0) return text
  const blocks: ContentBlock[] = attachments.map(attachmentToBlock)
  // The question/instruction goes last so it reads as "here are the files, now…".
  blocks.push({ type: 'text', text: text || 'Please review the attached file(s).' })
  return blocks
}

export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
