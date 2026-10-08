import { useState } from 'react'
import { X } from 'lucide-react'
import { createContact, updateContact } from '../db/repo'
import type { Contact, ContactKind } from '../db/types'

/** Slide-over drawer to create or edit a customer/supplier with full details. */
export function ContactForm({
  companyId,
  edit,
  defaultKind,
  onClose,
  onSaved,
}: {
  companyId: number
  edit?: Contact
  defaultKind?: ContactKind
  onClose: () => void
  onSaved: (contactId: number, name: string) => void
}) {
  const [f, setF] = useState({
    name: edit?.name ?? '',
    kind: (edit?.kind ?? defaultKind ?? 'customer') as ContactKind,
    email: edit?.email ?? '',
    phone: edit?.phone ?? '',
    address_line1: edit?.address_line1 ?? '',
    address_line2: edit?.address_line2 ?? '',
    city: edit?.city ?? '',
    province: edit?.province ?? '',
    postal: edit?.postal ?? '',
    country: edit?.country ?? '',
    website: edit?.website ?? '',
    notes: edit?.notes ?? '',
  })
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const set = (patch: Partial<typeof f>) => setF((prev) => ({ ...prev, ...patch }))

  function save() {
    setError(null)
    setSaving(true)
    try {
      const input = {
        name: f.name,
        kind: f.kind,
        email: f.email || null,
        phone: f.phone || null,
        address_line1: f.address_line1 || null,
        address_line2: f.address_line2 || null,
        city: f.city || null,
        province: f.province || null,
        postal: f.postal || null,
        country: f.country || null,
        website: f.website || null,
        notes: f.notes || null,
      }
      const id = edit ? (updateContact(edit.id, input), edit.id) : createContact(companyId, input)
      onSaved(id, f.name.trim())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex justify-end bg-slate-900/40" onClick={onClose}>
      <div className="flex h-full w-full max-w-md flex-col bg-surface shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h2 className="text-lg font-semibold text-slate-900">{edit ? 'Edit contact' : 'New contact'}</h2>
          <button className="btn-ghost p-1" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="flex-1 space-y-4 overflow-auto p-5">
          <div className="grid grid-cols-2 gap-3">
            <label className="col-span-2 text-sm">
              <span className="mb-1 block text-xs font-medium text-slate-500">Name</span>
              <input className="w-full rounded-md border border-slate-300 px-3 py-1.5" value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="Business or person" />
            </label>
            <label className="col-span-2 text-sm">
              <span className="mb-1 block text-xs font-medium text-slate-500">Type</span>
              <select className="w-full rounded-md border border-slate-300 px-3 py-1.5" value={f.kind} onChange={(e) => set({ kind: e.target.value as ContactKind })}>
                <option value="customer">Customer</option>
                <option value="supplier">Supplier / Vendor</option>
                <option value="both">Both</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium text-slate-500">Email</span>
              <input className="w-full rounded-md border border-slate-300 px-3 py-1.5" value={f.email} onChange={(e) => set({ email: e.target.value })} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium text-slate-500">Phone</span>
              <input className="w-full rounded-md border border-slate-300 px-3 py-1.5" value={f.phone} onChange={(e) => set({ phone: e.target.value })} />
            </label>
          </div>

          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Address</div>
            <div className="grid grid-cols-2 gap-3">
              <input className="col-span-2 rounded-md border border-slate-300 px-3 py-1.5 text-sm" placeholder="Street address" value={f.address_line1} onChange={(e) => set({ address_line1: e.target.value })} />
              <input className="col-span-2 rounded-md border border-slate-300 px-3 py-1.5 text-sm" placeholder="Suite / unit (optional)" value={f.address_line2} onChange={(e) => set({ address_line2: e.target.value })} />
              <input className="rounded-md border border-slate-300 px-3 py-1.5 text-sm" placeholder="City" value={f.city} onChange={(e) => set({ city: e.target.value })} />
              <input className="rounded-md border border-slate-300 px-3 py-1.5 text-sm" placeholder="Province / State" value={f.province} onChange={(e) => set({ province: e.target.value })} />
              <input className="rounded-md border border-slate-300 px-3 py-1.5 text-sm" placeholder="Postal / ZIP" value={f.postal} onChange={(e) => set({ postal: e.target.value })} />
              <input className="rounded-md border border-slate-300 px-3 py-1.5 text-sm" placeholder="Country" value={f.country} onChange={(e) => set({ country: e.target.value })} />
            </div>
          </div>

          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-slate-500">Website</span>
            <input className="w-full rounded-md border border-slate-300 px-3 py-1.5" value={f.website} onChange={(e) => set({ website: e.target.value })} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-slate-500">Notes</span>
            <textarea className="w-full rounded-md border border-slate-300 px-3 py-1.5" rows={3} value={f.notes} onChange={(e) => set({ notes: e.target.value })} />
          </label>

          {error && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={saving || !f.name.trim()}>{saving ? 'Saving…' : 'Save contact'}</button>
        </div>
      </div>
    </div>
  )
}
