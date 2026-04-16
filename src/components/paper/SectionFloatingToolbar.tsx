'use client';

import { BookOpen, Loader2, MessageSquare, RefreshCw, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';

interface SectionFloatingToolbarProps {
  onGenerate: () => void;
  onRegenerate: () => void;
  onInstructions: () => void;
  onToggleAutoCitations?: () => void;
  autoCitationsAvailable?: boolean;
  autoCitationsEnabled?: boolean;
  generating?: boolean;
  regenerating?: boolean;
  instructionActive?: boolean;
  disabled?: boolean;
}

function ToolbarButton({
  title,
  onClick,
  disabled,
  className,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex h-6 w-6 items-center justify-center rounded-md border border-transparent text-slate-500 transition-all duration-150 hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50 ${className || ''}`}
    >
      {children}
    </button>
  );
}

export default function SectionFloatingToolbar({
  onGenerate,
  onRegenerate,
  onInstructions,
  onToggleAutoCitations,
  autoCitationsAvailable,
  autoCitationsEnabled,
  generating,
  regenerating,
  instructionActive,
  disabled,
}: SectionFloatingToolbarProps) {
  return (
    <div className="section-float-toolbar pointer-events-none absolute -top-3 right-0 z-10 flex gap-0.5 rounded-lg border border-slate-200 bg-white px-1.5 py-1 shadow-[0_2px_8px_rgba(0,0,0,0.06)] opacity-0 transition-opacity duration-200 group-hover/section:opacity-100 group-focus-within/section:opacity-100">
      <div className="pointer-events-auto flex items-center gap-0.5">
        <ToolbarButton
          title="Generate"
          onClick={onGenerate}
          disabled={Boolean(disabled)}
          className="hover:bg-indigo-50 hover:text-indigo-600"
        >
          {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
        </ToolbarButton>

        <ToolbarButton
          title="Regenerate"
          onClick={onRegenerate}
          disabled={Boolean(disabled)}
          className="hover:bg-slate-100 hover:text-slate-700"
        >
          {regenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        </ToolbarButton>

        <ToolbarButton
          title="Instructions"
          onClick={onInstructions}
          disabled={Boolean(disabled)}
          className={instructionActive ? 'bg-indigo-50 text-indigo-600 border-indigo-200' : 'hover:bg-slate-100 hover:text-slate-700'}
        >
          <MessageSquare className="h-3.5 w-3.5" />
        </ToolbarButton>

        {autoCitationsAvailable && onToggleAutoCitations && (
          <ToolbarButton
            title="Auto Citations"
            onClick={onToggleAutoCitations}
            disabled={Boolean(disabled)}
            className={autoCitationsEnabled ? 'bg-indigo-50 text-indigo-600 border-indigo-200' : 'hover:bg-slate-100 hover:text-slate-700'}
          >
            <BookOpen className="h-3.5 w-3.5" />
          </ToolbarButton>
        )}
      </div>
    </div>
  );
}
