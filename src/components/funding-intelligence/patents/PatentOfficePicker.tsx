'use client'

import { useId, useState } from 'react'
import { ChevronDown, Globe2, X } from 'lucide-react'
import { allCountryCodes, countryKey, countryNameFor } from '@/lib/geo/countries'

const regionalOffices: Record<string, string> = {
  EP: 'European Patent Office',
  WO: 'International applications (PCT / WIPO)',
  AP: 'African Regional Intellectual Property Organization',
  OA: 'African Intellectual Property Organization',
  EA: 'Eurasian Patent Organization',
  GC: 'Gulf Cooperation Council Patent Office',
}
const officeName = (code: string) => regionalOffices[code] || countryNameFor(code)
const offices = [...new Set([...allCountryCodes(), ...Object.keys(regionalOffices)])]
  .map(code => ({ code, name: officeName(code) }))
  .sort((a, b) => a.name.localeCompare(b.name, 'en'))
const maxOffices = 20

export default function PatentOfficePicker({ value, onChange }: { value: string[]; onChange: (value: string[]) => void }) {
  const filterId = useId()
  const [filter, setFilter] = useState('')
  const selected = value.filter(code => code !== '*')
  const isWorldwide = value.includes('*') && value.length === 1
  const isIndiaDefault = value.length === 0
  const search = countryKey(filter)
  const visible = offices.filter(({ code, name }) => countryKey(`${name} ${code}`).includes(search))
  const coverage = isWorldwide ? 'All available offices' : isIndiaDefault ? 'India (default)' : selected.length === 1 ? officeName(selected[0]) : `${selected.length} offices selected`

  return (
    <div className="min-w-0 text-sm text-slate-700">
      <details className="group">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 [&::-webkit-details-marker]:hidden">
          <Globe2 aria-hidden="true" className="h-4 w-4 shrink-0 text-blue-700" />
          <span className="min-w-0 flex-1"><span className="block text-xs font-semibold text-slate-600">Search coverage</span><span className="block font-medium text-slate-900">{coverage}</span></span>
          <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 group-open:rotate-180" />
        </summary>
        <div className="mt-2 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="flex flex-wrap gap-2">
            <button type="button" aria-pressed={isIndiaDefault} onClick={() => onChange([])} className="min-h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold aria-pressed:border-blue-600 aria-pressed:bg-blue-50">India (default)</button>
            <button type="button" aria-pressed={isWorldwide} onClick={() => onChange(['*'])} className="min-h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold aria-pressed:border-blue-600 aria-pressed:bg-blue-50">All available offices</button>
          </div>
          <label htmlFor={filterId} className="block text-xs font-semibold">Find a country or patent office</label>
          <input id={filterId} type="search" value={filter} onChange={event => setFilter(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') event.preventDefault() }} placeholder="e.g. United States, Japan, Europe" className="min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3" />
          <fieldset className="max-h-56 min-w-0 overflow-y-auto overscroll-contain rounded-lg border border-slate-200 bg-white p-1">
            <legend className="sr-only">Countries and regional patent offices</legend>
            {visible.length === 0 ? <p role="status" className="px-2 py-3 text-sm">No offices match your search.</p> : visible.map(({ code, name }) => {
              const checked = selected.includes(code)
              return <label key={code} className="flex min-h-9 items-center gap-2 rounded-md px-2 hover:bg-slate-50">
                <input type="checkbox" checked={checked} disabled={!checked && selected.length >= maxOffices} onChange={() => onChange(checked ? selected.filter(item => item !== code) : [...selected, code])} className="h-4 w-4 shrink-0 accent-blue-700" />
                <span className="flex-1 py-1">{name}</span><span aria-hidden="true" className="text-xs text-slate-500">{code}</span>
              </label>
            })}
          </fieldset>
          <p aria-live="polite" className="text-xs text-slate-600">{selected.length >= maxOffices ? '20 office limit reached. Remove an office to add another.' : 'Select up to 20 offices. Clearing the selection returns to India.'}</p>
        </div>
      </details>
      {selected.length > 0 && <ul aria-label="Selected offices" className="mt-2 flex flex-wrap gap-1.5">{selected.map(code => <li key={code}>
        <button type="button" aria-label={`Remove ${officeName(code)}`} onClick={() => onChange(selected.filter(item => item !== code))} className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-blue-50 px-2.5 text-xs font-medium text-blue-900 hover:bg-blue-100">{officeName(code)} <X aria-hidden="true" className="h-3.5 w-3.5" /></button>
      </li>)}</ul>}
    </div>
  )
}
