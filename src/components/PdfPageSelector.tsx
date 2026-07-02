'use client'

/* eslint-disable @next/next/no-img-element */
import { useEffect, useMemo, useState } from 'react'

import {
  MAX_SELECTED_TEMPLATE_PDF_PAGES,
  formatPageRangeInput,
  getDefaultTemplatePdfPages,
  parsePageRangeInput,
} from '@/lib/pdf/pageSelection'

export type PdfDocumentState = {
  totalPages: number | null
  loading: boolean
  error: string | null
}

type PdfPageSelectorProps = {
  file: File | null
  selectedPages: number[]
  onSelectedPagesChange: (pages: number[]) => void
  onDocumentStateChange?: (state: PdfDocumentState) => void
  onValidationErrorChange?: (error: string | null) => void
  maxSelectedPages?: number
  title?: string
}

type ThumbnailState = {
  pageNumber: number
  dataUrl: string | null
}

const MAX_THUMBNAIL_PAGES = 30
const THUMBNAIL_BATCH_SIZE = 4

function isPdfFile(file: File | null) {
  if (!file) return false
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
}

function sortPages(pages: number[]) {
  return Array.from(new Set(pages)).sort((a, b) => a - b)
}

export default function PdfPageSelector({
  file,
  selectedPages,
  onSelectedPagesChange,
  onDocumentStateChange,
  onValidationErrorChange,
  maxSelectedPages = MAX_SELECTED_TEMPLATE_PDF_PAGES,
  title = 'Template pages',
}: PdfPageSelectorProps) {
  const [totalPages, setTotalPages] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [thumbnailsLoading, setThumbnailsLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [rangeInput, setRangeInput] = useState('')
  const [rangeError, setRangeError] = useState<string | null>(null)
  const [isEditingRange, setIsEditingRange] = useState(false)
  const [thumbnails, setThumbnails] = useState<ThumbnailState[]>([])

  const pdfFile = isPdfFile(file)
  const selectedSet = useMemo(() => new Set(selectedPages), [selectedPages])
  const visibleThumbnailCount = Math.min(totalPages || 0, MAX_THUMBNAIL_PAGES)
  const selectionRequired = Boolean(totalPages || loadError)

  useEffect(() => {
    onDocumentStateChange?.({ totalPages, loading, error: loadError })
  }, [loadError, loading, onDocumentStateChange, totalPages])

  useEffect(() => {
    onValidationErrorChange?.(rangeError)
  }, [onValidationErrorChange, rangeError])

  useEffect(() => {
    if (!isEditingRange) {
      setRangeInput(formatPageRangeInput(selectedPages))
    }
  }, [isEditingRange, selectedPages])

  useEffect(() => {
    let canceled = false

    async function loadPdf() {
      setTotalPages(null)
      setLoadError(null)
      setRangeError(null)
      setThumbnails([])
      setThumbnailsLoading(false)
      setRangeInput('')
      onSelectedPagesChange([])

      if (!pdfFile || !file) {
        setLoading(false)
        return
      }

      setLoading(true)
      try {
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
        const data = new Uint8Array(await file.arrayBuffer())
        const documentTask = pdfjs.getDocument({
          data,
          useSystemFonts: true,
          isEvalSupported: false,
        })
        const document = await documentTask.promise

        if (canceled) return

        const pageCount = Number(document.numPages || 0)
        setTotalPages(pageCount)
        const defaultPages = getDefaultTemplatePdfPages(pageCount)
        onSelectedPagesChange(defaultPages)
        setRangeInput(formatPageRangeInput(defaultPages))
        setLoading(false)
        setThumbnailsLoading(true)

        const nextThumbnails: ThumbnailState[] = []
        for (let startPage = 1; startPage <= Math.min(pageCount, MAX_THUMBNAIL_PAGES); startPage += THUMBNAIL_BATCH_SIZE) {
          if (canceled) return

          const batchEnd = Math.min(startPage + THUMBNAIL_BATCH_SIZE - 1, pageCount, MAX_THUMBNAIL_PAGES)
          const batch = await Promise.all(
            Array.from({ length: batchEnd - startPage + 1 }, async (_, index) => {
              const pageNumber = startPage + index
              try {
                const page = await document.getPage(pageNumber)
                const baseViewport = page.getViewport({ scale: 1 })
                const scale = Math.min(0.32, 120 / Math.max(baseViewport.width, 1))
                const viewport = page.getViewport({ scale })
                const canvas = window.document.createElement('canvas')
                const context = canvas.getContext('2d', { alpha: false })
                if (!context) return { pageNumber, dataUrl: null }

                canvas.width = Math.ceil(viewport.width)
                canvas.height = Math.ceil(viewport.height)
                context.fillStyle = '#ffffff'
                context.fillRect(0, 0, canvas.width, canvas.height)
                await page.render({ canvas, canvasContext: context, viewport }).promise
                return { pageNumber, dataUrl: canvas.toDataURL('image/jpeg', 0.78) }
              } catch {
                return { pageNumber, dataUrl: null }
              }
            })
          )
          nextThumbnails.push(...batch)

          if (!canceled) {
            setThumbnails([...nextThumbnails])
          }
        }
        await document.destroy()
      } catch (error) {
        if (canceled) return
        try {
          const { PDFDocument } = await import('pdf-lib')
          const fallbackDocument = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true })
          const pageCount = fallbackDocument.getPageCount()
          const defaultPages = getDefaultTemplatePdfPages(pageCount)
          setTotalPages(pageCount)
          onSelectedPagesChange(defaultPages)
          setRangeInput(formatPageRangeInput(defaultPages))
          setLoadError('Page count detected, but thumbnails are unavailable for this PDF.')
        } catch {
          setLoadError(error instanceof Error ? error.message : 'PDF preview failed. Enter page ranges manually.')
        }
      } finally {
        if (!canceled) {
          setLoading(false)
          setThumbnailsLoading(false)
        }
      }
    }

    void loadPdf()

    return () => {
      canceled = true
    }
  }, [file, onSelectedPagesChange, pdfFile])

  if (!pdfFile) {
    return null
  }

  const togglePage = (pageNumber: number) => {
    setRangeError(null)
    const next = selectedSet.has(pageNumber)
      ? selectedPages.filter((page) => page !== pageNumber)
      : sortPages([...selectedPages, pageNumber])

    if (next.length > maxSelectedPages) {
      setRangeError(`Select ${maxSelectedPages} pages or fewer.`)
      return
    }

    onSelectedPagesChange(next)
    setRangeInput(formatPageRangeInput(next))
  }

  const handleRangeChange = (value: string) => {
    setRangeInput(value)
    setIsEditingRange(true)

    const parsed = parsePageRangeInput(value, {
      totalPages,
      maxPages: maxSelectedPages,
    })
    setRangeError(parsed.error)
    if (!parsed.error) {
      onSelectedPagesChange(parsed.pages)
    }
  }

  const commitRangeInput = () => {
    setIsEditingRange(false)
    const parsed = parsePageRangeInput(rangeInput, {
      totalPages,
      maxPages: maxSelectedPages,
    })
    setRangeError(parsed.error)
    if (!parsed.error) {
      onSelectedPagesChange(parsed.pages)
      setRangeInput(formatPageRangeInput(parsed.pages))
    }
  }

  return (
    <div className="mt-3 rounded-md border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</div>
          <div className="mt-1 text-sm font-medium text-slate-800">
            {loading
              ? 'Preparing PDF pages...'
              : totalPages
                ? `${selectedPages.length} of ${totalPages} selected`
                : `${selectedPages.length} selected`}
          </div>
        </div>
        <div className="text-xs font-semibold text-slate-500">
          Max {maxSelectedPages} pages
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          value={rangeInput}
          onChange={(event) => handleRangeChange(event.target.value)}
          onFocus={() => setIsEditingRange(true)}
          onBlur={commitRangeInput}
          placeholder="1-3, 7, 10-12"
          className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
        />
        {totalPages ? (
          <button
            type="button"
            onClick={() => onSelectedPagesChange(getDefaultTemplatePdfPages(totalPages))}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            {totalPages > maxSelectedPages ? `First ${maxSelectedPages}` : 'Select all'}
          </button>
        ) : null}
      </div>

      {selectionRequired && selectedPages.length === 0 && !rangeError ? (
        <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
          Select the template pages before extraction.
        </div>
      ) : null}
      {rangeError ? (
        <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
          {rangeError}
        </div>
      ) : null}
      {loadError ? (
        <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
          {loadError}
        </div>
      ) : null}

      {visibleThumbnailCount > 0 ? (
        <div className="mt-3 grid max-h-72 grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-4 md:grid-cols-5">
          {Array.from({ length: visibleThumbnailCount }, (_, index) => {
            const pageNumber = index + 1
            const thumbnail = thumbnails.find((entry) => entry.pageNumber === pageNumber)
            const selected = selectedSet.has(pageNumber)

            return (
              <button
                type="button"
                key={pageNumber}
                onClick={() => togglePage(pageNumber)}
                className={`relative min-h-[116px] rounded-md border p-1 text-left transition-colors ${
                  selected
                    ? 'border-emerald-500 bg-emerald-50'
                    : 'border-slate-200 bg-slate-50 hover:border-emerald-300'
                }`}
              >
                <div className="flex h-24 items-center justify-center overflow-hidden rounded-sm bg-white">
                  {thumbnail?.dataUrl ? (
                    <img src={thumbnail.dataUrl} alt={`Page ${pageNumber}`} className="max-h-full max-w-full object-contain" />
                  ) : (
                    <span className="text-xs font-semibold text-slate-400">Page {pageNumber}</span>
                  )}
                </div>
                <div className="mt-1 flex items-center justify-between text-xs font-semibold text-slate-700">
                  <span>Page {pageNumber}</span>
                  <span className={selected ? 'text-emerald-700' : 'text-slate-400'}>
                    {selected ? 'Selected' : 'Tap'}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      ) : null}

      {thumbnailsLoading ? (
        <div className="mt-2 text-xs text-slate-500">Loading page previews...</div>
      ) : null}

      {totalPages && totalPages > MAX_THUMBNAIL_PAGES ? (
        <div className="mt-2 text-xs text-slate-500">
          Showing the first {MAX_THUMBNAIL_PAGES} pages. Use the range field for later pages.
        </div>
      ) : null}
    </div>
  )
}
