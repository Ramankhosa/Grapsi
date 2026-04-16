'use client'

import { useState, useEffect, useCallback } from 'react'

interface UserInstruction {
  id: string
  sessionId: string | null
  userId?: string
  jurisdiction: string
  sectionKey: string
  instruction: string
  emphasis?: string
  avoid?: string
  style?: string
  wordCount?: number
  isActive: boolean
  isPersistent: boolean // true = user-level (persists across drafts)
  updatedAt: string
}

interface AllInstructionsModalProps {
  sessionId: string
  patentId: string
  activeJurisdiction: string
  availableJurisdictions: string[]
  sectionLabels: Record<string, string>
  onClose: () => void
  onUpdate: () => void
}

const SECTION_ICONS: Record<string, string> = {
  title: '📝',
  fieldOfInvention: '🔬',
  background: '📚',
  objectsOfInvention: '🎯',
  summary: '📋',
  briefDescriptionOfDrawings: '🖼️',
  detailedDescription: '📖',
  claims: '⚖️',
  abstract: '📄',
  technicalProblem: '❓',
  technicalSolution: '💡',
  advantageousEffects: '✨',
  industrialApplicability: '🏭',
  listOfNumerals: '🔢',
  bestMethod: '⭐',
  crossReference: '🔗',
  preamble: '📜',
  default: '📌'
}

// All canonical sections for adding new instructions
const ALL_SECTIONS = [
  'title', 'fieldOfInvention', 'background', 'objectsOfInvention', 'summary',
  'briefDescriptionOfDrawings', 'detailedDescription', 'claims', 'abstract',
  'technicalProblem', 'technicalSolution', 'advantageousEffects',
  'industrialApplicability', 'listOfNumerals', 'bestMethod', 'crossReference', 'preamble'
]

// Word limit for custom instructions to keep prompts manageable
const MAX_INSTRUCTION_WORDS = 50

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(w => w.length > 0).length
}

export default function AllInstructionsModal({
  sessionId,
  patentId,
  activeJurisdiction,
  availableJurisdictions,
  sectionLabels,
  onClose,
  onUpdate
}: AllInstructionsModalProps) {
  const [instructions, setInstructions] = useState<UserInstruction[]>([])
  const [loading, setLoading] = useState(true)
  const [filterJurisdiction, setFilterJurisdiction] = useState<string>('all')
  const [filterType, setFilterType] = useState<'all' | 'persistent' | 'session'>('all')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [editEmphasis, setEditEmphasis] = useState('')
  const [editAvoid, setEditAvoid] = useState('')
  const [saving, setSaving] = useState(false)
  const [showAddNew, setShowAddNew] = useState(false)
  const [newSectionKey, setNewSectionKey] = useState('')
  const [newJurisdiction, setNewJurisdiction] = useState<string>(activeJurisdiction)
  const [newInstruction, setNewInstruction] = useState('')
  const [newEmphasis, setNewEmphasis] = useState('')
  const [newAvoid, setNewAvoid] = useState('')
  const [newIsPersistent, setNewIsPersistent] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [bulkOperating, setBulkOperating] = useState(false)

  const fetchInstructions = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch(
        `/api/patents/${patentId}/drafting/user-instructions?sessionId=${sessionId}`,
        { headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` } }
      )
      if (response.ok) {
        const data = await response.json()
        // Map the response to include isPersistent
        const mapped = (data.instructions || []).map((i: any) => ({
          ...i,
          isPersistent: i.sessionId === null || i.isPersistent === true
        }))
        setInstructions(mapped)
      }
    } catch (err) {
      console.error('Failed to fetch instructions:', err)
    } finally {
      setLoading(false)
    }
  }, [patentId, sessionId])

  useEffect(() => {
    fetchInstructions()
  }, [fetchInstructions])

  useEffect(() => {
    // Reset new instruction form when jurisdiction changes
    setNewJurisdiction(activeJurisdiction)
  }, [activeJurisdiction])

  const handleDelete = async (instruction: UserInstruction) => {
    const typeLabel = instruction.isPersistent ? 'persistent' : 'session'
    if (!confirm(`Delete ${typeLabel} instruction for "${sectionLabels[instruction.sectionKey] || instruction.sectionKey}"?`)) {
      return
    }

    try {
      await fetch(
        `/api/patents/${patentId}/drafting/user-instructions?id=${instruction.id}`,
        {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` }
        }
      )
      setInstructions(prev => prev.filter(i => i.id !== instruction.id))
      onUpdate()
    } catch (err) {
      console.error('Failed to delete:', err)
    }
  }

  const handleToggleActive = async (instruction: UserInstruction) => {
    setTogglingId(instruction.id)
    try {
      const response = await fetch(`/api/patents/${patentId}/drafting/user-instructions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          sessionId: instruction.isPersistent ? null : sessionId,
          sectionKey: instruction.sectionKey,
          jurisdiction: instruction.jurisdiction,
          instruction: instruction.instruction,
          emphasis: instruction.emphasis,
          avoid: instruction.avoid,
          style: instruction.style,
          wordCount: instruction.wordCount,
          isActive: !instruction.isActive,
          isPersistent: instruction.isPersistent
        })
      })

      if (response.ok) {
        setInstructions(prev => prev.map(i => 
          i.id === instruction.id ? { ...i, isActive: !i.isActive } : i
        ))
        onUpdate()
      }
    } catch (err) {
      console.error('Failed to toggle:', err)
    } finally {
      setTogglingId(null)
    }
  }

  const handleAddNew = async () => {
    if (!newSectionKey || !newInstruction.trim()) return
    if (countWords(newInstruction) > MAX_INSTRUCTION_WORDS) return
    
    setSaving(true)
    try {
      const response = await fetch(`/api/patents/${patentId}/drafting/user-instructions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          sessionId: newIsPersistent ? null : sessionId,
          sectionKey: newSectionKey,
          jurisdiction: newJurisdiction,
          instruction: newInstruction.trim(),
          emphasis: newEmphasis.trim() || undefined,
          avoid: newAvoid.trim() || undefined,
          isPersistent: newIsPersistent
        })
      })

      if (response.ok) {
        // Reset form and refresh
        setNewSectionKey('')
        setNewInstruction('')
        setNewEmphasis('')
        setNewAvoid('')
        setNewIsPersistent(false)
        setShowAddNew(false)
        fetchInstructions()
        onUpdate()
      }
    } catch (err) {
      console.error('Failed to add:', err)
    } finally {
      setSaving(false)
    }
  }

  // Get sections that don't have instructions yet for the selected jurisdiction
  const sectionsWithoutInstructions = ALL_SECTIONS.filter(sectionKey => {
    const jurisdictionToCheck = newJurisdiction === '*' ? '*' : newJurisdiction
    return !instructions.some(i => 
      i.sectionKey === sectionKey && 
      (i.jurisdiction === jurisdictionToCheck || i.jurisdiction === '*')
    )
  })

  // Bulk enable/disable all instructions
  const handleBulkToggle = async (enableAll: boolean) => {
    if (instructions.length === 0) return
    
    let targetInstructions = filteredInstructions
    
    if (targetInstructions.length === 0) return
    
    setBulkOperating(true)
    try {
      // Process all in parallel
      await Promise.all(
        targetInstructions.map(instr =>
          fetch(`/api/patents/${patentId}/drafting/user-instructions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
            },
            body: JSON.stringify({
              sessionId: instr.isPersistent ? null : sessionId,
              sectionKey: instr.sectionKey,
              jurisdiction: instr.jurisdiction,
              instruction: instr.instruction,
              emphasis: instr.emphasis,
              avoid: instr.avoid,
              style: instr.style,
              wordCount: instr.wordCount,
              isActive: enableAll,
              isPersistent: instr.isPersistent
            })
          })
        )
      )
      
      // Update local state
      const targetIds = new Set(targetInstructions.map(i => i.id))
      setInstructions(prev => prev.map(i => 
        targetIds.has(i.id) ? { ...i, isActive: enableAll } : i
      ))
      onUpdate()
    } catch (err) {
      console.error('Bulk operation failed:', err)
    } finally {
      setBulkOperating(false)
    }
  }

  const handleSaveEdit = async (instruction: UserInstruction) => {
    if (!editText.trim()) return
    
    setSaving(true)
    try {
      const response = await fetch(`/api/patents/${patentId}/drafting/user-instructions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          sessionId: instruction.isPersistent ? null : sessionId,
          sectionKey: instruction.sectionKey,
          jurisdiction: instruction.jurisdiction,
          instruction: editText.trim(),
          emphasis: editEmphasis.trim() || undefined,
          avoid: editAvoid.trim() || undefined,
          style: instruction.style,
          wordCount: instruction.wordCount,
          isPersistent: instruction.isPersistent
        })
      })

      if (response.ok) {
        setInstructions(prev => prev.map(i => 
          i.id === instruction.id ? { 
            ...i, 
            instruction: editText.trim(), 
            emphasis: editEmphasis.trim() || undefined,
            avoid: editAvoid.trim() || undefined,
            updatedAt: new Date().toISOString() 
          } : i
        ))
        setEditingId(null)
        setEditEmphasis('')
        setEditAvoid('')
        onUpdate()
      }
    } catch (err) {
      console.error('Failed to save:', err)
    } finally {
      setSaving(false)
    }
  }

  const startEditing = (instr: UserInstruction) => {
    setEditingId(instr.id)
    setEditText(instr.instruction)
    setEditEmphasis(instr.emphasis || '')
    setEditAvoid(instr.avoid || '')
  }

  // Apply filters
  const filteredInstructions = instructions.filter(i => {
    // Jurisdiction filter
    const jurisdictionMatch = filterJurisdiction === 'all' || 
      i.jurisdiction === filterJurisdiction ||
      i.jurisdiction === '*'
    
    // Type filter (persistent vs session)
    const typeMatch = filterType === 'all' ||
      (filterType === 'persistent' && i.isPersistent) ||
      (filterType === 'session' && !i.isPersistent)
    
    return jurisdictionMatch && typeMatch
  })

  // Count active/inactive for current filter
  const activeCount = filteredInstructions.filter(i => i.isActive).length
  const inactiveCount = filteredInstructions.length - activeCount
  const persistentCount = instructions.filter(i => i.isPersistent).length
  const sessionCount = instructions.filter(i => !i.isPersistent).length

  // Group by jurisdiction, then by persistent/session
  const grouped: Record<string, UserInstruction[]> = {}
  for (const instr of filteredInstructions) {
    const persistentLabel = instr.isPersistent ? '💾 Persistent' : '📝 This Draft Only'
    const jurisdictionLabel = instr.jurisdiction === '*' ? '🌐 All Jurisdictions' : `🎯 ${instr.jurisdiction}`
    const key = `${persistentLabel} • ${jurisdictionLabel}`
    if (!grouped[key]) grouped[key] = []
    grouped[key].push(instr)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="bg-slate-900 rounded-2xl border border-slate-700 w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-700">
          <div>
            <h2 className="text-xl font-bold text-white">📋 Custom Instructions</h2>
            <p className="text-sm text-slate-400">
              {instructions.length} instruction{instructions.length !== 1 ? 's' : ''} 
              {persistentCount > 0 && <span className="text-violet-400"> • {persistentCount} persistent</span>}
              {sessionCount > 0 && <span className="text-blue-400"> • {sessionCount} session-only</span>}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-2">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Filter bar */}
        <div className="p-4 border-b border-slate-800 bg-slate-800/50">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm text-slate-400">Filter:</span>
            <select
              value={filterJurisdiction}
              onChange={(e) => setFilterJurisdiction(e.target.value)}
              className="px-3 py-1.5 bg-slate-700 border border-slate-600 rounded-lg text-sm text-white focus:border-violet-500 focus:outline-none"
            >
              <option value="all">All Jurisdictions</option>
              <option value="*">Global (*)</option>
              {availableJurisdictions.map(j => (
                <option key={j} value={j}>{j}</option>
              ))}
            </select>
            
            {/* Type filter */}
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value as any)}
              className="px-3 py-1.5 bg-slate-700 border border-slate-600 rounded-lg text-sm text-white focus:border-violet-500 focus:outline-none"
            >
              <option value="all">All Types</option>
              <option value="persistent">💾 Persistent Only</option>
              <option value="session">📝 This Draft Only</option>
            </select>
            
            {/* Bulk Enable/Disable buttons */}
            {filteredInstructions.length > 0 && (
              <div className="flex items-center gap-2 ml-auto">
                <span className="text-xs text-slate-500">
                  {activeCount} active / {inactiveCount} disabled
                </span>
                <button
                  onClick={() => handleBulkToggle(true)}
                  disabled={bulkOperating || activeCount === filteredInstructions.length}
                  className="px-2 py-1 text-xs rounded bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Enable all instructions"
                >
                  {bulkOperating ? '...' : '✓ Enable All'}
                </button>
                <button
                  onClick={() => handleBulkToggle(false)}
                  disabled={bulkOperating || inactiveCount === filteredInstructions.length}
                  className="px-2 py-1 text-xs rounded bg-slate-700 text-slate-400 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Disable all instructions"
                >
                  {bulkOperating ? '...' : '○ Disable All'}
                </button>
              </div>
            )}
            
            {filteredInstructions.length === 0 && (
              <span className="text-xs text-slate-500 ml-auto">
                Active: {activeJurisdiction}
              </span>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* Add New Instruction Section */}
          {showAddNew && (
            <div className="mb-6 p-4 bg-slate-800 rounded-xl border border-violet-500/50">
              <h4 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
                ➕ Add New Instruction
              </h4>
              
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Section</label>
                  <select
                    value={newSectionKey}
                    onChange={(e) => setNewSectionKey(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-sm text-white focus:border-violet-500 focus:outline-none"
                  >
                    <option value="">Select section...</option>
                    {sectionsWithoutInstructions.map(key => (
                      <option key={key} value={key}>
                        {SECTION_ICONS[key] || '📌'} {sectionLabels[key] || key}
                      </option>
                    ))}
                    {sectionsWithoutInstructions.length === 0 && (
                      <option disabled>All sections have instructions</option>
                    )}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Apply to</label>
                  <select
                    value={newJurisdiction}
                    onChange={(e) => setNewJurisdiction(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-sm text-white focus:border-violet-500 focus:outline-none"
                  >
                    <option value="*">🌐 All Jurisdictions</option>
                    {availableJurisdictions.map(j => (
                      <option key={j} value={j}>🎯 {j} only</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Persistent toggle */}
              <div className="mb-3 p-2 bg-slate-700/50 rounded-lg">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newIsPersistent}
                    onChange={(e) => setNewIsPersistent(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-600 bg-slate-700 text-violet-500 focus:ring-violet-500 focus:ring-offset-0"
                  />
                  <span className="text-xs text-slate-300 font-medium">
                    💾 Save for all future drafts
                  </span>
                </label>
                <p className="text-[10px] text-slate-500 mt-1 ml-6">
                  {newIsPersistent 
                    ? `This instruction will automatically apply to all your new ${newJurisdiction === '*' ? '' : newJurisdiction + ' '}patent drafts`
                    : 'This instruction will only apply to this draft'
                  }
                </p>
              </div>

              <div className="mb-3">
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs text-slate-400">Instruction *</label>
                  <span className={`text-xs ${countWords(newInstruction) > MAX_INSTRUCTION_WORDS ? 'text-red-400 font-medium' : 'text-slate-500'}`}>
                    {countWords(newInstruction)}/{MAX_INSTRUCTION_WORDS} words
                  </span>
                </div>
                <textarea
                  value={newInstruction}
                  onChange={(e) => setNewInstruction(e.target.value)}
                  placeholder="E.g., Focus on the technical aspects and use formal language..."
                  className={`w-full px-3 py-2 bg-slate-700 border rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none resize-none ${
                    countWords(newInstruction) > MAX_INSTRUCTION_WORDS ? 'border-red-500' : 'border-slate-600 focus:border-violet-500'
                  }`}
                  rows={3}
                />
                {countWords(newInstruction) > MAX_INSTRUCTION_WORDS && (
                  <p className="text-xs text-red-400 mt-1">
                    ⚠️ Keep instructions concise (max {MAX_INSTRUCTION_WORDS} words) for optimal AI performance
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Emphasize (optional)</label>
                  <input
                    type="text"
                    value={newEmphasis}
                    onChange={(e) => setNewEmphasis(e.target.value)}
                    placeholder="E.g., novel features, industrial use"
                    className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-sm text-white placeholder-slate-500 focus:border-violet-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Avoid (optional)</label>
                  <input
                    type="text"
                    value={newAvoid}
                    onChange={(e) => setNewAvoid(e.target.value)}
                    placeholder="E.g., marketing language, jargon"
                    className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-sm text-white placeholder-slate-500 focus:border-violet-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowAddNew(false)}
                  className="px-4 py-2 text-sm text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddNew}
                  disabled={saving || !newSectionKey || !newInstruction.trim() || countWords(newInstruction) > MAX_INSTRUCTION_WORDS}
                  className="px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white text-sm rounded-lg font-medium disabled:opacity-50"
                >
                  {saving ? 'Adding...' : (newIsPersistent ? 'Add Persistent' : 'Add Instruction')}
                </button>
              </div>
            </div>
          )}

          {/* Section Status Overview - compact grid showing all sections */}
          {!loading && instructions.length > 0 && !showAddNew && (
            <div className="mb-6 p-3 bg-slate-800/50 rounded-xl border border-slate-700">
              <h4 className="text-xs font-medium text-slate-400 mb-2">📊 Section Overview</h4>
              <div className="flex flex-wrap gap-1.5">
                {ALL_SECTIONS.map(sectionKey => {
                  const hasInstruction = instructions.some(i => i.sectionKey === sectionKey)
                  const isActive = instructions.some(i => i.sectionKey === sectionKey && i.isActive)
                  const hasPersistent = instructions.some(i => i.sectionKey === sectionKey && i.isPersistent)
                  const icon = SECTION_ICONS[sectionKey] || '📌'
                  
                  return (
                    <div
                      key={sectionKey}
                      className={`px-2 py-1 rounded text-xs flex items-center gap-1 ${
                        hasInstruction
                          ? isActive
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : 'bg-slate-700 text-slate-500'
                          : 'bg-slate-800 text-slate-600'
                      }`}
                      title={`${sectionLabels[sectionKey] || sectionKey}: ${hasInstruction ? (isActive ? 'Active' : 'Disabled') : 'No instruction'}${hasPersistent ? ' (persistent)' : ''}`}
                    >
                      <span>{icon}</span>
                      <span className="hidden sm:inline">{sectionLabels[sectionKey]?.split(' ')[0] || sectionKey.substring(0, 8)}</span>
                      {hasInstruction && (
                        <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-emerald-400' : 'bg-slate-500'}`} />
                      )}
                      {hasPersistent && (
                        <span className="text-violet-400 text-[10px]">💾</span>
                      )}
                    </div>
                  )
                })}
              </div>
              <p className="text-[10px] text-slate-500 mt-2">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 mr-1" /> Active
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-slate-500 mx-1 ml-3" /> Disabled
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-slate-700 mx-1 ml-3" /> No instruction
                <span className="ml-3">💾 Persistent</span>
              </p>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin w-8 h-8 border-4 border-violet-500 border-t-transparent rounded-full" />
            </div>
          ) : instructions.length === 0 && !showAddNew ? (
            <div className="text-center py-12">
              <div className="text-4xl mb-3">💬</div>
              <h3 className="text-lg font-medium text-white mb-2">No custom instructions yet</h3>
              <p className="text-sm text-slate-400 max-w-md mx-auto mb-4">
                Add custom instructions to guide the AI when generating patent sections.
                <br />
                <span className="text-violet-400">💾 Persistent instructions</span> will apply to all your future drafts.
              </p>
              <button
                onClick={() => setShowAddNew(true)}
                className="px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white text-sm rounded-lg font-medium"
              >
                ➕ Add First Instruction
              </button>
            </div>
          ) : filteredInstructions.length === 0 && !showAddNew ? (
            <div className="text-center py-12">
              <p className="text-slate-400">No instructions for selected filter</p>
            </div>
          ) : (
            <div className="space-y-6">
              {Object.entries(grouped).map(([groupLabel, instrs]) => (
                <div key={groupLabel}>
                  <h3 className="text-sm font-medium text-slate-400 mb-3 flex items-center gap-2">
                    {groupLabel}
                    <span className="px-2 py-0.5 bg-slate-800 rounded text-xs">
                      {instrs.length}
                    </span>
                  </h3>
                  <div className="space-y-2">
                    {instrs.map(instr => (
                      <div 
                        key={instr.id}
                        className={`bg-slate-800 rounded-lg p-4 border transition ${
                          instr.isActive 
                            ? instr.isPersistent
                              ? 'border-violet-500/30 hover:border-violet-500/50'
                              : 'border-slate-700 hover:border-slate-600'
                            : 'border-slate-700/50 opacity-60'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-start gap-3 flex-1 min-w-0">
                            <span className={`text-xl ${!instr.isActive ? 'grayscale' : ''}`}>
                              {SECTION_ICONS[instr.sectionKey] || SECTION_ICONS.default}
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1 flex-wrap">
                                <span className="font-medium text-white">
                                  {sectionLabels[instr.sectionKey] || instr.sectionKey}
                                </span>
                                {/* Persistent badge */}
                                {instr.isPersistent && (
                                  <span className="text-xs px-2 py-0.5 bg-violet-500/20 text-violet-400 rounded font-medium">
                                    💾 Persistent
                                  </span>
                                )}
                                {/* Enable/Disable Toggle */}
                                <button
                                  onClick={() => handleToggleActive(instr)}
                                  disabled={togglingId === instr.id}
                                  className={`text-xs px-2 py-0.5 rounded font-medium transition ${
                                    instr.isActive
                                      ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30'
                                      : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
                                  }`}
                                  title={instr.isActive ? 'Click to disable' : 'Click to enable'}
                                >
                                  {togglingId === instr.id ? '...' : instr.isActive ? '✓ Active' : '○ Disabled'}
                                </button>
                                {instr.style && (
                                  <span className="text-xs px-2 py-0.5 bg-slate-700 rounded text-slate-400">
                                    {instr.style}
                                  </span>
                                )}
                                {instr.wordCount && (
                                  <span className="text-xs px-2 py-0.5 bg-slate-700 rounded text-slate-400">
                                    ~{instr.wordCount} words
                                  </span>
                                )}
                              </div>
                              
                              {editingId === instr.id ? (
                                <div className="space-y-2">
                                  <div>
                                    <label className="block text-xs text-slate-400 mb-1">Instruction *</label>
                                    <textarea
                                      value={editText}
                                      onChange={(e) => setEditText(e.target.value)}
                                      className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-sm text-white focus:border-violet-500 focus:outline-none resize-none"
                                      rows={3}
                                      autoFocus
                                    />
                                  </div>
                                  <div className="grid grid-cols-2 gap-2">
                                    <div>
                                      <label className="block text-xs text-slate-400 mb-1">Emphasize</label>
                                      <input
                                        type="text"
                                        value={editEmphasis}
                                        onChange={(e) => setEditEmphasis(e.target.value)}
                                        placeholder="Focus on..."
                                        className="w-full px-2 py-1.5 bg-slate-700 border border-slate-600 rounded text-xs text-white placeholder-slate-500 focus:border-violet-500 focus:outline-none"
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-xs text-slate-400 mb-1">Avoid</label>
                                      <input
                                        type="text"
                                        value={editAvoid}
                                        onChange={(e) => setEditAvoid(e.target.value)}
                                        placeholder="Exclude..."
                                        className="w-full px-2 py-1.5 bg-slate-700 border border-slate-600 rounded text-xs text-white placeholder-slate-500 focus:border-violet-500 focus:outline-none"
                                      />
                                    </div>
                                  </div>
                                  <div className="flex gap-2">
                                    <button
                                      onClick={() => handleSaveEdit(instr)}
                                      disabled={saving}
                                      className="px-3 py-1 bg-violet-600 text-white text-xs rounded hover:bg-violet-500 disabled:opacity-50"
                                    >
                                      {saving ? 'Saving...' : 'Save'}
                                    </button>
                                    <button
                                      onClick={() => setEditingId(null)}
                                      className="px-3 py-1 text-slate-400 text-xs hover:text-white"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  <p className={`text-sm ${instr.isActive ? 'text-slate-300' : 'text-slate-500'}`}>
                                    {instr.instruction}
                                  </p>
                                  
                                  {(instr.emphasis || instr.avoid) && (
                                    <div className="flex flex-wrap gap-2 mt-2">
                                      {instr.emphasis && (
                                        <span className="text-xs px-2 py-1 bg-emerald-500/10 text-emerald-400 rounded">
                                          ✓ {instr.emphasis}
                                        </span>
                                      )}
                                      {instr.avoid && (
                                        <span className="text-xs px-2 py-1 bg-red-500/10 text-red-400 rounded">
                                          ✗ {instr.avoid}
                                        </span>
                                      )}
                                    </div>
                                  )}
                                </>
                              )}
                              
                              <p className="text-xs text-slate-500 mt-2">
                                Updated {new Date(instr.updatedAt).toLocaleDateString()}
                                {instr.isPersistent && <span className="text-violet-400"> • Applies to all drafts</span>}
                              </p>
                            </div>
                          </div>
                          
                          {editingId !== instr.id && (
                            <div className="flex gap-1">
                              <button
                                onClick={() => startEditing(instr)}
                                className="p-1.5 text-slate-500 hover:text-white rounded hover:bg-slate-700"
                                title="Edit"
                              >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                              </button>
                              <button
                                onClick={() => handleDelete(instr)}
                                className="p-1.5 text-slate-500 hover:text-red-400 rounded hover:bg-slate-700"
                                title="Delete"
                              >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-700 bg-slate-800/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span className="text-xs text-slate-500">
                💡 <span className="text-violet-400">Persistent</span> instructions apply to all future drafts
              </span>
              {instructions.length > 0 && (
                <span className="text-xs px-2 py-0.5 bg-slate-700 rounded text-slate-400">
                  {instructions.filter(i => i.isActive).length} active / {instructions.length} total
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {!showAddNew && (
                <button
                  onClick={() => setShowAddNew(true)}
                  className="px-4 py-2 border border-violet-500/50 text-violet-400 hover:bg-violet-500/10 rounded-lg text-sm font-medium"
                >
                  ➕ Add New
                </button>
              )}
              <button
                onClick={onClose}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-sm"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
