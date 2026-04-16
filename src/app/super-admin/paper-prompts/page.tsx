'use client'
/* eslint-disable react/no-unescaped-entities */

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/lib/auth-context'
import { unstable_noStore as noStore } from 'next/cache'

// Types
interface SupersetSection {
  sectionKey: string
  label: string
  description: string
  displayOrder: number
  isRequired: boolean
  instruction: string
  instructionPreview: string
  constraints: Record<string, any>
  requiresBlueprint: boolean
  requiresPreviousSections: boolean
  requiresCitations: boolean
}

interface PaperType {
  code: string
  name: string
}

interface SectionPrompt {
  sectionKey: string
  label: string
  description: string
  displayOrder: number
  isRequired: boolean
  instruction: string
  instructionPreview: string
  constraints: Record<string, any>
  hasOverride: boolean
  overrideId?: string
  version: number
  requiresBlueprint: boolean
  requiresPreviousSections: boolean
  requiresCitations: boolean
}

interface SystemPromptTemplate {
  id: string
  templateKey: string
  applicationMode: string
  sectionScope: string
  paperTypeScope: string
  content: string
  priority: number
  status: string
  description: string | null
  updatedAt: string
}

interface SystemTemplateEditorState {
  id: string
  content: string
  priority: number
  status: string
}

const SYSTEM_TEMPLATE_GROUPS: Record<string, { label: string; icon: string; keys: string[] }> = {
  polish: {
    label: 'Polish Rules (Pass 2)',
    icon: '✨',
    keys: [
      'polish_persona',
      'polish_citation_rules',
      'polish_factual_fidelity',
      'polish_structural_rules',
      'polish_improvement_directives',
      'polish_hedging_rules',
      'polish_rhythm_rules'
    ]
  },
  dimension: {
    label: 'Dimension Generation',
    icon: '🧩',
    keys: [
      'dimension_role_introduction',
      'dimension_role_body',
      'dimension_role_conclusion',
      'dimension_role_intro_conclusion',
      'dimension_prompt_rules',
      'evidence_gap_guardrail'
    ]
  },
  quality: {
    label: 'Pass 1 Quality',
    icon: '🔬',
    keys: ['intellectual_rigor_block']
  },
  guidance: {
    label: 'Section Guidance',
    icon: '🧭',
    keys: ['section_guidance']
  },
  textActions: {
    label: 'Writing Assistant Actions',
    icon: '🛠️',
    keys: ['text_action_create_sections']
  }
}

const isSectionPrompt = (prompt: SupersetSection | SectionPrompt | null | undefined): prompt is SectionPrompt => {
  return !!prompt && 'hasOverride' in prompt
}

// Paper type icons
const PAPER_TYPE_ICONS: Record<string, string> = {
  'JOURNAL_ARTICLE': '📄',
  'CONFERENCE_PAPER': '🎤',
  'REVIEW_ARTICLE': '📚',
  'BOOK_CHAPTER': '📖',
  'SHORT_COMMUNICATION': '📝',
  'CASE_STUDY': '🔍'
}

export default function PaperPromptsPage() {
  noStore()

  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [paperTypes, setPaperTypes] = useState<PaperType[]>([])
  const [supersetSections, setSupersetSections] = useState<SupersetSection[]>([])
  const [promptsByPaperType, setPromptsByPaperType] = useState<Record<string, SectionPrompt[]>>({})
  const [systemTemplates, setSystemTemplates] = useState<SystemPromptTemplate[]>([])
  const [selectedPaperType, setSelectedPaperType] = useState<string | null>(null)
  const [selectedSection, setSelectedSection] = useState<string | null>(null)
  const [editingPrompt, setEditingPrompt] = useState<{
    paperTypeCode: string
    sectionKey: string
    instruction: string
    hasOverride: boolean
  } | null>(null)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [showHierarchy, setShowHierarchy] = useState(true)
  const [refreshingCache, setRefreshingCache] = useState(false)
  const [editingSystemTemplate, setEditingSystemTemplate] = useState<SystemTemplateEditorState | null>(null)

  const showToast = useCallback((type: 'success' | 'error', message: string) => {
    setToast({ type, message })
    setTimeout(() => setToast(null), 3000)
  }, [])

  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/super-admin/paper-section-prompts', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` }
      })
      if (response.ok) {
        const data = await response.json()
        setPaperTypes(data.paperTypes || [])
        setSupersetSections(data.supersetSections || [])
        setPromptsByPaperType(data.promptsByPaperType || {})
        setSystemTemplates(data.systemTemplates || [])
        
        // Select first paper type if none selected
        if (data.paperTypes?.length > 0 && !selectedPaperType) {
          setSelectedPaperType(data.paperTypes[0].code)
        }
      }
    } catch (err) {
      console.error('Failed to fetch:', err)
      showToast('error', 'Failed to load paper prompts')
    } finally {
      setLoading(false)
    }
  }, [selectedPaperType, showToast])

  useEffect(() => {
    if (!user) {
      window.location.href = '/login'
      return
    }
    if (!user.roles?.some(role => role === 'SUPER_ADMIN')) {
      window.location.href = '/dashboard'
      return
    }
    fetchData()
  }, [user, fetchData])

  const handleSavePrompt = async () => {
    if (!editingPrompt) return

    // Client-side validation
    const trimmedInstruction = editingPrompt.instruction.trim()
    if (trimmedInstruction.length < 10) {
      showToast('error', 'Instruction must be at least 10 characters')
      return
    }

    if (trimmedInstruction.length > 50000) {
      showToast('error', 'Instruction is too long (max 50,000 characters)')
      return
    }

    try {
      const response = await fetch('/api/super-admin/paper-section-prompts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          action: editingPrompt.hasOverride ? 'update' : 'create_override',
          paperTypeCode: editingPrompt.paperTypeCode,
          sectionKey: editingPrompt.sectionKey,
          instruction: trimmedInstruction,
          changeReason: 'Admin update from Super Admin UI'
        })
      })

      if (response.ok) {
        showToast('success', 'Prompt saved successfully')
        setEditingPrompt(null)
        fetchData()
      } else {
        const error = await response.json()
        showToast('error', error.error || 'Failed to save prompt')
      }
    } catch (err) {
      console.error('Failed to save:', err)
      showToast('error', 'Failed to save prompt')
    }
  }

  const handleRefreshDraftingCache = async () => {
    try {
      setRefreshingCache(true)
      const response = await fetch('/api/super-admin/paper-section-prompts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          action: 'refresh_cache'
        })
      })

      if (response.ok) {
        await fetchData()
        showToast('success', 'Drafting + system prompt caches reloaded. New prompts are now live.')
      } else {
        const error = await response.json()
        showToast('error', error.error || 'Failed to reload drafting prompt cache')
      }
    } catch (err) {
      console.error('Failed to refresh drafting prompt cache:', err)
      showToast('error', 'Failed to reload drafting prompt cache')
    } finally {
      setRefreshingCache(false)
    }
  }

  const handleDeleteOverride = async (paperTypeCode: string, sectionKey: string) => {
    if (!confirm('Remove this override? The section will use the base prompt instead.')) return

    try {
      const response = await fetch('/api/super-admin/paper-section-prompts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          action: 'delete_override',
          paperTypeCode,
          sectionKey,
          changeReason: 'Removed override from Super Admin UI'
        })
      })

      if (response.ok) {
        showToast('success', 'Override removed - using base prompt')
        fetchData()
      } else {
        const error = await response.json()
        showToast('error', error.error || 'Failed to remove override')
      }
    } catch (err) {
      console.error('Failed to delete:', err)
      showToast('error', 'Failed to remove override')
    }
  }

  // Handle saving BASE prompts (not overrides)
  const handleSaveBasePrompt = async () => {
    if (!editingPrompt || editingPrompt.paperTypeCode !== '__BASE__') return

    const trimmedInstruction = editingPrompt.instruction.trim()
    if (trimmedInstruction.length < 50) {
      showToast('error', 'Base prompt must be at least 50 characters')
      return
    }

    try {
      const response = await fetch('/api/super-admin/paper-superset-sections', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          action: 'update',
          sectionKey: editingPrompt.sectionKey,
          instruction: trimmedInstruction
        })
      })

      if (response.ok) {
        showToast('success', 'Base prompt updated successfully')
        setEditingPrompt(null)
        fetchData()
      } else {
        const error = await response.json()
        showToast('error', error.error || 'Failed to save base prompt')
      }
    } catch (err) {
      console.error('Failed to save base prompt:', err)
      showToast('error', 'Failed to save base prompt')
    }
  }

  const handleSaveSystemTemplate = async () => {
    if (!editingSystemTemplate) return

    const trimmedContent = editingSystemTemplate.content.trim()
    if (trimmedContent.length < 10) {
      showToast('error', 'Template content must be at least 10 characters')
      return
    }

    try {
      const response = await fetch('/api/super-admin/paper-section-prompts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          action: 'update_system_template',
          id: editingSystemTemplate.id,
          content: trimmedContent,
          priority: editingSystemTemplate.priority,
          status: editingSystemTemplate.status
        })
      })

      if (response.ok) {
        showToast('success', 'System template saved successfully')
        await fetchData()
      } else {
        const error = await response.json()
        showToast('error', error.error || 'Failed to save system template')
      }
    } catch (err) {
      console.error('Failed to save system template:', err)
      showToast('error', 'Failed to save system template')
    }
  }

  const isViewingBase = selectedPaperType === '__BASE__'
  const isViewingSystem = selectedPaperType === '__SYSTEM__'
  const isViewingPaperType = !!selectedPaperType && !isViewingBase && !isViewingSystem

  const selectedTypePrompts = isViewingPaperType && selectedPaperType
    ? promptsByPaperType[selectedPaperType] || []
    : []

  const selectedPrompt = isViewingBase
    ? supersetSections.find(s => s.sectionKey === selectedSection) || null
    : isViewingPaperType
      ? selectedTypePrompts.find(p => p.sectionKey === selectedSection) || null
      : null

  const groupedSystemTemplates = Object.entries(SYSTEM_TEMPLATE_GROUPS)
    .map(([groupKey, group]) => {
      const entries = systemTemplates
        .filter(template => {
          if (group.keys.includes('section_guidance')) {
            return template.templateKey === 'section_guidance'
          }
          return group.keys.includes(template.templateKey)
        })
        .sort((a, b) => {
          const keyCmp = a.templateKey.localeCompare(b.templateKey)
          if (keyCmp !== 0) return keyCmp
          const sectionCmp = (a.sectionScope || '*').localeCompare(b.sectionScope || '*')
          if (sectionCmp !== 0) return sectionCmp
          return (a.paperTypeScope || '*').localeCompare(b.paperTypeScope || '*')
        })

      return {
        groupKey,
        ...group,
        entries
      }
    })
    .filter(group => group.entries.length > 0)

  const selectedSystemTemplate = isViewingSystem
    ? systemTemplates.find(template => template.id === selectedSection) || null
    : null

  useEffect(() => {
    if (!selectedSystemTemplate) {
      setEditingSystemTemplate(null)
      return
    }

    setEditingSystemTemplate({
      id: selectedSystemTemplate.id,
      content: selectedSystemTemplate.content,
      priority: selectedSystemTemplate.priority,
      status: selectedSystemTemplate.status
    })
  }, [selectedSystemTemplate])

  if (!user || loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-amber-500 mx-auto"></div>
          <p className="mt-4 text-slate-400">Loading paper prompts...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg ${
          toast.type === 'success' ? 'bg-emerald-500' : 'bg-red-500'
        } text-white`}>
          {toast.message}
        </div>
      )}

      {/* Header */}
      <div className="bg-slate-800 border-b border-slate-700">
        <div className="max-w-7xl mx-auto px-6 py-6">
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-2xl font-bold text-white flex items-center gap-3">
                <span className="text-3xl">📝</span>
                Paper Section Prompts
              </h1>
              <p className="mt-1 text-slate-400">
                Configure prompts for academic paper sections by publication type
              </p>
            </div>
            <div className="flex items-center gap-4">
              <button
                onClick={handleRefreshDraftingCache}
                disabled={refreshingCache}
                className={`px-3 py-1.5 rounded text-sm transition-colors ${
                  refreshingCache
                    ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
                    : 'bg-blue-500/20 text-blue-300 hover:bg-blue-500/30'
                }`}
                title="Clear in-memory drafting and system prompt caches and reload latest prompts"
              >
                {refreshingCache ? 'Reloading Cache...' : 'Reload Drafting Cache'}
              </button>
              <button
                onClick={() => setShowHierarchy(!showHierarchy)}
                className={`px-3 py-1.5 rounded text-sm ${
                  showHierarchy ? 'bg-amber-500/20 text-amber-400' : 'bg-slate-700 text-slate-300'
                }`}
              >
                {showHierarchy ? '📊 Hierarchy View' : '📋 Simple View'}
              </button>
              <a
                href="/super-admin"
                className="text-slate-400 hover:text-white text-sm"
              >
                ← Back to Admin
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* Stats Bar */}
      <div className="bg-slate-800/50 border-b border-slate-700">
        <div className="max-w-7xl mx-auto px-6 py-3">
          <div className="flex gap-8">
            <StatBadge label="Base Sections" value={supersetSections.length} color="slate" />
            <StatBadge label="Paper Types" value={paperTypes.length} color="amber" />
            <StatBadge 
              label="Overrides" 
              value={Object.values(promptsByPaperType).flat().filter(p => p.hasOverride).length} 
              color="emerald" 
            />
            <StatBadge
              label="System Templates"
              value={systemTemplates.length}
              color="blue"
            />
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-6 py-6">
        <div className="grid grid-cols-12 gap-6">
          {/* Paper Type Selector */}
          <div className="col-span-3 space-y-4">
            <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
              <div className="px-4 py-3 bg-slate-700/50 border-b border-slate-700">
                <h2 className="font-semibold text-white">Publication Types</h2>
              </div>
              <div className="p-2">
                {/* System prompts option */}
                <button
                  onClick={() => {
                    setSelectedPaperType('__SYSTEM__')
                    setSelectedSection(null)
                  }}
                  className={`w-full text-left px-3 py-2 rounded transition-colors mb-2 ${
                    selectedPaperType === '__SYSTEM__'
                      ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                      : 'hover:bg-slate-700 text-slate-300 border border-dashed border-slate-600'
                  }`}
                >
                  <span className="mr-2">⚙️</span>
                  System Prompts (Pipeline)
                </button>

                {/* Base prompts option */}
                <button
                  onClick={() => {
                    setSelectedPaperType('__BASE__')
                    setSelectedSection(null)
                  }}
                  className={`w-full text-left px-3 py-2 rounded transition-colors mb-2 ${
                    selectedPaperType === '__BASE__'
                      ? 'bg-violet-500/20 text-violet-400 border border-violet-500/30'
                      : 'hover:bg-slate-700 text-slate-300 border border-dashed border-slate-600'
                  }`}
                >
                  <span className="mr-2">🏗️</span>
                  Base Prompts (All Types)
                </button>
                
                <div className="border-t border-slate-700 my-2 pt-2">
                  <div className="px-3 py-1 text-xs text-slate-500 uppercase">Paper Types</div>
                </div>

                {paperTypes.map(pt => (
                  <button
                    key={pt.code}
                    onClick={() => {
                      setSelectedPaperType(pt.code)
                      setSelectedSection(null)
                    }}
                    className={`w-full text-left px-3 py-2 rounded transition-colors ${
                      selectedPaperType === pt.code
                        ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                        : 'hover:bg-slate-700 text-slate-300'
                    }`}
                  >
                    <span className="mr-2">{PAPER_TYPE_ICONS[pt.code] || '📄'}</span>
                    {pt.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Legend */}
            <div className="bg-slate-800 rounded-lg border border-slate-700 p-4">
              <h3 className="text-sm font-medium text-slate-400 mb-3">Legend</h3>
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded bg-slate-600"></div>
                  <span className="text-slate-400">Base Prompt (inherited)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded bg-emerald-500/30 border border-emerald-500"></div>
                  <span className="text-slate-400">Has Override</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-amber-500">★</span>
                  <span className="text-slate-400">Required Section</span>
                </div>
              </div>
            </div>
          </div>

          {/* Sections List */}
          <div className="col-span-4">
            <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
              <div className="px-4 py-3 bg-slate-700/50 border-b border-slate-700 flex justify-between items-center">
                <h2 className="font-semibold text-white">
                  {isViewingSystem
                    ? 'System Prompt Templates (Pipeline)'
                    : isViewingBase
                      ? 'Base Prompts (Shared by All Types)'
                      : `Sections for ${paperTypes.find(pt => pt.code === selectedPaperType)?.name || 'Select Type'}`
                  }
                </h2>
              </div>

              {isViewingSystem ? (
                <div className="max-h-[600px] overflow-y-auto p-3 space-y-4">
                  {groupedSystemTemplates.length === 0 ? (
                    <div className="p-4 text-center text-slate-500">
                      No system templates found
                    </div>
                  ) : (
                    groupedSystemTemplates.map(group => (
                      <div key={group.groupKey} className="border border-slate-700 rounded-lg overflow-hidden">
                        <div className="px-3 py-2 bg-slate-700/50 text-sm font-medium text-slate-200">
                          <span className="mr-2">{group.icon}</span>
                          {group.label}
                        </div>
                        <div className="divide-y divide-slate-700">
                          {group.entries.map(template => {
                            const preview = template.content.replace(/\s+/g, ' ').trim()
                            const previewText = preview.length > 80 ? `${preview.substring(0, 80)}...` : preview
                            const isSelected = selectedSection === template.id
                            const sectionScope = template.sectionScope || '*'

                            return (
                              <button
                                key={template.id}
                                onClick={() => setSelectedSection(template.id)}
                                className={`w-full text-left p-3 transition-colors ${
                                  isSelected ? 'bg-blue-500/15' : 'hover:bg-slate-700/40'
                                }`}
                              >
                                <div className="flex items-center justify-between gap-3">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span className="text-sm font-medium text-white truncate">{template.templateKey}</span>
                                    {sectionScope !== '*' && (
                                      <span className="px-2 py-0.5 text-[11px] rounded bg-slate-700 text-slate-300 border border-slate-600">
                                        {sectionScope}
                                      </span>
                                    )}
                                  </div>
                                  <span
                                    className={`px-2 py-0.5 text-[11px] rounded border ${
                                      template.status === 'ACTIVE'
                                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                                        : 'bg-red-500/20 text-red-300 border-red-500/30'
                                    }`}
                                  >
                                    {template.status}
                                  </span>
                                </div>
                                <p className="mt-1 text-xs text-slate-400">{previewText || 'No content'}</p>
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              ) : (
                <div className="divide-y divide-slate-700 max-h-[600px] overflow-y-auto">
                  {/* BASE PROMPTS VIEW */}
                  {isViewingBase ? (
                    supersetSections.length === 0 ? (
                      <div className="p-4 text-center text-slate-500">
                        No base sections found
                      </div>
                    ) : (
                      supersetSections.sort((a, b) => a.displayOrder - b.displayOrder).map(section => (
                        <button
                          key={section.sectionKey}
                          onClick={() => setSelectedSection(section.sectionKey)}
                          className={`w-full text-left p-4 transition-colors ${
                            selectedSection === section.sectionKey
                              ? 'bg-violet-700/30'
                              : 'hover:bg-slate-700/50'
                          }`}
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-white">{section.label}</span>
                                {section.isRequired && <span className="text-amber-500">★</span>}
                              </div>
                              <p className="text-sm text-slate-400 mt-1">{section.description}</p>
                            </div>
                            <div className="flex items-center gap-2 ml-2">
                              <span className="px-2 py-0.5 text-xs bg-violet-500/20 text-violet-400 rounded border border-violet-500/30">
                                Base
                              </span>
                            </div>
                          </div>
                          <div className="mt-2 text-xs text-slate-500">
                            {section.instruction.length.toLocaleString()} chars
                          </div>
                        </button>
                      ))
                    )
                  ) : (
                    /* PAPER TYPE VIEW */
                    selectedTypePrompts.length === 0 ? (
                      <div className="p-4 text-center text-slate-500">
                        Select a publication type
                      </div>
                    ) : (
                      selectedTypePrompts.sort((a, b) => a.displayOrder - b.displayOrder).map(prompt => (
                        <button
                          key={prompt.sectionKey}
                          onClick={() => setSelectedSection(prompt.sectionKey)}
                          className={`w-full text-left p-4 transition-colors ${
                            selectedSection === prompt.sectionKey
                              ? 'bg-slate-700'
                              : 'hover:bg-slate-700/50'
                          }`}
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-white">{prompt.label}</span>
                                {prompt.isRequired && <span className="text-amber-500">★</span>}
                              </div>
                              <p className="text-sm text-slate-400 mt-1">{prompt.description}</p>
                            </div>
                            <div className="flex items-center gap-2 ml-2">
                              {prompt.hasOverride ? (
                                <span className="px-2 py-0.5 text-xs bg-emerald-500/20 text-emerald-400 rounded border border-emerald-500/30">
                                  Override
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 text-xs bg-slate-600 text-slate-300 rounded">
                                  Base
                                </span>
                              )}
                            </div>
                          </div>
                          {showHierarchy && (
                            <div className="mt-2 flex gap-2 text-xs">
                              {prompt.requiresBlueprint && (
                                <span className="px-1.5 py-0.5 bg-blue-500/10 text-blue-400 rounded">
                                  +Blueprint
                                </span>
                              )}
                              {prompt.requiresPreviousSections && (
                                <span className="px-1.5 py-0.5 bg-purple-500/10 text-purple-400 rounded">
                                  +Memory
                                </span>
                              )}
                              {prompt.requiresCitations && (
                                <span className="px-1.5 py-0.5 bg-pink-500/10 text-pink-400 rounded">
                                  +Citations
                                </span>
                              )}
                            </div>
                          )}
                        </button>
                      ))
                    )
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Prompt Editor */}
          <div className="col-span-5">
            <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
              <div className="px-4 py-3 bg-slate-700/50 border-b border-slate-700 flex justify-between items-center">
                <h2 className="font-semibold text-white">
                  {isViewingSystem
                    ? (selectedSystemTemplate ? `System Template: ${selectedSystemTemplate.templateKey}` : 'Select a System Template')
                    : (selectedPrompt ? `${selectedPrompt.label} Prompt` : 'Select a Section')
                  }
                </h2>
                {!isViewingSystem && selectedPrompt && (
                  <div className="flex gap-2">
                    {/* For base prompts - show edit base button */}
                    {isViewingBase ? (
                      <button
                        onClick={() => setEditingPrompt({
                          paperTypeCode: '__BASE__',
                          sectionKey: selectedSection!,
                          instruction: selectedPrompt.instruction,
                          hasOverride: false
                        })}
                        className="px-3 py-1.5 text-sm bg-violet-500/20 text-violet-400 rounded hover:bg-violet-500/30"
                      >
                        Edit Base Prompt
                      </button>
                    ) : (
                      /* For paper type view - show both base and override actions */
                      <>
                        {/* Edit Base Prompt button */}
                        <button
                          onClick={() => {
                            const basePrompt = supersetSections.find(s => s.sectionKey === selectedSection)
                            if (basePrompt) {
                              setEditingPrompt({
                                paperTypeCode: '__BASE__',
                                sectionKey: selectedSection!,
                                instruction: basePrompt.instruction,
                                hasOverride: false
                              })
                            }
                          }}
                          className="px-3 py-1.5 text-sm bg-violet-500/20 text-violet-400 rounded hover:bg-violet-500/30"
                        >
                          Edit Base
                        </button>

                        {'hasOverride' in selectedPrompt && selectedPrompt.hasOverride && (
                          <button
                            onClick={() => handleDeleteOverride(selectedPaperType!, selectedSection!)}
                            className="px-3 py-1.5 text-sm bg-red-500/20 text-red-400 rounded hover:bg-red-500/30"
                          >
                            Remove Override
                          </button>
                        )}
                        <button
                          onClick={() => {
                            if (!selectedPrompt) return
                            const promptHasOverride = isSectionPrompt(selectedPrompt) && selectedPrompt.hasOverride
                            setEditingPrompt({
                              paperTypeCode: selectedPaperType!,
                              sectionKey: selectedSection!,
                              instruction: promptHasOverride ? selectedPrompt.instruction : '',
                              hasOverride: promptHasOverride
                            })
                          }}
                          className="px-3 py-1.5 text-sm bg-emerald-500/20 text-emerald-400 rounded hover:bg-emerald-500/30"
                        >
                          {isSectionPrompt(selectedPrompt) && selectedPrompt.hasOverride ? 'Edit Override' : 'Create Override'}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>

              <div className="p-4">
                {isViewingSystem ? (
                  !selectedSystemTemplate || !editingSystemTemplate ? (
                    <div className="text-center text-slate-500 py-12">
                      <p>Select a system template to view and edit</p>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-4 h-[600px]">
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div className="bg-slate-700/30 rounded p-3">
                          <div className="text-xs text-slate-500 uppercase">Template Key</div>
                          <div className="text-slate-200 font-medium mt-1 break-all">{selectedSystemTemplate.templateKey}</div>
                        </div>
                        <div className="bg-slate-700/30 rounded p-3">
                          <div className="text-xs text-slate-500 uppercase">Application Mode</div>
                          <div className="text-slate-200 font-medium mt-1">{selectedSystemTemplate.applicationMode || 'paper'}</div>
                        </div>
                        <div className="bg-slate-700/30 rounded p-3">
                          <div className="text-xs text-slate-500 uppercase">Section Scope</div>
                          <span className="inline-flex mt-1 px-2 py-0.5 text-xs rounded bg-slate-600 text-slate-200 border border-slate-500">
                            {selectedSystemTemplate.sectionScope === '*' ? 'All sections (*)' : selectedSystemTemplate.sectionScope}
                          </span>
                        </div>
                        <div className="bg-slate-700/30 rounded p-3">
                          <div className="text-xs text-slate-500 uppercase">Paper Type Scope</div>
                          <span className="inline-flex mt-1 px-2 py-0.5 text-xs rounded bg-slate-600 text-slate-200 border border-slate-500">
                            {selectedSystemTemplate.paperTypeScope === '*' ? 'All types (*)' : selectedSystemTemplate.paperTypeScope}
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-slate-500 uppercase mb-1">Priority</label>
                          <input
                            type="number"
                            value={editingSystemTemplate.priority}
                            onChange={(e) => setEditingSystemTemplate({
                              ...editingSystemTemplate,
                              priority: Number.isNaN(Number.parseInt(e.target.value, 10))
                                ? 0
                                : Number.parseInt(e.target.value, 10)
                            })}
                            className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-slate-500 uppercase mb-1">Status</label>
                          <div className="flex rounded border border-slate-600 overflow-hidden">
                            <button
                              onClick={() => setEditingSystemTemplate({ ...editingSystemTemplate, status: 'ACTIVE' })}
                              className={`flex-1 px-3 py-2 text-sm ${
                                editingSystemTemplate.status === 'ACTIVE'
                                  ? 'bg-emerald-500/20 text-emerald-300'
                                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                              }`}
                            >
                              ACTIVE
                            </button>
                            <button
                              onClick={() => setEditingSystemTemplate({ ...editingSystemTemplate, status: 'INACTIVE' })}
                              className={`flex-1 px-3 py-2 text-sm ${
                                editingSystemTemplate.status === 'INACTIVE'
                                  ? 'bg-red-500/20 text-red-300'
                                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                              }`}
                            >
                              INACTIVE
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="text-sm text-slate-400">
                        <span className="text-slate-500">Description: </span>
                        {selectedSystemTemplate.description || 'No description provided.'}
                      </div>

                      <div className="flex-1 min-h-0 flex flex-col">
                        <label className="block text-xs text-slate-500 uppercase mb-2">Content</label>
                        <textarea
                          value={editingSystemTemplate.content}
                          onChange={(e) => setEditingSystemTemplate({ ...editingSystemTemplate, content: e.target.value })}
                          className="flex-1 min-h-[260px] bg-slate-900 border border-blue-500/30 rounded-lg px-4 py-3 text-slate-300 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                          placeholder="Enter system prompt template content..."
                        />
                        <div className="mt-2 text-xs text-slate-500">
                          {editingSystemTemplate.content.length.toLocaleString()} characters
                        </div>
                      </div>

                      <div className="flex justify-end">
                        <button
                          onClick={handleSaveSystemTemplate}
                          disabled={editingSystemTemplate.content.trim().length < 10}
                          className={`px-4 py-2 rounded-lg font-medium ${
                            editingSystemTemplate.content.trim().length < 10
                              ? 'bg-slate-600 text-slate-400 cursor-not-allowed'
                              : 'bg-blue-500 text-white hover:bg-blue-400'
                          }`}
                        >
                          Save System Template
                        </button>
                      </div>
                    </div>
                  )
                ) : (
                  !selectedPrompt ? (
                    <div className="text-center text-slate-500 py-12">
                      <p>Select a section to view its prompt</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {/* Status */}
                      <div className="flex items-center gap-4 p-3 bg-slate-700/30 rounded">
                        <div>
                          <span className="text-xs text-slate-500">Type</span>
                          <div className={`font-medium ${isViewingBase ? 'text-violet-400' : ('hasOverride' in selectedPrompt && selectedPrompt.hasOverride ? 'text-emerald-400' : 'text-slate-300')}`}>
                            {isViewingBase ? 'Base Prompt' : ('hasOverride' in selectedPrompt && selectedPrompt.hasOverride ? 'Using Override' : 'Using Base Prompt')}
                          </div>
                        </div>
                        {isSectionPrompt(selectedPrompt) && (
                          <div>
                            <span className="text-xs text-slate-500">Version</span>
                            <div className="font-medium text-slate-300">v{selectedPrompt.version}</div>
                          </div>
                        )}
                        <div>
                          <span className="text-xs text-slate-500">Characters</span>
                          <div className="font-medium text-slate-300">{selectedPrompt.instruction.length.toLocaleString()}</div>
                        </div>
                      </div>

                      {/* Constraints */}
                      {selectedPrompt.constraints && Object.keys(selectedPrompt.constraints).length > 0 && (
                        <div>
                          <h3 className="text-sm font-medium text-slate-400 mb-2">Constraints</h3>
                          <div className="grid grid-cols-2 gap-2 text-sm">
                            {Object.entries(selectedPrompt.constraints).map(([key, value]) => (
                              <div key={key} className="bg-slate-700/30 rounded p-2">
                                <span className="text-slate-500 text-xs">{key}</span>
                                <div className="text-slate-300">
                                  {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Instruction Preview */}
                      {isViewingBase ? (
                        /* Base prompt view - show single prompt */
                        <div>
                          <h3 className="text-sm font-medium text-slate-400 mb-2">Base Prompt Instruction</h3>
                          <pre className="bg-slate-900 rounded p-4 text-sm text-slate-300 overflow-x-auto max-h-[400px] overflow-y-auto whitespace-pre-wrap">
                            {selectedPrompt.instruction}
                          </pre>
                        </div>
                      ) : (
                        /* Paper type view - show base + override */
                        <div className="space-y-4">
                          {/* Base Prompt (always show for context) */}
                          <div>
                            <h3 className="text-sm font-medium text-violet-400 mb-2 flex items-center gap-2">
                              <span>[Base]</span> Base Prompt (from All Types)
                            </h3>
                            <pre className="bg-violet-950/30 border border-violet-500/20 rounded p-4 text-sm text-slate-400 overflow-x-auto max-h-[250px] overflow-y-auto whitespace-pre-wrap">
                              {supersetSections.find(s => s.sectionKey === selectedSection)?.instruction || 'No base prompt found'}
                            </pre>
                          </div>

                          {/* Override (if exists) */}
                          {'hasOverride' in selectedPrompt && selectedPrompt.hasOverride ? (
                            <div>
                              <h3 className="text-sm font-medium text-emerald-400 mb-2 flex items-center gap-2">
                                <span>[Override]</span> Override (TOP-UP for {paperTypes.find(pt => pt.code === selectedPaperType)?.name})
                              </h3>
                              <pre className="bg-emerald-950/30 border border-emerald-500/20 rounded p-4 text-sm text-slate-300 overflow-x-auto max-h-[250px] overflow-y-auto whitespace-pre-wrap">
                                {selectedPrompt.instruction}
                              </pre>
                            </div>
                          ) : (
                            <div className="p-4 bg-slate-700/30 rounded border border-dashed border-slate-600 text-center">
                              <p className="text-slate-500 text-sm">
                                No override for this paper type. Using base prompt only.
                              </p>
                              <p className="text-slate-600 text-xs mt-1">
                                Click "Create Override" to add paper-type-specific modifications.
                              </p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Edit Modal */}
      {editingPrompt && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-xl border border-slate-700 w-full max-w-4xl max-h-[90vh] overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-700 flex justify-between items-center">
              <div>
                <h2 className="text-xl font-semibold text-white">
                  {editingPrompt.paperTypeCode === '__BASE__' 
                    ? `Edit Base Prompt: ${editingPrompt.sectionKey}`
                    : `${editingPrompt.hasOverride ? 'Edit' : 'Create'} Override: ${editingPrompt.sectionKey}`
                  }
                </h2>
                <div className="text-sm text-slate-400 mt-1">
                  {editingPrompt.instruction.length.toLocaleString()} characters • 
                  {' '}{editingPrompt.instruction.trim().split(/\s+/).filter(Boolean).length.toLocaleString()} words
                  {editingPrompt.paperTypeCode === '__BASE__' ? (
                    editingPrompt.instruction.trim().length < 50 && (
                      <span className="text-red-400 ml-2">⚠️ Too short (min 50 chars for base)</span>
                    )
                  ) : (
                    editingPrompt.instruction.trim().length < 10 && (
                      <span className="text-red-400 ml-2">⚠️ Too short (min 10 chars)</span>
                    )
                  )}
                </div>
              </div>
              <button
                onClick={() => setEditingPrompt(null)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>
            <div className="p-6 space-y-4 overflow-y-auto" style={{ maxHeight: 'calc(90vh - 140px)' }}>
              {/* Info banner for base vs override */}
              {editingPrompt.paperTypeCode === '__BASE__' ? (
                <div className="p-3 bg-violet-500/10 border border-violet-500/30 rounded-lg text-sm text-violet-300">
                  <strong>🏗️ Base Prompt:</strong> This prompt applies to ALL paper types unless overridden. 
                  Changes here affect Journal Articles, Conference Papers, Book Chapters, etc.
                </div>
              ) : (
                <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-sm text-amber-300">
                  <strong>📝 Paper Type Override:</strong> This is a TOP-UP addition that layers on top of the base prompt. 
                  Write modifications specific to <strong>{paperTypes.find(pt => pt.code === editingPrompt.paperTypeCode)?.name}</strong> format.
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-1">
                    {editingPrompt.paperTypeCode === '__BASE__' ? 'Scope' : 'Paper Type'}
                  </label>
                  <div className="text-white">
                    {editingPrompt.paperTypeCode === '__BASE__' 
                      ? 'Base (All Types)' 
                      : paperTypes.find(pt => pt.code === editingPrompt.paperTypeCode)?.name
                    }
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-1">Section</label>
                  <div className="text-white">{editingPrompt.sectionKey}</div>
                </div>
              </div>

              {/* Show base prompt as read-only context when editing override */}
              {editingPrompt.paperTypeCode !== '__BASE__' && (
                <div>
                  <details className="group">
                    <summary className="cursor-pointer text-sm font-medium text-violet-400 mb-2 flex items-center gap-2 hover:text-violet-300">
                      <span className="group-open:rotate-90 transition-transform">▶</span>
                      🏗️ View Base Prompt (read-only reference)
                    </summary>
                    <pre className="mt-2 bg-violet-950/30 border border-violet-500/20 rounded p-3 text-xs text-slate-400 overflow-x-auto max-h-[200px] overflow-y-auto whitespace-pre-wrap">
                      {supersetSections.find(s => s.sectionKey === editingPrompt.sectionKey)?.instruction || 'No base prompt found'}
                    </pre>
                  </details>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">
                  {editingPrompt.paperTypeCode === '__BASE__' ? 'Base Prompt Instruction' : 'Override Instruction (TOP-UP additions)'}
                </label>
                <textarea
                  value={editingPrompt.instruction}
                  onChange={(e) => setEditingPrompt({ ...editingPrompt, instruction: e.target.value })}
                  rows={editingPrompt.paperTypeCode === '__BASE__' ? 20 : 12}
                  className={`w-full bg-slate-900 border rounded-lg px-4 py-3 text-slate-300 font-mono text-sm focus:outline-none focus:ring-2 ${
                    editingPrompt.paperTypeCode === '__BASE__' 
                      ? 'border-violet-500/30 focus:ring-violet-500/50' 
                      : 'border-emerald-500/30 focus:ring-emerald-500/50'
                  }`}
                  placeholder={editingPrompt.paperTypeCode === '__BASE__' 
                    ? "Enter the complete base prompt instruction..."
                    : "Enter paper-type-specific modifications that will be ADDED to the base prompt above..."
                  }
                />
              </div>

              {editingPrompt.paperTypeCode !== '__BASE__' && (
                <div className="text-sm text-slate-500 p-3 bg-slate-700/30 rounded">
                  <p className="font-medium mb-1">💡 Writing Override Tips:</p>
                  <ul className="list-disc list-inside space-y-1 text-xs">
                    <li>Focus on what's DIFFERENT for this paper type (e.g., brevity for conferences)</li>
                    <li>Use clear headers like "CONFERENCE PAPER MODIFICATIONS:" or "BOOK CHAPTER MODIFICATIONS:"</li>
                    <li>End with "PRESERVE from base:" to clarify what should NOT change</li>
                  </ul>
                </div>
              )}

              <div className="text-sm text-slate-500">
                <p><strong>Available placeholders:</strong></p>
                <code className="text-xs text-amber-400">
                  {'{{TITLE}}, {{RESEARCH_QUESTION}}, {{HYPOTHESIS}}, {{METHODOLOGY}}, {{CONTRIBUTION_TYPE}}, {{KEYWORDS}}, {{DATASET_DESCRIPTION}}, {{ABSTRACT_DRAFT}}, {{PREVIOUS_SECTIONS}}'}
                </code>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-700 flex justify-end gap-3">
              <button
                onClick={() => setEditingPrompt(null)}
                className="px-4 py-2 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600"
              >
                Cancel
              </button>
              <button
                onClick={editingPrompt.paperTypeCode === '__BASE__' ? handleSaveBasePrompt : handleSavePrompt}
                disabled={editingPrompt.paperTypeCode === '__BASE__' 
                  ? editingPrompt.instruction.trim().length < 50 
                  : editingPrompt.instruction.trim().length < 10
                }
                className={`px-4 py-2 rounded-lg font-medium ${
                  (editingPrompt.paperTypeCode === '__BASE__' 
                    ? editingPrompt.instruction.trim().length < 50 
                    : editingPrompt.instruction.trim().length < 10)
                    ? 'bg-slate-600 text-slate-400 cursor-not-allowed'
                    : editingPrompt.paperTypeCode === '__BASE__'
                      ? 'bg-violet-500 text-white hover:bg-violet-400'
                      : 'bg-amber-500 text-slate-900 hover:bg-amber-400'
                }`}
              >
                {editingPrompt.paperTypeCode === '__BASE__' 
                  ? 'Save Base Prompt' 
                  : (editingPrompt.hasOverride ? 'Update Override' : 'Create Override')
                }
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Stat Badge Component
function StatBadge({ label, value, color }: { label: string; value: number; color: string }) {
  const colorClasses: Record<string, string> = {
    slate: 'bg-slate-700 text-slate-300',
    amber: 'bg-amber-500/20 text-amber-400',
    emerald: 'bg-emerald-500/20 text-emerald-400',
    blue: 'bg-blue-500/20 text-blue-400',
    red: 'bg-red-500/20 text-red-400'
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-slate-400 text-sm">{label}:</span>
      <span className={`px-2 py-0.5 rounded text-sm font-medium ${colorClasses[color] || colorClasses.slate}`}>
        {value}
      </span>
    </div>
  )
}
