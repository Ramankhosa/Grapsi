'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { 
  Bot, 
  User, 
  Sparkles, 
  Upload, 
  FileText, 
  Check, 
  Loader2, 
  Code, 
  Trash2, 
  Edit2, 
  Eye, 
  RefreshCw, 
  Image as ImageIcon, 
  Zap,
  LayoutGrid,
  Pencil,
  Star,
  StarOff,
  Wand2,
  Grid3X3,
  AlertCircle,
  GripVertical,
  Layers,
  Lock,
  Unlock,
  RotateCcw,
  Info,
  ExternalLink,
  History,
  Download,
  UploadCloud,
  HelpCircle,
  Paintbrush,
  Languages,
  Lightbulb
} from 'lucide-react'

// DnD Kit imports
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
  DragOverlay
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import dynamic from 'next/dynamic'

// Dynamic import for ImageEditor (opens miniPaint for image editing)
const ImageEditor = dynamic(() => import('@/components/ui/ImageEditor'), {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center">
      <div className="text-white text-center">
        <Loader2 className="w-10 h-10 animate-spin mx-auto mb-3" />
        <p>Loading Image Editor...</p>
      </div>
    </div>
  )
})

interface FigurePlannerStageProps {
  session: any
  patent: any
  onComplete: (data: any) => Promise<any>
  onRefresh: () => Promise<void>
}

type LLMFigure = {
  title: string
  purpose: string
  plantuml: string
}

// Helper function to normalize page sizes from country profiles
// IMPORTANT: This must be defined before the component to avoid TDZ (Temporal Dead Zone) errors
function normalizePageSizes(input: any): string[] {
  if (!input) return []
  if (Array.isArray(input)) return input.flatMap((val) => normalizePageSizes(val))
  if (typeof input === 'string') {
    const trimmed = input.trim()
    return trimmed ? [trimmed] : []
  }
  if (typeof input === 'object') return Object.values(input).flatMap((val) => normalizePageSizes(val))
  return []
}

export default function FigurePlannerStage({ session, patent, onComplete, onRefresh }: FigurePlannerStageProps) {
  const [isGenerating, setIsGenerating] = useState(false)
  const [figures, setFigures] = useState<LLMFigure[]>([])
  const [error, setError] = useState<string | null>(null)
  const [diagramCount, setDiagramCount] = useState(5)

  // Helper for cleaning titles
  const sanitizeFigureLabel = (text?: string | null) => {
    const raw = typeof text === 'string' ? text : ''
    if (!raw.trim()) return ''
    const cpcIpcPattern = /\b(?:CPC|IPC)?\s*(?:class\s*)?[A-H][0-9]{1,2}[A-Z]\s*\d+\/\d+\b/gi
    let cleaned = raw.replace(cpcIpcPattern, '')
    cleaned = cleaned.replace(/\b(?:CPC|IPC)\b[:\-]?\s*/gi, '')
    cleaned = cleaned.replace(/\s{2,}/g, ' ').replace(/\s+([,.;:])/g, '$1')
    cleaned = cleaned.replace(/^[\s,:;.-]+|[\s,:;.-]+$/g, '')
    return cleaned.trim()
  }

  const diagramSources = session?.diagramSources || []
  const figurePlans = (session?.figurePlans || []).map((plan: any) => ({
    ...plan,
    title: sanitizeFigureLabel(plan.title) || `Figure ${plan.figureNo}`
  }))

  const [isUploading, setIsUploading] = useState(false)
  const [uploaded, setUploaded] = useState<Record<string, boolean>>({})
  const [modifyIdx, setModifyIdx] = useState<number | null>(null)
  const [processingStatus, setProcessingStatus] = useState<Record<string, string>>({})
  const [processingStep, setProcessingStep] = useState<Record<string, number>>({})
  const [modifyText, setModifyText] = useState('')
  const [modifyFigNo, setModifyFigNo] = useState<number | null>(null)
  const [modifyTextSaved, setModifyTextSaved] = useState('')
  const [regeneratingFigure, setRegeneratingFigure] = useState<Record<number, boolean>>({})
  const [isViewing, setIsViewing] = useState<Record<number, boolean>>({})
  const [rendering, setRendering] = useState<Record<string, boolean>>({})
  const [renderPreview, setRenderPreview] = useState<Record<string, string | null>>({})
  const [expandedFigNo, setExpandedFigNo] = useState<number | null>(null)
  const [addCount, setAddCount] = useState(0)
  const [addInputs, setAddInputs] = useState<string[]>([])
  const [overrideCount, setOverrideCount] = useState(0)
  const [overrideInputs, setOverrideInputs] = useState<string[]>([])
  const [stateInitialized, setStateInitialized] = useState(false)

  // UI Mode state
  const [mode, setMode] = useState<'ai' | 'manual'>('ai')
  const [includeExistingFigures, setIncludeExistingFigures] = useState(true)

  // Map legacy state to new mode
  const [aiDecides, setAiDecides] = useState(true)
  const [userDecides, setUserDecides] = useState(false)
  
  useEffect(() => {
    if (mode === 'ai') {
      setAiDecides(true)
      setUserDecides(false)
    } else {
      setAiDecides(false)
      setUserDecides(true)
    }
  }, [mode])

  const [manualCount, setManualCount] = useState(0)
  const [manualInputs, setManualInputs] = useState<{ title: string; description: string }[]>([])
  const [manualFiles, setManualFiles] = useState<(File | null)[]>([])
  const [showManual, setShowManual] = useState(false)
  const [manualBusy, setManualBusy] = useState<Record<number, boolean>>({})
  const [showPlantUML, setShowPlantUML] = useState<Record<number, boolean>>({})
  const [countryProfile, setCountryProfile] = useState<any | null>(null)
  const uploadSectionRef = useRef<HTMLDivElement>(null)
  const [highlightUpload, setHighlightUpload] = useState(false)
  const renderQueueRef = useRef<Promise<void>>(Promise.resolve())
  // Ref to hold latest handleUploadImage function to avoid stale closures in queueUpload
  const handleUploadImageRef = useRef<((figureNo: number, file: File, customFilename?: string, language?: string) => Promise<void>) | null>(null)

  // === FIGURE PLANNER TAB STATE ===
  const [activeTab, setActiveTab] = useState<'diagrams' | 'sketches' | 'arrange'>('diagrams')
  
  // === ARRANGE TAB STATE ===
  const [arrangedFigures, setArrangedFigures] = useState<any[]>([])
  const [arrangeLoading, setArrangeLoading] = useState(false)
  const [arrangeError, setArrangeError] = useState<string | null>(null)
  const [isSequenceFinalized, setIsSequenceFinalized] = useState(false)
  const [selectedArrangeFigure, setSelectedArrangeFigure] = useState<any | null>(null)
  const [aiInsight, setAiInsight] = useState<string | null>(null)
  const [aiReasons, setAiReasons] = useState<Array<{ id: string; title: string; reason: string; finalFigNo?: number }> | null>(null)
  const [aiArranging, setAiArranging] = useState(false)
  const [savingSequence, setSavingSequence] = useState(false)
  const [showUnlockPrompt, setShowUnlockPrompt] = useState(false)
  
  // === SKETCH TAB STATE ===
  const [sketches, setSketches] = useState<any[]>([])
  const [sketchesLoading, setSketchesLoading] = useState(false)
  const [sketchSuggestions, setSketchSuggestions] = useState<any[]>([])
  const [suggestionsLoading, setSuggestionsLoading] = useState(false)
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null)
  const [sketchError, setSketchError] = useState<string | null>(null)
  const [sketchGenerating, setSketchGenerating] = useState(false)
  const [sketchMode, setSketchMode] = useState<'auto' | 'guided' | 'refine'>('auto')
  const [sketchPrompt, setSketchPrompt] = useState('')
  const [sketchTitle, setSketchTitle] = useState('')
  const [sketchUploadFile, setSketchUploadFile] = useState<File | null>(null)
  const [sketchUploadPreview, setSketchUploadPreview] = useState<string | null>(null)
  const [expandedSketchId, setExpandedSketchId] = useState<string | null>(null)
  const [modifyingSketchId, setModifyingSketchId] = useState<string | null>(null)
  const [modifySketchPrompt, setModifySketchPrompt] = useState('')
  const sketchFileInputRef = useRef<HTMLInputElement>(null)

  // === IMAGE EDITOR STATE ===
  const [imageEditorOpen, setImageEditorOpen] = useState(false)
  const [editingImage, setEditingImage] = useState<{
    type: 'diagram' | 'sketch'
    id: string | number  // figureNo for diagrams, id for sketches
    imagePath: string
    title: string
    originalImagePath?: string | null
  } | null>(null)
  const [savingEditedImage, setSavingEditedImage] = useState(false)

  // === TRANSLATION STATE ===
  const [showTranslateModal, setShowTranslateModal] = useState(false)
  const [translateTargetLang, setTranslateTargetLang] = useState('')
  const [translateFigureNo, setTranslateFigureNo] = useState<number | null>(null) // null = translate all
  const [translating, setTranslating] = useState(false)
  const [translateProgress, setTranslateProgress] = useState<{ current: number; total: number } | null>(null)
  const [diagramTranslations, setDiagramTranslations] = useState<Record<number, Array<{ language: string; id: string; hasImage: boolean }>>>({})
  // Track selected language tab per figure (for multi-language view)
  const [selectedLangByFigure, setSelectedLangByFigure] = useState<Record<number, string>>({})

  // Language labels for translation UI
  const LANGUAGE_LABELS: Record<string, string> = {
    en: 'English',
    hi: 'Hindi (हिन्दी)',
    ja: 'Japanese (日本語)',
    zh: 'Chinese (中文)',
    ko: 'Korean (한국어)',
    de: 'German (Deutsch)',
    fr: 'French (Français)',
    es: 'Spanish (Español)',
    pt: 'Portuguese (Português)',
    it: 'Italian (Italiano)',
    ru: 'Russian (Русский)',
    ar: 'Arabic (العربية)',
    nl: 'Dutch (Nederlands)',
    sv: 'Swedish (Svenska)',
    th: 'Thai (ไทย)',
    vi: 'Vietnamese (Tiếng Việt)'
  }

  const activeJurisdiction = (session?.activeJurisdiction || session?.draftingJurisdictions?.[0] || 'IN').toUpperCase()

  useEffect(() => {
    const loadProfile = async () => {
      try {
        const res = await fetch(`/api/country-profiles/${activeJurisdiction}`, {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}` }
        })
        if (res.ok) {
          const data = await res.json()
          setCountryProfile(data?.profile || null)
        } else if (res.status === 404) {
          // Country profile not found, use defaults
          console.warn(`Country profile for ${activeJurisdiction} not found, using defaults`)
          setCountryProfile(null)
        } else {
          console.warn('Failed to load country profile for figures', res.status, res.statusText)
        }
      } catch (e) {
        console.warn('Failed to load country profile for figures', e)
        setCountryProfile(null)
      }
    }
    loadProfile()
  }, [activeJurisdiction])

  const countWords = (text: string) => (text || '').trim().split(/\s+/).filter(Boolean).length
  const getDiagramKey = (figureNo: number, language?: string | null) => `${figureNo}_${(language || 'en').toLowerCase()}`
  const preferredFigureLanguage = useMemo(() => {
    const status = (session as any)?.jurisdictionDraftStatus || {}
    const explicitFiguresLang = typeof status.__figuresLanguage === 'string' && status.__figuresLanguage.trim()
      ? status.__figuresLanguage.trim().toLowerCase()
      : null
    const activeLang = typeof status?.[activeJurisdiction]?.language === 'string' && status?.[activeJurisdiction]?.language.trim()
      ? status[activeJurisdiction].language.trim().toLowerCase()
      : null
    const commonLang = typeof status.__commonLanguage === 'string' && status.__commonLanguage.trim()
      ? status.__commonLanguage.trim().toLowerCase()
      : null
    return explicitFiguresLang || activeLang || commonLang || 'en'
  }, [session?.jurisdictionDraftStatus, activeJurisdiction])

  // Group diagram sources by figure number for language-tabbed view
  const diagramsByFigure = useMemo(() => {
    const grouped: Record<number, any[]> = {}
    diagramSources.forEach((ds: any) => {
      const figNo = ds.figureNo
      if (!grouped[figNo]) grouped[figNo] = []
      grouped[figNo].push(ds)
    })
    // Keep languages sorted for stable tab order (English first)
    Object.values(grouped).forEach(list => {
      list.sort((a: any, b: any) => {
        const la = (a.language || 'en').toLowerCase()
        const lb = (b.language || 'en').toLowerCase()
        if (la === 'en' && lb !== 'en') return -1
        if (lb === 'en' && la !== 'en') return 1
        return la.localeCompare(lb)
      })
    })
    return grouped
  }, [diagramSources])

  // Default selected language per figure to English (or first available)
  useEffect(() => {
    const updates: Record<number, string> = {}
    Object.entries(diagramsByFigure).forEach(([figNoStr, list]) => {
      const figNo = Number(figNoStr)
      if (selectedLangByFigure[figNo]) return
      const langs = list.map((d: any) => (d.language || 'en').toLowerCase())
      const preferred = langs.includes(preferredFigureLanguage)
        ? preferredFigureLanguage
        : langs.includes('en')
          ? 'en'
          : langs[0]
      if (preferred) updates[figNo] = preferred
    })
    if (Object.keys(updates).length > 0) {
      setSelectedLangByFigure(prev => ({ ...prev, ...updates }))
    }
  }, [diagramsByFigure, selectedLangByFigure, preferredFigureLanguage])

  // Load diagram translations on mount
  useEffect(() => {
    const loadTranslations = async () => {
      if (!session?.id || !patent?.id) return
      try {
        const res = await fetch(`/api/patents/${patent.id}/drafting`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
          },
          body: JSON.stringify({
            action: 'get_diagram_translations',
            sessionId: session.id
          })
        })
        if (res.ok) {
          const data = await res.json()
          setDiagramTranslations(data.translations || {})
        }
      } catch (err) {
        console.warn('Failed to load diagram translations:', err)
      }
    }
    loadTranslations()
  }, [session?.id, patent?.id, diagramSources])

  // Handle translating a single diagram or all diagrams
  const handleTranslateDiagrams = async () => {
    if (!translateTargetLang || translating) return

    setTranslating(true)
    setTranslateProgress(null)

    try {
      if (translateFigureNo !== null) {
        // Single diagram translation
        const res = await fetch(`/api/patents/${patent?.id}/drafting`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
          },
          body: JSON.stringify({
            action: 'translate_plantuml',
            sessionId: session?.id,
            figureNo: translateFigureNo,
            targetLanguage: translateTargetLang,
            sourceLanguage: 'en'
          })
        })

        const data = await res.json()
        if (!res.ok) {
          throw new Error(data.error || 'Translation failed')
        }

        // Refresh to load new translation
        await onRefresh()
        
        alert(`✓ Figure ${translateFigureNo} translated to ${LANGUAGE_LABELS[translateTargetLang] || translateTargetLang}`)
      } else {
        // Translate all diagrams - process one by one with progress
        const englishDiagrams = diagramSources.filter((d: any) => !d.language || d.language === 'en')
        const total = englishDiagrams.length
        
        if (total === 0) {
          alert('No English diagrams found to translate')
          return
        }

        let successCount = 0
        let failCount = 0

        for (let i = 0; i < englishDiagrams.length; i++) {
          const d = englishDiagrams[i]
          setTranslateProgress({ current: i + 1, total })

          try {
            const res = await fetch(`/api/patents/${patent?.id}/drafting`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
              },
              body: JSON.stringify({
                action: 'translate_plantuml',
                sessionId: session?.id,
                figureNo: d.figureNo,
                targetLanguage: translateTargetLang,
                sourceLanguage: 'en'
              })
            })

            if (res.ok) {
              successCount++
            } else {
              failCount++
            }
          } catch {
            failCount++
          }
        }

        // Refresh to load new translations
        await onRefresh()

        alert(`✓ Translation complete!\n• ${successCount} diagrams translated\n• ${failCount} failed`)
      }

      setShowTranslateModal(false)
      setTranslateTargetLang('')
      setTranslateFigureNo(null)
      
      // Refresh translations list
      const res = await fetch(`/api/patents/${patent?.id}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'get_diagram_translations',
          sessionId: session?.id
        })
      })
      if (res.ok) {
        const data = await res.json()
        setDiagramTranslations(data.translations || {})
      }
    } catch (err) {
      console.error('Translation error:', err)
      alert(`❌ Translation failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setTranslating(false)
      setTranslateProgress(null)
    }
  }

  // Get available jurisdictions with their languages for translation target options
  const getAvailableTargetLanguages = () => {
    const jurisdictions = session?.draftingJurisdictions || []
    const status = (session as any)?.jurisdictionDraftStatus || {}
    const languages: Set<string> = new Set()
    
    // Always include English as base
    languages.add('en')
    
    // Add languages from selected jurisdictions
    jurisdictions.forEach((code: string) => {
      const lang = status[code]?.language
      if (lang && lang !== 'en') {
        languages.add(lang)
      }
    })
    
    // Add common translation languages
    const commonLangs = ['ja', 'zh', 'ko', 'de', 'fr', 'es', 'hi']
    commonLangs.forEach(l => languages.add(l))
    
    return Array.from(languages).filter(l => l !== 'en') // Exclude English as target (source is English)
  }

  // Animated dots component for waiting states
  const AnimatedDots = () => (
    <span className="inline-flex">
      <span className="animate-pulse">.</span>
      <span className="animate-pulse" style={{ animationDelay: '0.2s' }}>.</span>
      <span className="animate-pulse" style={{ animationDelay: '0.4s' }}>.</span>
    </span>
  )

  // Handle upload button click with scroll and animation
  const handleUploadToggle = () => {
    const newShowManual = !showManual
    setShowManual(newShowManual)

    if (newShowManual) {
      // Scroll to upload section after a brief delay to allow animation to start
      setTimeout(() => {
        uploadSectionRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        })
        // Trigger highlight animation
        setHighlightUpload(true)
        setTimeout(() => setHighlightUpload(false), 2000)
      }, 100)
    }
  }

  // Intelligent processing messages
  const intelligentMessages = [
    "🧠 Analyzing diagram architecture...",
    "⚡ Optimizing layout algorithms...",
    "🎨 Applying advanced rendering techniques...",
    "🔬 Validating technical specifications...",
    "✨ Generating high-resolution output...",
    "📊 Performing quality assurance checks...",
    "🎯 Finalizing patent-grade visualization..."
  ]

  // Track which figures have been queued for rendering to prevent duplicate calls (language-aware)
  const queuedForRenderRef = useRef<Set<string>>(new Set())
  const renderAbortControllersRef = useRef<Record<string, AbortController | null>>({})
  const uploadQueueRef = useRef<Promise<void>>(Promise.resolve())
  const [uploadingByKey, setUploadingByKey] = useState<Record<string, boolean>>({})

  // Cleanup effect: abort pending requests and revoke blob URLs on unmount
  useEffect(() => {
    const controllersRef = renderAbortControllersRef
    return () => {
      // Abort all pending render requests
      Object.values(controllersRef.current).forEach(controller => {
        try { controller?.abort() } catch {}
      })
      controllersRef.current = {}
    }
  }, [])

  // Cleanup blob URLs on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      // Revoke all blob URLs stored in renderPreview
      Object.values(renderPreview).forEach(url => {
        if (url && typeof url === 'string' && url.startsWith('blob:')) {
          try { URL.revokeObjectURL(url) } catch {}
        }
      })
    }
  }, []) // Empty deps - only run on unmount

  // Automatically process diagrams when PlantUML code is available
  // This effect runs after state initialization and when diagramSources change
  useEffect(() => {
    if (!stateInitialized) return

    // Immediate processing without delay for better responsiveness
    diagramSources.forEach((d: any) => {
      const figNo = d.figureNo
      const lang = (d.language || 'en').toLowerCase()
      const key = getDiagramKey(figNo, lang)
      // Check all conditions for auto-rendering:
      // 1. Has PlantUML code
      // 2. Not already uploaded/rendered
      // 3. No existing image
      // 4. Not currently rendering
      // 5. No processing status (not in progress or failed)
      // 6. Not already queued for rendering (prevents duplicate calls)
      const shouldRender =
        d.plantumlCode &&
        !uploaded[key] &&
        !d.imageUploadedAt &&
        !rendering[key] &&
        !processingStatus[key] &&
        !queuedForRenderRef.current.has(key)

      if (shouldRender) {
        queuedForRenderRef.current.add(key)
        autoProcessDiagram(figNo, d.plantumlCode, lang)
      }
    })
  }, [diagramSources, uploaded, rendering, processingStatus, stateInitialized])

  // Initialize state for new figures when diagramSources changes
  // Also reset uploaded state when image data is cleared (e.g., after regeneration)
  useEffect(() => {
    const newFigureNos = diagramSources.map((d: any) => d.figureNo)
    const newDiagramKeys = diagramSources.map((d: any) => getDiagramKey(d.figureNo, d.language || 'en'))
    setUploaded((prev) => {
      const updated = { ...prev }
      diagramSources.forEach((d: any) => {
        const key = getDiagramKey(d.figureNo, d.language || 'en')
        // For diagrams without an image, always clear the queued ref to allow re-rendering
        // This fixes the bug where replaced diagrams wouldn't auto-render because the ref wasn't cleared
        if (!d?.imageUploadedAt) {
          queuedForRenderRef.current.delete(key)
        }
        // Reset uploaded to false if no image exists OR if imageUploadedAt is null (cleared after regeneration)
        if (updated[key] === undefined || (!d?.imageUploadedAt && updated[key] !== false)) {
          updated[key] = false
        }
      })
      return updated
    })
    setRendering((prev) => {
      const updated = { ...prev }
      newDiagramKeys.forEach((key: string) => {
        if (updated[key] === undefined) updated[key] = false
      })
      return updated
    })
    setProcessingStatus((prev) => {
      const updated = { ...prev }
      diagramSources.forEach((d: any) => {
        const key = getDiagramKey(d.figureNo, d.language || 'en')
        // Clear processing status if: new key OR diagram has code but no image (needs re-rendering)
        // This fixes the bug where modified diagrams wouldn't auto-render after a previous failure
        if (updated[key] === undefined || (d.plantumlCode && !d.imageUploadedAt)) {
          updated[key] = ''
        }
      })
      return updated
    })
    setProcessingStep((prev) => {
      const updated = { ...prev }
      diagramSources.forEach((d: any) => {
        const key = getDiagramKey(d.figureNo, d.language || 'en')
        // Clear processing step if: new key OR diagram has code but no image (needs re-rendering)
        if (updated[key] === undefined || (d.plantumlCode && !d.imageUploadedAt)) {
          updated[key] = 0
        }
      })
      return updated
    })
    setRenderPreview((prev) => {
      const updated = { ...prev }
      newDiagramKeys.forEach((key: string) => {
        if (updated[key] === undefined) updated[key] = null
      })
      return updated
    })
    setIsViewing((prev) => {
      const updated = { ...prev }
      newFigureNos.forEach((no: number) => {
        if (updated[no] === undefined) updated[no] = false
      })
      return updated
    })
    setStateInitialized(true)
  }, [diagramSources])

  // === SKETCH TAB EFFECTS AND FUNCTIONS ===
  
  // Load sketches when tab changes to sketches
  useEffect(() => {
    if (activeTab === 'sketches' && session?.id) {
      loadSketches()
    }
  }, [activeTab, session?.id])

  // === ARRANGE TAB EFFECTS AND FUNCTIONS ===
  
  // DnD Kit sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5, // 5px movement before drag starts
      }
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const [activeDragId, setActiveDragId] = useState<string | null>(null)

  // Load combined figures when arrange tab is active
  useEffect(() => {
    if (activeTab === 'arrange' && session?.id) {
      loadCombinedFigures()
    }
  }, [activeTab, session?.id])

  const loadCombinedFigures = async () => {
    if (!session?.id) return
    
    try {
      setArrangeLoading(true)
      setArrangeError(null)
      
      const res = await fetch(`/api/patents/${patent.id}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'get_combined_figures',
          sessionId: session.id
        })
      })
      
      if (!res.ok) throw new Error('Failed to load figures')
      
      const data = await res.json()
      setArrangedFigures(data.figures || [])
      setIsSequenceFinalized(data.isFinalized || false)
      setAiReasons(null)
      if (data.figures?.length > 0 && !selectedArrangeFigure) {
        setSelectedArrangeFigure(data.figures[0])
      }
    } catch (err) {
      setArrangeError(err instanceof Error ? err.message : 'Failed to load figures')
    } finally {
      setArrangeLoading(false)
    }
  }

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragId(event.active.id as string)
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    setActiveDragId(null)

    if (!over || active.id === over.id) return
    if (isSequenceFinalized) return

    const oldIndex = arrangedFigures.findIndex(f => f.id === active.id)
    const newIndex = arrangedFigures.findIndex(f => f.id === over.id)

    if (oldIndex !== -1 && newIndex !== -1) {
      const newOrder = arrayMove(arrangedFigures, oldIndex, newIndex)
      // Update finalFigNo for each item
      const updatedOrder = newOrder.map((fig, idx) => ({
        ...fig,
        finalFigNo: idx + 1
      }))
      setArrangedFigures(updatedOrder)
      
      // Fix #4: Update selected figure to reflect new position
      if (selectedArrangeFigure) {
        const updatedSelected = updatedOrder.find(f => f.id === selectedArrangeFigure.id)
        if (updatedSelected) {
          setSelectedArrangeFigure(updatedSelected)
        }
      }
      
      // Auto-save the sequence
      await saveSequence(updatedOrder)
    }
  }

  const saveSequence = async (figures: any[]) => {
    if (!session?.id) return
    
    try {
      setSavingSequence(true)
      const sequence = figures.map(f => ({
        id: f.id,
        type: f.type,
        sourceId: f.sourceId,
        finalFigNo: f.finalFigNo
      }))

      await fetch(`/api/patents/${patent.id}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'save_figure_sequence',
          sessionId: session.id,
          sequence
        })
      })
    } catch (err) {
      console.error('Failed to save sequence:', err)
    } finally {
      setSavingSequence(false)
    }
  }

  const handleAIArrange = async () => {
    if (!session?.id) return
    // Guard: Need at least 2 figures to arrange
    if (arrangedFigures.length < 2) {
      setArrangeError('Need at least 2 figures to use AI arrangement')
      return
    }
    
    try {
      setAiArranging(true)
      setArrangeError(null)
      setAiInsight(null)
      setAiReasons(null)
      
      const res = await fetch(`/api/patents/${patent.id}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'ai_arrange_figures',
          sessionId: session.id
        })
      })
      
      if (!res.ok) throw new Error('Failed to arrange figures')
      
      const data = await res.json()
      if (data.sequence) {
        setArrangedFigures(data.sequence)
        setAiReasons(data.reasons || null)
        // Fix #4: Preserve selection if possible, otherwise select first
        if (selectedArrangeFigure) {
          const updatedSelected = data.sequence.find((f: any) => f.id === selectedArrangeFigure.id)
          setSelectedArrangeFigure(updatedSelected || data.sequence[0] || null)
        } else if (data.sequence.length > 0) {
          setSelectedArrangeFigure(data.sequence[0])
        }
      }
      if (data.insight) {
        setAiInsight(data.insight)
        setAiReasons(data.reasons || null)
      }
      
      // Save the AI-suggested sequence
      if (data.sequence) {
        await saveSequence(data.sequence)
      }
    } catch (err) {
      setArrangeError(err instanceof Error ? err.message : 'Failed to arrange figures')
    } finally {
      setAiArranging(false)
    }
  }

  const handleFinalizeSequence = async () => {
    if (!session?.id) return
    
    try {
      setSavingSequence(true)
      
      const res = await fetch(`/api/patents/${patent.id}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'finalize_figure_sequence',
          sessionId: session.id
        })
      })
      
      if (!res.ok) throw new Error('Failed to finalize sequence')
      
      setIsSequenceFinalized(true)
    } catch (err) {
      setArrangeError(err instanceof Error ? err.message : 'Failed to finalize sequence')
    } finally {
      setSavingSequence(false)
    }
  }

  const handleUnlockSequence = async () => {
    if (!session?.id) return
    
    try {
      setSavingSequence(true)
      
      const res = await fetch(`/api/patents/${patent.id}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'unlock_figure_sequence',
          sessionId: session.id
        })
      })
      
      if (!res.ok) throw new Error('Failed to unlock sequence')
      
      setIsSequenceFinalized(false)
    } catch (err) {
      setArrangeError(err instanceof Error ? err.message : 'Failed to unlock sequence')
    } finally {
      setSavingSequence(false)
    }
  }

  const handleResetSequence = async () => {
    // Reload original order
    await loadCombinedFigures()
    setAiInsight(null)
    setAiReasons(null)
  }

  const loadSketches = async () => {
    if (!session?.id) return
    
    try {
      setSketchesLoading(true)
      setSketchError(null)
      
      const res = await fetch(`/api/patents/${patent.id}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'list_sketches',
          sessionId: session.id
        })
      })
      
      if (!res.ok) throw new Error('Failed to load sketches')
      
      const data = await res.json()
      setSketches(data.sketches || [])
    } catch (err) {
      setSketchError(err instanceof Error ? err.message : 'Failed to load sketches')
    } finally {
      setSketchesLoading(false)
    }
  }

  // === IMAGE EDITOR FUNCTIONS ===
  
  // Open miniPaint Image Editor
  const openImageEditor = (
    type: 'diagram' | 'sketch',
    id: string | number,
    imagePath: string,
    title: string,
    originalImagePath?: string | null
  ) => {
    setEditingImage({ type, id, imagePath, title, originalImagePath })
    setImageEditorOpen(true)
  }

  // Handle save from miniPaint Image Editor (receives base64 directly)
  const handleImageEditorSave = async (base64: string, imageObject: any) => {
    if (!editingImage) return
    
    try {
      setSavingEditedImage(true)
      setError(null)
      
      const updateRes = await fetch(`/api/patents/${patent.id}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'update_image',
          sessionId: session?.id,
          type: editingImage.type,
          id: editingImage.id,
          imageBase64: base64,
          filename: `${editingImage.title.replace(/[^a-zA-Z0-9]/g, '_')}_edited.png`,
          preserveOriginal: true
        })
      })
      
      if (!updateRes.ok) {
        const errData = await updateRes.json()
        throw new Error(errData.error || 'Failed to save edited image')
      }
      
      // Close editor and refresh
      setImageEditorOpen(false)
      setEditingImage(null)
      
      // Refresh data based on type
      if (editingImage.type === 'sketch') {
        await loadSketches()
      } else {
        await onRefresh()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save edited image')
    } finally {
      setSavingEditedImage(false)
    }
  }

  // Close image editor without saving
  const handleImageEditorClose = () => {
    setImageEditorOpen(false)
    setEditingImage(null)
  }

  // Restore original image
  const restoreOriginalImage = async () => {
    if (!editingImage || !editingImage.originalImagePath) return
    
    if (!confirm('Restore the original AI-generated image? This will discard your edits.')) return
    
    try {
      setSavingEditedImage(true)
      
      const res = await fetch(`/api/patents/${patent.id}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'restore_original_image',
          sessionId: session?.id,
          type: editingImage.type,
          id: editingImage.id
        })
      })
      
      if (!res.ok) {
        const errData = await res.json()
        throw new Error(errData.error || 'Failed to restore original')
      }
      
      setImageEditorOpen(false)
      setEditingImage(null)
      
      if (editingImage.type === 'sketch') {
        await loadSketches()
      } else {
        await onRefresh()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to restore original')
    } finally {
      setSavingEditedImage(false)
    }
  }

  const handleGenerateSketch = async () => {
    if (!session?.id) return
    
    // Validation
    if (sketchMode === 'guided' && sketchPrompt.trim().length < 10) {
      setSketchError('Please provide at least 10 characters of instructions')
      return
    }
    if (sketchMode === 'refine' && !sketchUploadFile) {
      setSketchError('Please upload a sketch to refine')
      return
    }
    
    try {
      setSketchGenerating(true)
      setSketchError(null)
      
      let action = 'generate_sketch'
      let body: any = {
        sessionId: session.id,
        title: sketchTitle || undefined,
        contextFlags: {
          useIdeaSummary: true,
          useClaims: true,
          useDiagrams: true,
          useComponents: true
        }
      }
      
      if (sketchMode === 'guided') {
        action = 'generate_sketch_guided'
        body.userPrompt = sketchPrompt
      } else if (sketchMode === 'refine') {
        action = 'refine_sketch'
        body.userPrompt = sketchPrompt || undefined
        
        // Convert file to base64
        if (sketchUploadFile) {
          const reader = new FileReader()
          const base64 = await new Promise<string>((resolve, reject) => {
            reader.onload = () => {
              const result = reader.result as string
              resolve(result.split(',')[1]) // Remove data URL prefix
            }
            reader.onerror = reject
            reader.readAsDataURL(sketchUploadFile)
          })
          body.uploadedImageBase64 = base64
          body.uploadedImageMimeType = sketchUploadFile.type
        }
      }
      
      const res = await fetch(`/api/patents/${patent.id}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({ action, ...body })
      })
      
      const data = await res.json()
      
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Sketch generation failed')
      }
      
      // Refresh sketches list
      await loadSketches()
      
      // Reset form
      setSketchPrompt('')
      setSketchTitle('')
      setSketchUploadFile(null)
      setSketchUploadPreview(null)
      
    } catch (err) {
      setSketchError(err instanceof Error ? err.message : 'Sketch generation failed')
    } finally {
      setSketchGenerating(false)
    }
  }

  const handleGenerateSketchSuggestions = async () => {
    if (!session?.id) return

    try {
      setSuggestionsLoading(true)
      setSuggestionsError(null)

      const res = await fetch(`/api/patents/${patent.id}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'generate_sketch_suggestions',
          sessionId: session.id
        })
      })

      if (!res.ok) throw new Error('Failed to generate sketch suggestions')

      const data = await res.json()
      if (data.suggestions && Array.isArray(data.suggestions)) {
        setSketchSuggestions(data.suggestions)
      }
    } catch (err) {
      setSuggestionsError(err instanceof Error ? err.message : 'Failed to generate sketch suggestions')
    } finally {
      setSuggestionsLoading(false)
    }
  }

  const handleModifySketch = async (sketchId: string) => {
    if (!session?.id || !modifySketchPrompt.trim()) return
    
    try {
      setSketchGenerating(true)
      setSketchError(null)
      
      const res = await fetch(`/api/patents/${patent.id}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'modify_sketch',
          sessionId: session.id,
          sourceSketchId: sketchId,
          userPrompt: modifySketchPrompt
        })
      })
      
      const data = await res.json()
      
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Sketch modification failed')
      }
      
      // Refresh and close modify dialog
      await loadSketches()
      setModifyingSketchId(null)
      setModifySketchPrompt('')
      
    } catch (err) {
      setSketchError(err instanceof Error ? err.message : 'Sketch modification failed')
    } finally {
      setSketchGenerating(false)
    }
  }

  const handleDeleteSketch = async (sketchId: string) => {
    if (!confirm('Delete this sketch?')) return
    
    try {
      const res = await fetch(`/api/patents/${patent.id}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'delete_sketch',
          sketchId,
          sessionId: session?.id // Include sessionId for figure sequence cleanup
        })
      })
      
      if (!res.ok) throw new Error('Failed to delete sketch')
      
      await loadSketches()
      // Also refresh arrange tab data if it was previously loaded
      if (arrangedFigures.length > 0) {
        await loadCombinedFigures()
      }
    } catch (err) {
      setSketchError(err instanceof Error ? err.message : 'Failed to delete sketch')
    }
  }

  const handleToggleFavorite = async (sketchId: string) => {
    try {
      const res = await fetch(`/api/patents/${patent.id}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'toggle_sketch_favorite',
          sketchId
        })
      })
      
      if (!res.ok) throw new Error('Failed to toggle favorite')
      
      const data = await res.json()
      setSketches(prev => prev.map(s => 
        s.id === sketchId ? { ...s, isFavorite: data.isFavorite } : s
      ))
    } catch (err) {
      console.error('Toggle favorite error:', err)
    }
  }

  const handleRetrySketch = async (sketchId: string) => {
    try {
      setSketchGenerating(true)
      
      const res = await fetch(`/api/patents/${patent.id}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'retry_sketch',
          sketchId
        })
      })
      
      if (!res.ok) throw new Error('Failed to retry sketch')
      
      await loadSketches()
    } catch (err) {
      setSketchError(err instanceof Error ? err.message : 'Failed to retry sketch')
    } finally {
      setSketchGenerating(false)
    }
  }

  // Handle generating image from a SUGGESTED sketch
  const [generatingSuggestionId, setGeneratingSuggestionId] = useState<string | null>(null)
  
  const handleGenerateFromSuggestion = async (sketchId: string) => {
    try {
      setGeneratingSuggestionId(sketchId)
      setSketchError(null)
      
      const res = await fetch(`/api/patents/${patent.id}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'generate_from_suggestion',
          sketchId
        })
      })
      
      const data = await res.json()
      
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to generate sketch')
      }
      
      await loadSketches()
    } catch (err) {
      setSketchError(err instanceof Error ? err.message : 'Failed to generate sketch from suggestion')
    } finally {
      setGeneratingSuggestionId(null)
    }
  }

  const handleSketchFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    
    // Validate file type
    if (!['image/png', 'image/jpeg', 'image/jpg', 'image/webp'].includes(file.type)) {
      setSketchError('Please upload a PNG, JPEG, or WebP image')
      return
    }
    
    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      setSketchError('Image must be less than 10MB')
      return
    }
    
    setSketchUploadFile(file)
    
    // Create preview
    const reader = new FileReader()
    reader.onload = () => setSketchUploadPreview(reader.result as string)
    reader.readAsDataURL(file)
  }

  const handleGenerateFromLLM = async () => {
    try {
      setIsGenerating(true)
      setError(null)

      // If user chose to decide and provided an override list, generate exactly those figures instead of auto list
      const overrideList = overrideInputs.filter(Boolean)
      if (mode === 'manual' && overrideCount > 0 && overrideList.length > 0) {
        // Build the same rich context and prompt as AI mode, but use user-provided instructions
        const components = session?.referenceMap?.components || []
        const numeralsPreview = components.map((c: any) => `${c.name} (${c.numeral || '?'})`).join(', ')

        const drawingRules = countryProfile?.rules?.drawings || {}
        const figureLabelFormat = countryProfile?.profileData?.diagrams?.figureLabelFormat || countryProfile?.profileData?.rules?.drawings?.figureLabelFormat || 'Fig. {number}'
        const colorAllowed = drawingRules.colorAllowed !== undefined ? drawingRules.colorAllowed : false
        const lineStyle = drawingRules.lineStyle || 'black_and_white_solid'
        const refNumeralsMandatory = drawingRules.referenceNumeralsMandatoryWhenDrawings !== false
        const minTextSize = drawingRules.minReferenceTextSizePt || 8
        const allowedPageSizeList = [
          ...normalizePageSizes(drawingRules.allowedPageSizes),
          ...normalizePageSizes(drawingRules.paperSize)
        ]
        const allowedPageSizes = allowedPageSizeList.join(', ')

        // Determine next figure number based on existing figures
        const existingFigureCount = session?.figurePlans?.length || 0
        const startingFigNo = existingFigureCount + 1

        // Create a custom prompt that incorporates the user-provided instructions
        let customPrompt = `SYSTEM ROLE — Patent Figure Diagram Generator (PlantUML)

You generate patent-office-friendly diagrams (USPTO/EPO/IPO) in black-and-white, suitable for filing.
Your diagrams MUST be easy to understand when printed.

OUTPUT FORMAT (MANDATORY)
Return a JSON array of exactly ${overrideList.length} objects.
Each object must be:
{
  "title": "Fig.X - <short title>",
  "purpose": "<one sentence>",
  "plantuml": "<PlantUML code from @startuml to @enduml>"
}
Return JSON only. No markdown. No commentary.

NUMBERING
- These new figures will be numbered starting from Fig.${startingFigNo}.
- Use titles like "Fig.${startingFigNo} - ...", "Fig.${startingFigNo + 1} - ...", etc., in order.

USER INSTRUCTIONS FOR EACH NEW FIGURE
${overrideList.map((instruction, index) => `Fig.${startingFigNo + index}: ${instruction}`).join('\n')}`

        // Include existing figures context if checkbox is checked
        if (includeExistingFigures && session?.figurePlans?.length > 0) {
          const existingFigures = session.figurePlans
            .sort((a: any, b: any) => a.figureNo - b.figureNo)
            .map((f: any) => {
              const clean = sanitizeFigureLabel(f.title) || `Figure ${f.figureNo}`
              const description = f.description ? ` - ${f.description.slice(0, 100)}${f.description.length > 100 ? '...' : ''}` : ''
              return `Fig.${f.figureNo}: ${clean}${description}`
            })
            .join('\n')

          customPrompt += `

EXISTING FIGURES (already created - do NOT duplicate these, but ensure new figures logically follow them):
${existingFigures}

IMPORTANT: New figures should continue the "zoom-in" progression. If existing figures show the system overview, new figures should show deeper details.`
        }

        customPrompt += `

COMPONENTS / NUMERALS (MANDATORY)
You may use ONLY these components and numerals: ${numeralsPreview}.
- Do NOT invent components or numerals.
- Every component label MUST include its numeral in parentheses, e.g., "Controller (200)".
- Figure label format: ${figureLabelFormat}.
- Color policy: ${colorAllowed ? 'color permitted if essential' : 'MONOCHROME ONLY (no color)'}.
- Reference numerals: ${refNumeralsMandatory ? 'MANDATORY in all drawings' : 'Optional'}.

USER INSTRUCTIONS TAKE PRIORITY
Follow the user's specific instructions above. If the user requests a specific diagram type 
(flowchart, state diagram, deployment diagram, etc.), you may use that type.
However, you MUST still apply the DESIGN REQUIREMENTS below to ensure patent-office compliance.

DESIGN REQUIREMENTS (ALWAYS APPLY)
These settings ensure black-and-white, print-friendly diagrams:

REQUIRED SKINPARAM BLOCK (include at start of every diagram):
skinparam monochrome true
skinparam shadowing false
skinparam roundcorner 0
skinparam defaultFontName Arial
skinparam defaultFontSize 14
skinparam ArrowColor black
skinparam BorderColor black

FORBIDDEN DIRECTIVES:
- No !include / !theme / !pragma
- No title / caption / header / footer
- No sprites / icons / colors

PREFERRED STYLES (use unless user specifies otherwise):
- STYLE 1: Nested block diagram (rectangles with nested rectangles) - for system overviews
- STYLE 2: Linear pipeline (rectangles in chain with "skinparam linetype ortho") - for data flow
- STYLE 3: Sequence diagram (with skinparam sequence block) - for interactions
- STYLE 4: Activity diagram (with skinparam activity block) - for method steps

STYLE TEMPLATES FOR REFERENCE:

NESTED BLOCK:
@startuml
skinparam monochrome true
skinparam shadowing false
skinparam roundcorner 0
skinparam defaultFontName Arial
skinparam defaultFontSize 14
skinparam ArrowColor black
skinparam BorderColor black
top to bottom direction
rectangle "System (10)" as SYS {
  rectangle "Subsystem A (12)" as A
  rectangle "Subsystem B (14)" as B
}
A --> B : data
@enduml

SEQUENCE (with required skinparam block):
@startuml
skinparam monochrome true
skinparam shadowing false
skinparam roundcorner 0
skinparam defaultFontName Arial
skinparam defaultFontSize 14
skinparam ArrowColor black
skinparam BorderColor black
skinparam sequence {
  LifeLineBorderColor black
  LifeLineBackgroundColor white
  ParticipantBorderColor black
  ParticipantBackgroundColor white
}

actor "User (900)" as U
participant "Device (100)" as D
U -> D : input
D --> U : response
@enduml

ACTIVITY (with required skinparam block):
@startuml
skinparam monochrome true
skinparam shadowing false
skinparam roundcorner 0
skinparam defaultFontName Arial
skinparam defaultFontSize 14
skinparam ArrowColor black
skinparam BorderColor black
skinparam activity {
  BackgroundColor white
  BorderColor black
  FontColor black
}

start
:Step one (100);
:Step two (200);
stop
@enduml

FINAL SELF-CHECK (MANDATORY)
- Follows user's instructions for diagram content and type.
- Includes required skinparam block for patent compliance.
- Uses only allowed numerals/components.
- Has @startuml and @enduml.
Now output the JSON array.`

        const resp = await onComplete({
          action: 'generate_diagrams_llm',
          sessionId: session?.id,
          prompt: customPrompt,
          // In manual AI mode, append to existing figures instead of replacing them
          replaceExisting: false
        })
        if (!resp) throw new Error('LLM did not return valid figure list')

        // Backend already saves figures with correct figure numbers (appended after existing)
        // No need to call handleSavePlantUML - it would overwrite with wrong figure numbers

        setOverrideCount(0)
        setOverrideInputs([])
        await onRefresh()
        return
      }

      // Build concise context to nudge LLM
      const components = session?.referenceMap?.components || []
      const numeralsPreview = components.map((c: any) => `${c.name} (${c.numeral || '?'})`).join(', ')

      // Get frozen claims for claim-aware diagram generation
      const normalizedData = session?.ideaRecord?.normalizedData || {}
      const frozenClaims = normalizedData.claimsStructured || []
      const claimsText = normalizedData.claims || ''
      const hasClaimsContext = frozenClaims.length > 0 || claimsText

      // Build claims context for the prompt
      let claimsContext = ''
      if (hasClaimsContext) {
        if (frozenClaims.length > 0) {
          const claimsSummary = frozenClaims.slice(0, 5).map((c: any) => 
            `Claim ${c.number} (${c.type}${c.category ? `, ${c.category}` : ''}): ${(c.text || '').substring(0, 150)}...`
          ).join('\n')
          claimsContext = `\n\nFROZEN PATENT CLAIMS (diagrams should illustrate these):\n${claimsSummary}`
          if (frozenClaims.length > 5) {
            claimsContext += `\n(+ ${frozenClaims.length - 5} more claims)`
          }
        } else if (claimsText) {
          // Parse HTML claims text
          const plainClaims = claimsText.replace(/<[^>]*>/g, '').substring(0, 800)
          claimsContext = `\n\nFROZEN PATENT CLAIMS (diagrams should illustrate these):\n${plainClaims}...`
        }
      }

      const drawingRules = countryProfile?.rules?.drawings || {}
      const figureLabelFormat = countryProfile?.profileData?.diagrams?.figureLabelFormat || countryProfile?.profileData?.rules?.drawings?.figureLabelFormat || 'Fig. {number}'
      const colorAllowed = drawingRules.colorAllowed !== undefined ? drawingRules.colorAllowed : false
      const lineStyle = drawingRules.lineStyle || 'black_and_white_solid'
      const refNumeralsMandatory = drawingRules.referenceNumeralsMandatoryWhenDrawings !== false
      const minTextSize = drawingRules.minReferenceTextSizePt || 8
      const allowedPageSizeList = [
        ...normalizePageSizes(drawingRules.allowedPageSizes),
        ...normalizePageSizes(drawingRules.paperSize)
      ]
      const allowedPageSizes = allowedPageSizeList.join(', ')

      const prompt = `SYSTEM ROLE — Patent Figure Diagram Generator (PlantUML)

You generate patent-office-friendly diagrams (USPTO/EPO/IPO) in black-and-white, suitable for filing.
Your diagrams MUST be easy to understand when printed.

OUTPUT FORMAT (MANDATORY)
Return a JSON array of exactly ${diagramCount} objects.
Each object must be:
{
  "title": "Fig.X - <short title>",
  "purpose": "<one sentence>",
  "plantuml": "<PlantUML code from @startuml to @enduml>"
}
Return JSON only. No markdown. No commentary.

COMPONENTS / NUMERALS (MANDATORY)
You may use ONLY these components and numerals: ${numeralsPreview}.
- Do NOT invent components or numerals.
- Every component label MUST include its numeral in parentheses, e.g., "Controller (200)".
- Use concise labels.
- Figure label format: ${figureLabelFormat}.
- Color policy: ${colorAllowed ? 'color permitted if essential' : 'MONOCHROME ONLY (no color)'}.
- Reference numerals: ${refNumeralsMandatory ? 'MANDATORY in all drawings' : 'Optional'}.

FIGURE HIERARCHY (MANDATORY)
Fig.1: System Overview (broad, abstract)
Fig.2: Subsystem Zoom (nested within the system)
Fig.3: Either (A) linear data/control pipeline OR (B) method flowchart; choose the clearest.
Fig.4+: Only if needed (deployment/interface or another component zoom)
${claimsContext ? `
═══════════════════════════════════════════════════════════════════════════════
CLAIM-AWARE DIAGRAM GENERATION
═══════════════════════════════════════════════════════════════════════════════
The following claims define the legal scope of this patent. Design figures that:
- Illustrate the method steps described in method claims
- Show the system architecture described in system/apparatus claims
- Highlight the key inventive features that distinguish this invention
${claimsContext}
` : ''}
DIAGRAM TYPE POLICY (IMPORTANT)
You are allowed ONLY these four diagram styles:
STYLE 1: Nested block diagram (rectangles with nested rectangles)
STYLE 2: Linear ortho pipeline (rectangles in a chain; linetype ortho)
STYLE 3: Sequence diagram (only for real message/interactions)
STYLE 4: Activity diagram (method steps; max one decision)

Do NOT use any other PlantUML types (no class, component keyword, usecase, mindmap, etc.).
No !include / !theme / !pragma. No title/caption. No sprites/icons. No colors.

READABILITY LIMITS (STRICT)
- Block/pipeline: 4–10 rectangles, max 12 arrows.
- Nested block: max depth = 2 levels (System → Subsystem → Components). No deeper.
- Sequence: 3–6 participants, max 10 messages.
- Activity: 4–10 steps, max 1 decision.
- Max label length (excluding numeral): 28 characters.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
APPROVED STYLE TEMPLATES (COPY EXACTLY, THEN MODIFY CONTENT)
You MUST use one of these templates per figure.
Preserve the skinparam lines and overall structure.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

STYLE 1 — NESTED BLOCK DIAGRAM (preferred for Fig.1 & Fig.2)
@startuml
skinparam monochrome true
skinparam shadowing false
skinparam roundcorner 0
skinparam defaultFontName Arial
skinparam defaultFontSize 14
skinparam ArrowColor black
skinparam BorderColor black

top to bottom direction

rectangle "System (10)" as SYS {
  rectangle "Subsystem A (12)" as A {
    rectangle "Component A1 (121)" as A1
    rectangle "Component A2 (122)" as A2
  }
  rectangle "Subsystem B (14)" as B {
    rectangle "Component B1 (141)" as B1
    rectangle "Component B2 (142)" as B2
  }
}

A --> B : data
@enduml

STYLE 2 — LINEAR ORTHO PIPELINE (preferred for Fig.3 if linear flow)
@startuml
skinparam monochrome true
skinparam shadowing false
skinparam roundcorner 0
skinparam defaultFontName Arial
skinparam defaultFontSize 14
skinparam ArrowColor black
skinparam BorderColor black
skinparam linetype ortho

top to bottom direction

rectangle "Input (20)" as IN
rectangle "Filter (22)" as FIL
rectangle "Analyzer (24)" as AN
rectangle "Controller (26)" as CO
rectangle "Output (28)" as OUT

IN --> FIL
FIL --> AN
AN --> CO
CO --> OUT
@enduml

STYLE 3 — SEQUENCE (ONLY if truly message/interactions matter)
@startuml
skinparam monochrome true
skinparam shadowing false
skinparam roundcorner 0
skinparam defaultFontName Arial
skinparam defaultFontSize 14
skinparam ArrowColor black
skinparam BorderColor black
skinparam sequence {
  LifeLineBorderColor black
  LifeLineBackgroundColor white
  ParticipantBorderColor black
  ParticipantBackgroundColor white
}

actor "User (900)" as U
participant "Device (100)" as D
participant "Controller (200)" as C
participant "Storage (500)" as S

U -> D : input
D -> C : transmit data
C -> S : read/write
S --> C : response
C --> D : output
D --> U : present result
@enduml

STYLE 4 — ACTIVITY (ONLY for method steps; max 1 decision)
@startuml
skinparam monochrome true
skinparam shadowing false
skinparam roundcorner 0
skinparam defaultFontName Arial
skinparam defaultFontSize 14
skinparam ArrowColor black
skinparam BorderColor black

skinparam activity {
  BackgroundColor white
  BorderColor black
  FontColor black
}

start
:Receive input data (100);
:Extract features (200);
:Determine condition (210);

if (Condition satisfied?) then (Yes)
  :Generate control output (400);
else (No)
  :Apply fallback rule (500);
endif

:Transmit result (600);
stop
@enduml

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

FINAL SELF-CHECK (MANDATORY)
For each figure:
- Uses EXACTLY one of the four styles above.
- Uses only allowed numerals/components.
- Meets readability caps.
- Has @startuml and @enduml.${claimsContext ? `
- Diagrams illustrate the frozen claims where applicable.` : ''}
Now output the JSON array.`

      const res = await onComplete({
        action: 'generate_diagrams_llm',
        sessionId: session?.id,
        prompt,
        // In autopilot mode, we intentionally replace the existing figure set
        replaceExisting: true
      })

      if (!res || !Array.isArray(res.figures)) {
        throw new Error('LLM did not return valid figure list')
      }

      // Backend already saves figures with correct figure numbers (1, 2, 3... for replace mode)
      // No need to call handleSavePlantUML - it would be redundant

      setFigures([]) // Clear proposed figures since they're now automatically approved

      // Refresh to pull saved plans and sources immediately
      await onRefresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed')
    } finally {
      setIsGenerating(false)
    }
  }

  const queueUpload = useCallback((key: string, figureNo: number, blob: Blob, language: string) => {
    uploadQueueRef.current = uploadQueueRef.current.then(async () => {
      try {
        setUploadingByKey(prev => ({ ...prev, [key]: true }))
        setIsUploading(true)
        const filename = `figure_${figureNo}_${language}_${Date.now()}.png`
        const file = new File([blob], filename, { type: 'image/png' })
        // Use ref to get latest handleUploadImage and avoid stale closure
        if (handleUploadImageRef.current) {
          await handleUploadImageRef.current(figureNo, file, filename, language)
        }
      } finally {
        setUploadingByKey(prev => ({ ...prev, [key]: false }))
        setIsUploading(false)
      }
    }).catch((e) => {
      console.warn('Queued upload failed:', e instanceof Error ? e.message : e)
    })
  }, [])

  const runSingleRender = async (figureNo: number, plantumlCode: string, language = 'en') => {
    const key = getDiagramKey(figureNo, language)
    setProcessingStatus(prev => ({ ...prev, [key]: intelligentMessages[0] }))
    setProcessingStep(prev => ({ ...prev, [key]: 0 }))

    try {
      // Minimal delay for UI feedback
      await new Promise(resolve => setTimeout(resolve, 50))
      setProcessingStatus(prev => ({ ...prev, [key]: intelligentMessages[1] }))
      setProcessingStep(prev => ({ ...prev, [key]: 1 }))

      setRendering((prev) => ({ ...prev, [key]: true }))
      setError(null)

      // Abort any in-flight render for this figure/language to keep UI responsive
      try {
        const prev = renderAbortControllersRef.current[key]
        prev?.abort()
      } catch {}
      const controller = new AbortController()
      renderAbortControllersRef.current[key] = controller

      const resp = await fetch('/api/test/plantuml-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          code: plantumlCode,
          format: 'png',
          figureNo,
          patentId: patent?.id,
          sessionId: session?.id
        })
      })

      if (!resp.ok) {
        const info = await resp.json().catch(() => ({}))
        throw new Error(info.error || 'Render failed')
      }

      setProcessingStatus(prev => ({ ...prev, [key]: intelligentMessages[2] }))
      setProcessingStep(prev => ({ ...prev, [key]: 2 }))

      const blob = await resp.blob()
      const url = URL.createObjectURL(blob)
      setRenderPreview((prev) => {
        const prevUrl = prev?.[key]
        if (prevUrl && typeof prevUrl === 'string') {
          try { URL.revokeObjectURL(prevUrl) } catch {}
        }
        return ({ ...prev, [key]: url })
      })

      setProcessingStatus(prev => ({ ...prev, [key]: intelligentMessages[3] }))
      setProcessingStep(prev => ({ ...prev, [key]: 3 }))

      // Upload in the background so the next render can start quickly
      queueUpload(key, figureNo, blob, language)

      // Clear processing status
      setProcessingStatus(prev => ({ ...prev, [key]: '' }))
      setProcessingStep(prev => ({ ...prev, [key]: 0 }))

    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'Unknown error'
      console.error(`Processing failed for figure ${figureNo}:`, errorMessage)
      setError(`Figure ${figureNo} processing failed: ${errorMessage}`)
      setProcessingStatus(prev => ({ ...prev, [key]: `Failed: ${errorMessage}` }))
      setProcessingStep(prev => ({ ...prev, [key]: -1 })) // Mark as failed
      // Clear from queued set so user can retry
      queuedForRenderRef.current.delete(key)
    } finally {
      setRendering((prev) => ({ ...prev, [key]: false }))
    }
  }

  // Intelligent automatic diagram processing with serialized queue and reduced gap between requests
  const autoProcessDiagram = (figureNo: number, plantumlCode: string, language = 'en') => {
    renderQueueRef.current = renderQueueRef.current.then(async () => {
      // Reduced gap between render requests for better responsiveness
      await new Promise(resolve => setTimeout(resolve, 150))
      await runSingleRender(figureNo, plantumlCode, language)
    })
    return renderQueueRef.current
  }

  const handleUploadImage = async (figureNo: number, file: File, customFilename?: string, language = 'en') => {
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
      if (!uploadResp.ok) {
        let message = 'Upload failed'
        try {
          const j = await uploadResp.json()
          if (j?.error) message = j.error
        } catch {}
        throw new Error(message)
      }
      const uploadedMeta = await uploadResp.json()
      // Use custom filename if provided, otherwise use the filename from response
      const filename = customFilename || uploadedMeta.filename
      await onComplete({ action: 'upload_diagram', sessionId: session?.id, figureNo, language, filename, checksum: uploadedMeta.checksum, imagePath: uploadedMeta.path })
      setUploaded((prev) => ({ ...prev, [getDiagramKey(figureNo, language)]: true }))
      await onRefresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setIsUploading(false)
    }
  }
  // Keep ref updated with latest handleUploadImage to avoid stale closures
  handleUploadImageRef.current = handleUploadImage

  const handleViewImage = async (figureNo: number, filename?: string) => {
    if (!filename) return
    try {
      setIsViewing(prev => ({ ...prev, [figureNo]: true }))
      setError(null)
      const url = `/api/projects/${patent.project.id}/patents/${patent.id}/upload?filename=${encodeURIComponent(filename)}`
      const resp = await fetch(url, { headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` } })
      if (!resp.ok) throw new Error('Failed to load image')
      const blob = await resp.blob()
      const blobUrl = URL.createObjectURL(blob)
      window.open(blobUrl, '_blank', 'noopener,noreferrer')
      // Revoke blob URL after a delay to allow browser to load it
      setTimeout(() => {
        try { URL.revokeObjectURL(blobUrl) } catch {}
      }, 5000)
    } catch (e) {
      setError('Unable to open image')
    } finally {
      setIsViewing(prev => ({ ...prev, [figureNo]: false }))
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-8 max-w-7xl mx-auto space-y-8"
    >
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-3xl font-bold text-gray-900 tracking-tight flex items-center gap-3">
            <div className="p-2 bg-indigo-100 rounded-lg">
              <LayoutGrid className="w-6 h-6 text-indigo-600" />
            </div>
            Figure Planner
          </h2>
          <p className="text-gray-500 mt-2 text-lg">Design and generate intelligent patent diagrams.</p>
      </div>

      </div>

      {/* Main Tab Bar: Diagrams vs Sketches */}
      <div className="border-b border-gray-200">
        <nav className="flex space-x-8" aria-label="Figure Planner Tabs">
          <button
            onClick={() => setActiveTab('diagrams')}
            className={`py-4 px-1 border-b-2 font-medium text-sm flex items-center gap-2 transition-colors ${
              activeTab === 'diagrams'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <Code className="w-4 h-4" />
            Diagrams
            {diagramSources.length > 0 && (
              <Badge variant="secondary" className="ml-1">{diagramSources.length}</Badge>
            )}
          </button>
          <button
            onClick={() => setActiveTab('sketches')}
            className={`py-4 px-1 border-b-2 font-medium text-sm flex items-center gap-2 transition-colors ${
              activeTab === 'sketches'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <Pencil className="w-4 h-4" />
            Sketches (AI Generated)
            {sketches.filter(s => s.status === 'SUCCESS').length > 0 && (
              <Badge variant="secondary" className="ml-1">{sketches.filter(s => s.status === 'SUCCESS').length}</Badge>
            )}
          </button>
          <button
            onClick={() => setActiveTab('arrange')}
            className={`py-4 px-1 border-b-2 font-medium text-sm flex items-center gap-2 transition-colors ${
              activeTab === 'arrange'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <Layers className="w-4 h-4" />
            Arrange
            {isSequenceFinalized && (
              <Lock className="w-3 h-3 text-green-600" />
            )}
          </button>
        </nav>
      </div>

      {/* TAB CONTENT */}
      {activeTab === 'diagrams' && (
        <>
          {/* Diagrams Mode Selector */}
          <div className="flex items-center gap-2 bg-gray-100 p-1 rounded-lg w-fit">
            <button
              onClick={() => setMode('ai')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2 ${
                mode === 'ai' 
                  ? 'bg-white text-indigo-600 shadow-sm' 
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <Bot className="w-4 h-4" />
              AI Autopilot
            </button>
            <button
              onClick={() => setMode('manual')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2 ${
                mode === 'manual' 
                  ? 'bg-white text-indigo-600 shadow-sm' 
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <User className="w-4 h-4" />
              Manual Control
            </button>
          </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Mode Selection Cards - Only show if no figures yet */}
      {figures.length === 0 && diagramSources.length === 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <button
            className="text-left"
            onClick={() => setMode('ai')}
          >
            <Card
              className={`cursor-pointer transition-all hover:shadow-md ${mode === 'ai' ? 'ring-2 ring-indigo-600 border-indigo-100 bg-indigo-50/30' : ''}`}
            >
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-indigo-600" />
                AI-Driven Generation
              </CardTitle>
              <CardDescription>
                Let our intelligent agent analyze your patent claims and description to automatically propose and generate the perfect set of figures.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm text-gray-600">
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-green-500" /> Automatic figure count optimization</li>
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-green-500" /> Context-aware component labeling</li>
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-green-500" /> Standard patent diagram styles</li>
              </ul>
            </CardContent>
          </Card>
          </button>

          <button
            className="text-left"
            onClick={() => setMode('manual')}
          >
            <Card
              className={`cursor-pointer transition-all hover:shadow-md ${mode === 'manual' ? 'ring-2 ring-indigo-600 border-indigo-100 bg-indigo-50/30' : ''}`}
            >
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="w-5 h-5 text-indigo-600" />
                Manual Specification
              </CardTitle>
              <CardDescription>
                You know your invention best. Define exactly how many figures you need and what each one should depict.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm text-gray-600">
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-green-500" /> Custom figure counts</li>
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-green-500" /> Specific descriptions for each view</li>
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-green-500" /> Full control over the output</li>
              </ul>
            </CardContent>
          </Card>
          </button>
          </div>
      )}

      {/* Actions Area */}
      <AnimatePresence mode="wait">
        {mode === 'ai' ? (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="space-y-4"
          >
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Label htmlFor="diagram-count" className="text-sm font-medium text-gray-700">
                  Number of Diagrams:
                </Label>
                <Input
                  id="diagram-count"
                  type="number"
                  min={1}
                  max={10}
                  value={diagramCount}
                  onChange={(e) => setDiagramCount(Math.max(1, Math.min(10, parseInt(e.target.value) || 5)))}
                  className="w-20 text-center"
                  disabled={isGenerating}
                />
              </div>
            </div>
            <Button 
              size="lg"
              onClick={handleGenerateFromLLM}
              disabled={isGenerating}
              className="w-full md:w-auto bg-indigo-600 hover:bg-indigo-700 text-white gap-2 h-12 px-8 text-lg shadow-lg shadow-indigo-200"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Analyzing Patent Structure<AnimatedDots />
                </>
              ) : (
                <>
                  <Sparkles className="w-5 h-5" />
                  Generate Diagram Set
                </>
              )}
            </Button>
            {isGenerating && (
              <p className="text-sm text-gray-500 animate-pulse">
                Our AI is reading your specification and designing the optimal figure set...
              </p>
            )}
          </motion.div>
        ) : (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="space-y-4 bg-gray-50 p-6 rounded-xl border border-gray-200"
          >
            <div className="flex items-center gap-4 mb-4">
              <Label className="whitespace-nowrap">Number of Figures:</Label>
              <Input
                type="number"
                min={1}
                max={20}
                className="w-24 bg-white"
                value={overrideCount}
                onChange={(e) => {
                  const n = Math.max(0, parseInt(e.target.value || '0', 10))
                  setOverrideCount(n)
                  setOverrideInputs(Array.from({ length: n }, (_, i) => overrideInputs[i] || ''))
                }}
              />
            </div>

            <div className="flex items-center space-x-2 mb-4">
              <Checkbox
                id="include-existing"
                checked={includeExistingFigures}
                onCheckedChange={setIncludeExistingFigures}
              />
              <Label htmlFor="include-existing" className="text-sm text-gray-700">
                Tell AI about existing figures to avoid duplicates
              </Label>
            </div>
            
            <div className="space-y-4">
          {Array.from({ length: overrideCount }).map((_, i) => (
                <motion.div 
                  key={i}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="bg-white p-4 rounded-lg border shadow-sm"
                >
                  <Label className="mb-2 block text-xs uppercase text-gray-500 font-semibold">Figure {i + 1} Description</Label>
                  <Textarea 
                    placeholder="Describe what this figure should show..."
                    className="resize-none"
                    value={overrideInputs[i] || ''}
                    onChange={(e) => {
                const arr = [...overrideInputs]
                arr[i] = e.target.value
                setOverrideInputs(arr)
                    }}
                  />
                </motion.div>
          ))}
        </div>
            
            {overrideCount > 0 && (
              <Button 
                onClick={handleGenerateFromLLM}
                disabled={isGenerating}
                className="w-full md:w-auto bg-indigo-600 hover:bg-indigo-700"
              >
                {isGenerating ? <>Generating<AnimatedDots /></> : `Generate ${overrideCount} Custom Figures`}
              </Button>
            )}
          </motion.div>
        )}
      </AnimatePresence>


      {/* Saved Diagrams Grid */}
      <div className="mt-12">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <ImageIcon className="w-5 h-5 text-gray-600" />
            Project Diagrams
          </h3>
          <div className="flex items-center gap-2">
            {/* Translate All Diagrams Button */}
            {diagramSources.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setTranslateFigureNo(null) // null = translate all
                  setShowTranslateModal(true)
                }}
                className="text-purple-600 border-purple-200 hover:bg-purple-50 hover:border-purple-300"
              >
                <Languages className="w-4 h-4 mr-2" />
                Translate All
              </Button>
            )}
            <motion.div
              animate={showManual ? { scale: [1, 1.05, 1] } : {}}
              transition={{ duration: 0.5, repeat: showManual ? Infinity : 0, repeatDelay: 2 }}
            >
              <Button
                variant="outline"
                size="sm"
                onClick={handleUploadToggle}
                className={showManual ? 'border-indigo-400 text-indigo-700' : ''}
              >
                {showManual ? 'Hide External Uploads' : 'Upload External Image'}
              </Button>
            </motion.div>
          </div>
        </div>

        
{diagramSources.length === 0 ? (
          <div className="text-center py-12 bg-gray-50 rounded-xl border border-dashed border-gray-200">
            <ImageIcon className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500">No diagrams created yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {Object.keys(diagramsByFigure)
              .map(n => Number(n))
              .sort((a, b) => a - b)
              .map((figNo: number) => {
                const sources = diagramsByFigure[figNo] || []
                if (sources.length === 0) return null

                const availableLangs = Array.from(new Set(sources.map((s: any) => (s.language || 'en').toLowerCase())))
                const selectedLang = (() => {
                  const chosen = selectedLangByFigure[figNo]
                  if (chosen && availableLangs.includes(chosen)) return chosen
                  if (availableLangs.includes(preferredFigureLanguage)) return preferredFigureLanguage
                  if (availableLangs.includes('en')) return 'en'
                  return availableLangs[0]
                })()

                const selectedSource = sources.find((s: any) => (s.language || 'en').toLowerCase() === selectedLang) || sources[0]

                const plan = figurePlans.find((f: any) => f.figureNo === figNo)
                const diagramKey = getDiagramKey(figNo, selectedSource.language || 'en')
                const previewUrl = renderPreview[diagramKey] as string | undefined
                const serverImageUrl = selectedSource.imageFilename
                  ? `/api/projects/${patent.project.id}/patents/${patent.id}/upload?filename=${encodeURIComponent(selectedSource.imageFilename)}`
                  : undefined
                const displayUrl = previewUrl || serverImageUrl
                const editorImageUrl = previewUrl && !previewUrl.startsWith('blob:')
                  ? previewUrl
                  : serverImageUrl || previewUrl

                return (
              <Card key={`figure_${figNo}`} className="overflow-hidden hover:shadow-lg transition-all duration-300">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant={uploaded[diagramKey] || selectedSource.imageUploadedAt ? 'default' : 'secondary'} className="shrink-0">
                        Fig. {figNo}
                      </Badge>
                      {/* Show translation count if available */}
                      {diagramTranslations[figNo]?.length > 1 && (
                        <Badge variant="outline" className="text-xs text-green-600 bg-green-50 border-green-200">
                          {diagramTranslations[figNo].length - 1} translation{diagramTranslations[figNo].length > 2 ? 's' : ''}
                        </Badge>
                      )}
                    </div>
                    <Badge variant="outline" className="text-xs text-gray-500">
                      {selectedSource.imageUploadedAt ? 'Rendered' : selectedSource.plantumlCode ? 'Code Ready' : 'Pending'}
                    </Badge>
                  </div>
                  {/* Caption (Title) - shown prominently */}
                  <CardTitle className="text-base font-semibold text-gray-900 mt-2 line-clamp-2">
                    {(() => {
                      const caption = plan?.title || `Figure ${figNo}`
                      // Remove redundant "Fig. X" prefix from caption if present
                      return caption.replace(/^(Fig\.\s*\d+\s*[-:"]\s*)/i, '').trim() || caption
                    })()}
                  </CardTitle>
                </CardHeader>
                
                <div className="px-4 pb-3 flex flex-wrap gap-2 border-b bg-white">
                  {availableLangs.map(lang => (
                    <button
                      key={`${figNo}_${lang}`}
                      onClick={() => setSelectedLangByFigure(prev => ({ ...prev, [figNo]: lang }))}
                      className={`px-3 py-1 rounded-md text-sm border transition ${
                        lang === selectedLang
                          ? 'bg-green-50 border-green-500 text-green-700 font-semibold'
                          : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {LANGUAGE_LABELS[lang]?.split(' ')[0] || lang.toUpperCase()}
                    </button>
                  ))}
                </div>
                
                <CardContent className="p-0 relative bg-gray-100 min-h-[200px] flex items-center justify-center group">
                  {/* Preview Image */}
                  {(renderPreview[diagramKey] || (selectedSource.imageFilename && !processingStatus[diagramKey])) ? (
                    <>
                      <img 
                        src={displayUrl || ''} 
                        alt={`Fig ${figNo}`}
                        className="w-full h-64 object-contain bg-white"
                      />
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                        <Button variant="secondary" size="sm" onClick={() => setExpandedFigNo(figNo)}>
                          <Eye className="w-4 h-4 mr-2" /> Expand
                        </Button>
                        <Button 
                          variant="secondary" 
                          size="sm" 
                          className="w-full text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50"
                          onClick={() => {
                            const imagePath = editorImageUrl || displayUrl || ''
                            openImageEditor('diagram', figNo, imagePath, plan?.title || `Figure ${figNo}`, selectedSource.originalImagePath)
                          }}
                          title="Edit this image in miniPaint - add/remove labels, erase, draw shapes"
                        >
                          <Paintbrush className="w-4 h-4 mr-2" /> Edit
                        </Button>
                      </div>
                    </>
                  ) : (
                  <div className="flex flex-col items-center p-6 text-center">
                    {processingStatus[diagramKey] ? (
                      <div className="space-y-3">
                        <div className="relative w-16 h-16 mx-auto">
                          <div className="absolute inset-0 border-4 border-indigo-100 rounded-full"></div>
                          <div className="absolute inset-0 border-4 border-indigo-500 rounded-full border-t-transparent animate-spin"></div>
                          <Sparkles className="absolute inset-0 m-auto w-6 h-6 text-indigo-500 animate-pulse" />
                        </div>
                        <p className="text-sm font-medium text-indigo-600 animate-pulse">
                          {processingStatus[diagramKey]}
                        </p>
                        {processingStep[diagramKey] === -1 && selectedSource.plantumlCode && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="mt-2"
                            onClick={() => {
                              // Clear states and re-queue for rendering
                              setProcessingStatus(prev => ({ ...prev, [diagramKey]: '' }))
                              setProcessingStep(prev => ({ ...prev, [diagramKey]: 0 }))
                              queuedForRenderRef.current.delete(diagramKey) // Allow re-queueing
                              autoProcessDiagram(figNo, selectedSource.plantumlCode, selectedSource.language || 'en')
                            }}
                          >
                            <RefreshCw className="w-4 h-4 mr-2" /> Retry Render
                          </Button>
                        )}
                      </div>
                    ) : selectedSource.plantumlCode ? (
                      <div className="text-center">
                        <Code className="w-12 h-12 text-gray-300 mx-auto mb-2" />
                        <p className="text-sm text-gray-500 mb-4">Code ready for processing</p>
                        <Button size="sm" onClick={() => {
                          queuedForRenderRef.current.delete(diagramKey) // Ensure it can be queued
                          autoProcessDiagram(figNo, selectedSource.plantumlCode, selectedSource.language || 'en')
                        }}>
                          <RefreshCw className="w-4 h-4 mr-2" /> Render Image
                        </Button>
                      </div>
                    ) : (
                      <p className="text-sm text-gray-400">No image data</p>
                    )}
                  </div>
                )}
                </CardContent>

                {/* Figure Caption & Description - Academic Style */}
                {(() => {
                  const caption = plan?.title || ''
                  const description = plan?.description || ''
                  // Clean caption: remove "Fig. X -" prefix if present
                  const cleanCaption = caption.replace(/^(Fig\.\s*\d+\s*[-:"]\s*)/i, '').trim()
                  
                  // Only show this section if there's either a caption or description
                  if (!cleanCaption && !description) return null
                  
                  return (
                    <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 space-y-2">
                      {/* Caption Line - for draft export (one line max) */}
                      {cleanCaption && (
                        <p className="text-sm font-medium text-gray-800 truncate" title={cleanCaption}>
                          <span className="text-indigo-600">Fig. {figNo}:</span> {cleanCaption}
                        </p>
                      )}
                      {/* Description - detailed explanation */}
                      {description && (
                        <p className="text-xs text-gray-600 leading-relaxed text-justify">
                          <span className="font-medium text-gray-700">Description:</span> {description}
                        </p>
                      )}
                    </div>
                  )
                })()}

                <div className="p-3 bg-white border-t grid grid-cols-4 gap-2">
                  <Button variant="ghost" size="sm" className="w-full" onClick={() => { setModifyFigNo(figNo); setModifyTextSaved('') }}>
                    <Edit2 className="w-4 h-4 mr-2" /> Modify
                  </Button>
                  {/* Edit Image button - visible when image exists */}
                  {(renderPreview[diagramKey] || selectedSource.imageFilename) ? (
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="w-full text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50"
                      onClick={() => {
                        const imagePath = editorImageUrl || displayUrl || ''
                        openImageEditor('diagram', figNo, imagePath, plan?.title || `Figure ${figNo}`, selectedSource.originalImagePath)
                      }}
                      title="Edit image in miniPaint - add/remove labels, erase, draw"
                    >
                      <Paintbrush className="w-4 h-4 mr-2" /> Edit
                    </Button>
                  ) : (
                    <Button variant="ghost" size="sm" className="w-full" disabled>
                      <Paintbrush className="w-4 h-4 mr-2 opacity-50" /> Edit
                    </Button>
                  )}
                  {/* Translate single diagram button */}
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="w-full text-purple-600 hover:text-purple-700 hover:bg-purple-50"
                    onClick={() => {
                      setTranslateFigureNo(figNo)
                      setShowTranslateModal(true)
                    }}
                    title="Translate diagram labels to another language"
                  >
                    <Languages className="w-4 h-4 mr-2" /> Translate
                  </Button>
                  <Button variant="ghost" size="sm" className="w-full text-red-600 hover:text-red-700 hover:bg-red-50" 
                    onClick={async () => {
                      const langLabel = LANGUAGE_LABELS[selectedLang]?.split(' ')[0] || selectedLang.toUpperCase()
                      if(!confirm(`Delete Figure ${figNo} (${langLabel})?`)) return
                      try {
                        await onComplete({ action: 'delete_figure', sessionId: session?.id, figureNo: figNo, language: selectedLang })
                        await onRefresh()
                        // Clear selected arrange figure if it was the deleted one
                        if (selectedArrangeFigure?.id === `diagram-${figNo}`) {
                          setSelectedArrangeFigure(null)
                        }
                        // Refresh arrange tab data if it was previously loaded
                        if (arrangedFigures.length > 0) {
                          await loadCombinedFigures()
                        }
                      } catch (e) { setError('Failed to delete') }
                    }}>
                    <Trash2 className="w-4 h-4 mr-2" /> Delete
                  </Button>
                  
                  {selectedSource.plantumlCode && (
                    <div className="col-span-2">
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="w-full text-xs text-gray-500"
                          onClick={() => setShowPlantUML(prev => ({ ...prev, [figNo]: !prev[figNo] }))}
                        >
                          {showPlantUML[figNo] ? 'Hide Source Code' : 'View Source Code'}
                        </Button>
                        {showPlantUML[figNo] && (
                           <div className="mt-2 relative">
                             <Textarea 
                        readOnly
                        value={selectedSource.plantumlCode}
                               className="font-mono text-xs h-32 bg-gray-50"
                      />
                             <Button 
                               size="sm" 
                               variant="secondary"
                               className="absolute top-2 right-2 h-6 text-xs"
                        onClick={() => navigator.clipboard.writeText(selectedSource.plantumlCode)}
                      >
                        Copy
                             </Button>
                    </div>
                        )}
                  </div>
                )}

                  {/* Modification Panel */}
                {modifyFigNo === figNo && (
                    <div className="col-span-2 mt-2 pt-2 border-t">
                      <Label className="text-xs mb-1 block">Describe changes:</Label>
                      <Textarea 
                        className="text-sm mb-2"
                        value={modifyTextSaved}
                        onChange={(e) => setModifyTextSaved(e.target.value)}
                      />
                        <div className="flex gap-2">
                          <Button size="sm" className="flex-1" onClick={async () => {
                            setRegeneratingFigure(prev => ({ ...prev, [figNo]: true }))
                            try {
                             const resp = await onComplete({ action: 'regenerate_diagram_llm', sessionId: session?.id, figureNo: figNo, instructions: modifyTextSaved })
                              if (resp?.diagramSource?.plantumlCode) {
                                await onRefresh()
                                setModifyFigNo(null)
                                setModifyTextSaved('')
                              }
                            } catch (e) { setError('Failed to modify') } finally {
                              setRegeneratingFigure(prev => ({ ...prev, [figNo]: false }))
                            }
                          }} disabled={!!regeneratingFigure[figNo]}>
                            {regeneratingFigure[figNo] ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                            Apply
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setModifyFigNo(null)}>Cancel</Button>
                      </div>
                      {regeneratingFigure[figNo] && (
                        <div className="mt-2 flex items-center text-xs text-indigo-600">
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Regenerating diagram with AI...
                        </div>
                      )}
                    </div>
                  )}
                  </div>
                </Card>
                )})}
                      </div>
                    )}
                      </div>
      {/* Manual Upload Section (Collapsible) */}
      <div ref={uploadSectionRef}>
        <AnimatePresence>
          {showManual && (
            <motion.div
              initial={{ opacity: 0, height: 0, scale: 0.95 }}
              animate={{
                opacity: 1,
                height: 'auto',
                scale: highlightUpload ? [1, 1.02, 1] : 1,
                boxShadow: highlightUpload
                  ? ['0 1px 3px 0 rgb(0 0 0 / 0.1)', '0 10px 25px -5px rgb(99 102 241 / 0.1)', '0 1px 3px 0 rgb(0 0 0 / 0.1)']
                  : '0 1px 3px 0 rgb(0 0 0 / 0.1)'
              }}
              exit={{ opacity: 0, height: 0, scale: 0.95 }}
              transition={{
                duration: highlightUpload ? 0.6 : 0.3,
                scale: {
                  repeat: highlightUpload ? 2 : 0,
                  duration: 0.2
                }
              }}
              className={`bg-white border border-gray-200 rounded-xl p-6 shadow-sm mt-6 ${highlightUpload ? 'ring-2 ring-indigo-400 ring-opacity-50' : ''}`}
            >
            <div className="mb-4">
              <h4 className="font-semibold flex items-center gap-2 mb-2">
                <Upload className="w-5 h-5 text-indigo-600" />
                Upload External Images
                {highlightUpload && (
                  <motion.span
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="inline-flex items-center px-2 py-1 text-xs font-medium text-indigo-700 bg-indigo-100 rounded-full"
                  >
                    <Sparkles className="w-3 h-3 mr-1" />
                    Ready to upload!
                  </motion.span>
                )}
              </h4>
              <p className="text-sm text-gray-600">
                Upload your own patent diagrams or images. Each image needs a detailed description (minimum 20 words)
                so our AI can understand and integrate it into your patent specification.
              </p>
                      </div>
            
            <div className="flex gap-4 mb-6">
              <Input 
                type="number" 
                min={1} 
                className="w-24"
                value={manualCount}
                onChange={(e) => { 
                  const n = Math.max(0, parseInt(e.target.value || '0', 10)); 
                  setManualCount(n); 
                  setManualInputs(Array.from({ length: n }, (_, i) => manualInputs[i] || { title: '', description: '' })); 
                  setManualFiles(Array.from({ length: n }, (_, i) => manualFiles[i] || null)); 
                }} 
              />
              <Button onClick={async () => {
                // Bulk add slots logic
              try {
                for (let i = 0; i < manualCount; i++) {
                  const item = manualInputs[i]
                  if (!item || !item.description || item.description.trim().split(/\s+/).length < 20) {
                    setError('Each image needs at least 20 words description')
                    return
                  }
                }
                for (let i = 0; i < manualCount; i++) {
                  const item = manualInputs[i]
                            const resp = await onComplete({ action: 'create_manual_figure', sessionId: session?.id, title: sanitizeFigureLabel(item.title) || item.title, description: item.description })
                  const createdNo = resp?.created?.figureNo
                  if (createdNo && manualFiles[i]) {
                    await handleUploadImage(createdNo, manualFiles[i] as File)
                  }
                }
                setManualCount(0)
                setManualInputs([])
                setManualFiles([])
                await onRefresh()
                } catch (e) { setError('Failed to create manual figures') }
              }}>
                Add {manualCount} Upload Slots
              </Button>
        </div>

            <div className="space-y-4">
        {Array.from({ length: manualCount }).map((_, i) => (
                <div key={i} className="border rounded-lg p-4 bg-gray-50">
                  <div className="grid gap-4">
                    <Input 
                      placeholder="Figure Title (Optional)" 
                      value={manualInputs[i]?.title || ''} 
                      onChange={(e) => { const arr = [...manualInputs]; arr[i] = { ...(arr[i] || { title: '', description: '' }), title: e.target.value }; setManualInputs(arr) }} 
                    />
                    <div>
                      <Label className="text-xs text-gray-500 mb-1">Description (min 20 words)</Label>
                      <Textarea 
                        placeholder="Describe the image content..."
                        value={manualInputs[i]?.description || ''} 
                        onChange={(e) => { const arr = [...manualInputs]; arr[i] = { ...(arr[i] || { title: '', description: '' }), description: e.target.value }; setManualInputs(arr) }} 
                      />
                       <div className="text-xs mt-1 text-right">
              <span className={countWords(manualInputs[i]?.description || '') >= 20 ? 'text-green-600' : 'text-gray-500'}>
                {countWords(manualInputs[i]?.description || '')} / 20 words
              </span>
            </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <Input 
                        type="file" 
                        accept=".png,.svg" 
                        className="bg-white"
                        onChange={(e) => { const arr = [...manualFiles]; arr[i] = e.target.files?.[0] || null; setManualFiles(arr) }} 
                      />
                      {manualFiles[i] && countWords(manualInputs[i]?.description || '') >= 20 && (
                         <Badge variant="default" className="bg-green-500">Ready</Badge>
                      )}
                    </div>
        </div>
          </div>
        ))}
      </div>
          </motion.div>
      )}
      </AnimatePresence>
      </div>

      {/* Expanded Image Modal */}
      <AnimatePresence>
        {(() => {
          const sources = diagramSources.filter((d: any) => d.figureNo === expandedFigNo)
          const availableLangs = Array.from(new Set(sources.map((s: any) => (s.language || 'en').toLowerCase())))
          const selectedLang = (() => {
            if (!expandedFigNo) return null
            const chosen = selectedLangByFigure[expandedFigNo]
            if (chosen && availableLangs.includes(chosen)) return chosen
            if (availableLangs.includes(preferredFigureLanguage)) return preferredFigureLanguage
            if (availableLangs.includes('en')) return 'en'
            return availableLangs[0] || null
          })()
          const diagramSource = sources.find((d: any) => (d.language || 'en').toLowerCase() === selectedLang) || sources[0]
          const expandedKey = diagramSource ? getDiagramKey(diagramSource.figureNo, diagramSource.language || 'en') : ''
          const hasImage = expandedFigNo && (renderPreview[expandedKey] || (diagramSource?.imageFilename && !processingStatus[expandedKey]))

          return hasImage ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setExpandedFigNo(null)}
          >
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              transition={{
                type: "spring",
                stiffness: 300,
                damping: 30,
                duration: 0.3
              }}
              className="bg-white rounded-xl shadow-2xl p-2 max-w-6xl w-full max-h-[90vh] flex flex-col will-change-transform"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between p-4 border-b">
                <h4 className="text-lg font-semibold text-gray-900">Figure {expandedFigNo} Preview</h4>
                <Button variant="ghost" size="icon" onClick={() => setExpandedFigNo(null)}>
                  <span className="sr-only">Close</span>
                  <span className="text-2xl">&times;</span>
                </Button>
              </div>
              <div className="flex-1 overflow-auto p-4 bg-gray-100 flex items-center justify-center">
                <motion.img
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.1, duration: 0.3 }}
                  src={renderPreview[expandedKey] || `/api/projects/${patent.project.id}/patents/${patent.id}/upload?filename=${encodeURIComponent(diagramSource?.imageFilename || '')}`}
                  alt={`Preview Fig.${expandedFigNo}`}
                  className="max-w-full h-auto shadow-lg"
                  style={{ willChange: 'transform, opacity' }}
                />
              </div>
              <div className="p-4 border-t flex justify-end gap-3">
                <Button variant="outline" onClick={() => setExpandedFigNo(null)}>Close</Button>
                {/* Approval is now automatic - this button removed */}
              </div>
            </motion.div>
          </motion.div>
        ) : null
      })()}
      </AnimatePresence>

      {/* Translation Modal */}
      <AnimatePresence>
        {showTranslateModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => !translating && setShowTranslateModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-xl shadow-2xl p-6 max-w-md w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-purple-100 rounded-lg">
                  <Languages className="w-6 h-6 text-purple-600" />
                </div>
                <div>
                  <h4 className="text-lg font-semibold text-gray-900">
                    {translateFigureNo !== null ? `Translate Figure ${translateFigureNo}` : 'Translate All Diagrams'}
                  </h4>
                  <p className="text-sm text-gray-500">
                    {translateFigureNo !== null 
                      ? 'Convert diagram labels to another language' 
                      : `Translate all ${diagramSources.filter((d: any) => !d.language || d.language === 'en').length} English diagrams`}
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <Label className="text-sm font-medium text-gray-700">Target Language</Label>
                  <select
                    value={translateTargetLang}
                    onChange={(e) => setTranslateTargetLang(e.target.value)}
                    className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                    disabled={translating}
                  >
                    <option value="">Select language...</option>
                    {getAvailableTargetLanguages().map((lang) => (
                      <option key={lang} value={lang}>
                        {LANGUAGE_LABELS[lang] || lang.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </div>

                {translateFigureNo === null && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                    <p className="text-sm text-amber-800">
                      <strong>Note:</strong> Diagrams will be translated one by one to ensure accuracy. 
                      This may take a few moments.
                    </p>
                  </div>
                )}

                {translateProgress && (
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm text-gray-600">
                      <span>Translating...</span>
                      <span>{translateProgress.current} / {translateProgress.total}</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div 
                        className="bg-purple-600 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${(translateProgress.current / translateProgress.total) * 100}%` }}
                      />
                    </div>
                  </div>
                )}

                <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-600 space-y-1">
                  <p>• Original English diagrams are preserved</p>
                  <p>• Translated diagrams are stored separately</p>
                  <p>• Reference numerals (100, 200, etc.) remain unchanged</p>
                  <p>• Drafting stage will auto-select by jurisdiction</p>
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowTranslateModal(false)
                    setTranslateTargetLang('')
                    setTranslateFigureNo(null)
                  }}
                  disabled={translating}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleTranslateDiagrams}
                  disabled={!translateTargetLang || translating}
                  className="flex-1 bg-purple-600 hover:bg-purple-700 text-white"
                >
                  {translating ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Translating...
                    </>
                  ) : (
                    <>
                      <Languages className="w-4 h-4 mr-2" />
                      {translateFigureNo !== null ? 'Translate' : 'Translate All'}
                    </>
                  )}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
        </>
      )}

      {/* SKETCHES TAB CONTENT */}
      {activeTab === 'sketches' && (
        <div className="space-y-6">
          {/* Sketch Error Alert */}
          {sketchError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{sketchError}</AlertDescription>
            </Alert>
          )}

          {/* Sketch Generation Controls */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wand2 className="w-5 h-5 text-indigo-600" />
                Generate Patent Sketch
              </CardTitle>
              <CardDescription>
                Create patent-style black-and-white line art sketches from your invention context.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Generate Suggestions Button */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Button
                    onClick={handleGenerateSketchSuggestions}
                    disabled={suggestionsLoading}
                    variant="outline"
                    className="gap-2"
                  >
                    {suggestionsLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Sparkles className="w-4 h-4" />
                    )}
                    Generate Suggestions
                  </Button>
                  {sketchSuggestions.length > 0 && (
                    <Badge variant="secondary" className="ml-2">
                      {sketchSuggestions.length} suggestions
                    </Badge>
                  )}
                </div>
              </div>

              {/* Mode Selector */}
              <div className="flex items-center gap-2 bg-gray-100 p-1 rounded-lg w-fit">
                <button
                  onClick={() => setSketchMode('auto')}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2 ${
                    sketchMode === 'auto'
                      ? 'bg-white text-indigo-600 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  <Sparkles className="w-4 h-4" />
                  Auto Generate
                </button>
                <button
                  onClick={() => setSketchMode('guided')}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2 ${
                    sketchMode === 'guided'
                      ? 'bg-white text-indigo-600 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  <Edit2 className="w-4 h-4" />
                  With Instructions
                </button>
                <button
                  onClick={() => setSketchMode('refine')}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2 ${
                    sketchMode === 'refine'
                      ? 'bg-white text-indigo-600 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  <Upload className="w-4 h-4" />
                  Refine Upload
                </button>
              </div>

              {/* Suggestions Error */}
              {suggestionsError && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{suggestionsError}</AlertDescription>
                </Alert>
              )}

              {/* Sketch Suggestions */}
              {sketchSuggestions.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Lightbulb className="w-4 h-4 text-amber-600" />
                    <Label className="text-sm font-medium text-gray-700">Sketch Suggestions</Label>
                  </div>
                  <div className="grid gap-3">
                    {sketchSuggestions.map((suggestion, index) => (
                      <Card key={index} className="border-amber-200 bg-amber-50/50">
                        <CardContent className="p-4">
                          <div className="flex items-start gap-3">
                            <div className="w-6 h-6 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                              <span className="text-xs font-semibold text-amber-700">{index + 1}</span>
                            </div>
                            <div className="flex-1">
                              <h4 className="font-medium text-gray-900 mb-1">{suggestion.title}</h4>
                              <p className="text-sm text-gray-600 leading-relaxed">{suggestion.description}</p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              )}

              {/* Mode-specific inputs */}
              <div className="space-y-4">
                <div>
                  <Label htmlFor="sketch-title">Title (Optional)</Label>
                  <Input
                    id="sketch-title"
                    placeholder="e.g., System Block Diagram"
                    value={sketchTitle}
                    onChange={(e) => setSketchTitle(e.target.value)}
                    disabled={sketchGenerating}
                  />
                </div>

                {sketchMode !== 'auto' && (
                  <div>
                    <Label htmlFor="sketch-prompt">
                      {sketchMode === 'guided' ? 'Instructions' : 'Refinement Instructions (Optional)'}
                    </Label>
                    <Textarea
                      id="sketch-prompt"
                      placeholder={
                        sketchMode === 'guided'
                          ? "Describe what the sketch should show, layout preferences, focus areas..."
                          : "Optional: Specify how to refine the uploaded sketch..."
                      }
                      value={sketchPrompt}
                      onChange={(e) => setSketchPrompt(e.target.value)}
                      disabled={sketchGenerating}
                      rows={3}
                    />
                  </div>
                )}

                {sketchMode === 'refine' && (
                  <div className="space-y-2">
                    <Label>Upload Your Sketch</Label>
                    <input
                      ref={sketchFileInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/jpg,image/webp"
                      onChange={handleSketchFileChange}
                      className="hidden"
                    />
                    <div
                      onClick={() => sketchFileInputRef.current?.click()}
                      className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
                        sketchUploadPreview
                          ? 'border-green-300 bg-green-50'
                          : 'border-gray-300 hover:border-indigo-400 hover:bg-indigo-50'
                      }`}
                    >
                      {sketchUploadPreview ? (
                        <div className="space-y-2">
                          <img
                            src={sketchUploadPreview}
                            alt="Upload preview"
                            className="max-h-32 mx-auto rounded"
                          />
                          <p className="text-sm text-green-600">{sketchUploadFile?.name}</p>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation()
                              setSketchUploadFile(null)
                              setSketchUploadPreview(null)
                            }}
                          >
                            Remove
                          </Button>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <Upload className="w-8 h-8 mx-auto text-gray-400" />
                          <p className="text-sm text-gray-500">Click to upload a sketch</p>
                          <p className="text-xs text-gray-400">PNG, JPEG, WebP up to 10MB</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <Button
                onClick={handleGenerateSketch}
                disabled={sketchGenerating || (sketchMode === 'refine' && !sketchUploadFile)}
                className="w-full md:w-auto bg-indigo-600 hover:bg-indigo-700 text-white gap-2"
              >
                {sketchGenerating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Generating Sketch...
                  </>
                ) : (
                  <>
                    <Wand2 className="w-4 h-4" />
                    {sketchMode === 'auto' && 'Generate from Context'}
                    {sketchMode === 'guided' && 'Generate with Instructions'}
                    {sketchMode === 'refine' && 'Refine Uploaded Sketch'}
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          {/* Sketch Suggestions Section - shown first if there are suggestions from diagram generation */}
          {(() => {
            const suggestions = sketches.filter(s => s.status === 'SUGGESTED')
            if (suggestions.length === 0) return null
            
            return (
              <div className="mb-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-amber-500" />
                    AI-Suggested Sketches
                    <Badge variant="secondary" className="ml-2">{suggestions.length}</Badge>
                  </h3>
                </div>
                <p className="text-sm text-gray-600 mb-4">
                  These sketch ideas were generated alongside your diagrams. Click &quot;Generate Image&quot; to create the actual sketch.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {suggestions.map((suggestion) => (
                    <motion.div
                      key={suggestion.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="group"
                    >
                      <Card className="overflow-hidden transition-shadow hover:shadow-lg border-amber-200 bg-amber-50/50">
                        <div className="relative aspect-[4/3] bg-gradient-to-br from-amber-100 to-amber-50 flex items-center justify-center p-4">
                          {generatingSuggestionId === suggestion.id ? (
                            <div className="flex flex-col items-center">
                              <Loader2 className="w-10 h-10 animate-spin text-amber-600 mb-2" />
                              <p className="text-sm text-amber-700">Generating sketch...</p>
                            </div>
                          ) : (
                            <div className="text-center">
                              <Wand2 className="w-12 h-12 mx-auto text-amber-400 mb-3" />
                              <p className="text-xs text-amber-600 uppercase tracking-wide font-medium">Suggested Sketch</p>
                            </div>
                          )}
                        </div>
                        <CardContent className="p-4">
                          <h4 className="font-semibold text-gray-900 text-sm mb-2">{suggestion.title}</h4>
                          {suggestion.description && (
                            <p className="text-xs text-gray-600 mb-3 line-clamp-3">
                              {suggestion.description}
                            </p>
                          )}
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              className="flex-1 bg-amber-600 hover:bg-amber-700 text-white"
                              onClick={() => handleGenerateFromSuggestion(suggestion.id)}
                              disabled={generatingSuggestionId !== null}
                            >
                              {generatingSuggestionId === suggestion.id ? (
                                <>
                                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                  Generating...
                                </>
                              ) : (
                                <>
                                  <Wand2 className="w-3 h-3 mr-1" />
                                  Generate Image
                                </>
                              )}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 w-8 p-0"
                              onClick={() => handleDeleteSketch(suggestion.id)}
                              disabled={generatingSuggestionId !== null}
                            >
                              <Trash2 className="w-4 h-4 text-gray-400" />
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    </motion.div>
                  ))}
                </div>
              </div>
            )
          })()}

          {/* Generated Sketches Grid */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <Grid3X3 className="w-5 h-5" />
                Generated Sketches
              </h3>
              <Button variant="outline" size="sm" onClick={loadSketches} disabled={sketchesLoading}>
                <RefreshCw className={`w-4 h-4 mr-2 ${sketchesLoading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>

            {sketchesLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
              </div>
            ) : sketches.filter(s => s.status !== 'SUGGESTED').length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="py-12 text-center">
                  <Pencil className="w-12 h-12 mx-auto text-gray-300 mb-4" />
                  <h4 className="text-lg font-medium text-gray-900 mb-2">No generated sketches yet</h4>
                  <p className="text-gray-500 mb-4">
                    {sketches.some(s => s.status === 'SUGGESTED') 
                      ? 'Generate sketches from the suggestions above, or create a new one using the controls.'
                      : 'Generate your first patent-style sketch using the controls above.'}
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {sketches.filter((s) => s.status !== 'SUGGESTED').map((sketch) => {
                  const sketchImageUrl = sketch.imageFilename
                    ? `/api/projects/${patent.project.id}/patents/${patent.id}/upload?filename=${encodeURIComponent(sketch.imageFilename)}`
                    : sketch.imagePath

                  return (
                  <motion.div
                    key={sketch.id}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="group"
                  >
                    <Card className={`overflow-hidden transition-shadow hover:shadow-lg ${
                      sketch.status === 'FAILED' ? 'border-red-200' : ''
                    }`}>
                      {/* Image Preview */}
                      <div
                        className="relative aspect-square bg-gray-100 cursor-pointer"
                        onClick={() => sketchImageUrl && setExpandedSketchId(sketch.id)}
                      >
                        {sketch.status === 'PENDING' ? (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
                          </div>
                        ) : sketch.status === 'FAILED' ? (
                          <div className="absolute inset-0 flex flex-col items-center justify-center p-4">
                            <AlertCircle className="w-8 h-8 text-red-500 mb-2" />
                            <p className="text-sm text-red-600 text-center">{sketch.errorMessage || 'Generation failed'}</p>
                            <Button
                              size="sm"
                              variant="outline"
                              className="mt-2"
                              onClick={(e) => {
                                e.stopPropagation()
                                handleRetrySketch(sketch.id)
                              }}
                            >
                              <RefreshCw className="w-3 h-3 mr-1" />
                              Retry
                            </Button>
                          </div>
                        ) : sketchImageUrl ? (
                          <img
                            src={sketchImageUrl || ''}
                            alt={sketch.title}
                            className="w-full h-full object-contain"
                          />
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <ImageIcon className="w-8 h-8 text-gray-300" />
                          </div>
                        )}

                        {/* Hover overlay */}
                        {sketchImageUrl && sketch.status === 'SUCCESS' && (
                          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                            <Button size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); setExpandedSketchId(sketch.id) }}>
                              <Eye className="w-4 h-4" />
                            </Button>
                            <Button 
                              size="sm" 
                              variant="secondary"
                              onClick={(e) => {
                                e.stopPropagation()
                                if (sketchImageUrl) {
                                  openImageEditor('sketch', sketch.id, sketchImageUrl, sketch.title, sketch.originalImagePath)
                                }
                              }}
                              title="Edit this sketch in miniPaint"
                            >
                              <Paintbrush className="w-4 h-4" />
                            </Button>
                          </div>
                        )}

                        {/* Favorite badge */}
                        {sketch.isFavorite && (
                          <div className="absolute top-2 right-2">
                            <Star className="w-5 h-5 text-yellow-500 fill-yellow-500" />
                          </div>
                        )}

                        {/* Mode badge */}
                        <div className="absolute top-2 left-2">
                          <Badge variant="secondary" className="text-xs">
                            {sketch.mode}
                          </Badge>
                        </div>
                      </div>

                      {/* Card Footer */}
                      <CardContent className="p-3">
                        <h4 className="font-medium text-gray-900 truncate text-sm">{sketch.title}</h4>
                        {sketch.description && (
                          <p className="text-xs text-gray-600 mt-1 line-clamp-2" title={sketch.description}>
                            {sketch.description}
                          </p>
                        )}
                        <p className="text-xs text-gray-400 mt-1">
                          {new Date(sketch.createdAt).toLocaleDateString()}
                        </p>

                        {/* Actions */}
                        <div className="flex items-center gap-1 mt-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 p-0"
                            onClick={() => handleToggleFavorite(sketch.id)}
                            title="Toggle favorite"
                          >
                            {sketch.isFavorite ? (
                              <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
                            ) : (
                              <StarOff className="w-4 h-4 text-gray-400" />
                            )}
                          </Button>
                          {/* Edit Image button */}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 p-0"
                            onClick={() => {
                              if (sketchImageUrl) {
                                openImageEditor('sketch', sketch.id, sketchImageUrl, sketch.title, sketch.originalImagePath)
                              }
                            }}
                            disabled={!sketchImageUrl || sketch.status !== 'SUCCESS'}
                            title="Edit image in miniPaint"
                          >
                            <Paintbrush className={`w-4 h-4 ${sketchImageUrl && sketch.status === 'SUCCESS' ? 'text-indigo-500' : 'text-gray-300'}`} />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 p-0"
                            onClick={() => {
                              setModifyingSketchId(sketch.id)
                              setModifySketchPrompt('')
                            }}
                            disabled={sketch.status !== 'SUCCESS'}
                            title="Modify with AI"
                          >
                            <Edit2 className="w-4 h-4 text-gray-400" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 p-0"
                            onClick={() => handleDeleteSketch(sketch.id)}
                            title="Delete sketch"
                          >
                            <Trash2 className="w-4 h-4 text-gray-400" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Sketch Expanded Modal */}
          <AnimatePresence>
            {expandedSketchId && (() => {
              const sketch = sketches.find(s => s.id === expandedSketchId)
              if (!sketch) return null
              const modalSketchImageUrl = sketch.imageFilename
                ? `/api/projects/${patent.project.id}/patents/${patent.id}/upload?filename=${encodeURIComponent(sketch.imageFilename)}`
                : sketch.imagePath
              if (!modalSketchImageUrl) return null

              return (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
                  onClick={() => setExpandedSketchId(null)}
                >
                  <motion.div
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.8, opacity: 0 }}
                    className="bg-white rounded-xl shadow-2xl p-2 max-w-4xl w-full max-h-[90vh] flex flex-col"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center justify-between p-4 border-b">
                      <div>
                        <h4 className="text-lg font-semibold text-gray-900">{sketch.title}</h4>
                        {sketch.description && (
                          <p className="text-sm text-gray-600 mt-1 max-w-xl">{sketch.description}</p>
                        )}
                      </div>
                      <Button variant="ghost" size="icon" onClick={() => setExpandedSketchId(null)}>
                        <span className="text-2xl">&times;</span>
                      </Button>
                    </div>
                    <div className="flex-1 overflow-auto p-4 bg-gray-100 flex items-center justify-center">
                      <img
                        src={modalSketchImageUrl}
                        alt={sketch.title}
                        className="max-w-full h-auto shadow-lg"
                      />
                    </div>
                    <div className="p-4 border-t flex justify-between items-center">
                      <div className="text-sm text-gray-500">
                        Mode: {sketch.mode} • Created: {new Date(sketch.createdAt).toLocaleString()}
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          onClick={() => {
                            setExpandedSketchId(null)
                            setModifyingSketchId(sketch.id)
                          }}
                        >
                          <Edit2 className="w-4 h-4 mr-2" />
                          Modify
                        </Button>
                        <Button variant="outline" onClick={() => setExpandedSketchId(null)}>
                          Close
                        </Button>
                      </div>
                    </div>
                  </motion.div>
                </motion.div>
              )
            })()}
          </AnimatePresence>

          {/* Modify Sketch Modal */}
          <AnimatePresence>
            {modifyingSketchId && (() => {
              const sketch = sketches.find(s => s.id === modifyingSketchId)
              if (!sketch) return null

              const modalSketchImageUrl = sketch.imageFilename
                ? `/api/projects/${patent.project.id}/patents/${patent.id}/upload?filename=${encodeURIComponent(sketch.imageFilename)}`
                : sketch.imagePath

              return (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
                  onClick={() => setModifyingSketchId(null)}
                >
                  <motion.div
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.9, opacity: 0 }}
                    className="bg-white rounded-xl shadow-2xl p-6 max-w-lg w-full"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <h4 className="text-lg font-semibold text-gray-900 mb-4">Modify Sketch</h4>
                    <p className="text-sm text-gray-500 mb-4">
                      Describe the changes you want to make to "{sketch.title}"
                    </p>
                    
                    {modalSketchImageUrl && (
                      <div className="mb-4 p-2 bg-gray-100 rounded">
                        <img
                          src={modalSketchImageUrl}
                          alt={sketch.title}
                          className="max-h-32 mx-auto"
                        />
                      </div>
                    )}

                    <Textarea
                      placeholder="e.g., Add more detail to the control module, rotate the layout 90 degrees..."
                      value={modifySketchPrompt}
                      onChange={(e) => setModifySketchPrompt(e.target.value)}
                      rows={3}
                      disabled={sketchGenerating}
                    />

                    <div className="flex gap-2 mt-4">
                      <Button
                        variant="outline"
                        onClick={() => setModifyingSketchId(null)}
                        disabled={sketchGenerating}
                      >
                        Cancel
                      </Button>
                      <Button
                        onClick={() => handleModifySketch(sketch.id)}
                        disabled={sketchGenerating || !modifySketchPrompt.trim()}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white"
                      >
                        {sketchGenerating ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Modifying...
                          </>
                        ) : (
                          <>
                            <Wand2 className="w-4 h-4 mr-2" />
                            Create Modified Sketch
                          </>
                        )}
                      </Button>
                    </div>
                  </motion.div>
                </motion.div>
              )
            })()}
          </AnimatePresence>
        </div>
      )}

      {/* ARRANGE TAB CONTENT */}
      {activeTab === 'arrange' && (
        <div className="space-y-6">
          {/* Arrange Error Alert */}
          {arrangeError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{arrangeError}</AlertDescription>
            </Alert>
          )}

          {/* Header with instruction */}
          <div className="border-b border-gray-200 pb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-gray-600">
                Combine and order your figures for the final specification.
              </p>
              <p className="text-sm text-gray-500 mt-1">
                {isSequenceFinalized 
                  ? 'Sequence is finalized. Unlock to make changes.'
                  : 'Drag to reorder. Changes are saved automatically.'}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                Tip: Click, hold, and drag anywhere on a figure card to reorder.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleAIArrange}
              disabled={isSequenceFinalized || aiArranging || arrangedFigures.length < 2}
              className="shrink-0"
            >
              {aiArranging ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4 mr-2" />
              )}
              Suggest Order
            </Button>
          </div>

          {/* AI Insight Banner - only show when present */}
          {aiInsight && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-slate-50 border border-slate-200 rounded-lg p-4 flex flex-col gap-3"
            >
                <div className="flex items-start gap-3">
                  <Info className="w-5 h-5 text-slate-500 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-slate-700">{aiInsight}</p>
                </div>
                {aiReasons && aiReasons.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs text-slate-500">
                      Follow the numbered order below (top to bottom).
                    </p>
                    <ol className="space-y-2">
                      {aiReasons
                        .slice()
                        .sort((a, b) => (a.finalFigNo || 0) - (b.finalFigNo || 0))
                        .map((r) => (
                          <li key={r.id} className="rounded-md border border-slate-200 bg-white p-3">
                            <div className="flex items-start gap-2">
                              <span className="text-xs font-semibold text-slate-600 px-2 py-1 rounded bg-slate-100">
                                {r.finalFigNo ? `#${r.finalFigNo}` : '?'}
                              </span>
                              <div>
                                <div className="text-sm font-semibold text-slate-800">
                                  {r.title}
                                </div>
                                <div className="text-sm text-slate-700 leading-relaxed mt-0.5">{r.reason}</div>
                              </div>
                            </div>
                          </li>
                        ))}
                    </ol>
                  </div>
                )}
            </motion.div>
          )}

          {arrangeLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
            </div>
          ) : arrangedFigures.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-12 text-center">
                <Layers className="w-12 h-12 mx-auto text-gray-300 mb-4" />
                <h4 className="text-lg font-medium text-gray-900 mb-2">No figures to arrange</h4>
                <p className="text-gray-500">
                  Generate diagrams or sketches first, then return here to arrange them.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Left: Sortable List */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium text-gray-700 uppercase tracking-wide">
                    Figure Order
                  </h3>
                  <span className="text-xs text-gray-500">
                    {arrangedFigures.length} figure{arrangedFigures.length !== 1 ? 's' : ''}
                  </span>
                </div>

                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                >
                  <SortableContext
                    items={arrangedFigures.map(f => f.id)}
                    strategy={verticalListSortingStrategy}
                    disabled={isSequenceFinalized}
                  >
                    <div className="space-y-2">
                      {arrangedFigures.map((figure) => (
                        <SortableFigureItem
                          key={figure.id}
                          figure={figure}
                          isSelected={selectedArrangeFigure?.id === figure.id}
                          isFinalized={isSequenceFinalized}
                          onSelect={() => setSelectedArrangeFigure(figure)}
                          onAttemptReorder={() => {
                            if (isSequenceFinalized) setShowUnlockPrompt(true)
                          }}
                        />
                      ))}
                    </div>
                  </SortableContext>

                  <DragOverlay>
                    {activeDragId ? (
                      <div className="bg-white border border-gray-300 rounded-lg p-3 shadow-lg opacity-90">
                        {(() => {
                          const figure = arrangedFigures.find(f => f.id === activeDragId)
                          if (!figure) return null
                          return (
                            <div className="flex items-center gap-3">
                              <span className="text-sm font-mono text-gray-500 w-12">
                                Fig {figure.finalFigNo}
                              </span>
                              <span className="text-sm font-medium text-gray-900 truncate">
                                {figure.title}
                              </span>
                            </div>
                          )
                        })()}
                      </div>
                    ) : null}
                  </DragOverlay>
                </DndContext>
              </div>

              {/* Right: Preview Panel */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium text-gray-700 uppercase tracking-wide">
                    Preview
                  </h3>
                </div>

                {selectedArrangeFigure ? (
                  <Card>
                    <CardContent className="p-4">
                      {/* Figure preview image */}
                      <div className="aspect-video bg-gray-50 border border-gray-200 rounded-lg mb-4 flex items-center justify-center overflow-hidden">
                        {selectedArrangeFigure.imagePath ? (
                          <img
                            src={selectedArrangeFigure.imagePath}
                            alt={selectedArrangeFigure.title}
                            className="max-w-full max-h-full object-contain"
                            onError={(e) => {
                              // Sketches may be stored in /public/uploads/sketches; provide a direct fallback if the API URL fails.
                              if (selectedArrangeFigure?.type === 'sketch' && selectedArrangeFigure?.imageFilename) {
                                const fallback = `/uploads/sketches/${encodeURIComponent(selectedArrangeFigure.imageFilename)}`
                                if (e.currentTarget.src !== fallback) e.currentTarget.src = fallback
                              }
                            }}
                          />
                        ) : (
                          <div className="text-gray-400 text-sm">No preview available</div>
                        )}
                      </div>

                      {/* Figure details */}
                      <div className="space-y-3">
                        <div>
                          <h4 className="font-medium text-gray-900">
                            Fig {selectedArrangeFigure.finalFigNo} – {selectedArrangeFigure.title}
                          </h4>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge variant="outline" className="text-xs">
                              {selectedArrangeFigure.type === 'diagram' ? 'Block Diagram' : 'AI Sketch'}
                            </Badge>
                          </div>
                        </div>

                        {selectedArrangeFigure.description && (
                          <p className="text-sm text-gray-600">
                            {selectedArrangeFigure.description}
                          </p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ) : (
                  <Card className="border-dashed">
                    <CardContent className="py-12 text-center">
                      <p className="text-gray-500 text-sm">Select a figure to preview</p>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          )}

          {/* Action Buttons */}
          {arrangedFigures.length > 0 && (
            <div className="flex items-center justify-between pt-4 border-t border-gray-200">
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleResetSequence}
                  disabled={isSequenceFinalized || arrangeLoading}
                >
                  <RotateCcw className="w-4 h-4 mr-2" />
                  Reset
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleAIArrange}
                  disabled={isSequenceFinalized || aiArranging || arrangedFigures.length < 2}
                >
                  {aiArranging ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4 mr-2" />
                  )}
                  Suggest Order
                </Button>
              </div>

              <div className="flex items-center gap-3">
                {savingSequence && (
                  <span className="text-xs text-gray-500 flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Saving...
                  </span>
                )}
                
                {isSequenceFinalized ? (
                  <Button
                    variant="outline"
                    onClick={handleUnlockSequence}
                    disabled={savingSequence}
                  >
                    <Unlock className="w-4 h-4 mr-2" />
                    Unlock to Edit
                  </Button>
                ) : (
                  <Button
                    onClick={handleFinalizeSequence}
                    disabled={savingSequence || arrangedFigures.length === 0}
                    className="bg-gray-900 hover:bg-gray-800 text-white"
                  >
                    <Lock className="w-4 h-4 mr-2" />
                    Finalize Sequence
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
      
      {/* Unlock prompt when drag attempted while finalized */}
      {showUnlockPrompt && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
            <div className="flex items-start gap-3">
              <Lock className="w-5 h-5 text-gray-500 mt-1" />
              <div>
                <h4 className="text-lg font-semibold text-gray-900">Sequence locked</h4>
                <p className="text-sm text-gray-600 mt-1">
                  Unlock the figure sequence to rearrange images.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <Button variant="outline" onClick={() => setShowUnlockPrompt(false)}>
                Cancel
              </Button>
              <Button
                onClick={async () => {
                  setShowUnlockPrompt(false)
                  await handleUnlockSequence()
                }}
                disabled={savingSequence}
              >
                <Unlock className="w-4 h-4 mr-2" />
                Unlock to Edit
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* MINIPAINT IMAGE EDITOR - Opens miniPaint with image preloaded */}
      {imageEditorOpen && editingImage && (
        <ImageEditor
          imageSrc={editingImage.imagePath}
          title={editingImage.title}
          onSave={handleImageEditorSave}
          onClose={handleImageEditorClose}
        />
      )}
      
      <div className="hidden">
        {/* Helper for preserving existing logic not explicitly in UI but needed for compilation if any */}
      </div>
    </motion.div>
  )
}

// === SORTABLE FIGURE ITEM COMPONENT ===
interface SortableFigureItemProps {
  figure: any
  isSelected: boolean
  isFinalized: boolean
  onSelect: () => void
  onAttemptReorder?: () => void
}

function SortableFigureItem({ figure, isSelected, isFinalized, onSelect, onAttemptReorder }: SortableFigureItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ 
    id: figure.id,
    disabled: isFinalized
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  // Allow dragging from the entire card (not just the handle)
  const dragProps = isFinalized ? {} : { ...attributes, ...listeners }

  const handleBlockedDrag = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isFinalized) return
    e.preventDefault()
    onAttemptReorder?.()
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`
        flex items-center gap-3 p-3 bg-white border rounded-lg transition-colors
        ${isSelected ? 'border-indigo-300 bg-indigo-50/50' : 'border-gray-200 hover:border-gray-300'}
        ${isDragging ? 'shadow-md' : ''}
        ${isFinalized ? 'cursor-default' : 'cursor-pointer'}
      `}
      onClick={onSelect}
      onMouseDown={handleBlockedDrag}
      onTouchStart={handleBlockedDrag}
      {...dragProps}
    >
      {/* Drag Handle - only attach drag listeners when not finalized */}
      <button
        className={`
          p-1 rounded touch-none
          ${isFinalized ? 'opacity-30 cursor-not-allowed' : 'cursor-grab active:cursor-grabbing hover:bg-gray-100'}
        `}
        disabled={isFinalized}
        aria-label={isFinalized ? 'Sequence is locked' : 'Drag to reorder'}
      >
        <GripVertical className="w-4 h-4 text-gray-400" />
      </button>

      {/* Figure Number */}
      <span className="text-sm font-mono text-gray-500 w-12 flex-shrink-0">
        Fig {figure.finalFigNo}
      </span>

      {/* Thumbnail */}
      <div className="w-10 h-10 bg-gray-100 border border-gray-200 rounded flex-shrink-0 overflow-hidden">
        {figure.imagePath ? (
          <img
            src={figure.imagePath}
            alt=""
            className="w-full h-full object-cover"
            onError={(e) => {
              if (figure?.type === 'sketch' && figure?.imageFilename) {
                const fallback = `/uploads/sketches/${encodeURIComponent(figure.imageFilename)}`
                if (e.currentTarget.src !== fallback) e.currentTarget.src = fallback
              }
            }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <ImageIcon className="w-4 h-4 text-gray-300" />
          </div>
        )}
      </div>

      {/* Title and Type */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">{figure.title}</p>
        <p className="text-xs text-gray-500">
          {figure.type === 'diagram' ? 'Diagram' : 'Sketch'}
        </p>
      </div>

      {/* Type indicator */}
      <div className={`
        w-2 h-2 rounded-full flex-shrink-0
        ${figure.type === 'diagram' ? 'bg-blue-400' : 'bg-amber-400'}
      `} title={figure.type === 'diagram' ? 'Block Diagram' : 'AI Sketch'} />
    </div>
  )
}
