'use client'

import { useState, useRef, useCallback } from 'react'
import { Upload, File, X, AlertTriangle } from 'lucide-react'

interface FileUploadProps {
  onFileProcessed: (result: { html: string; textContent: string; fileName: string; fileSize: number; warning?: string }) => void
  projectId: string
  patentId: string
  disabled?: boolean
}

export default function FileUpload({ onFileProcessed, projectId, patentId, disabled = false }: FileUploadProps) {
  const [isDragOver, setIsDragOver] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const acceptedTypes = [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
    'application/pdf', // .pdf
    'text/plain', // .txt
    'text/markdown', // .md
  ]

  const acceptedExtensions = ['.docx', '.pdf', '.txt', '.md']

  const validateFile = (file: File): string | null => {
    if (file.size > 25 * 1024 * 1024) { // 25MB
      return 'File size exceeds 25MB limit'
    }

    const fileName = file.name.toLowerCase()
    const hasAllowedExtension = acceptedExtensions.some(ext => fileName.endsWith(ext))
    const hasAllowedType = acceptedTypes.includes(file.type)

    if (!hasAllowedType && !hasAllowedExtension) {
      return 'Unsupported file type. Please upload .docx, .pdf, .txt, or .md files'
    }

    return null
  }

  const processFile = async (file: File) => {
    setError(null)
    setIsUploading(true)
    setUploadProgress(0)

    const validationError = validateFile(file)
    if (validationError) {
      setError(validationError)
      setIsUploading(false)
      return
    }

    try {
      setUploadProgress(25)

      const formData = new FormData()
      formData.append('file', file)

      setUploadProgress(50)

      const response = await fetch(`/api/projects/${projectId}/patents/${patentId}/upload`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: formData,
      })

      setUploadProgress(75)

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Upload failed')
      }

      const result = await response.json()
      setUploadProgress(100)

      // Small delay to show 100% progress
      setTimeout(() => {
        onFileProcessed(result)
        setSelectedFile(null)
        setIsUploading(false)
        setUploadProgress(0)
      }, 500)

    } catch (err) {
      console.error('Upload error:', err)
      setError(err instanceof Error ? err.message : 'Upload failed')
      setIsUploading(false)
      setUploadProgress(0)
    }
  }

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    if (!disabled) {
      setIsDragOver(true)
    }
  }, [disabled])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)

    if (disabled) return

    const files = Array.from(e.dataTransfer.files)
    if (files.length > 0) {
      const file = files[0]
      setSelectedFile(file)
      processFile(file)
    }
  }, [disabled, processFile])

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (files && files.length > 0) {
      const file = files[0]
      setSelectedFile(file)
      processFile(file)
    }
  }

  const handleClick = () => {
    if (!disabled && fileInputRef.current) {
      fileInputRef.current.click()
    }
  }

  const clearSelection = () => {
    setSelectedFile(null)
    setError(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  return (
    <div className="space-y-4">
      {/* Upload Area */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleClick}
        className={`
          relative border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-all
          ${isDragOver ? 'border-blue-400 bg-blue-50' : 'border-gray-300 hover:border-gray-400'}
          ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
          ${error ? 'border-red-300 bg-red-50' : ''}
        `}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".docx,.pdf,.txt,.md"
          onChange={handleFileSelect}
          className="hidden"
          disabled={disabled}
        />

        <div className="flex flex-col items-center justify-center space-y-4">
          {isUploading ? (
            <>
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
              <div className="space-y-2">
                <p className="text-sm font-medium text-gray-900">
                  Processing {selectedFile?.name}
                </p>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  ></div>
                </div>
                <p className="text-xs text-gray-500">{uploadProgress}% complete</p>
              </div>
            </>
          ) : (
            <>
              <Upload className="h-12 w-12 text-gray-400" />
              <div>
                <p className="text-lg font-medium text-gray-900">
                  {isDragOver ? 'Drop your file here' : 'Upload patent document'}
                </p>
                <p className="text-sm text-gray-500 mt-1">
                  Drag & drop or click to select .docx, .pdf, .txt, or .md files
                </p>
                <p className="text-xs text-gray-400 mt-2">
                  Maximum file size: 25MB
                </p>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Selected File Info */}
      {selectedFile && !isUploading && (
        <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
          <div className="flex items-center space-x-3">
            <File className="h-8 w-8 text-gray-400" />
            <div>
              <p className="text-sm font-medium text-gray-900">{selectedFile.name}</p>
              <p className="text-xs text-gray-500">{formatFileSize(selectedFile.size)}</p>
            </div>
          </div>
          {!isUploading && (
            <button
              onClick={clearSelection}
              className="p-1 text-gray-400 hover:text-gray-600"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="flex items-start space-x-3 p-3 bg-red-50 border border-red-200 rounded-lg">
          <AlertTriangle className="h-5 w-5 text-red-400 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-red-800">Upload Error</p>
            <p className="text-sm text-red-700 mt-1">{error}</p>
          </div>
        </div>
      )}

      {/* File Type Warnings */}
      <div className="text-xs text-gray-500 space-y-1">
        <p><strong>Supported formats:</strong></p>
        <ul className="list-disc list-inside space-y-1 ml-4">
          <li><strong>DOCX:</strong> Best formatting preservation</li>
          <li><strong>PDF:</strong> Text extraction (layout may change)</li>
          <li><strong>TXT/MD:</strong> Plain text with basic formatting</li>
        </ul>
      </div>
    </div>
  )
}
