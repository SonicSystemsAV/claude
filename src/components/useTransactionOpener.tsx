import { useState, type ReactNode } from 'react'
import { getTransaction, type TransactionWithEntries } from '../db/repo'
import { getDocumentByTxnId, getDocumentForEdit, type DocumentEditData } from '../db/documents'
import type { DocType } from '../db/types'
import { DocumentForm } from './DocumentForm'
import { JournalEntryForm } from './JournalEntryForm'

const EDITABLE: DocType[] = ['invoice', 'bill', 'expense', 'sales_receipt']

/**
 * Routes "open this transaction" to the right editor: the document form for a
 * document-backed transaction, or the journal editor for a raw/manual/imported one.
 * Returns openTransaction(id) and the modal element to render.
 */
export function useTransactionOpener(companyId: number, onChanged: () => void): {
  openTransaction: (txnId: number) => void
  element: ReactNode
} {
  const [editDoc, setEditDoc] = useState<DocumentEditData | null>(null)
  const [editJournal, setEditJournal] = useState<TransactionWithEntries | null>(null)

  function openTransaction(txnId: number) {
    const doc = getDocumentByTxnId(txnId)
    if (doc && EDITABLE.includes(doc.type) && doc.status !== 'void') {
      const d = getDocumentForEdit(doc.id)
      if (d) { setEditDoc(d); return }
    }
    const t = getTransaction(txnId)
    if (t) setEditJournal(t)
  }

  const element = (
    <>
      {editDoc && EDITABLE.includes(editDoc.doc.type) && (
        <DocumentForm
          type={editDoc.doc.type as Extract<DocType, 'invoice' | 'bill' | 'expense' | 'sales_receipt'>}
          edit={editDoc}
          onClose={() => setEditDoc(null)}
          onSaved={onChanged}
        />
      )}
      {editJournal && (
        <JournalEntryForm
          companyId={companyId}
          edit={editJournal}
          onClose={() => setEditJournal(null)}
          onSaved={onChanged}
        />
      )}
    </>
  )

  return { openTransaction, element }
}
