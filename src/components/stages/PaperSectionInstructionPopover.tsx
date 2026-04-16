'use client';

import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

interface UserInstruction {
  id?: string;
  instruction: string;
  emphasis?: string;
  avoid?: string;
  style?: string;
  wordCount?: number;
  updatedAt?: string;
  isActive?: boolean;
  isPersistent?: boolean; // true = user-level (persists across drafts)
}

// Word limit for custom instructions
const MAX_INSTRUCTION_WORDS = 50;

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(w => w.length > 0).length;
}

interface PaperSectionInstructionPopoverProps {
  sectionKey: string;
  sectionLabel: string;
  sessionId: string;
  paperTypeCode?: string;
  existingInstruction?: UserInstruction | null;
  onSave: (instruction: UserInstruction) => void;
  onClose: () => void;
}

export default function PaperSectionInstructionPopover({
  sectionKey,
  sectionLabel,
  sessionId,
  paperTypeCode,
  existingInstruction,
  onSave,
  onClose
}: PaperSectionInstructionPopoverProps) {
  const [instruction, setInstruction] = useState(existingInstruction?.instruction || '');
  const [emphasis, setEmphasis] = useState(existingInstruction?.emphasis || '');
  const [avoid, setAvoid] = useState(existingInstruction?.avoid || '');
  const [style, setStyle] = useState(existingInstruction?.style || '');
  const [wordCount, setWordCount] = useState<number | ''>(existingInstruction?.wordCount || '');
  const [isActive, setIsActive] = useState(existingInstruction?.isActive !== false);
  const [isPersistent, setIsPersistent] = useState(existingInstruction?.isPersistent || false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const popoverRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  // Word count validation
  const instructionWordCount = countWords(instruction);
  const isOverLimit = instructionWordCount > MAX_INSTRUCTION_WORDS;

  // Mount check for portal
  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const handleSave = async () => {
    if (!instruction.trim()) {
      setError('Instruction text is required');
      return;
    }

    if (isOverLimit) {
      setError(`Instruction exceeds ${MAX_INSTRUCTION_WORDS} word limit (currently ${instructionWordCount} words)`);
      return;
    }

    setSaving(true);
    setError('');

    try {
      const response = await fetch(`/api/papers/${sessionId}/drafting/user-instructions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          sessionId: isPersistent ? null : sessionId,
          sectionKey,
          instruction: instruction.trim(),
          emphasis: emphasis.trim() || undefined,
          avoid: avoid.trim() || undefined,
          style: style || undefined,
          wordCount: wordCount || undefined,
          isActive,
          isPersistent,
          paperTypeCode
        })
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to save');
      }

      const data = await response.json();
      onSave({
        ...data.instruction,
        isPersistent: data.instruction.isPersistent
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save instruction');
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    if (!confirm('Clear this instruction?')) return;
    
    setSaving(true);
    try {
      const deleteParams = new URLSearchParams({
        sectionKey,
        ...(existingInstruction?.isPersistent 
          ? { isPersistent: 'true' }
          : { sessionId }
        )
      });
      
      await fetch(`/api/papers/${sessionId}/drafting/user-instructions?${deleteParams}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` }
      });
      setInstruction('');
      setEmphasis('');
      setAvoid('');
      setStyle('');
      setWordCount('');
      setIsPersistent(false);
      onSave({ instruction: '' });
    } catch (err) {
      setError('Failed to clear instruction');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async () => {
    if (!existingInstruction?.id) return;
    
    const newStatus = !isActive;
    setIsActive(newStatus);
    
    try {
      await fetch(`/api/papers/${sessionId}/drafting/user-instructions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          sessionId: existingInstruction.isPersistent ? null : sessionId,
          sectionKey,
          instruction: existingInstruction.instruction,
          emphasis: existingInstruction.emphasis,
          avoid: existingInstruction.avoid,
          style: existingInstruction.style,
          wordCount: existingInstruction.wordCount,
          isActive: newStatus,
          isPersistent: existingInstruction.isPersistent
        })
      });
      onSave({ ...existingInstruction, isActive: newStatus });
    } catch (err) {
      console.error('Failed to toggle status:', err);
      setIsActive(!newStatus);
    }
  };

  const popoverContent = (
    <div
      ref={popoverRef}
      className="fixed z-[9999] w-96 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-4"
      style={{
        top: '120px',
        right: '24px',
        maxHeight: 'calc(100vh - 140px)',
        overflowY: 'auto'
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-700">
        <div>
          <h3 className="font-medium text-white">Custom Instructions</h3>
          <p className="text-xs text-slate-400">{sectionLabel}</p>
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-white">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Persistent instruction badge */}
      {existingInstruction?.isPersistent && (
        <div className="mb-3 p-2 bg-violet-500/10 border border-violet-500/30 rounded-lg">
          <p className="text-xs text-violet-400 font-medium">
            💾 This instruction applies to all your paper drafts
          </p>
        </div>
      )}

      {/* Persistence toggle */}
      <div className="mb-3 p-2 bg-slate-800/50 rounded-lg border border-slate-700">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={isPersistent}
            onChange={(e) => setIsPersistent(e.target.checked)}
            className="w-4 h-4 rounded border-slate-600 bg-slate-700 text-violet-500 focus:ring-violet-500 focus:ring-offset-0"
          />
          <span className="text-xs text-slate-300 font-medium">
            💾 Save for all future paper drafts
          </span>
        </label>
        <p className="text-[10px] text-slate-500 mt-1 ml-6">
          {isPersistent 
            ? 'This instruction will automatically apply to all your new paper drafts'
            : 'This instruction will only apply to this paper'
          }
        </p>
      </div>

      {/* Active/Inactive toggle for existing instruction */}
      {existingInstruction?.id && (
        <div className="mb-3 flex items-center justify-between p-2 bg-slate-800/50 rounded-lg border border-slate-700">
          <span className="text-xs text-slate-400">Instruction Status:</span>
          <button
            onClick={handleToggleActive}
            disabled={saving}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition ${
              isActive
                ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30'
                : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
            }`}
          >
            {isActive ? '✓ Active (will be used)' : '○ Disabled (won\'t be used)'}
          </button>
        </div>
      )}

      {/* Main instruction */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-1">
          <label className="block text-xs font-medium text-slate-400">
            Instruction <span className="text-red-400">*</span>
          </label>
          <span className={`text-xs ${isOverLimit ? 'text-red-400 font-medium' : 'text-slate-500'}`}>
            {instructionWordCount}/{MAX_INSTRUCTION_WORDS} words
          </span>
        </div>
        <textarea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder="E.g., Focus on statistical methodology and include effect sizes for all analyses..."
          className={`w-full px-3 py-2 bg-slate-800 border rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none resize-none ${
            isOverLimit ? 'border-red-500 focus:border-red-500' : 'border-slate-700 focus:border-violet-500'
          }`}
          rows={3}
        />
        {isOverLimit && (
          <p className="text-xs text-red-400 mt-1">
            ⚠️ Keep instructions concise (max {MAX_INSTRUCTION_WORDS} words) for optimal AI performance
          </p>
        )}
      </div>

      {/* Optional fields */}
      <details className="mb-3">
        <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-300 mb-2">
          ➕ More options (emphasis, avoid, style)
        </summary>
        <div className="space-y-2 pl-2 border-l-2 border-slate-700">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Emphasize / Focus on:</label>
            <input
              type="text"
              value={emphasis}
              onChange={(e) => setEmphasis(e.target.value)}
              placeholder="E.g., theoretical contributions, practical implications"
              className="w-full px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-xs text-white placeholder-slate-500 focus:border-violet-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Avoid / Exclude:</label>
            <input
              type="text"
              value={avoid}
              onChange={(e) => setAvoid(e.target.value)}
              placeholder="E.g., informal language, excessive jargon"
              className="w-full px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-xs text-white placeholder-slate-500 focus:border-violet-500 focus:outline-none"
            />
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-xs text-slate-500 mb-1">Tone:</label>
              <select
                value={style}
                onChange={(e) => setStyle(e.target.value)}
                className="w-full px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-xs text-white focus:border-violet-500 focus:outline-none"
              >
                <option value="">Default</option>
                <option value="formal">Formal Academic</option>
                <option value="technical">Technical</option>
                <option value="accessible">Accessible</option>
                <option value="critical">Critical Analysis</option>
              </select>
            </div>
            <div className="w-24">
              <label className="block text-xs text-slate-500 mb-1">Words:</label>
              <input
                type="number"
                value={wordCount}
                onChange={(e) => setWordCount(e.target.value ? parseInt(e.target.value) : '')}
                placeholder="~500"
                min={50}
                max={5000}
                className="w-full px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-xs text-white placeholder-slate-500 focus:border-violet-500 focus:outline-none"
              />
            </div>
          </div>
        </div>
      </details>

      {/* Error message */}
      {error && (
        <div className="mb-3 p-2 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-400">
          {error}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between pt-2 border-t border-slate-700">
        <button
          onClick={handleClear}
          disabled={saving || !instruction.trim()}
          className="text-xs text-slate-500 hover:text-red-400 disabled:opacity-50"
        >
          Clear
        </button>
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-slate-400 hover:text-white"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !instruction.trim() || isOverLimit}
            className="px-4 py-1.5 bg-violet-600 hover:bg-violet-500 text-white text-xs rounded-lg font-medium disabled:opacity-50"
          >
            {saving ? 'Saving...' : (isPersistent ? 'Save for All Papers' : 'Save')}
          </button>
        </div>
      </div>
    </div>
  );

  if (!mounted) return null;

  return createPortal(
    <>
      <div className="fixed inset-0 bg-black/20 z-[9998]" onClick={onClose} />
      {popoverContent}
    </>,
    document.body
  );
}
