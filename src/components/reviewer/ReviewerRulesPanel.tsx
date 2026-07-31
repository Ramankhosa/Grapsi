import { useState } from 'react'
import Link from 'next/link'
import { FaBalanceScale, FaChevronDown, FaChevronUp, FaExternalLinkAlt, FaInfoCircle } from 'react-icons/fa'

import { ReviewerText } from '@/components/reviewer/ReviewerText'
import type { ReviewerPromptScope } from '@/lib/reviewer/promptScope'

interface ReviewerRulesPanelProps {
  scope: ReviewerPromptScope | null
  sectionTitle: string
  /** Link to the workspace's full call-rules page. */
  callRulesHref?: string
  defaultOpen?: boolean
}

function RuleList({
  title,
  hint,
  rules,
  tone,
}: {
  title: string
  hint: string
  rules: string[]
  tone: 'scoring' | 'global' | 'reminder'
}) {
  if (rules.length === 0) return null

  // Scoring weight is what distinguishes these lists, so the accent marks that
  // rather than giving each list a decorative colour of its own.
  const accent = {
    scoring: 'border-l-cobalt-600',
    global: 'border-l-cobalt-300',
    reminder: 'border-l-nickel-300',
  }[tone]

  return (
    <div className={`rounded-lg border border-nickel-200 border-l-[3px] bg-nickel-25 p-4 ${accent}`}>
      <h4 className="text-[13px] font-semibold text-nickel-900">
        {title} <span className="nk-mono font-normal text-nickel-500">{rules.length}</span>
      </h4>
      <p className="mt-1 text-[12px] leading-4 text-nickel-500">{hint}</p>
      <ul className="mt-3 space-y-2">
        {rules.map((rule, index) => (
          <li key={index} className="text-[13px] leading-5 text-nickel-700">
            <ReviewerText value={rule} />
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Shows the user the exact rule set this section is scored against.
 *
 * The scope comes from the same `buildReviewerPromptScope` the reviewer prompt
 * uses, so what is listed here is what the model is told — including which
 * rules are deliberately excluded from scoring.
 */
export default function ReviewerRulesPanel({
  scope,
  sectionTitle,
  callRulesHref,
  defaultOpen = false,
}: ReviewerRulesPanelProps) {
  const [open, setOpen] = useState(defaultOpen)

  if (!scope) return null

  const total =
    scope.sectionRules.length + scope.globalRules.length + scope.supplementaryRules.length

  if (total === 0) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-[13px] leading-5 text-amber-900">
        <div className="flex items-start gap-2">
          <FaInfoCircle className="mt-0.5 shrink-0" />
          <span>
            No call rules were mapped to this section, so it will be scored on reviewer judgment and
            the general funding call context.
            {callRulesHref ? (
              <>
                {' '}
                <Link href={callRulesHref} className="font-medium underline hover:no-underline">
                  See what this call provided
                </Link>
                .
              </>
            ) : null}
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="nk-panel overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-nickel-25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-cobalt-600"
      >
        <span className="flex min-w-0 items-center gap-2 text-[13px] font-semibold text-nickel-900">
          <FaBalanceScale className="shrink-0 text-cobalt-600" />
          <span className="truncate">Rules applied to {sectionTitle}</span>
          <span className="nk-badge nk-badge-live shrink-0">
            {scope.sectionRules.length + scope.globalRules.length} scoring
            {scope.supplementaryRules.length > 0
              ? ` · ${scope.supplementaryRules.length} reminders`
              : ''}
          </span>
        </span>
        {open ? (
          <FaChevronUp className="shrink-0 text-nickel-400" />
        ) : (
          <FaChevronDown className="shrink-0 text-nickel-400" />
        )}
      </button>

      {open ? (
        <div className="space-y-3 border-t border-nickel-200 p-4">
          <RuleList
            title="Section rules"
            hint="Taken from this call's requirements for this section. These drive the section score."
            rules={scope.sectionRules}
            tone="scoring"
          />
          <RuleList
            title="Call-wide rules"
            hint="Evaluation criteria and call-level obligations, applied wherever this section can evidence them."
            rules={scope.globalRules}
            tone="global"
          />
          <RuleList
            title="Submission reminders"
            hint="Attachments, forms, and portal steps. Reported for your checklist — they never reduce your score."
            rules={scope.supplementaryRules}
            tone="reminder"
          />

          {callRulesHref ? (
            <Link
              href={callRulesHref}
              className="inline-flex items-center gap-1.5 text-[13px] font-medium text-cobalt-700 hover:text-cobalt-800"
            >
              View all call rules and guidelines <FaExternalLinkAlt className="h-3 w-3" />
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
