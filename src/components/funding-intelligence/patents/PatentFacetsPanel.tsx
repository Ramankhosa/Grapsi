'use client'

import { SlidersHorizontal } from 'lucide-react'

import { countActivePatentFilters } from '@/lib/patentIntelligence/searchCore'
import type { PatentFacets, PatentFilters } from '@/lib/patentIntelligence/types'
import FilterSection from '../FilterSection'

/**
 * Client-side facets over the returned page of results. Counts come from the
 * unfiltered page (derivePatentFacets) so they stay fixed while toggling.
 */
export default function PatentFacetsPanel({ facets, filters, onChange, onClear }: {
  facets: PatentFacets
  filters: PatentFilters
  onChange: (filters: PatentFilters) => void
  onClear: () => void
}) {
  const toggle = (key: keyof PatentFilters, value: string) => {
    const current = filters[key]
    onChange({ ...filters, [key]: current.includes(value) ? current.filter((item) => item !== value) : [...current, value] })
  }
  const activeCount = countActivePatentFilters(filters)
  const hasAny = facets.jurisdictions.length + facets.applicants.length + facets.years.length + facets.classifications.length + facets.kinds.length > 0

  return (
    <div>
      <div className="flex items-center justify-between border-b border-slate-200 pb-4">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-teal-700" />
          <span className="font-semibold text-slate-900">Refine results</span>
          {activeCount ? <span className="rounded-full bg-teal-100 px-2 py-0.5 text-xs font-semibold text-teal-800">{activeCount}</span> : null}
        </div>
        {activeCount ? <button type="button" onClick={onClear} className="text-xs font-semibold text-teal-700 hover:text-teal-900">Clear all</button> : null}
      </div>
      {!hasAny ? <p className="pt-4 text-xs leading-5 text-slate-500">Facets appear once a search returns results.</p> : null}
      <FilterSection label="Jurisdiction" items={facets.jurisdictions} selected={filters.jurisdictions} onToggle={(value) => toggle('jurisdictions', value)} />
      <FilterSection label="Applicant" items={facets.applicants} selected={filters.applicants} onToggle={(value) => toggle('applicants', value)} maxItems={15} />
      <FilterSection label="Year" items={facets.years} selected={filters.years} onToggle={(value) => toggle('years', value)} maxItems={12} />
      <FilterSection label="Classification (IPC/CPC)" items={facets.classifications} selected={filters.classifications} onToggle={(value) => toggle('classifications', value)} initialOpen={false} maxItems={15} />
      <FilterSection label="Kind" items={facets.kinds} selected={filters.kinds} onToggle={(value) => toggle('kinds', value)} initialOpen={false} />
    </div>
  )
}
