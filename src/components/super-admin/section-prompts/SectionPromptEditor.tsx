'use client'

import { useState, useEffect } from 'react'

interface SectionPrompt {
  id: string
  countryCode: string
  sectionKey: string
  instruction: string
  constraints: string[]
  additions: string[]
  version: number
  status: string
  createdAt: string
  updatedAt: string
}

interface SectionPromptEditorProps {
  prompt: SectionPrompt | null
  countryCode?: string
  onSave: (prompt: SectionPrompt) => void
  onCancel: () => void
  isNew?: boolean
}

const SECTION_KEYS = [
  { key: 'title', label: 'Title' },
  { key: 'preamble', label: 'Preamble' },
  { key: 'fieldOfInvention', label: 'Field of Invention' },
  { key: 'background', label: 'Background' },
  { key: 'objectsOfInvention', label: 'Objects of the Invention' },
  { key: 'summary', label: 'Summary' },
  { key: 'technicalProblem', label: 'Technical Problem' },
  { key: 'technicalSolution', label: 'Technical Solution' },
  { key: 'advantageousEffects', label: 'Advantageous Effects' },
  { key: 'briefDescriptionOfDrawings', label: 'Brief Description of Drawings' },
  { key: 'detailedDescription', label: 'Detailed Description' },
  { key: 'bestMethod', label: 'Best Mode' },
  { key: 'industrialApplicability', label: 'Industrial Applicability' },
  { key: 'claims', label: 'Claims' },
  { key: 'abstract', label: 'Abstract' }
]

export function SectionPromptEditor({
  prompt,
  countryCode,
  onSave,
  onCancel,
  isNew = false
}: SectionPromptEditorProps) {
  const [formData, setFormData] = useState({
    sectionKey: prompt?.sectionKey || '',
    instruction: prompt?.instruction || '',
    constraints: prompt?.constraints || [],
    additions: prompt?.additions || [],
    changeReason: ''
  })
  const [newConstraint, setNewConstraint] = useState('')
  const [newAddition, setNewAddition] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (prompt) {
      setFormData({
        sectionKey: prompt.sectionKey,
        instruction: prompt.instruction,
        constraints: prompt.constraints || [],
        additions: prompt.additions || [],
        changeReason: ''
      })
    }
  }, [prompt])

  const handleAddConstraint = () => {
    if (newConstraint.trim()) {
      setFormData(prev => ({
        ...prev,
        constraints: [...prev.constraints, newConstraint.trim()]
      }))
      setNewConstraint('')
    }
  }

  const handleRemoveConstraint = (index: number) => {
    setFormData(prev => ({
      ...prev,
      constraints: prev.constraints.filter((_, i) => i !== index)
    }))
  }

  const handleAddAddition = () => {
    if (newAddition.trim()) {
      setFormData(prev => ({
        ...prev,
        additions: [...prev.additions, newAddition.trim()]
      }))
      setNewAddition('')
    }
  }

  const handleRemoveAddition = (index: number) => {
    setFormData(prev => ({
      ...prev,
      additions: prev.additions.filter((_, i) => i !== index)
    }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSaving(true)

    try {
      const endpoint = '/api/super-admin/section-prompts'
      const method = isNew ? 'POST' : 'PUT'

      const body = isNew
        ? {
            countryCode,
            sectionKey: formData.sectionKey,
            instruction: formData.instruction,
            constraints: formData.constraints,
            additions: formData.additions
          }
        : {
            id: prompt?.id,
            instruction: formData.instruction,
            constraints: formData.constraints,
            additions: formData.additions,
            changeReason: formData.changeReason
          }

      const response = await fetch(endpoint, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify(body)
      })

      if (response.ok) {
        const data = await response.json()
        onSave(data.prompt)
      } else {
        const errorData = await response.json()
        setError(errorData.error || 'Failed to save prompt')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save prompt')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white rounded-lg shadow-lg p-6 max-w-4xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-semibold">
          {isNew ? 'Create New Section Prompt' : `Edit ${prompt?.sectionKey} Prompt`}
        </h2>
        <span className="text-sm text-gray-500">
          {prompt ? `v${prompt.version} • ${prompt.status}` : 'New'}
        </span>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Section Key (only for new prompts) */}
        {isNew && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Section Key *
            </label>
            <select
              value={formData.sectionKey}
              onChange={(e) => setFormData(prev => ({ ...prev, sectionKey: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            >
              <option value="">Select a section...</option>
              {SECTION_KEYS.map(s => (
                <option key={s.key} value={s.key}>{s.label} ({s.key})</option>
              ))}
            </select>
          </div>
        )}

        {/* Instruction */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Instruction *
            <span className="ml-2 text-gray-400 font-normal">
              (Country-specific guidance to merge with base prompt)
            </span>
          </label>
          <textarea
            value={formData.instruction}
            onChange={(e) => setFormData(prev => ({ ...prev, instruction: e.target.value }))}
            rows={8}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
            placeholder="Enter jurisdiction-specific drafting instruction..."
            required
          />
          <p className="mt-1 text-xs text-gray-500">
            This will be appended to the base superset prompt. Reference local laws, rules, and guidelines.
          </p>
        </div>

        {/* Constraints */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Constraints
            <span className="ml-2 text-gray-400 font-normal">
              (Rules the LLM must follow)
            </span>
          </label>
          <div className="space-y-2">
            {formData.constraints.map((constraint, index) => (
              <div key={index} className="flex items-start gap-2 bg-gray-50 p-2 rounded">
                <span className="flex-1 text-sm">{constraint}</span>
                <button
                  type="button"
                  onClick={() => handleRemoveConstraint(index)}
                  className="text-red-500 hover:text-red-700 text-sm"
                >
                  ✕
                </button>
              </div>
            ))}
            <div className="flex gap-2">
              <input
                type="text"
                value={newConstraint}
                onChange={(e) => setNewConstraint(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddConstraint())}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm"
                placeholder="Add a constraint..."
              />
              <button
                type="button"
                onClick={handleAddConstraint}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 text-sm"
              >
                Add
              </button>
            </div>
          </div>
        </div>

        {/* Additions */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Additions
            <span className="ml-2 text-gray-400 font-normal">
              (Extra guidance beyond constraints)
            </span>
          </label>
          <div className="space-y-2">
            {formData.additions.map((addition, index) => (
              <div key={index} className="flex items-start gap-2 bg-blue-50 p-2 rounded">
                <span className="flex-1 text-sm">{addition}</span>
                <button
                  type="button"
                  onClick={() => handleRemoveAddition(index)}
                  className="text-red-500 hover:text-red-700 text-sm"
                >
                  ✕
                </button>
              </div>
            ))}
            <div className="flex gap-2">
              <input
                type="text"
                value={newAddition}
                onChange={(e) => setNewAddition(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddAddition())}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm"
                placeholder="Add additional guidance..."
              />
              <button
                type="button"
                onClick={handleAddAddition}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 text-sm"
              >
                Add
              </button>
            </div>
          </div>
        </div>

        {/* Change Reason (only for updates) */}
        {!isNew && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Change Reason
              <span className="ml-2 text-gray-400 font-normal">
                (For audit trail)
              </span>
            </label>
            <input
              type="text"
              value={formData.changeReason}
              onChange={(e) => setFormData(prev => ({ ...prev, changeReason: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              placeholder="Why is this change being made?"
            />
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-4 border-t">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="px-4 py-2 text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
            disabled={saving}
          >
            {saving ? 'Saving...' : isNew ? 'Create Prompt' : 'Save Changes'}
          </button>
        </div>
      </form>
    </div>
  )
}

