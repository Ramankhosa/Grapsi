'use client'

import { useState } from 'react'
import Image from 'next/image'

export default function TestPlantUML() {
  const [code, setCode] = useState('@startuml\nAlice -> Bob: Hello\n@enduml')
  const [format, setFormat] = useState<'svg' | 'png'>('svg')
  const [imgUrl, setImgUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const render = async () => {
    try {
      setLoading(true)
      setError(null)
      setImgUrl(null)
      const resp = await fetch('/api/test/plantuml-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, format })
      })
      if (!resp.ok) {
        const j = await resp.json().catch(() => ({}))
        throw new Error(j.error || 'Render failed')
      }
      const blob = await resp.blob()
      const url = URL.createObjectURL(blob)
      setImgUrl(url)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Render failed')
    } finally {
      setLoading(false)
    }
  }

  const download = async () => {
    if (!imgUrl) return
    const a = document.createElement('a')
    a.href = imgUrl
    a.download = `diagram.${format}`
    a.click()
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">PlantUML Proxy Test</h1>
      <div className="mb-3 flex items-center space-x-2">
        <select value={format} onChange={(e) => setFormat(e.target.value as 'svg' | 'png')} className="border rounded px-2 py-1 text-sm">
          <option value="svg">SVG</option>
          <option value="png">PNG</option>
        </select>
        <button onClick={render} disabled={loading} className="px-3 py-1 rounded bg-indigo-600 text-white text-sm disabled:opacity-50">{loading ? 'Rendering…' : 'Render & Save'}</button>
        <button onClick={download} disabled={!imgUrl} className="px-3 py-1 rounded border text-sm disabled:opacity-50">Download</button>
      </div>
      <textarea className="w-full h-48 border rounded p-2 font-mono text-sm" value={code} onChange={(e) => setCode(e.target.value)} />
      {error && <div className="mt-3 text-sm text-red-700">{error}</div>}
      {imgUrl && (
        <div className="mt-4">
          <div className="relative w-full max-w-4xl mx-auto">
            <Image
              src={imgUrl}
              alt="preview"
              fill
              className="object-contain border rounded"
              sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
            />
          </div>
        </div>
      )}
    </div>
  )
}

