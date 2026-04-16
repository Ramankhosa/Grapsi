'use client'

import { useMemo, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { FileText } from 'lucide-react'

export interface PaperTypeOption {
  code: string
  name: string
  description?: string | null
  requiredSections: string[]
  optionalSections: string[]
  sectionOrder: string[]
  defaultWordLimits: Record<string, number>
  defaultCitationStyle?: string | null
  sortOrder?: number
}

interface PaperTypeSelectorProps {
  paperTypes: PaperTypeOption[]
  selectedCode?: string
  onSelect: (code: string) => void
}

const CATEGORY_RULES = [
  { match: 'THESIS', label: 'Thesis' },
  { match: 'REVIEW', label: 'Review' },
  { match: 'CONFERENCE', label: 'Conference' },
  { match: 'JOURNAL', label: 'Journal' },
  { match: 'BOOK', label: 'Book' },
  { match: 'CASE', label: 'Case Study' },
  { match: 'SHORT', label: 'Short' }
]

function getCategory(code: string): string {
  const upper = code.toUpperCase()
  const match = CATEGORY_RULES.find(rule => upper.includes(rule.match))
  return match ? match.label : 'Other'
}

function formatSectionList(sections: string[]): string {
  return sections.slice(0, 4).map(section => section.replace(/_/g, ' ')).join(', ')
}

function estimateWordCount(defaultWordLimits: Record<string, number>): number {
  return Object.values(defaultWordLimits || {}).reduce((sum, value) => sum + (Number(value) || 0), 0)
}

export default function PaperTypeSelector({ paperTypes, selectedCode, onSelect }: PaperTypeSelectorProps) {
  const [filter, setFilter] = useState('All')

  const categories = useMemo(() => {
    const counts = new Map<string, number>()
    paperTypes.forEach(type => {
      const category = getCategory(type.code)
      counts.set(category, (counts.get(category) || 0) + 1)
    })

    return ['All', ...Array.from(counts.keys()).sort()]
  }, [paperTypes])

  const filtered = useMemo(() => {
    if (filter === 'All') return paperTypes
    return paperTypes.filter(type => getCategory(type.code) === filter)
  }, [paperTypes, filter])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {categories.map(category => (
          <Button
            key={category}
            type="button"
            variant={filter === category ? 'default' : 'secondary'}
            onClick={() => setFilter(category)}
          >
            {category}
          </Button>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {filtered.map(type => {
          const isSelected = type.code === selectedCode
          const wordCount = estimateWordCount(type.defaultWordLimits)
          const required = formatSectionList(type.requiredSections)
          const optional = formatSectionList(type.optionalSections)

          return (
            <Card
              key={type.code}
              className={`border transition ${isSelected ? 'border-indigo-500 shadow-md' : 'border-gray-200 hover:border-indigo-300'}`}
            >
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <div className="rounded-md bg-indigo-50 p-2 text-indigo-600">
                        <FileText className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-gray-900">{type.name}</div>
                        <div className="text-xs text-gray-500">{type.code}</div>
                      </div>
                    </div>
                    {type.description && (
                      <p className="mt-2 text-xs text-gray-600">{type.description}</p>
                    )}
                  </div>
                  {isSelected && <Badge>Selected</Badge>}
                </div>

                <div className="grid gap-1 text-xs text-gray-600">
                  <div>
                    <span className="font-semibold text-gray-700">Typical length:</span>{' '}
                    {wordCount > 0 ? `~${wordCount.toLocaleString()} words` : 'Not set'}
                  </div>
                  <div>
                    <span className="font-semibold text-gray-700">Required:</span>{' '}
                    {required || 'Not set'}
                  </div>
                  <div>
                    <span className="font-semibold text-gray-700">Optional:</span>{' '}
                    {optional || 'None'}
                  </div>
                </div>

                <Button
                  type="button"
                  variant={isSelected ? 'default' : 'secondary'}
                  className="w-full"
                  onClick={() => onSelect(type.code)}
                >
                  {isSelected ? 'Selected' : 'Choose'}
                </Button>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
