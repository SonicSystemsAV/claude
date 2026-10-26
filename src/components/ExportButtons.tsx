import { Download, FileSpreadsheet, Printer, ChevronDown } from 'lucide-react'
import { clsx } from 'clsx'
import { exportCSV, exportXLSX, exportPDF, type ExportTable } from '../lib/exporters'

/**
 * A small CSV / Excel / PDF export menu. `build` is called at click time so the
 * export always reflects the current (sorted / filtered) view.
 */
export default function ExportButtons({ build, className }: { build: () => ExportTable; className?: string }) {
  return (
    <div className={clsx('flex items-center gap-1', className)}>
      <button className="btn-ghost flex items-center gap-1.5 text-sm" title="Export to Excel (.xlsx)" onClick={() => exportXLSX(build())}>
        <FileSpreadsheet size={15} /> Excel
      </button>
      <button className="btn-ghost flex items-center gap-1.5 text-sm" title="Export to CSV" onClick={() => exportCSV(build())}>
        <Download size={15} /> CSV
      </button>
      <button className="btn-ghost flex items-center gap-1.5 text-sm" title="Print / Save as PDF" onClick={() => exportPDF(build())}>
        <Printer size={15} /> PDF
      </button>
    </div>
  )
}

/** A clickable column header that shows the current sort direction. */
export function SortTh({
  label, sortKey, active, dir, onClick, className, align = 'left',
}: {
  label: string
  sortKey: string
  active: boolean
  dir: 'asc' | 'desc'
  onClick: (key: string) => void
  className?: string
  align?: 'left' | 'right'
}) {
  return (
    <th className={clsx('px-3 py-2 font-medium', align === 'right' && 'text-right', className)}>
      <button
        className={clsx('inline-flex items-center gap-1 hover:text-ink', align === 'right' && 'flex-row-reverse', active ? 'text-ink' : 'text-subtle')}
        onClick={() => onClick(sortKey)}
        title={`Sort by ${label}`}
      >
        {label}
        <ChevronDown size={12} className={clsx('transition-transform', !active && 'opacity-20', active && dir === 'asc' && 'rotate-180')} />
      </button>
    </th>
  )
}
