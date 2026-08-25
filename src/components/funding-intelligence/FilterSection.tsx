'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'

export type FilterSectionItem = { value: string | number; count: number }

/**
 * Collapsible checkbox facet used by the Funding Intelligence explorers
 * (awarded-project search and patent search). Shows the top ten values.
 */
export default function FilterSection({
  label, items, selected, onToggle, initialOpen = true, maxItems = 10,
}: {
  label: string
  items: FilterSectionItem[]
  selected: string[]
  onToggle: (value: string) => void
  initialOpen?: boolean
  maxItems?: number
}) {
  const [open, setOpen] = useState(initialOpen)
  const visibleItems = items.slice(0, maxItems)
  if (!items.length) return null

  return (
    <div className="border-b border-slate-200 py-4 last:border-0">
      <button type="button" onClick={() => setOpen((value) => !value)} className="flex w-full items-center justify-between text-left" aria-expanded={open}>
        <span className="text-sm font-semibold text-slate-800">{label}</span>
        <ChevronDown className={`h-4 w-4 text-slate-400 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open ? (
        <div className="mt-3 space-y-1.5">
          {visibleItems.map((item) => {
            const value = String(item.value)
            const active = selected.includes(value)
            return (
              <label key={value} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50">
                <input
                  type="checkbox"
                  checked={active}
                  onChange={() => onToggle(value)}
                  className="h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                />
                <span className="min-w-0 flex-1 truncate text-slate-600" title={value}>{value}</span>
                <span className="text-xs tabular-nums text-slate-400">{item.count}</span>
              </label>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
