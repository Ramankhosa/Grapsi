'use client'
/* eslint-disable @next/next/no-img-element */

import { useState, useRef, useEffect } from 'react'
import { Loader2, X, ExternalLink, Upload, Check, AlertTriangle, ArrowRight, Image as ImageIcon, Download } from 'lucide-react'

const MINI_PAINT_URL = 'https://viliusle.github.io/miniPaint/'

interface ImageEditorProps {
  imageSrc: string
  onSave: (editedImageBase64: string, imageObject: any) => void
  onClose: () => void
  title?: string
}

type EditorStep = 'confirm' | 'editing' | 'upload'

export default function ImageEditor({ imageSrc, onSave, onClose, title }: ImageEditorProps) {
  const [step, setStep] = useState<EditorStep>('confirm')
  const [editedFile, setEditedFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const miniPaintWindowRef = useRef<Window | null>(null)

  // Open miniPaint in a new tab
  // Note: miniPaint's #image=URL parameter often fails with cross-origin images
  // due to CORS/canvas tainting issues. We open miniPaint without the image
  // and provide clear instructions for the user to manually open the image.
  const openMiniPaint = () => {
    // Open miniPaint without image parameter - the #image=URL approach
    // doesn't reliably work with cross-origin images due to:
    // 1. CORS preflight requirements
    // 2. Canvas tainting (even with CORS headers, miniPaint may not load with crossOrigin="anonymous")
    // 3. Browser security policies for localhost
    const url = MINI_PAINT_URL
    console.log('Opening miniPaint (manual image load required)')
    miniPaintWindowRef.current = window.open(url, '_blank', 'noopener')
    setStep('editing')
  }

  const reopenMiniPaint = () => {
    if (miniPaintWindowRef.current && !miniPaintWindowRef.current.closed) {
      miniPaintWindowRef.current.focus()
      return
    }
    miniPaintWindowRef.current = window.open(MINI_PAINT_URL, '_blank', 'noopener')
  }
  
  // Download the image for user to manually open in miniPaint
  const downloadImageForEditing = async () => {
    try {
      let fetchUrl = imageSrc
      if (imageSrc.startsWith('/')) {
        fetchUrl = `${window.location.origin}${imageSrc}`
      }
      
      const response = await fetch(fetchUrl)
      if (!response.ok) throw new Error('Failed to fetch image')
      
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      
      const a = document.createElement('a')
      a.href = url
      a.download = title ? `${title.replace(/[^a-zA-Z0-9]/g, '_')}.png` : 'image_to_edit.png'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      setError('Failed to download image')
    }
  }

  // Handle file selection
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('image/')) {
      setError('Please select an image file (PNG, JPEG, etc.)')
      return
    }

    // 10MB limit
    if (file.size > 10 * 1024 * 1024) {
      setError('Image too large. Maximum size is 10MB.')
      return
    }

    setError(null)
    setEditedFile(file)

    // Create preview
    const reader = new FileReader()
    reader.onload = () => setPreviewUrl(reader.result as string)
    reader.readAsDataURL(file)
  }

  // Save the edited image
  const handleSave = async () => {
    if (!editedFile) return

    try {
      setSaving(true)
      setError(null)

      const reader = new FileReader()
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1]
        onSave(base64, { name: editedFile.name, type: editedFile.type })
      }
      reader.onerror = () => {
        setError('Failed to read the image file')
        setSaving(false)
      }
      reader.readAsDataURL(editedFile)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
      setSaving(false)
    }
  }

  // Mark as done editing (user came back)
  const handleDoneEditing = () => {
    setStep('upload')
  }

  // Cleanup preview URL
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full overflow-hidden">
        
        {/* Step 1: Confirmation */}
        {step === 'confirm' && (
          <>
            <div className="p-6 border-b bg-gradient-to-r from-indigo-50 to-purple-50">
              <div className="flex items-start gap-4">
                <div className="p-3 bg-amber-100 rounded-xl">
                  <AlertTriangle className="w-6 h-6 text-amber-600" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-gray-900">Edit Image with miniPaint</h2>
                  <p className="text-gray-600 mt-1">
                    You&apos;ll be taken to miniPaint (third-party editor) to edit your image
                  </p>
                </div>
              </div>
            </div>

            <div className="p-6 space-y-4">
              {/* Error display */}
              {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-red-700 text-sm">
                  {error}
                </div>
              )}

              {/* Current image preview */}
              <div className="bg-gray-100 rounded-xl p-3 flex items-center gap-4">
                <div className="w-20 h-20 bg-white rounded-lg border overflow-hidden flex-shrink-0 relative">
                  <img src={imageSrc} alt={title} className="w-full h-full object-contain" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 truncate">{title || 'Image'}</p>
                  <p className="text-sm text-gray-500">Will open in miniPaint editor</p>
                </div>
              </div>

              {/* Instructions */}
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                <h3 className="font-medium text-blue-900 mb-3">How it works:</h3>
                <ol className="space-y-2 text-sm text-blue-800">
                  <li className="flex items-start gap-2">
                    <span className="flex-shrink-0 w-5 h-5 bg-blue-200 text-blue-800 rounded-full flex items-center justify-center text-xs font-bold">1</span>
                    <span>Click <strong>&quot;Download Image&quot;</strong> to save the image to your computer</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="flex-shrink-0 w-5 h-5 bg-blue-200 text-blue-800 rounded-full flex items-center justify-center text-xs font-bold">2</span>
                    <span>Click <strong>&quot;Open miniPaint&quot;</strong> to open the editor</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="flex-shrink-0 w-5 h-5 bg-blue-200 text-blue-800 rounded-full flex items-center justify-center text-xs font-bold">3</span>
                    <span>In miniPaint, go to <strong>File → Open</strong> and select the downloaded image</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="flex-shrink-0 w-5 h-5 bg-blue-200 text-blue-800 rounded-full flex items-center justify-center text-xs font-bold">4</span>
                    <span>Make your edits (add/remove labels, erase, draw, etc.)</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="flex-shrink-0 w-5 h-5 bg-blue-200 text-blue-800 rounded-full flex items-center justify-center text-xs font-bold">5</span>
                    <span>Go to <strong>File → Export as → PNG</strong> to save the edited image</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="flex-shrink-0 w-5 h-5 bg-blue-200 text-blue-800 rounded-full flex items-center justify-center text-xs font-bold">6</span>
                    <span>Return here and upload your edited image</span>
                  </li>
                </ol>
              </div>
            </div>

            <div className="p-6 border-t bg-gray-50 flex justify-between">
              <button
                onClick={onClose}
                className="px-4 py-2 text-gray-600 hover:text-gray-900 font-medium transition-colors"
              >
                Cancel
              </button>
              <div className="flex gap-3">
                <button
                  onClick={downloadImageForEditing}
                  className="flex items-center gap-2 px-4 py-2.5 border border-indigo-300 text-indigo-700 hover:bg-indigo-50 font-medium rounded-xl transition-colors"
                >
                  <Download className="w-4 h-4" />
                  Download Image
                </button>
                <button
                  onClick={openMiniPaint}
                  className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-xl transition-colors shadow-lg shadow-indigo-200"
                >
                  Open miniPaint
                  <ExternalLink className="w-4 h-4" />
                </button>
              </div>
            </div>
          </>
        )}

        {/* Step 2: Editing in progress */}
        {step === 'editing' && (
          <>
            <div className="p-6 border-b bg-gradient-to-r from-green-50 to-emerald-50">
              <div className="flex items-start gap-4">
                <div className="p-3 bg-green-100 rounded-xl">
                  <ExternalLink className="w-6 h-6 text-green-600" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-gray-900">Editing in miniPaint</h2>
                  <p className="text-gray-600 mt-1">
                    miniPaint is open in another tab. Come back when you&apos;re done!
                  </p>
                </div>
              </div>
            </div>

            <div className="p-6 space-y-4">
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                <h3 className="font-medium text-amber-900 mb-2">Remember to save your work:</h3>
                <p className="text-sm text-amber-800">
                  In miniPaint, go to <strong>File → Export as → PNG</strong> to download your edited image,
                  then come back here to upload it.
                </p>
              </div>

              <div className="flex items-center justify-center py-8">
                <div className="text-center">
                  <Loader2 className="w-12 h-12 animate-spin text-indigo-400 mx-auto mb-4" />
                  <p className="text-gray-600">Waiting for you to finish editing...</p>
                </div>
              </div>
            </div>

            <div className="p-6 border-t bg-gray-50 flex justify-between">
              <button
                onClick={onClose}
                className="px-4 py-2 text-gray-600 hover:text-gray-900 font-medium transition-colors"
              >
                Cancel
              </button>
              <div className="flex gap-3">
              <button
                  onClick={reopenMiniPaint}  
                  className="flex items-center gap-2 px-4 py-2 border border-gray-300 hover:border-gray-400 text-gray-700 font-medium rounded-xl transition-colors"
                >
                  <ExternalLink className="w-4 h-4" />
                  Reopen miniPaint
                </button>
                <button
                  onClick={handleDoneEditing}
                  className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-xl transition-colors shadow-lg shadow-indigo-200"
                >
                  Done Editing
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </>
        )}

        {/* Step 3: Upload edited image */}
        {step === 'upload' && (
          <>
            <div className="p-6 border-b bg-gradient-to-r from-purple-50 to-pink-50">
              <div className="flex items-start gap-4">
                <div className="p-3 bg-purple-100 rounded-xl">
                  <Upload className="w-6 h-6 text-purple-600" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-gray-900">Upload Edited Image</h2>
                  <p className="text-gray-600 mt-1">
                    Upload the image you exported from miniPaint
                  </p>
                </div>
              </div>
            </div>

            <div className="p-6 space-y-4">
              {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-red-700 text-sm">
                  {error}
                </div>
              )}

              {/* Upload zone */}
              <div
                onClick={() => fileInputRef.current?.click()}
                className={`
                  border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all
                  ${editedFile 
                    ? 'border-green-300 bg-green-50' 
                    : 'border-gray-300 hover:border-indigo-400 hover:bg-indigo-50/50'
                  }
                `}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                
                {editedFile ? (
                  <div className="space-y-3">
                    {previewUrl && (
                      <div className="w-32 h-32 mx-auto bg-white rounded-lg border overflow-hidden">
                        <img src={previewUrl} alt="Preview" className="w-full h-full object-contain" />
                      </div>
                    )}
                    <div className="flex items-center justify-center gap-2 text-green-700">
                      <Check className="w-5 h-5" />
                      <span className="font-medium">{editedFile.name}</span>
                    </div>
                    <p className="text-sm text-green-600">
                      {(editedFile.size / 1024).toFixed(1)} KB • Click to change
                    </p>
                  </div>
                ) : (
                  <>
                    <ImageIcon className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                    <p className="text-gray-700 font-medium">Click to upload edited image</p>
                    <p className="text-sm text-gray-500 mt-1">or drag and drop</p>
                  </>
                )}
              </div>

              {/* Comparison */}
              {editedFile && previewUrl && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="text-center">
                    <p className="text-xs text-gray-500 mb-2">Original</p>
                    <div className="h-24 bg-gray-100 rounded-lg overflow-hidden">
                      <img src={imageSrc} alt="Original" className="w-full h-full object-contain" />
                    </div>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-gray-500 mb-2">Edited</p>
                    <div className="h-24 bg-gray-100 rounded-lg overflow-hidden">
                      <img src={previewUrl} alt="Edited" className="w-full h-full object-contain" />
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="p-6 border-t bg-gray-50 flex justify-between">
              <button
                onClick={() => setStep('editing')}
                className="px-4 py-2 text-gray-600 hover:text-gray-900 font-medium transition-colors"
              >
                ← Back to editing
              </button>
              <div className="flex gap-3">
                <button
                  onClick={onClose}
                  className="px-4 py-2 border border-gray-300 hover:border-gray-400 text-gray-700 font-medium rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={!editedFile || saving}
                  className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white font-medium rounded-xl transition-colors shadow-lg shadow-indigo-200"
                >
                  {saving ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      Save Changes
                    </>
                  )}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
