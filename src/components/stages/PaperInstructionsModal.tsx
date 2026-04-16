'use client';

import { useState, useEffect } from 'react';
import { X, Save, Sparkles, Trash2, ToggleLeft, ToggleRight, Cloud } from 'lucide-react';

interface UserInstruction {
  id?: string;
  instruction: string;
  emphasis?: string;
  avoid?: string;
  style?: string;
  wordCount?: number;
  isActive?: boolean;
  isPersistent?: boolean;
  updatedAt?: string;
}

interface PaperInstructionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  sections: Array<{ key: string; label: string }>;
  instructions: Record<string, UserInstruction | undefined>;
  onSaveAll: (instructions: Record<string, UserInstruction | undefined>) => void;
}

export default function PaperInstructionsModal({
  isOpen,
  onClose,
  sections,
  instructions,
  onSaveAll
}: PaperInstructionsModalProps) {
  const [localInstructions, setLocalInstructions] = useState<Record<string, UserInstruction | undefined>>({});

  // Initialize local state when modal opens
  useEffect(() => {
    if (isOpen) {
      setLocalInstructions({ ...instructions });
    }
  }, [isOpen, instructions]);

  if (!isOpen) return null;

  const handleInstructionChange = (key: string, value: string) => {
    setLocalInstructions(prev => {
      const existing: UserInstruction = prev[key] ?? { instruction: '', isActive: true };
      return {
        ...prev,
        [key]: {
          ...existing,
          instruction: value,
          isActive: existing.isActive !== false
        }
      };
    });
  };

  const handleToggleActive = (key: string) => {
    setLocalInstructions(prev => {
      const existing = prev[key];
      if (!existing?.instruction) return prev;
      return {
        ...prev,
        [key]: {
          ...existing,
          isActive: existing.isActive === false ? true : false
        }
      };
    });
  };

  const handleTogglePersistent = (key: string) => {
    setLocalInstructions(prev => {
      const existing = prev[key];
      if (!existing?.instruction) return prev;
      return {
        ...prev,
        [key]: {
          ...existing,
          isPersistent: !existing.isPersistent
        }
      };
    });
  };

  const handleClear = (key: string) => {
    setLocalInstructions(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const handleSave = () => {
    // Filter out empty instructions
    const filtered: Record<string, UserInstruction | undefined> = {};
    Object.entries(localInstructions).forEach(([key, value]) => {
      if (value?.instruction?.trim()) {
        filtered[key] = value;
      }
    });
    onSaveAll(filtered);
    onClose();
  };

  const handleClearAll = () => {
    if (confirm('Clear all instructions?')) {
      setLocalInstructions({});
    }
  };

  const instructionCount = Object.values(localInstructions).filter(v => v?.instruction?.trim()).length;
  const activeCount = Object.values(localInstructions).filter(v => v?.instruction?.trim() && v?.isActive !== false).length;
  const persistentCount = Object.values(localInstructions).filter(v => v?.instruction?.trim() && v?.isPersistent).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col border border-slate-200 dark:border-slate-700" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Section Instructions</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {activeCount} active • {persistentCount} persistent
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Info Banner */}
        <div className="p-4 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
          <div className="flex items-start gap-3 text-sm text-slate-600 dark:text-slate-400">
            <div className="flex-1 space-y-1">
              <p className="font-medium text-slate-700 dark:text-slate-300">💡 How instructions work:</p>
              <ul className="text-xs space-y-1 pl-4 list-disc">
                <li><span className="text-emerald-600">Active</span> instructions are used when generating content</li>
                <li><span className="text-violet-600">Persistent</span> instructions apply to all your future papers</li>
                <li>Toggle OFF to temporarily disable without deleting</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {sections.map(({ key, label }) => {
            const instr = localInstructions[key];
            const hasInstruction = !!instr?.instruction?.trim();
            const isActive = instr?.isActive !== false;
            const isPersistent = instr?.isPersistent || false;

            return (
              <div key={key} className={`rounded-lg border ${hasInstruction ? (isActive ? 'border-emerald-200 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-900/20' : 'border-slate-200 bg-slate-50/50 dark:border-slate-700 dark:bg-slate-800/20') : 'border-slate-200 dark:border-slate-700'} p-3 space-y-2`}>
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300 flex items-center gap-2">
                    {label}
                    {hasInstruction && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${isActive ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400' : 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400'}`}>
                        {isActive ? 'ON' : 'OFF'}
                      </span>
                    )}
                    {isPersistent && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-400 flex items-center gap-0.5">
                        <Cloud className="w-2.5 h-2.5" /> Persistent
                      </span>
                    )}
                  </label>
                  
                  {hasInstruction && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleToggleActive(key)}
                        className={`p-1 rounded transition-colors ${isActive ? 'text-emerald-500 hover:bg-emerald-100 dark:hover:bg-emerald-900/30' : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
                        title={isActive ? 'Disable instruction' : 'Enable instruction'}
                      >
                        {isActive ? <ToggleRight className="w-5 h-5" /> : <ToggleLeft className="w-5 h-5" />}
                      </button>
                      <button
                        onClick={() => handleTogglePersistent(key)}
                        className={`p-1 rounded transition-colors ${isPersistent ? 'text-violet-500 hover:bg-violet-100 dark:hover:bg-violet-900/30' : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
                        title={isPersistent ? 'Remove from persistent' : 'Save for all papers'}
                      >
                        <Cloud className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleClear(key)}
                        className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded transition-colors"
                        title="Clear instruction"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
                <textarea
                  value={instr?.instruction || ''}
                  onChange={(e) => handleInstructionChange(key, e.target.value)}
                  placeholder={`E.g., "Focus on methodology details", "Include recent citations", "Keep formal academic tone"...`}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none transition-colors"
                  rows={2}
                />
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
          <div className="flex items-center gap-4">
            <button
              onClick={handleClearAll}
              className="text-sm text-slate-500 hover:text-red-500 transition-colors"
            >
              Clear All
            </button>
            <span className="text-xs text-slate-400">
              {instructionCount} instruction{instructionCount !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2 shadow-sm"
            >
              <Save className="w-4 h-4" />
              Save Instructions
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
