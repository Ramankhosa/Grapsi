/**
 * A section or overall score, shown against the scale it sits on.
 *
 * The pill this replaces printed a bare number tinted by hardcoded 8/6
 * thresholds, so a 5.9 and a 1.2 looked identical (both red) and nothing said
 * what counted as good. A marked track makes the position readable without a
 * legend, and the band label states the judgement in words as well as colour.
 */

export type ScoreBand = 'strong' | 'sound' | 'weak' | 'poor'

export function scoreBand(score: number): ScoreBand {
  if (score >= 8) return 'strong'
  if (score >= 6.5) return 'sound'
  if (score >= 4) return 'weak'
  return 'poor'
}

const BAND_LABEL: Record<ScoreBand, string> = {
  strong: 'Competitive',
  sound: 'Sound, needs work',
  weak: 'Weak',
  poor: 'Not fundable as written',
}

const BAND_FILL: Record<ScoreBand, string> = {
  strong: 'bg-emerald-500',
  sound: 'bg-cobalt-600',
  weak: 'bg-amber-500',
  poor: 'bg-red-500',
}

const BAND_TEXT: Record<ScoreBand, string> = {
  strong: 'text-emerald-700',
  sound: 'text-cobalt-800',
  weak: 'text-amber-700',
  poor: 'text-red-700',
}

export default function ScoreBar({
  score,
  outOf = 10,
  size = 'md',
  delta = null,
  comparedToVersion = null,
  label = 'Score',
}: {
  score: number | null | undefined
  outOf?: number
  size?: 'sm' | 'md' | 'lg'
  /** Change against the previous version, when this is a revision. */
  delta?: number | null
  comparedToVersion?: number | null
  label?: string
}) {
  const value = typeof score === 'number' && Number.isFinite(score) ? score : null

  if (value === null) {
    return (
      <div>
        <div className="nk-eyebrow">{label}</div>
        <p className="mt-1 text-[13px] text-nickel-500">Not scored yet</p>
      </div>
    )
  }

  const band = scoreBand(value)
  const percent = Math.max(0, Math.min(100, (value / outOf) * 100))
  const readoutClass = size === 'lg' ? 'nk-readout' : 'nk-readout-sm'

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="nk-eyebrow">{label}</span>
        {typeof delta === 'number' && Number.isFinite(delta) && (
          <span
            className={`nk-mono rounded px-1.5 py-0.5 ${
              delta > 0
                ? 'bg-emerald-50 text-emerald-700'
                : delta < 0
                  ? 'bg-red-50 text-red-700'
                  : 'bg-nickel-100 text-nickel-600'
            }`}
          >
            {delta > 0 ? '+' : ''}
            {delta.toFixed(1)}
            {comparedToVersion !== null && ` vs v${comparedToVersion}`}
          </span>
        )}
      </div>

      <div className="mt-1.5 flex items-baseline gap-1.5">
        <span className={`${readoutClass} ${BAND_TEXT[band]}`}>{value.toFixed(1)}</span>
        <span className="text-[13px] text-nickel-500">/ {outOf}</span>
      </div>

      <div
        className="nk-meter mt-2"
        role="meter"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={outOf}
        aria-label={`${label}: ${value.toFixed(1)} out of ${outOf} — ${BAND_LABEL[band]}`}
      >
        <div
          className={`h-full rounded-full transition-[width] duration-500 ease-out ${BAND_FILL[band]}`}
          style={{ width: `${percent}%` }}
        />
      </div>

      <p className={`mt-1.5 text-[12px] font-medium ${BAND_TEXT[band]}`}>{BAND_LABEL[band]}</p>
    </div>
  )
}
