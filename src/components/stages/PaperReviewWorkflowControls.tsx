'use client'

import { ArrowRight, CheckCircle2, Download, SearchCheck, Wrench } from 'lucide-react'
import { formatPaperReviewDateTime, getPaperReviewModeMeta } from '@/lib/paper-review-ui'
import type { PaperReviewMode } from '@/types/paper-review'

type WorkflowStageKey = 'MANUSCRIPT_REVIEW' | 'MANUSCRIPT_IMPROVE' | 'REVIEW_EXPORT'

type PipelineStepperProps = {
  currentStage: WorkflowStageKey
  onNavigateToStage?: (stageKey: WorkflowStageKey) => void
  canAccessImprove?: boolean
  canAccessExport?: boolean
}

const PIPELINE_STAGES: Array<{
  key: WorkflowStageKey
  label: string
  description: string
  icon: typeof SearchCheck
}> = [
  {
    key: 'MANUSCRIPT_REVIEW',
    label: 'Review',
    description: 'Audit the manuscript and identify the highest-risk issues.',
    icon: SearchCheck,
  },
  {
    key: 'MANUSCRIPT_IMPROVE',
    label: 'Improve',
    description: 'Apply or resolve issues from the saved review report.',
    icon: Wrench,
  },
  {
    key: 'REVIEW_EXPORT',
    label: 'Adaptive Export',
    description: 'Review formatting, run final checks, and export the paper package.',
    icon: Download,
  },
]

function isStageAccessible(
  stageKey: WorkflowStageKey,
  canAccessImprove: boolean,
  canAccessExport: boolean
) {
  if (stageKey === 'MANUSCRIPT_IMPROVE') return canAccessImprove
  if (stageKey === 'REVIEW_EXPORT') return canAccessExport
  return true
}

export function PaperReviewPipelineStepper({
  currentStage,
  onNavigateToStage,
  canAccessImprove = true,
  canAccessExport = true,
}: PipelineStepperProps) {
  const currentIndex = PIPELINE_STAGES.findIndex(stage => stage.key === currentStage)

  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Pipeline</div>
      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        {PIPELINE_STAGES.map((stage, index) => {
          const StageIcon = stage.icon
          const isCurrent = stage.key === currentStage
          const isPast = index < currentIndex
          const accessible = isStageAccessible(stage.key, canAccessImprove, canAccessExport)

          return (
            <button
              key={stage.key}
              type="button"
              onClick={() => accessible && onNavigateToStage?.(stage.key)}
              disabled={!accessible}
              title={accessible ? stage.description : 'Complete the previous stage first'}
              className={`group flex items-start gap-3 rounded-3xl border px-4 py-4 text-left transition ${
                isCurrent
                  ? 'border-slate-900 bg-slate-900 text-white shadow-lg shadow-slate-900/10'
                  : isPast
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                    : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300 hover:bg-white'
              } ${!accessible ? 'cursor-not-allowed opacity-55' : ''}`}
            >
              <div
                className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl ${
                  isCurrent
                    ? 'bg-white/15 text-white'
                    : isPast
                      ? 'bg-white text-emerald-600'
                      : 'bg-white text-slate-500'
                }`}
              >
                {isPast ? <CheckCircle2 className="h-4 w-4" /> : <StageIcon className="h-4 w-4" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <div className="text-sm font-semibold">{stage.label}</div>
                  {index < PIPELINE_STAGES.length - 1 && (
                    <ArrowRight className={`h-3.5 w-3.5 ${isCurrent ? 'text-white/70' : 'text-slate-400'}`} />
                  )}
                </div>
                <p className={`mt-1 text-sm leading-6 ${isCurrent ? 'text-slate-200' : 'text-slate-500'}`}>
                  {stage.description}
                </p>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

type ModeSwitcherProps = {
  selectedMode: PaperReviewMode
  onChange: (reviewMode: PaperReviewMode) => void
  latestRunByMode?: Partial<Record<PaperReviewMode, string | null | undefined>>
  noun?: string
}

export function PaperReviewModeSwitcher({
  selectedMode,
  onChange,
  latestRunByMode,
  noun = 'review',
}: ModeSwitcherProps) {
  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Mode</div>
          <h2 className="mt-2 text-lg font-semibold text-slate-900">Choose how this {noun} should behave</h2>
        </div>
        <div className="inline-flex rounded-2xl bg-slate-100 p-1">
          {(['quick', 'section_by_section'] as const).map(mode => (
            <button
              key={mode}
              type="button"
              onClick={() => onChange(mode)}
              title={getPaperReviewModeMeta(mode).description}
              className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
                selectedMode === mode
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {getPaperReviewModeMeta(mode).label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {(['quick', 'section_by_section'] as const).map(mode => {
          const meta = getPaperReviewModeMeta(mode)
          const isActive = selectedMode === mode
          const latestRun = latestRunByMode?.[mode]

          return (
            <button
              key={mode}
              type="button"
              onClick={() => onChange(mode)}
              title={meta.description}
              className={`rounded-3xl border px-4 py-4 text-left transition ${
                isActive
                  ? 'border-slate-900 bg-slate-50 shadow-sm'
                  : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-slate-900">{meta.label}</div>
                {isActive && (
                  <span className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[11px] font-semibold text-slate-700">
                    Selected
                  </span>
                )}
              </div>
              <div className="mt-2 text-base font-semibold text-slate-900">{meta.title}</div>
              <p className="mt-2 text-sm leading-6 text-slate-600">{meta.description}</p>
              <div className="mt-3 text-xs text-slate-500">
                {latestRun ? `Latest run: ${formatPaperReviewDateTime(latestRun)}` : 'No saved run yet'}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
