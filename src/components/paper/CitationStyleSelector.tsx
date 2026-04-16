'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

export interface CitationStyleOption {
  code: string
  name: string
  inTextFormatTemplate: string
  bibliographySortOrder?: string
}

interface CitationStyleSelectorProps {
  styles: CitationStyleOption[]
  selectedCode?: string
  onSelect: (code: string) => void
}

const DISCIPLINE_GROUPS: Array<{ label: string; codes: string[] }> = [
  { label: 'Social Sciences', codes: ['APA', 'HARVARD'] },
  { label: 'Humanities', codes: ['MLA', 'CHICAGO'] },
  { label: 'Sciences & Engineering', codes: ['IEEE', 'ACM', 'NATURE', 'VANCOUVER', 'AMA'] }
]

function resolveGroup(code: string): string {
  const upper = code.toUpperCase()
  const group = DISCIPLINE_GROUPS.find(item =>
    item.codes.some(prefix => upper.startsWith(prefix))
  )
  return group ? group.label : 'Other'
}

export default function CitationStyleSelector({
  styles,
  selectedCode,
  onSelect
}: CitationStyleSelectorProps) {
  const [preview, setPreview] = useState<{ inText: string; bibliography: string } | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)

  useEffect(() => {
    const loadPreview = async () => {
      if (!selectedCode) {
        setPreview(null)
        return
      }
      try {
        setLoadingPreview(true)
        const response = await fetch(`/api/citation-styles/${selectedCode}/preview`)
        if (!response.ok) {
          setPreview(null)
          return
        }
        const data = await response.json()
        setPreview({ inText: data.inText || '', bibliography: data.bibliography || '' })
      } catch {
        setPreview(null)
      } finally {
        setLoadingPreview(false)
      }
    }

    loadPreview()
  }, [selectedCode])

  const grouped = useMemo(() => {
    const map = new Map<string, CitationStyleOption[]>()
    styles.forEach(style => {
      const group = resolveGroup(style.code)
      if (!map.has(group)) map.set(group, [])
      map.get(group)!.push(style)
    })
    return Array.from(map.entries())
  }, [styles])

  return (
    <div className="grid gap-4 lg:grid-cols-[1.4fr,1fr]">
      <div className="space-y-4">
        {grouped.map(([group, groupStyles]) => (
          <div key={group} className="space-y-2">
            <div className="text-xs font-semibold uppercase text-gray-500">{group}</div>
            <div className="grid gap-3 md:grid-cols-2">
              {groupStyles.map(style => {
                const isSelected = style.code === selectedCode
                return (
                  <Card
                    key={style.code}
                    className={`border transition ${isSelected ? 'border-indigo-500 shadow-sm' : 'border-gray-200 hover:border-indigo-300'}`}
                  >
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-sm font-semibold text-gray-900">{style.name}</div>
                          <div className="text-xs text-gray-500">{style.code}</div>
                        </div>
                        {isSelected && <Badge>Selected</Badge>}
                      </div>
                      <div className="text-xs text-gray-600">
                        In-text: {style.inTextFormatTemplate || 'Sample not configured'}
                      </div>
                      <Button
                        type="button"
                        variant={isSelected ? 'default' : 'secondary'}
                        className="w-full"
                        onClick={() => onSelect(style.code)}
                      >
                        {isSelected ? 'Selected' : 'Choose'}
                      </Button>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      <Card className="h-fit">
        <CardContent className="p-4 space-y-3">
          <div className="text-sm font-semibold text-gray-900">Style Preview</div>
          {loadingPreview && <div className="text-xs text-gray-500">Loading preview...</div>}
          {!loadingPreview && !selectedCode && (
            <div className="text-xs text-gray-500">Select a style to see formatted examples.</div>
          )}
          {!loadingPreview && selectedCode && preview && (
            <div className="space-y-3 text-xs text-gray-700">
              <div>
                <div className="font-semibold text-gray-700">In-text</div>
                <div className="mt-1 rounded border border-gray-200 bg-gray-50 p-2">{preview.inText}</div>
              </div>
              <div>
                <div className="font-semibold text-gray-700">Bibliography</div>
                <div className="mt-1 rounded border border-gray-200 bg-gray-50 p-2 whitespace-pre-wrap">{preview.bibliography}</div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
