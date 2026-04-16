'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'

interface BibliographyPreviewProps {
  sessionId: string
  authToken: string | null
}

export default function BibliographyPreview({ sessionId, authToken }: BibliographyPreviewProps) {
  const [bibliography, setBibliography] = useState('')
  const [unused, setUnused] = useState<any[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [bibtex, setBibtex] = useState('')

  const loadUnused = async () => {
    const response = await fetch(`/api/papers/${sessionId}/citations/unused`, {
      headers: { Authorization: `Bearer ${authToken}` }
    })
    if (!response.ok) return
    const data = await response.json()
    setUnused(data.citations || [])
  }

  const generateBibliography = async () => {
    try {
      setLoading(true)
      setMessage(null)
      const response = await fetch(`/api/papers/${sessionId}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({ action: 'generate_bibliography' })
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate bibliography')
      }
      setBibliography(data.bibliography || '')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to generate bibliography')
    } finally {
      setLoading(false)
    }
  }

  const exportBibtex = async () => {
    setMessage(null)
    const response = await fetch(`/api/papers/${sessionId}/citations/export`, {
      headers: { Authorization: `Bearer ${authToken}` }
    })
    const data = await response.json()
    if (!response.ok) {
      setMessage(data.error || 'Failed to export BibTeX')
      return
    }
    setBibtex(data.bibtex || '')
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(data.bibtex || '')
      setMessage('BibTeX copied to clipboard.')
    }
  }

  useEffect(() => {
    if (sessionId && authToken) {
      loadUnused().catch(() => undefined)
    }
  }, [sessionId, authToken])

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">References</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button onClick={generateBibliography} disabled={loading}>
              {loading ? 'Generating...' : 'Generate bibliography'}
            </Button>
            <Button variant="secondary" onClick={exportBibtex}>
              Export BibTeX
            </Button>
            <Button variant="secondary" disabled>
              Export RIS (soon)
            </Button>
            <Button variant="secondary" disabled>
              Copy plain text (soon)
            </Button>
          </div>
          <Textarea value={bibliography} readOnly rows={10} />
          {unused.length > 0 && (
            <div className="text-xs text-amber-700">
              Unused citations: {unused.length}. Consider citing or removing them before export.
            </div>
          )}
          {message && <div className="text-xs text-gray-600">{message}</div>}
        </CardContent>
      </Card>

      {bibtex && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">BibTeX Preview</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea value={bibtex} readOnly rows={8} />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
