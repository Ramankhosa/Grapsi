import { ArrowDown, ArrowUp } from 'lucide-react'

type BlueprintSection = {
  sectionKey: string
  label: string
  order: number
  sectionType: 'narrative' | 'short_answer' | 'checklist' | 'table' | 'budget_rows'
  required: boolean
  wordBudget: number | null
  characterLimit: number | null
  purpose: string
  reviewerIntent: string | null
  dependencies: string[]
  sourceTemplatePointer: string | null
  mustCover: string[]
  mustAvoid: string[]
  seededContext: string
}

interface GrantBlueprintSectionCardProps {
  section: BlueprintSection
  index: number
  total: number
  isFrozen: boolean
  onMove: (sectionKey: string, direction: -1 | 1) => void
  onChange: (sectionKey: string, patch: Partial<BlueprintSection>) => void
}

function isDraftable(sectionType: BlueprintSection['sectionType']) {
  return sectionType === 'narrative' || sectionType === 'short_answer'
}

function typeBadgeClasses(sectionType: BlueprintSection['sectionType']) {
  switch (sectionType) {
    case 'narrative':
      return 'bg-emerald-50 text-emerald-700'
    case 'short_answer':
      return 'bg-sky-50 text-sky-700'
    case 'checklist':
      return 'bg-amber-50 text-amber-800'
    case 'table':
      return 'bg-violet-50 text-violet-700'
    case 'budget_rows':
      return 'bg-rose-50 text-rose-700'
    default:
      return 'bg-slate-100 text-slate-700'
  }
}

export default function GrantBlueprintSectionCard({
  section,
  index,
  total,
  isFrozen,
  onMove,
  onChange,
}: GrantBlueprintSectionCardProps) {
  const draftable = isDraftable(section.sectionType)
  const metadata = [
    section.required ? 'Required' : 'Optional',
    typeof section.wordBudget === 'number' ? `${section.wordBudget} words` : null,
    typeof section.characterLimit === 'number' ? `${section.characterLimit} chars` : null,
    section.sourceTemplatePointer ? `Pointer: ${section.sourceTemplatePointer}` : null,
  ].filter(Boolean)

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">
              {index + 1}
            </span>
            <span className={`rounded-full px-2 py-1 text-xs font-semibold ${typeBadgeClasses(section.sectionType)}`}>
              {section.sectionType}
            </span>
            {section.required ? (
              <span className="rounded-full bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700">
                Required
              </span>
            ) : null}
          </div>

          <input
            value={section.label}
            onChange={(event) => onChange(section.sectionKey, { label: event.target.value })}
            disabled={isFrozen}
            className="mt-3 w-full rounded-xl border border-slate-300 px-3 py-2 text-lg font-semibold text-slate-900 outline-none focus:border-slate-500 disabled:bg-slate-50"
          />

          <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
            {metadata.map((item) => (
              <span key={item} className="rounded-full bg-slate-100 px-3 py-1 font-medium">
                {item}
              </span>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onMove(section.sectionKey, -1)}
            disabled={isFrozen || index === 0}
            className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onMove(section.sectionKey, 1)}
            disabled={isFrozen || index === total - 1}
            className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          >
            <ArrowDown className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <label className="block">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            Purpose
          </div>
          <textarea
            value={section.purpose}
            onChange={(event) => onChange(section.sectionKey, { purpose: event.target.value })}
            disabled={isFrozen}
            className="mt-2 min-h-[108px] w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700 outline-none focus:border-slate-500 disabled:bg-slate-50"
          />
        </label>

        <label className="block">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            Seeded Context
          </div>
          <textarea
            value={section.seededContext || ''}
            onChange={(event) => onChange(section.sectionKey, { seededContext: event.target.value })}
            disabled={isFrozen}
            className="mt-2 min-h-[108px] w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700 outline-none focus:border-slate-500 disabled:bg-slate-50"
            placeholder="Seeded context from grant prep and template guidance."
          />
        </label>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            {draftable ? 'Must Cover Dimensions' : 'Structured Requirements'}
          </div>
          {draftable ? (
            <textarea
              value={section.mustCover.join('\n')}
              onChange={(event) =>
                onChange(section.sectionKey, {
                  mustCover: event.target.value
                    .split('\n')
                    .map((item) => item.trim())
                    .filter(Boolean),
                })
              }
              disabled={isFrozen}
              className="mt-2 min-h-[108px] w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700 outline-none focus:border-slate-500 disabled:bg-slate-50"
            />
          ) : (
            <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              {section.mustCover.length > 0 ? (
                <ul className="list-disc space-y-1 pl-5">
                  {section.mustCover.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : (
                <span>No structured requirements were seeded for this section.</span>
              )}
            </div>
          )}
        </div>

        {draftable || section.mustAvoid.length > 0 ? (
          <label className="block">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Must Avoid
            </div>
            <textarea
              value={section.mustAvoid.join('\n')}
              onChange={(event) =>
                onChange(section.sectionKey, {
                  mustAvoid: event.target.value
                    .split('\n')
                    .map((item) => item.trim())
                    .filter(Boolean),
                })
              }
              disabled={isFrozen || !draftable}
              className="mt-2 min-h-[108px] w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700 outline-none focus:border-slate-500 disabled:bg-slate-50"
            />
          </label>
        ) : null}
      </div>

      {section.reviewerIntent ? (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            Reviewer Intent
          </div>
          <div className="mt-2 text-sm text-slate-700">{section.reviewerIntent}</div>
        </div>
      ) : null}
    </article>
  )
}
