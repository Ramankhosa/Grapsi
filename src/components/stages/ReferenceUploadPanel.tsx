'use client'

import { useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import { ClipboardList, FileText, Loader2, Upload, X } from 'lucide-react'

type ReferenceUploadPanelProps = {
  mode: 'upload' | 'paste'
  selectedFile: File | null
  pastedText: string
  extracting: boolean
  error?: string | null
  onModeChange: (mode: 'upload' | 'paste') => void
  onFileChange: (file: File | null) => void
  onPastedTextChange: (value: string) => void
  onExtract: () => void
}

export default function ReferenceUploadPanel({
  mode,
  selectedFile,
  pastedText,
  extracting,
  error,
  onModeChange,
  onFileChange,
  onPastedTextChange,
  onExtract,
}: ReferenceUploadPanelProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)

  const triggerBrowse = () => {
    if (extracting) return
    inputRef.current?.click()
  }

  const handleDrop = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault()
    setIsDragOver(false)
    if (extracting) return
    const file = event.dataTransfer.files?.[0]
    if (file) onFileChange(file)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if ((event.key === 'Enter' || event.key === ' ') && !extracting) {
      event.preventDefault()
      triggerBrowse()
    }
  }

  return (
    <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Format Reference</div>
      <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">Set your export formatting</h2>
      <p className="mt-2 text-sm leading-7 text-slate-600">
        Upload a reference document or paste formatting guidelines from your target venue. We&apos;ll auto-detect the settings.
      </p>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={() => onModeChange('upload')}
          className={`inline-flex items-center justify-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium transition-all ${
            mode === 'upload'
              ? 'bg-slate-900 text-white'
              : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
          }`}
        >
          <FileText className="h-4 w-4" />
          Upload File
        </button>
        <button
          type="button"
          onClick={() => onModeChange('paste')}
          className={`inline-flex items-center justify-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium transition-all ${
            mode === 'paste'
              ? 'bg-slate-900 text-white'
              : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
          }`}
        >
          <ClipboardList className="h-4 w-4" />
          Paste Guidelines
        </button>
      </div>

      <div className={`mt-5 transition-opacity ${extracting ? 'opacity-60' : ''}`} aria-busy={extracting}>
        {mode === 'upload' ? (
          <>
            <input
              ref={inputRef}
              type="file"
              accept=".docx,.tex,text/x-tex,application/x-tex,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="hidden"
              onChange={(event) => onFileChange(event.target.files?.[0] || null)}
            />
            {selectedFile ? (
              <div className="inline-flex w-full items-center justify-between gap-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <FileText className="h-5 w-5 text-sky-600" />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-900">{selectedFile.name}</div>
                    <div className="text-xs text-slate-500">{formatFileSize(selectedFile.size)}</div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onFileChange(null)}
                  className="rounded-full p-1 text-slate-500 hover:bg-white hover:text-slate-700"
                  aria-label="Remove selected file"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={triggerBrowse}
                onDrop={handleDrop}
                onDragOver={(event) => {
                  event.preventDefault()
                  setIsDragOver(true)
                }}
                onDragLeave={() => setIsDragOver(false)}
                onKeyDown={handleKeyDown}
                className={`w-full rounded-2xl border-2 border-dashed p-10 text-center transition-colors ${
                  isDragOver
                    ? 'border-sky-400 bg-sky-50'
                    : 'border-slate-300 bg-slate-50'
                }`}
              >
                <Upload className="mx-auto h-8 w-8 text-slate-400" />
                <div className="mt-4 text-sm font-medium text-slate-900">Drop .docx or .tex file here</div>
                <div className="mt-1 text-sm text-slate-500">or click to browse</div>
                <div className="mt-4 text-xs text-slate-400">Accepted: .docx, .tex | Max size: 5 MB</div>
              </button>
            )}
          </>
        ) : (
          <div>
            <textarea
              value={pastedText}
              onChange={(event) => onPastedTextChange(event.target.value)}
              rows={8}
              aria-label="Paste formatting guidelines"
              className="min-h-[160px] w-full resize-none rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
              placeholder={`Paste your venue's formatting guidelines here...

e.g. "Manuscripts must use 10pt Times New Roman, double-spaced, IEEE format, with 1-inch margins on US Letter paper."`}
            />
            <div className="mt-2 text-right text-xs text-slate-400">{pastedText.length} characters</div>
          </div>
        )}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onExtract}
          disabled={extracting || (!selectedFile && !pastedText.trim())}
          className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-6 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {extracting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {extracting ? 'Extracting...' : 'Extract Settings'}
        </button>
        {error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">
            {error}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
