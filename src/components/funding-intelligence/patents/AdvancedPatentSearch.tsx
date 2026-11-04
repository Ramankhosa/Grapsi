'use client'

import { PATENT_DATE_FILTERS, PATENT_TEXT_FILTERS, type PatentAdvancedSearch } from '@/lib/patentIntelligence/advancedSearch'

export default function AdvancedPatentSearch({ value, onChange, disabled }: {
  value: PatentAdvancedSearch
  onChange: (value: PatentAdvancedSearch) => void
  disabled?: boolean
}) {
  const inputClass = 'mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal text-slate-800'
  const scope = value.jurisdictions.length === 0 ? 'india' : value.jurisdictions.join(',') === '*' ? 'worldwide' : 'selected'
  return (
    <fieldset disabled={disabled} className="space-y-4 border-t border-slate-100 pt-4">
      <legend className="sr-only">Search options</legend>
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="text-xs font-semibold text-slate-600">Search method
          <select value={value.mode} onChange={event => {
            const mode = event.target.value === 'structured' ? 'structured' : 'hybrid'
            onChange({ ...value, mode, sort: mode === 'structured' ? 'publicationDateDesc' : 'relevance' })
          }} className={inputClass}>
            <option value="hybrid">By meaning</option><option value="structured">By fields and dates</option>
          </select>
        </label>
        <label className="text-xs font-semibold text-slate-600">Search coverage
          <select value={scope} onChange={event => {
            const scopes = { india: [], worldwide: ['*'], selected: ['IN'] }
            onChange({ ...value, jurisdictions: scopes[event.target.value as keyof typeof scopes] })
          }} className={inputClass}>
            <option value="india">India (default)</option>
            <option value="worldwide">All available offices</option>
            <option value="selected">Selected patent offices</option>
          </select>
        </label>
        {value.mode === 'structured' ? <label className="text-xs font-semibold text-slate-600">Order all matches by
          <select value={value.sort} onChange={event => onChange({ ...value, sort: event.target.value as PatentAdvancedSearch['sort'] })} className={inputClass}>
            <option value="publicationDateDesc">Publication date, newest first</option><option value="filingDateDesc">Filing date, newest first</option><option value="grantDateDesc">Grant date, newest first</option><option value="titleAsc">Title, A–Z</option>
          </select>
        </label> : null}
      </div>
      {scope === 'selected' ? <label className="block text-xs font-semibold text-slate-600">Patent office codes
        <input
          required
          pattern={String.raw`\s*[A-Za-z]{2}(\s*,\s*[A-Za-z]{2}){0,19}\s*`}
          placeholder="US, EP, WO"
          value={value.jurisdictions.join(',')}
          onChange={event => onChange({ ...value, jurisdictions: event.target.value.split(',') })}
          className={inputClass}
        />
        <span className="mt-1 block font-normal text-slate-500">Enter up to 20 two-letter office codes, separated by commas.</span>
      </label> : null}
      <p className="text-xs leading-5 text-slate-500">{value.mode === 'structured' ? 'Find individual publications with filters and page through matches. A query is optional and matches literal text in the title or abstract.' : 'Describe the invention to retrieve a ranked shortlist. The filters below narrow the corpus before matching.'}</p>
      <details open={value.mode === 'structured' || Object.keys(value.filters).length > 0}>
        <summary className="cursor-pointer text-sm font-semibold text-blue-700">Filter the patent corpus</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PATENT_TEXT_FILTERS.map(([key, label]) => {
            const raw = value.filters[key]
            const array = key === 'applicants' || key === 'inventors' || key === 'classifications'
            return <label key={key} className="text-xs font-semibold text-slate-600">{label}
              <input maxLength={array ? 6019 : 300} value={Array.isArray(raw) ? raw.join('|') : raw || ''} placeholder={array ? 'Separate alternatives with |' : undefined} onChange={event => {
                const filters = { ...value.filters }
                if (event.target.value) Object.assign(filters, { [key]: array ? event.target.value.split('|') : event.target.value })
                else delete filters[key]
                onChange({ ...value, filters })
              }} className={inputClass} />
            </label>
          })}
          {PATENT_DATE_FILTERS.map(([key, label]) => <label key={key} className="text-xs font-semibold text-slate-600">{label}
            <input type="date" value={value.filters[key] || ''} onChange={event => {
              const filters = { ...value.filters }
              if (event.target.value) filters[key] = event.target.value
              else delete filters[key]
              onChange({ ...value, filters })
            }} className={inputClass} />
          </label>)}
        </div>
        <p className="mt-3 text-xs leading-5 text-slate-500">Filters apply together; alternatives within a field match any entry. Date bounds include both days. Grant dates are shown only when explicitly recorded; records without that date are excluded by grant-date filters.</p>
      </details>
    </fieldset>
  )
}
