'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { IdeaBankIdeaWithDetails } from '@/lib/idea-bank-service'

interface IdeaEditorModalProps {
  idea: IdeaBankIdeaWithDetails
  open: boolean
  onClose: () => void
  onSave: (updatedIdea: IdeaBankIdeaWithDetails) => void
}

export default function IdeaEditorModal({
  idea,
  open,
  onClose,
  onSave
}: IdeaEditorModalProps) {
  const [editedIdea, setEditedIdea] = useState({
    title: idea.title,
    description: idea.description,
    abstract: idea.abstract || '',
    domainTags: [...idea.domainTags],
    technicalField: idea.technicalField || '',
    keyFeatures: [...idea.keyFeatures],
    potentialApplications: [...idea.potentialApplications]
  })
  const [saving, setSaving] = useState(false)

  // Available domain tags
  const availableDomains = [
    'AI/ML', 'IoT', 'Biotech', 'Medical Devices', 'Software', 'Hardware',
    'Energy', 'Transportation', 'Agriculture', 'Manufacturing', 'Finance', 'Other'
  ]

  const handleSave = async () => {
    if (!editedIdea.title.trim() || !editedIdea.description.trim()) return

    setSaving(true)
    try {
      const response = await fetch(`/api/idea-bank/${idea.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify(editedIdea)
      })

      if (response.ok) {
        const data = await response.json()
        onSave(data.idea)
      }
    } catch (error) {
      console.error('Failed to save edited idea:', error)
    } finally {
      setSaving(false)
    }
  }

  const addTag = (tag: string) => {
    if (!editedIdea.domainTags.includes(tag)) {
      setEditedIdea(prev => ({
        ...prev,
        domainTags: [...prev.domainTags, tag]
      }))
    }
  }

  const removeTag = (tag: string) => {
    setEditedIdea(prev => ({
      ...prev,
      domainTags: prev.domainTags.filter(t => t !== tag)
    }))
  }

  const addFeature = () => {
    setEditedIdea(prev => ({
      ...prev,
      keyFeatures: [...prev.keyFeatures, '']
    }))
  }

  const updateFeature = (index: number, value: string) => {
    setEditedIdea(prev => ({
      ...prev,
      keyFeatures: prev.keyFeatures.map((f, i) => i === index ? value : f)
    }))
  }

  const removeFeature = (index: number) => {
    setEditedIdea(prev => ({
      ...prev,
      keyFeatures: prev.keyFeatures.filter((_, i) => i !== index)
    }))
  }

  const addApplication = () => {
    setEditedIdea(prev => ({
      ...prev,
      potentialApplications: [...prev.potentialApplications, '']
    }))
  }

  const updateApplication = (index: number, value: string) => {
    setEditedIdea(prev => ({
      ...prev,
      potentialApplications: prev.potentialApplications.map((a, i) => i === index ? value : a)
    }))
  }

  const removeApplication = (index: number) => {
    setEditedIdea(prev => ({
      ...prev,
      potentialApplications: prev.potentialApplications.filter((_, i) => i !== index)
    }))
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto bg-white border-gray-200 shadow-2xl">
        <DialogHeader>
          <DialogTitle>✏️ Clone & Edit Idea</DialogTitle>
          <p className="text-sm text-gray-600">
            Create a new idea based on "{idea.title}". Your changes will be saved as a separate idea.
          </p>
        </DialogHeader>

        <div className="space-y-6">
          {/* Title */}
          <div>
            <Label htmlFor="edit-title">Title *</Label>
            <Input
              id="edit-title"
              value={editedIdea.title}
              onChange={(e) => setEditedIdea(prev => ({ ...prev, title: e.target.value }))}
              placeholder="Enter idea title"
            />
          </div>

          {/* Description */}
          <div>
            <Label htmlFor="edit-description">Description *</Label>
            <Textarea
              id="edit-description"
              value={editedIdea.description}
              onChange={(e) => setEditedIdea(prev => ({ ...prev, description: e.target.value }))}
              placeholder="Describe your invention idea"
              rows={4}
            />
          </div>

          {/* Abstract */}
          <div>
            <Label htmlFor="edit-abstract">Patent Abstract</Label>
            <Textarea
              id="edit-abstract"
              value={editedIdea.abstract}
              onChange={(e) => setEditedIdea(prev => ({ ...prev, abstract: e.target.value }))}
              placeholder="Patent abstract (optional)"
              rows={3}
            />
          </div>

          {/* Technical Field */}
          <div>
            <Label htmlFor="edit-technical-field">Technical Field</Label>
            <Input
              id="edit-technical-field"
              value={editedIdea.technicalField}
              onChange={(e) => setEditedIdea(prev => ({ ...prev, technicalField: e.target.value }))}
              placeholder="e.g., Artificial Intelligence, Medical Devices"
            />
          </div>

          {/* Domain Tags */}
          <div>
            <Label>Domain Tags</Label>
            <div className="flex flex-wrap gap-2 mt-2 mb-3">
              {editedIdea.domainTags.map(tag => (
                <Badge
                  key={tag}
                  variant="default"
                  className="cursor-pointer hover:bg-red-600"
                  onClick={() => removeTag(tag)}
                >
                  {tag} ×
                </Badge>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {availableDomains
                .filter(domain => !editedIdea.domainTags.includes(domain))
                .map(domain => (
                  <Badge
                    key={domain}
                    variant="outline"
                    className="cursor-pointer hover:bg-blue-100"
                    onClick={() => addTag(domain)}
                  >
                    + {domain}
                  </Badge>
                ))}
            </div>
          </div>

          {/* Key Features */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <Label>Key Features</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addFeature}
              >
                + Add Feature
              </Button>
            </div>
            <div className="space-y-2">
              {editedIdea.keyFeatures.map((feature, index) => (
                <div key={index} className="flex gap-2">
                  <Input
                    value={feature}
                    onChange={(e) => updateFeature(index, e.target.value)}
                    placeholder="Describe a key technical feature"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => removeFeature(index)}
                    className="text-red-600 hover:bg-red-50"
                  >
                    ×
                  </Button>
                </div>
              ))}
            </div>
          </div>

          {/* Potential Applications */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <Label>Potential Applications</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addApplication}
              >
                + Add Application
              </Button>
            </div>
            <div className="space-y-2">
              {editedIdea.potentialApplications.map((application, index) => (
                <div key={index} className="flex gap-2">
                  <Input
                    value={application}
                    onChange={(e) => updateApplication(index, e.target.value)}
                    placeholder="Describe a potential application"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => removeApplication(index)}
                    className="text-red-600 hover:bg-red-50"
                  >
                    ×
                  </Button>
                </div>
              ))}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end space-x-3 pt-4 border-t">
            <Button
              variant="outline"
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || !editedIdea.title.trim() || !editedIdea.description.trim()}
              className="bg-purple-600 hover:bg-purple-700"
            >
              {saving ? 'Saving...' : '💾 Save New Idea'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
