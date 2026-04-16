'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { Upload, File as FileIcon, X, AlertTriangle, CheckCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
// import { Progress } from '@/components/ui/progress' // Not used in this component

interface FileAnalysis {
  file: File
  wordCount: number
  patentScore: number
  isSelected: boolean
}

interface FileUploadProps {
  onFilesSelected: (files: File[]) => void
  accept?: string
  maxFiles?: number
  disabled?: boolean
  autoSelect?: boolean // Whether to auto-select best file for training
}

export default function FileUpload({ onFilesSelected, accept = "*", maxFiles = 6, disabled = false, autoSelect = true }: FileUploadProps) {
  const [isDragOver, setIsDragOver] = useState(false)
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [fileAnalyses, setFileAnalyses] = useState<FileAnalysis[]>([])
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const validateFiles = (files: File[]): string | null => {
    if (files.length > maxFiles) {
      return `Maximum ${maxFiles} file${maxFiles > 1 ? 's' : ''} allowed`
    }

    const allowedExtensions = accept.split(',').map(ext => ext.trim().toLowerCase().replace('.', ''))
    const allowedMimeTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'text/markdown'
    ]

    for (const file of files) {
      const fileExtension = file.name.split('.').pop()?.toLowerCase()
      const isExtensionAllowed = allowedExtensions.includes(fileExtension || '')
      const isMimeTypeAllowed = allowedMimeTypes.includes(file.type)

      if (accept !== "*" && !isExtensionAllowed && !isMimeTypeAllowed) {
        return `File type not supported: ${file.name}. Supported: ${accept}`
      }

      if (file.size > 10 * 1024 * 1024) { // 10MB limit
        return `File too large: ${file.name} (max 10MB)`
      }
    }

    return null
  }

  // Patent-related keywords for scoring
  const patentKeywords = [
    'claims', 'embodiment', 'invention', 'figure', 'comprising', 'module',
    'apparatus', 'system', 'method', 'patent', 'prior art', 'abstract',
    'background', 'summary', 'detailed description', 'embodiments',
    'aspect', 'feature', 'component', 'device', 'circuit', 'algorithm'
  ]

  const analyzeFileForPatentContent = async (file: File): Promise<{ wordCount: number; patentScore: number }> => {
    try {
      const text = await file.text()
      const cleanText = text.toLowerCase().replace(/[^\w\s]/g, ' ')
      const words = cleanText.split(/\s+/).filter(word => word.length > 0)
      const wordCount = words.length

      // Calculate patent score based on keyword matches
      const keywordMatches = patentKeywords.reduce((score, keyword) => {
        const regex = new RegExp(`\\b${keyword}\\b`, 'gi')
        const matches = text.toLowerCase().match(regex)
        return score + (matches ? matches.length * 2 : 0) // Weight keyword matches
      }, 0)

      // Check for patent-specific patterns
      const hasPatentPatterns =
        /the present invention/i.test(text) ||
        /a system comprising/i.test(text) ||
        /claims?:?\s*\d+/i.test(text) ||
        /abstract|background|summary/i.test(text)

      const patentScore = keywordMatches + (hasPatentPatterns ? 10 : 0)

      return { wordCount, patentScore }
    } catch (error) {
      console.error('Error analyzing file:', error)
      return { wordCount: 0, patentScore: 0 }
    }
  }

  const selectBestPatentFile = (analyses: FileAnalysis[]): File | null => {
    if (analyses.length === 0) return null

    // Filter files within word count range (900-1100 words)
    const inRange = analyses.filter(a => a.wordCount >= 900 && a.wordCount <= 1100)

    let candidates = inRange.length > 0 ? inRange : analyses

    // Select file with highest patent score
    candidates.sort((a, b) => {
      // Primary: patent score
      if (b.patentScore !== a.patentScore) {
        return b.patentScore - a.patentScore
      }
      // Secondary: closest to 1000 words
      return Math.abs(a.wordCount - 1000) - Math.abs(b.wordCount - 1000)
    })

    return candidates[0]?.file || null
  }

  const analyzeFiles = useCallback(async (files: File[]) => {
    if (!autoSelect || files.length === 0 || isAnalyzing) return

    setIsAnalyzing(true)
    setError(null)

    try {
      const analyses: FileAnalysis[] = []

      for (const file of files) {
        const { wordCount, patentScore } = await analyzeFileForPatentContent(file)
        analyses.push({
          file,
          wordCount,
          patentScore,
          isSelected: false
        })
      }

      // Auto-select the best file and update analyses in a single render
      const bestFile = selectBestPatentFile(analyses)
      if (bestFile) {
        setSelectedFile(bestFile)
      } else {
        setSelectedFile(null)
      }

      setFileAnalyses(
        analyses.map(analysis => ({
          ...analysis,
          isSelected: bestFile ? analysis.file === bestFile : false
        }))
      )

      // Don't automatically call onFilesSelected - user must click training button
    } catch (error) {
      console.error('Error analyzing files:', error)
      setError('Failed to analyze files')
    } finally {
      setIsAnalyzing(false)
    }
  }, [analyzeFileForPatentContent, autoSelect, isAnalyzing, selectBestPatentFile])

  const handleFiles = useCallback((files: FileList | null, accumulate: boolean = false) => {
    if (!files) return

    const newFileArray = Array.from(files)

    if (accumulate) {
      // Accumulate mode (for drag & drop) - add to existing files
      setSelectedFiles(currentFiles => {
        const combined = [...currentFiles]
        let changed = false

        for (const newFile of newFileArray) {
          // Check if file already exists (same name and size)
          const exists = combined.some(existingFile =>
            existingFile.name === newFile.name && existingFile.size === newFile.size
          )

          if (!exists) {
            combined.push(newFile)
            changed = true
          }
        }

        if (!changed) return currentFiles

        // Validate the combined array
        const validationError = validateFiles(combined)
        if (validationError) {
          setError(validationError)
          return currentFiles // Don't add the new files if validation fails
        }

        setError(null)
        return combined
      })
    } else {
      // Replace mode (for file input) - replace existing files
      const validationError = validateFiles(newFileArray)
      if (validationError) {
        setError(validationError)
        return
      }

      setError(null)
      setSelectedFiles(newFileArray)
    }

    // Files will be auto-analyzed via useEffect
  }, [accept, maxFiles, validateFiles])

  // Auto-analyze files when they change
  useEffect(() => {
    if (selectedFiles.length > 0) {
      analyzeFiles(selectedFiles)
    }
  }, [selectedFiles, analyzeFiles])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)

    if (disabled) return

    // Drag & drop should accumulate files
    handleFiles(e.dataTransfer.files, true)
  }, [disabled, handleFiles])

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

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    // Accumulate files selected via dialog as well
    handleFiles(e.target.files, true)
    // Reset input so selecting the same file again retriggers change
    if (e.target) {
      e.target.value = ''
    }
  }, [handleFiles])

  const removeFile = (index: number) => {
    const newFiles = selectedFiles.filter((_, i) => i !== index)
    setSelectedFiles(newFiles)

    // If we removed the selected file, clear the selection
    if (selectedFile && selectedFiles[index] === selectedFile) {
      setSelectedFile(null)
      setFileAnalyses([])
    }
  }

  const clearAll = () => {
    setSelectedFiles([])
    setFileAnalyses([])
    setSelectedFile(null)
    setError(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  return (
    <div className="space-y-4">
      {/* Upload Area */}
      <div
        className={`
          border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors
          ${isDragOver ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'}
          ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
        `}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => !disabled && fileInputRef.current?.click()}
      >
        <Upload className="mx-auto h-12 w-12 text-gray-400 mb-4" />
        <div className="text-sm text-gray-600">
          <span className="font-medium text-blue-600">Click to select files</span> or drag and drop
        </div>
        <div className="text-xs text-gray-500 mt-1">
          {accept === "*" ? "Any file type" : accept} (max {maxFiles} file{maxFiles > 1 ? 's' : ''})
          {maxFiles > 1 && selectedFiles.length === 0 && (
            <div className="text-xs text-blue-600 mt-1">💡 Select multiple files at once, or drag & drop additional files to add them</div>
          )}
          {maxFiles > 1 && selectedFiles.length > 0 && (
            <div className="text-xs text-green-600 mt-1">✅ {selectedFiles.length} file{selectedFiles.length > 1 ? 's' : ''} selected. Drag & drop more to add them!</div>
          )}
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple={maxFiles > 1}
        accept={accept}
        onChange={handleFileInput}
        className="hidden"
        disabled={disabled}
      />

      {/* Error Message */}
      {error && (
        <div className="flex items-center space-x-2 text-red-600 text-sm">
          <AlertTriangle className="h-4 w-4" />
          <span>{error}</span>
        </div>
      )}

      {/* Selected Files */}
      {selectedFiles.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium">
              Uploaded Files ({selectedFiles.length})
              {isAnalyzing && <span className="text-blue-600 ml-2">Analyzing...</span>}
            </h4>
            <Button variant="outline" size="sm" onClick={clearAll}>
              Clear All
            </Button>
          </div>

          {selectedFiles.map((file) => {
            const analysis = fileAnalyses.find(a => a.file === file) || { file, wordCount: 0, patentScore: 0, isSelected: false }
            return (
            <div key={`${analysis.file.name}-${analysis.file.size}`} className="flex items-center justify-between p-2 bg-gray-50 rounded border">
              <div className="flex items-center space-x-2">
                {analysis.isSelected ? (
                  <CheckCircle className="h-4 w-4 text-green-600" />
                ) : (
                  <FileIcon className="h-4 w-4 text-gray-400" />
                )}
                <div>
                  <div className="text-sm font-medium truncate max-w-xs">{analysis.file.name}</div>
                  <div className="text-xs text-gray-500">
                    {(analysis.file.size / 1024 / 1024).toFixed(2)} MB • {analysis.wordCount} words
                    {analysis.patentScore > 0 && ` • Patent Score: ${analysis.patentScore}`}
                  </div>
                  {analysis.isSelected && (
                    <div className="text-xs text-green-600 font-medium">✅ Selected for training</div>
                  )}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removeFile(selectedFiles.indexOf(analysis.file))}
                className="text-red-600 hover:text-red-700"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            )
          })}

          {/* Show selected file summary */}
          {selectedFile && !isAnalyzing && (
            <div className="p-3 bg-green-50 border border-green-200 rounded">
              <div className="text-sm font-medium text-green-800">
                🎯 Best file selected: {selectedFile.name}
              </div>
              <div className="text-xs text-green-600 mt-1">
                Training uses all selected files. The best candidate is highlighted for reference.
              </div>
            </div>
          )}

          {/* Start Training Button */}
          <Button
            onClick={() => selectedFiles.length > 0 && onFilesSelected(selectedFiles)}
            disabled={disabled || selectedFiles.length === 0 || isAnalyzing}
            className="w-full"
          >
            {isAnalyzing ? 'Analyzing Files...' : `Start Training (${selectedFiles.length} file${selectedFiles.length>1?'s':''})`}
          </Button>
        </div>
      )}
    </div>
  )
}

