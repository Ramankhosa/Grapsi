'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import {
  FileText,
  BookOpen,
  ArrowRight,
  Sparkles,
  Layers,
  PenLine,
  GraduationCap,
  ChevronLeft
} from 'lucide-react'
import { isFeatureEnabled } from '@/lib/feature-flags'
import LoadingBird from '@/components/ui/loading-bird'

// ============================================================================
// Quick Start Templates
// ============================================================================

interface QuickStartTemplate {
  id: string
  title: string
  description: string
  icon: any
  defaultTitle: string
}

const QUICK_START_TEMPLATES: QuickStartTemplate[] = [
  {
    id: 'blank',
    title: 'Blank Paper',
    description: 'Start fresh and configure everything in the next step',
    icon: FileText,
    defaultTitle: 'Untitled Paper'
  },
  {
    id: 'research',
    title: 'Research Article',
    description: 'Standard structure for journal publication',
    icon: BookOpen,
    defaultTitle: 'Research Article'
  },
  {
    id: 'thesis',
    title: 'Thesis / Dissertation',
    description: 'Extended format for academic degrees',
    icon: GraduationCap,
    defaultTitle: 'Thesis Draft'
  }
]

// ============================================================================
// Main Component
// ============================================================================

export default function NewPaperPage() {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showTitleInput, setShowTitleInput] = useState(false)

  // Check if paper writing feature is enabled
  if (!isFeatureEnabled('ENABLE_PAPER_WRITING_UI')) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <BookOpen className="w-16 h-16 text-slate-400 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-slate-900 mb-2">Paper Writing Feature</h2>
          <p className="text-slate-600">This feature is not currently available.</p>
        </div>
      </div>
    )
  }

  const handleSelectTemplate = (template: QuickStartTemplate) => {
    setSelectedTemplate(template.id)
    setTitle(template.defaultTitle)
    setShowTitleInput(true)
  }

  const handleCreatePaper = async () => {
    if (!title.trim()) {
      setError('Please enter a title for your paper')
      return
    }

    setIsCreating(true)
    setError(null)

    try {
      const response = await fetch('/api/papers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          title: title.trim()
        })
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to create paper')
      }

      const data = await response.json()
      
      // Navigate to the draft page - Paper Foundation stage will handle configuration
      router.push(`/papers/${data.paper.id}/draft`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create paper')
      setIsCreating(false)
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !isCreating) {
      handleCreatePaper()
    }
  }

  if (isCreating) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center"
        >
          <LoadingBird message="Creating your paper..." useKishoFallback={true} />
          <p className="text-slate-500 mt-4">Setting up your workspace...</p>
        </motion.div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100">
      {/* Decorative Elements */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-blue-100 rounded-full opacity-30 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-violet-100 rounded-full opacity-30 blur-3xl" />
      </div>

      {/* Header */}
      <header className="relative z-10 border-b border-slate-200 bg-white/80 backdrop-blur-sm">
        <div className="max-w-4xl mx-auto px-6 py-4">
          <button
            onClick={() => router.push('/papers')}
            className="flex items-center gap-2 text-slate-600 hover:text-slate-900 transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
            <span>Back to Papers</span>
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10 max-w-4xl mx-auto px-6 py-12">
        {/* Hero Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-12"
        >
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-slate-800 to-slate-900 shadow-lg shadow-slate-900/20 mb-6">
            <PenLine className="w-8 h-8 text-white" />
          </div>
          
          <h1 className="text-3xl md:text-4xl font-bold text-slate-900 tracking-tight mb-4">
            Start Your Research Paper
          </h1>
          
          <p className="text-lg text-slate-600 max-w-2xl mx-auto">
            Create a new paper and configure its structure, citation style, and sections in one seamless flow.
          </p>
        </motion.div>

        <AnimatePresence mode="wait">
          {!showTitleInput ? (
            /* Template Selection */
            <motion.div
              key="templates"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
            >
              <div className="grid gap-4 md:grid-cols-3 mb-8">
                {QUICK_START_TEMPLATES.map((template, index) => {
                  const Icon = template.icon
                  const isSelected = selectedTemplate === template.id

                  return (
                    <motion.button
                      key={template.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.1 }}
                      onClick={() => handleSelectTemplate(template)}
                      className={`
                        relative p-6 rounded-2xl border-2 text-left transition-all duration-300
                        ${isSelected
                          ? 'bg-slate-900 border-slate-900 text-white shadow-xl shadow-slate-900/20'
                          : 'bg-white border-slate-200 hover:border-slate-400 hover:shadow-lg'
                        }
                      `}
                    >
                      <div className={`
                        w-12 h-12 rounded-xl flex items-center justify-center mb-4
                        ${isSelected ? 'bg-white/20' : 'bg-slate-100'}
                      `}>
                        <Icon className={`w-6 h-6 ${isSelected ? 'text-white' : 'text-slate-600'}`} />
                      </div>

                      <h3 className={`font-semibold text-lg mb-2 ${isSelected ? 'text-white' : 'text-slate-900'}`}>
                        {template.title}
                      </h3>
                      
                      <p className={`text-sm ${isSelected ? 'text-slate-300' : 'text-slate-500'}`}>
                        {template.description}
                      </p>

                      {isSelected && (
                        <motion.div
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          className="absolute -top-2 -right-2 w-6 h-6 bg-emerald-500 rounded-full flex items-center justify-center"
                        >
                          <Sparkles className="w-4 h-4 text-white" />
                        </motion.div>
                      )}
                    </motion.button>
                  )
                })}
              </div>

              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.3 }}
                className="text-center"
              >
                <p className="text-slate-500 text-sm">
                  Select a starting point for your paper, then customize everything in the Paper Foundation stage
                </p>
              </motion.div>
            </motion.div>
          ) : (
            /* Title Input */
            <motion.div
              key="title"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="max-w-2xl mx-auto"
            >
              <div className="bg-white rounded-3xl border border-slate-200 shadow-xl p-8">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center">
                    <Layers className="w-5 h-5 text-slate-600" />
                  </div>
                  <div>
                    <h2 className="font-semibold text-slate-900">Name Your Paper</h2>
                    <p className="text-sm text-slate-500">You can change this anytime</p>
                  </div>
                </div>

                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Enter paper title..."
                  autoFocus
                  className="w-full px-0 py-3 text-2xl font-semibold text-slate-900 placeholder-slate-300 bg-transparent border-none outline-none focus:ring-0 border-b-2 border-slate-200 focus:border-slate-900 transition-colors"
                />

                {error && (
                  <motion.p
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-3 text-red-600 text-sm"
                  >
                    {error}
                  </motion.p>
                )}

                <div className="flex items-center justify-between mt-8">
                  <button
                    onClick={() => {
                      setShowTitleInput(false)
                      setSelectedTemplate(null)
                    }}
                    className="px-6 py-3 text-slate-600 hover:text-slate-900 font-medium transition-colors"
                  >
                    Back
                  </button>

                  <button
                    onClick={handleCreatePaper}
                    disabled={!title.trim()}
                    className={`
                      flex items-center gap-2 px-8 py-3 rounded-xl font-semibold transition-all duration-300
                      ${title.trim()
                        ? 'bg-slate-900 text-white hover:bg-slate-800 shadow-lg shadow-slate-900/20'
                        : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                      }
                    `}
                  >
                    Create Paper
                    <ArrowRight className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* What's Next Preview */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="mt-8 p-6 bg-slate-50 rounded-2xl border border-slate-200"
              >
                <h3 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-amber-500" />
                  What happens next
                </h3>
                
                <div className="space-y-3">
                  {[
                    { step: 1, label: 'Paper Foundation', desc: 'Choose paper type and citation style' },
                    { step: 2, label: 'Research Topic', desc: 'Define your research question' },
                    { step: 3, label: 'Literature Review', desc: 'Search and import citations' },
                    { step: 4, label: 'Section Drafting', desc: 'Write your paper sections' }
                  ].map((item) => (
                    <div key={item.step} className="flex items-center gap-3">
                      <div className="w-6 h-6 rounded-full bg-slate-200 flex items-center justify-center text-xs font-semibold text-slate-600">
                        {item.step}
                      </div>
                      <div className="flex-1">
                        <span className="font-medium text-slate-800">{item.label}</span>
                        <span className="text-slate-500 text-sm ml-2">— {item.desc}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  )
}
