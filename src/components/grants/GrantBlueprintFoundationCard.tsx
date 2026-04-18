type ProposalFoundation = {
  thesisStatement: string
  centralObjective: string
  keyContributions: string[]
  status: string | null
  version: number | null
}

interface GrantBlueprintFoundationCardProps {
  foundation: ProposalFoundation
  isFrozen: boolean
  issues: string[]
  onChange: (patch: Partial<ProposalFoundation>) => void
  onUpdateContribution: (index: number, value: string) => void
  onAddContribution: () => void
  onRemoveContribution: (index: number) => void
}

export default function GrantBlueprintFoundationCard({
  foundation,
  isFrozen,
  issues,
  onChange,
  onUpdateContribution,
  onAddContribution,
  onRemoveContribution,
}: GrantBlueprintFoundationCardProps) {
  const thesisLength = foundation.thesisStatement.trim().length
  const objectiveLength = foundation.centralObjective.trim().length
  const contributionsCount = foundation.keyContributions.filter((item) => item.trim().length > 0).length

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            Proposal Foundation
          </div>
          <h2 className="mt-2 text-xl font-semibold text-slate-900">
            Define the central thesis, objective, and promised contributions
          </h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">
            These fields power freeze readiness and the linked narrative blueprint. Keep them concise, specific, and proposal-level.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {foundation.status ? (
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
              {foundation.status}
            </span>
          ) : null}
          {typeof foundation.version === 'number' ? (
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
              v{foundation.version}
            </span>
          ) : null}
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <label className="block">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            Thesis Statement
          </div>
          <textarea
            value={foundation.thesisStatement}
            onChange={(event) => onChange({ thesisStatement: event.target.value })}
            disabled={isFrozen}
            className="mt-2 min-h-[124px] w-full rounded-xl border border-slate-300 px-3 py-3 text-sm text-slate-700 outline-none focus:border-slate-500 disabled:bg-slate-50"
            placeholder="State the central grant claim in a single clear sentence."
          />
          <div className={`mt-2 text-xs ${thesisLength >= 20 ? 'text-emerald-700' : 'text-amber-700'}`}>
            {thesisLength}/20 minimum characters
          </div>
        </label>

        <label className="block">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            Central Objective
          </div>
          <textarea
            value={foundation.centralObjective}
            onChange={(event) => onChange({ centralObjective: event.target.value })}
            disabled={isFrozen}
            className="mt-2 min-h-[124px] w-full rounded-xl border border-slate-300 px-3 py-3 text-sm text-slate-700 outline-none focus:border-slate-500 disabled:bg-slate-50"
            placeholder="Describe what the proposal will achieve and why it matters."
          />
          <div className={`mt-2 text-xs ${objectiveLength >= 20 ? 'text-emerald-700' : 'text-amber-700'}`}>
            {objectiveLength}/20 minimum characters
          </div>
        </label>
      </div>

      <div className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            Key Contributions
          </div>
          <button
            type="button"
            onClick={onAddContribution}
            disabled={isFrozen}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Add Contribution
          </button>
        </div>
        <div className="mt-3 space-y-3">
          {foundation.keyContributions.map((contribution, index) => (
            <div key={`contribution_${index}`} className="flex items-start gap-3">
              <div className="mt-3 rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">
                {index + 1}
              </div>
              <textarea
                value={contribution}
                onChange={(event) => onUpdateContribution(index, event.target.value)}
                disabled={isFrozen}
                className="min-h-[84px] flex-1 rounded-xl border border-slate-300 px-3 py-3 text-sm text-slate-700 outline-none focus:border-slate-500 disabled:bg-slate-50"
                placeholder="Describe one concrete deliverable, capability, or outcome."
              />
              <button
                type="button"
                onClick={() => onRemoveContribution(index)}
                disabled={isFrozen || foundation.keyContributions.length <= 1}
                className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <div className={`mt-2 text-xs ${contributionsCount >= 2 ? 'text-emerald-700' : 'text-amber-700'}`}>
          {contributionsCount}/2 minimum contributions
        </div>
      </div>

      {issues.length > 0 ? (
        <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="text-sm font-semibold text-amber-900">Freeze readiness</div>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-900">
            {issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}
