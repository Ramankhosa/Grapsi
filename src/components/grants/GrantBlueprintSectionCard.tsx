import { ArrowDown, ArrowUp } from 'lucide-react'
import {
  GRANT_BLUEPRINT_DIMENSION_TYPES,
  type GrantBlueprintDimensionType,
  type GrantBlueprintPlanSection as BlueprintSection,
} from '@/types/grant'
import {
  getGrantWorkflowBadgeLabel,
  getGrantWorkflowManualDetail,
} from '@/lib/grants/workflowMode'

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

function isAutoDraftable(section: BlueprintSection) {
  return section.workflowMode === 'app_draft' && isDraftable(section.sectionType)
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

function workflowBadgeClasses(workflowMode: BlueprintSection['workflowMode']) {
  switch (workflowMode) {
    case 'app_draft':
      return 'bg-emerald-100 text-emerald-800'
    case 'app_support':
      return 'bg-sky-100 text-sky-800'
    case 'team_manual':
      return 'bg-amber-100 text-amber-900'
    default:
      return 'bg-slate-100 text-slate-700'
  }
}

function semanticBadgeClasses(semantic: BlueprintSection['grantSemantic']) {
  switch (semantic) {
    case 'summary':
      return 'bg-cyan-50 text-cyan-700'
    case 'problem_need':
      return 'bg-rose-50 text-rose-700'
    case 'objectives':
      return 'bg-emerald-50 text-emerald-700'
    case 'methodology':
      return 'bg-indigo-50 text-indigo-700'
    case 'workplan':
      return 'bg-orange-50 text-orange-700'
    case 'innovation':
      return 'bg-fuchsia-50 text-fuchsia-700'
    case 'evaluation':
      return 'bg-sky-50 text-sky-700'
    case 'impact_outcomes':
      return 'bg-teal-50 text-teal-700'
    case 'alignment':
      return 'bg-blue-50 text-blue-700'
    case 'sustainability':
      return 'bg-lime-50 text-lime-700'
    case 'risk':
      return 'bg-amber-50 text-amber-800'
    default:
      return 'bg-slate-100 text-slate-700'
  }
}

function workflowLabel(workflowMode: BlueprintSection['workflowMode']) {
  return getGrantWorkflowBadgeLabel(workflowMode)
}

function workflowDescription(workflowMode: BlueprintSection['workflowMode']) {
  switch (workflowMode) {
    case 'app_draft':
      return 'This section stays in the app drafting flow and can carry literature-linked dimensions.'
    case 'app_support':
      return 'Manual drafting section. Keep it visible in the workspace, but do not send it into prep semantics, dimensions, or AI generation.'
    case 'team_manual':
      return 'Manual drafting section. Team-owned, visible inline for completeness, and excluded from AI flows.'
    default:
      return null
  }
}

function semanticLabel(semantic: BlueprintSection['grantSemantic']) {
  if (!semantic) return 'Semantic pending'
  return semantic.replace(/_/g, ' ')
}

function formatCount(value: number, singular: string, plural = `${singular}s`) {
  return `${value} ${value === 1 ? singular : plural}`
}

function getCitationPlanBadge(section: BlueprintSection, draftable: boolean) {
  const citationCount = section.suggestedCitationCount ?? 0
  if (!draftable) {
    return {
      label: 'Manual drafting',
      description: 'No AI citation plan',
      classes: 'bg-slate-100 text-slate-700',
    }
  }

  if (section.mustCover.length === 0 || citationCount === 0) {
    return {
      label: 'No citation mapping',
      description: 'Draft from prep and rules',
      classes: 'bg-amber-100 text-amber-900',
    }
  }

  return {
    label: `${formatCount(citationCount, 'citation')}`,
    description: `${formatCount(section.mustCover.length, 'dimension')}`,
    classes: 'bg-emerald-100 text-emerald-800',
  }
}

const DIMENSION_TYPE_LABELS = {
  foundational: 'Foundational',
  methodological: 'Methodological',
  empirical: 'Empirical',
  comparative: 'Comparative',
  gap: 'Gap',
} as const

function updateDimensionList(section: BlueprintSection, nextDimensions: string[]) {
  const nextMustCoverTyping: Record<string, GrantBlueprintDimensionType> | undefined = section.mustCoverTyping
    ? Object.fromEntries(
        nextDimensions
          .map((dimension) => {
            const type = section.mustCoverTyping?.[dimension]
            return type ? ([dimension, type] as const) : null
          })
          .filter(Boolean) as Array<readonly [string, GrantBlueprintDimensionType]>
      )
    : undefined

  return {
    mustCover: nextDimensions,
    ...(nextMustCoverTyping && Object.keys(nextMustCoverTyping).length > 0
      ? { mustCoverTyping: nextMustCoverTyping }
      : { mustCoverTyping: undefined }),
  }
}

function renderBulletList(items: string[], emptyLabel: string, itemClassName = 'text-sm text-slate-700') {
  if (items.length === 0) {
    return <div className="text-sm text-slate-500">{emptyLabel}</div>
  }

  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item} className={`flex items-start gap-2 ${itemClassName}`}>
          <span className="mt-1 h-1.5 w-1.5 rounded-full bg-current opacity-70" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}

export default function GrantBlueprintSectionCard({
  section,
  index,
  total,
  isFrozen,
  onMove,
  onChange,
}: GrantBlueprintSectionCardProps) {
  const draftable = isAutoDraftable(section)
  const teamManaged = section.workflowMode === 'team_manual'
  const canEdit = !isFrozen && !teamManaged
  const citationPlan = getCitationPlanBadge(section, draftable)
  const metadata = [
    section.required ? 'Required' : 'Optional',
    typeof section.wordBudget === 'number' ? `${section.wordBudget} words` : null,
    typeof section.characterLimit === 'number' ? `${section.characterLimit} chars` : null,
    section.sourceTemplatePointer ? `Pointer: ${section.sourceTemplatePointer}` : null,
  ].filter(Boolean)

  return (
    <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">
              {index + 1}
            </span>
            <span className={`rounded-full px-2 py-1 text-xs font-semibold ${typeBadgeClasses(section.sectionType)}`}>
              {section.sectionType}
            </span>
            <span className={`rounded-full px-2 py-1 text-xs font-semibold ${workflowBadgeClasses(section.workflowMode)}`}>
              {workflowLabel(section.workflowMode)}
            </span>
            {section.grantSemantic ? (
              <span className={`rounded-full px-2 py-1 text-xs font-semibold capitalize ${semanticBadgeClasses(section.grantSemantic)}`}>
                {semanticLabel(section.grantSemantic)}
              </span>
            ) : null}
            <span className={`rounded-full px-2 py-1 text-xs font-semibold ${citationPlan.classes}`}>
              {citationPlan.label}
            </span>
            {section.required ? (
              <span className="rounded-full bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700">
                Required
              </span>
            ) : null}
            {section.workflowMode !== 'app_draft' ? (
              <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">
                {getGrantWorkflowManualDetail(section.workflowMode)}
              </span>
            ) : null}
          </div>

          <input
            value={section.label}
            onChange={(event) => onChange(section.sectionKey, { label: event.target.value })}
            disabled={!canEdit}
            className="mt-3 w-full rounded-2xl border border-slate-300 px-4 py-3 text-lg font-semibold text-slate-900 outline-none focus:border-slate-500 disabled:bg-slate-50"
          />

          {metadata.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
              {metadata.map((item) => (
                <span key={item} className="rounded-full bg-slate-100 px-3 py-1 font-medium">
                  {item}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onMove(section.sectionKey, -1)}
            disabled={!canEdit || index === 0}
            className="rounded-xl border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onMove(section.sectionKey, 1)}
            disabled={!canEdit || index === total - 1}
            className="rounded-xl border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          >
            <ArrowDown className="h-4 w-4" />
          </button>
        </div>
      </div>

      {workflowDescription(section.workflowMode) ? (
        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          {workflowDescription(section.workflowMode)}
        </div>
      ) : null}

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                {draftable ? 'Literature Mapping' : 'Section Handling'}
              </div>
              <div className="mt-2 text-sm text-slate-700">
                {draftable
                  ? section.mustCover.length > 0
                    ? `This section will use literature-backed dimensions during search, relevance review, and drafting.`
                    : 'This section will stay in app drafting, but it currently has no literature mapping and a zero citation target.'
                  : 'This section stays visible in the blueprint, but it is handled manually outside the AI literature flow.'}
              </div>
            </div>
            <div className={`rounded-2xl px-3 py-2 text-right ${citationPlan.classes}`}>
              <div className="text-sm font-semibold">{citationPlan.label}</div>
              <div className="text-xs opacity-80">{citationPlan.description}</div>
            </div>
          </div>

          {draftable ? (
            section.mustCover.length > 0 ? (
              <>
                <div className="mt-4 space-y-3">
                  {section.mustCover.map((dimension, dimensionIndex) => (
                    <div
                      key={`${section.sectionKey}_dimension_${dimensionIndex}`}
                      className="rounded-2xl border border-slate-200 bg-white p-4"
                    >
                      <input
                        value={dimension}
                        onChange={(event) => {
                          const nextDimensions = [...section.mustCover]
                          nextDimensions[dimensionIndex] = event.target.value
                          const previousDimension = section.mustCover[dimensionIndex]
                          const nextType = section.mustCoverTyping?.[previousDimension]
                          const nextMustCoverTyping = {
                            ...(section.mustCoverTyping || {}),
                          }
                          if (previousDimension && previousDimension !== event.target.value) {
                            delete nextMustCoverTyping[previousDimension]
                          }
                          if (event.target.value.trim() && nextType) {
                            nextMustCoverTyping[event.target.value.trim()] = nextType
                          }
                          onChange(section.sectionKey, {
                            ...updateDimensionList(
                              section,
                              nextDimensions.map((item) => item.trim()).filter(Boolean)
                            ),
                            ...(Object.keys(nextMustCoverTyping).length > 0
                              ? { mustCoverTyping: nextMustCoverTyping }
                              : { mustCoverTyping: undefined }),
                          })
                        }}
                        disabled={!canEdit}
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-slate-500 disabled:bg-slate-100"
                      />

                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                          Evidence Type
                        </label>
                        <select
                          value={section.mustCoverTyping?.[dimension] || 'empirical'}
                          onChange={(event) =>
                            onChange(section.sectionKey, {
                              mustCoverTyping: {
                                ...(section.mustCoverTyping || {}),
                                [dimension]: event.target.value as GrantBlueprintDimensionType,
                              },
                            })
                          }
                          disabled={!canEdit}
                          className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-slate-500 disabled:bg-slate-100"
                        >
                          {GRANT_BLUEPRINT_DIMENSION_TYPES.map((type) => (
                            <option key={type} value={type}>
                              {DIMENSION_TYPE_LABELS[type]}
                            </option>
                          ))}
                        </select>
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                          {DIMENSION_TYPE_LABELS[section.mustCoverTyping?.[dimension] || 'empirical']}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            const nextDimensions = section.mustCover.filter((_, idx) => idx !== dimensionIndex)
                            onChange(section.sectionKey, updateDimensionList(section, nextDimensions))
                          }}
                          disabled={!canEdit || section.mustCover.length <= 1}
                          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_180px]">
                  <button
                    type="button"
                    onClick={() =>
                      onChange(section.sectionKey, {
                        mustCover: [...section.mustCover, ''],
                      })
                    }
                    disabled={!canEdit}
                    className="rounded-xl border border-dashed border-slate-300 bg-white px-3 py-3 text-sm font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                  >
                    Add Dimension
                  </button>
                  <label className="block">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Citation Target
                    </div>
                    <input
                      type="number"
                      min={0}
                      max={50}
                      value={section.suggestedCitationCount ?? 0}
                      onChange={(event) =>
                        onChange(section.sectionKey, {
                          suggestedCitationCount: event.target.value
                            ? Number(event.target.value)
                            : 0,
                        })
                      }
                      disabled={!canEdit}
                      className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700 outline-none focus:border-slate-500 disabled:bg-slate-50"
                    />
                  </label>
                </div>
              </>
            ) : (
              <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
                <div className="text-sm font-semibold text-amber-900">No citation mapping planned</div>
                <div className="mt-1 text-sm text-amber-800">
                  This section will draft from grant-prep context and grant rules only unless you add dimensions.
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_180px]">
                  <button
                    type="button"
                    onClick={() =>
                      onChange(section.sectionKey, {
                        mustCover: [''],
                      })
                    }
                    disabled={!canEdit}
                    className="rounded-xl border border-dashed border-amber-300 bg-white px-3 py-3 text-sm font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-40"
                  >
                    Add First Dimension
                  </button>
                  <label className="block">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-800">
                      Citation Target
                    </div>
                    <input
                      type="number"
                      min={0}
                      max={50}
                      value={section.suggestedCitationCount ?? 0}
                      onChange={(event) =>
                        onChange(section.sectionKey, {
                          suggestedCitationCount: event.target.value
                            ? Number(event.target.value)
                            : 0,
                        })
                      }
                      disabled={!canEdit}
                      className="mt-2 w-full rounded-xl border border-amber-300 px-3 py-2 text-sm text-slate-700 outline-none focus:border-amber-500 disabled:bg-amber-100"
                    />
                  </label>
                </div>
              </div>
            )
          ) : (
            <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
              <div className="text-sm text-slate-700">
                This section is visible for completeness only. Literature dimensions, citation targets, and AI drafting stay disabled here.
              </div>
            </div>
          )}
        </section>

        <div className="space-y-4">
          {draftable ? (
            <>
              <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-800">
                  Must Do
                </div>
                <div className="mt-3">
                  {renderBulletList(
                    [
                      ...(section.grantRuleProfile?.requiredPoints || []),
                      ...(section.grantRuleProfile?.formatConstraints || []),
                    ],
                    'No section-specific drafting requirements were extracted.',
                    'text-sm text-emerald-900'
                  )}
                </div>
              </section>

              <section className="rounded-2xl border border-sky-200 bg-sky-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-800">
                  Reviewer Focus
                </div>
                <div className="mt-3">
                  {renderBulletList(
                    [
                      ...(section.grantRuleProfile?.evaluationFocus || []),
                      ...(section.grantRuleProfile?.reviewerSignals || []),
                    ],
                    'No reviewer focus signals were extracted for this section.',
                    'text-sm text-sky-900'
                  )}
                </div>
              </section>

              <section className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-rose-800">
                  Warnings And Avoid
                </div>
                <div className="mt-3">
                  {renderBulletList(
                    [
                      ...(section.grantRuleProfile?.avoidRules || []),
                      ...section.mustAvoid,
                    ],
                    'No avoid rules were extracted for this section.',
                    'text-sm text-rose-900'
                  )}
                </div>
                <label className="mt-4 block">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-rose-800">
                    Manual Avoid Notes
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
                    disabled={!canEdit}
                    className="mt-2 min-h-[96px] w-full rounded-xl border border-rose-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-rose-400 disabled:bg-rose-100"
                  />
                </label>
              </section>

              <section className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-800">
                  Prep Signals
                </div>
                <div className="mt-3">
                  {renderBulletList(
                    section.prepContextBlock?.bullets || [],
                    'No grant-prep signals are attached to this section yet.',
                    'text-sm text-indigo-900'
                  )}
                </div>
                {(section.prepContextBlock?.keywords || []).length > 0 ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {section.prepContextBlock?.keywords.map((keyword) => (
                      <span
                        key={keyword}
                        className="rounded-full bg-white px-3 py-1 text-xs font-medium text-indigo-800"
                      >
                        {keyword}
                      </span>
                    ))}
                  </div>
                ) : null}
              </section>
            </>
          ) : (
            <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Manual Handling Notes
              </div>
              <div className="mt-3 text-sm text-slate-700">
                {section.workflowMode === 'app_support'
                  ? 'Keep this section in the workspace for visibility, but complete it manually. It will not participate in ideation, blueprint dimensions, literature mapping, or AI generation.'
                  : 'This team-owned section is shown inline so the final grant stays complete, but it is excluded from prep, blueprint semantics, literature mapping, and AI drafting.'}
              </div>
            </section>
          )}
        </div>
      </div>

      <details className="mt-4 rounded-2xl border border-slate-200 bg-white">
        <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-slate-700">
          Edit Section Contract
        </summary>
        <div className="border-t border-slate-200 px-4 py-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <label className="block">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Purpose
              </div>
              <textarea
                value={section.purpose}
                onChange={(event) => onChange(section.sectionKey, { purpose: event.target.value })}
                disabled={!canEdit}
                className="mt-2 min-h-[120px] w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700 outline-none focus:border-slate-500 disabled:bg-slate-50"
              />
            </label>

            <label className="block">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Seeded Context
              </div>
              <textarea
                value={section.seededContext || ''}
                onChange={(event) => onChange(section.sectionKey, { seededContext: event.target.value })}
                disabled={!canEdit}
                className="mt-2 min-h-[120px] w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700 outline-none focus:border-slate-500 disabled:bg-slate-50"
                placeholder="Seeded context from grant prep and template guidance."
              />
            </label>
          </div>

          {section.reviewerIntent ? (
            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Reviewer Intent
              </div>
              <div className="mt-2 text-sm text-slate-700">{section.reviewerIntent}</div>
            </div>
          ) : null}
        </div>
      </details>
    </article>
  )
}
