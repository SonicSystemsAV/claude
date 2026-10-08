import { useState } from 'react'
import { FileText, Receipt, HandCoins, Plus } from 'lucide-react'
import { clsx } from 'clsx'
import { useStore, useCan } from '../state/store'
import { DocumentList } from '../components/DocumentList'
import { DocumentForm } from '../components/DocumentForm'
import { PaymentForm } from '../components/PaymentForm'
import { getDocumentForEdit, type DocumentEditData } from '../db/documents'
import type { DocType } from '../db/types'

type Tab = 'invoice' | 'sales_receipt' | 'payment_received'
const TABS: { key: Tab; label: string; icon: typeof FileText }[] = [
  { key: 'invoice', label: 'Invoices', icon: FileText },
  { key: 'sales_receipt', label: 'Sales Receipts', icon: Receipt },
  { key: 'payment_received', label: 'Payments', icon: HandCoins },
]

export default function Sales() {
  const companyId = useStore((s) => s.currentCompanyId)
  const refresh = useStore((s) => s.refresh)
  const rev = useStore((s) => s.rev)
  const canEdit = useCan('edit')
  const [tab, setTab] = useState<Tab>('invoice')
  const [modal, setModal] = useState<'invoice' | 'sales_receipt' | 'receive' | null>(null)
  const [editing, setEditing] = useState<DocumentEditData | null>(null)
  if (companyId == null) return null

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Sales</h1>
        {canEdit && (
          <div className="flex gap-2">
            <button className="btn-outline" onClick={() => setModal('invoice')}><Plus size={15} /> Invoice</button>
            <button className="btn-outline" onClick={() => setModal('sales_receipt')}><Plus size={15} /> Sales receipt</button>
            <button className="btn-primary" onClick={() => setModal('receive')}><HandCoins size={15} /> Receive payment</button>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={clsx(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition',
              tab === t.key ? 'bg-brand-50 text-brand-700' : 'text-slate-500 hover:bg-slate-100',
            )}
          >
            <t.icon size={15} /> {t.label}
          </button>
        ))}
      </div>

      <div key={rev}>
        <DocumentList
          companyId={companyId}
          type={tab as DocType}
          onChange={refresh}
          onEdit={(id) => { const d = getDocumentForEdit(id); if (d) setEditing(d) }}
          showBalance={tab === 'invoice'}
        />
      </div>

      {(modal === 'invoice' || modal === 'sales_receipt') && (
        <DocumentForm type={modal} onClose={() => setModal(null)} onSaved={refresh} />
      )}
      {editing && (
        <DocumentForm
          type={editing.doc.type as 'invoice' | 'sales_receipt'}
          edit={editing}
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      )}
      {modal === 'receive' && (
        <PaymentForm kind="ar" onClose={() => setModal(null)} onSaved={refresh} />
      )}
    </div>
  )
}
