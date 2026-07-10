'use client'

import { GRANT_PREP_STAGE_BY_KEY } from '@/lib/grantPrep/stageLibrary'
import { getGuidelineContextForStage } from '@/lib/grantPrep/guidelineRouter'
import type { GrantPrepStageKey } from '@/lib/grantPrep/types'
import type { FundingGuidelineRuleItem, GuidelinePackDocument } from '@/lib/fundingGuidelines/types'

const GUIDELINE_BLOCK_LABELS: Record<string, string> = {
  priorities: 'Priorities',
  mustAddress: 'Must address',
  avoid: 'Avoid',
  evaluationCriteria: 'Evaluation criteria',
  budgetRules: 'Budget rules',
  durationRules: 'Duration rules',
  formatRules: 'Format rules',
  submissionRules: 'Submission rules',
  deliverableRules: 'Deliverables',
  reviewerSignals: 'Reviewer signals',
}

export interface StageNorms {
  title: string
  intent: string
  rubricStrong: string | null
  ruleGroups: Array<{ key: string; label: string; rules: FundingGuidelineRuleItem[] }>
  ruleCount: number
}

/**
 * The norms an AI answer or a reviewer holds a section to: the stage's intent
 * from the stage library plus the funding-call rules the guideline router
 * assigns to that stage. This is the same routing the AI-fill prompt uses, so
 * what the user reads next to a section is what the AI was told to respect.
 */
export function getStageNorms(stageKey: string, guidelinePack: GuidelinePackDocument | null): StageNorms | null {
  const stage = GRANT_PREP_STAGE_BY_KEY[stageKey as GrantPrepStageKey]
  if (!stage) return null
  const routed = getGuidelineContextForStage(stage.key, guidelinePack)
  const ruleGroups = Object.entries(routed.blocks)
    .map(([key, rules]) => ({ key, label: GUIDELINE_BLOCK_LABELS[key] || key, rules }))
    .filter((group) => group.rules.length)
  return {
    title: stage.title,
    intent: `${stage.description} ${stage.askStyle}`.trim(),
    rubricStrong: stage.reviewerRubric?.strong || null,
    ruleGroups,
    ruleCount: ruleGroups.reduce((sum, group) => sum + group.rules.length, 0),
  }
}

function EnforcementDot({ level }: { level: FundingGuidelineRuleItem['enforcementLevel'] }) {
  return (
    <span
      className={
        'mt-1 h-1.5 w-1.5 flex-none rounded-full ' +
        (level === 'hard' ? 'bg-rose-400' : level === 'soft' ? 'bg-amber-400' : 'bg-slate-300')
      }
    />
  )
}

/**
 * Compact norms panel shown next to a Draft Zero section — the section's
 * intent, what a strong section looks like to reviewers, and the call rules
 * routed to it.
 */
export function StageNormsPanel({
  stageKey,
  guidelinePack,
  rulesPerGroup = 3,
}: {
  stageKey: string
  guidelinePack: GuidelinePackDocument | null
  rulesPerGroup?: number
}) {
  const norms = getStageNorms(stageKey, guidelinePack)
  if (!norms) return null
  return (
    <div className="space-y-3 text-xs">
      <div>
        <div className="font-medium text-slate-600">What this section is for</div>
        <p className="mt-0.5 leading-relaxed text-slate-500">{norms.intent}</p>
      </div>
      {norms.rubricStrong ? (
        <div>
          <div className="font-medium text-slate-600">What reviewers call strong</div>
          <p className="mt-0.5 leading-relaxed text-slate-500">{norms.rubricStrong}</p>
        </div>
      ) : null}
      {norms.ruleGroups.length ? (
        norms.ruleGroups.map((group) => (
          <div key={group.key}>
            <div className="font-medium text-slate-600">{group.label}</div>
            <ul className="mt-1 space-y-1">
              {group.rules.slice(0, rulesPerGroup).map((rule) => (
                <li key={rule.key} className="flex items-start gap-1.5 text-slate-500">
                  <EnforcementDot level={rule.enforcementLevel} />
                  {rule.text}
                </li>
              ))}
            </ul>
          </div>
        ))
      ) : (
        <p className="text-slate-400">No call rules are routed to this section.</p>
      )}
    </div>
  )
}
