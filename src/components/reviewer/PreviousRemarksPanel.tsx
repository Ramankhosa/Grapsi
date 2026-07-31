import { useMemo, useState } from 'react'
import { ReviewerText, coerceReviewerText } from './ReviewerText'

/**
 * The remarks a revision is supposed to answer, pinned beside the editor.
 *
 * The revision form used to tell the user to "address the previous AI feedback"
 * on a screen that did not contain any of it — they had to memorise the review,
 * or keep two tabs open. Ticking a remark here is a local drafting aid; the
 * authoritative addressed/not-addressed verdict still comes from the review.
 */

export interface PreviousRemark {
  key: string
  kind: 'weakness' | 'suggestion'
  text: string
}

export function extractPreviousRemarks(review: any): PreviousRemark[] {
  if (!review || typeof review !== 'object') return []

  const remarks: PreviousRemark[] = []
  const seen = new Set<string>()

  const push = (kind: PreviousRemark['kind'], value: unknown, index: number) => {
    const text = coerceReviewerText(value)
    if (!text) return
    const dedupeKey = text.toLowerCase()
    if (seen.has(dedupeKey)) return
    seen.add(dedupeKey)
    remarks.push({ key: `${kind}-${index}`, kind, text })
  }

  const weaknesses = Array.isArray(review.weaknesses) ? review.weaknesses : []
  weaknesses.forEach((item: unknown, index: number) => push('weakness', item, index))

  // Reviews carry the same list under either name depending on which model
  // produced them, so read both and let the dedupe drop the overlap.
  const suggestions = [
    ...(Array.isArray(review.suggestions) ? review.suggestions : []),
    ...(Array.isArray(review.recommendations) ? review.recommendations : []),
  ]
  suggestions.forEach((item: unknown, index: number) => push('suggestion', item, index))

  return remarks
}

const KIND_BADGE: Record<PreviousRemark['kind'], { className: string; label: string }> = {
  weakness: { className: 'nk-badge nk-badge-danger', label: 'Weakness' },
  suggestion: { className: 'nk-badge nk-badge-warn', label: 'Suggestion' },
}

export default function PreviousRemarksPanel({
  review,
  version,
  className = '',
}: {
  review: any
  version?: number | null
  className?: string
}) {
  const remarks = useMemo(() => extractPreviousRemarks(review), [review])
  const [ticked, setTicked] = useState<Record<string, boolean>>({})

  if (remarks.length === 0) {
    return (
      <div className={`nk-panel-quiet p-4 ${className}`}>
        <h3 className="nk-eyebrow">Previous remarks</h3>
        <p className="nk-sub mt-2">
          The last review raised no weaknesses or suggestions for this section.
        </p>
      </div>
    )
  }

  const tickedCount = remarks.filter(remark => ticked[remark.key]).length

  return (
    <div className={`nk-panel ${className}`}>
      <div className="flex items-center justify-between gap-3 border-b border-nickel-200 px-4 py-3">
        <div>
          <h3 className="nk-eyebrow">Previous remarks</h3>
          <p className="nk-sub mt-0.5">
            {version ? `From the review of v${version}` : 'From the last review'}
          </p>
        </div>
        <span className="nk-mono shrink-0 text-nickel-500">
          {tickedCount}/{remarks.length}
        </span>
      </div>

      <ul className="divide-y divide-nickel-100">
        {remarks.map(remark => {
          const badge = KIND_BADGE[remark.kind]
          const isTicked = Boolean(ticked[remark.key])
          return (
            <li key={remark.key}>
              <label
                className={`flex cursor-pointer items-start gap-2.5 px-4 py-3 transition-colors hover:bg-nickel-25 ${
                  isTicked ? 'opacity-55' : ''
                }`}
              >
                <input
                  type="checkbox"
                  checked={isTicked}
                  onChange={() => setTicked(prev => ({ ...prev, [remark.key]: !prev[remark.key] }))}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-nickel-300 text-cobalt-600 focus:ring-cobalt-500"
                />
                <span className="min-w-0 flex-1">
                  <span className={badge.className}>{badge.label}</span>
                  <span
                    className={`mt-1.5 block text-[13px] leading-5 text-nickel-700 ${
                      isTicked ? 'line-through' : ''
                    }`}
                  >
                    <ReviewerText value={remark.text} />
                  </span>
                </span>
              </label>
            </li>
          )
        })}
      </ul>

      <p className="border-t border-nickel-200 px-4 py-2.5 text-[12px] leading-4 text-nickel-500">
        Ticking is just a drafting aid. The review itself decides what counts as
        addressed.
      </p>
    </div>
  )
}
