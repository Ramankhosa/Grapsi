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

  const toneStyles = {
    scoring: 'border-green-200 bg-green-50',
    global: 'border-blue-200 bg-blue-50',
    reminder: 'border-gray-200 bg-gray-50',
  }[tone]

  return (
    <div className={`rounded-md border p-4 ${toneStyles}`}>
      <h4 className="text-sm font-semibold text-gray-900">
        {title} <span className="font-normal text-gray-500">({rules.length})</span>
      </h4>
      <p className="mt-1 text-xs text-gray-600">{hint}</p>
      <ul className="mt-3 space-y-2">
        {rules.map((rule, index) => (
          <li key={index} className="text-sm text-gray-800">
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
      <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <div className="flex items-start">
          <FaInfoCircle className="mr-2 mt-0.5 flex-shrink-0" />
          <span>
            No call rules were mapped to this section, so it will be scored on reviewer judgment and
            the general funding call context.
            {callRulesHref ? (
              <>
                {' '}
                <Link href={callRulesHref} className="underline hover:no-underline">
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
    <div className="mb-6 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-gray-50"
      >
        <span className="flex items-center text-sm font-semibold text-gray-900">
          <FaBalanceScale className="mr-2 text-blue-600" />
          Rules applied to {sectionTitle}
          <span className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-normal text-blue-800">
            {scope.sectionRules.length + scope.globalRules.length} scoring
            {scope.supplementaryRules.length > 0
              ? ` · ${scope.supplementaryRules.length} reminders`
              : ''}
          </span>
        </span>
        {open ? <FaChevronUp className="text-gray-400" /> : <FaChevronDown className="text-gray-400" />}
      </button>

      {open ? (
        <div className="space-y-4 border-t border-gray-100 p-4">
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
              className="inline-flex items-center text-sm text-blue-600 hover:text-blue-800"
            >
              View all call rules and guidelines <FaExternalLinkAlt className="ml-1.5 h-3 w-3" />
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
