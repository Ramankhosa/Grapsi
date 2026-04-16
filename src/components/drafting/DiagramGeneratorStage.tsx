'use client'

import { useState } from 'react'

interface DiagramGeneratorStageProps {
  session: any
  patent: any
  onComplete: (data: any) => Promise<any>
  onRefresh: () => Promise<void>
}

async function sha256(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buf)
  const bytes = Array.from(new Uint8Array(digest))
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('')
}

export default function DiagramGeneratorStage({ session, patent, onComplete, onRefresh }: DiagramGeneratorStageProps) {
  const diagramSources = session?.diagramSources || []
  const figurePlans = session?.figurePlans || []
  const [error, setError] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [uploaded, setUploaded] = useState<Record<number, boolean>>({})

  const titleFor = (figureNo: number) => figurePlans.find((f: any) => f.figureNo === figureNo)?.title || `Figure ${figureNo}`

  const handleUpload = async (figureNo: number, file: File) => {
    try {
      setIsUploading(true)
      setError(null)
      const form = new FormData()
      form.append('file', file)
      const uploadResp = await fetch(`/api/projects/${patent.project.id}/patents/${patent.id}/upload`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` },
        body: form
      })
      if (!uploadResp.ok) throw new Error('Upload failed')
      const checksum = await sha256(file)
      await onComplete({ action: 'upload_diagram', sessionId: session?.id, figureNo, filename: (file as any).name, checksum })
      await onRefresh()
      setUploaded((prev) => ({ ...prev, [figureNo]: true }))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Diagram Generator</h2>
        <p className="text-gray-600">Review saved PlantUML, copy the code, and upload rendered images.</p>
      </div>

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-800">{error}</div>
      )}

      {diagramSources.length === 0 ? (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-yellow-800 text-sm">
          No diagrams saved yet. Go back to the previous step to generate PlantUML, then save each figure.
        </div>
      ) : (
        <div className="space-y-6">
          {diagramSources.map((d: any) => (
            <div key={d.figureNo} className="bg-white rounded-lg border p-4">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h3 className="font-medium text-gray-900 flex items-center">
                    {titleFor(d.figureNo)} (Fig.{d.figureNo})
                    {(uploaded[d.figureNo] || d.imageUploadedAt) && (
                      <span className="ml-2 inline-flex items-center text-blue-600 text-xs">
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.707a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/>
                        </svg>
                        <span className="ml-1">Uploaded</span>
                      </span>
                    )}
                  </h3>
                  <p className="text-xs text-gray-500">Checksum: {d.checksum?.slice(0, 12) || 'n/a'}</p>
                </div>
              </div>
              <div className="relative">
                <textarea className="w-full text-xs font-mono border rounded p-3 bg-gray-50" rows={8} readOnly value={d.plantuml} />
                <button onClick={() => navigator.clipboard.writeText(d.plantuml)} className="absolute top-2 right-2 inline-flex items-center px-2 py-1 text-xs border border-gray-300 rounded bg-white hover:bg-gray-50">Copy</button>
              </div>
              <div className="mt-3">
                <label className="block text-sm font-medium text-gray-700 mb-1">Upload rendered image (PNG/SVG)</label>
                <input type="file" accept=".png,.svg" onChange={(e) => e.target.files && handleUpload(d.figureNo, e.target.files[0])} disabled={isUploading} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
