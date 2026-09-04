import React from 'react'

/**
 * The AIGrantMentor mark.
 *
 * A scan ring with a locked centre: the thin arc is everything the platform
 * swept, the heavy arc is the slice that matched, and the dot is the call it
 * locked onto. That is the product in one glyph, and it still reads at 24px.
 *
 * Drawn rather than loaded so it stays crisp at every size and needs no asset.
 */

type Size = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

const SIZE_CLASSES: Record<Size, string> = {
  xs: 'h-6 w-6',
  sm: 'h-8 w-8',
  md: 'h-12 w-12',
  lg: 'h-16 w-16',
  xl: 'h-24 w-24',
}

const WORDMARK_CLASSES: Record<Size, string> = {
  xs: 'text-[13px]',
  sm: 'text-[15px]',
  md: 'text-[19px]',
  lg: 'text-[24px]',
  xl: 'text-[32px]',
}

const RADIUS = 9
const CIRCUMFERENCE = 2 * Math.PI * RADIUS
/** Arc length of the "matched" segment — roughly a quarter turn. */
const MATCHED = 13

export function BrandMark({ size = 'md', className = '' }: { size?: Size; className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      role="img"
      aria-label="AIGrantMentor"
      className={`${SIZE_CLASSES[size]} shrink-0 ${className}`}
    >
      <rect width="32" height="32" rx="8" fill="#1d4ed8" />
      <g transform="rotate(-90 16 16)" fill="none" strokeLinecap="round">
        {/* everything scanned */}
        <circle
          cx="16"
          cy="16"
          r={RADIUS}
          stroke="#ffffff"
          strokeOpacity="0.45"
          strokeWidth="1.75"
          strokeDasharray={`${CIRCUMFERENCE - MATCHED - 3} ${MATCHED + 3}`}
          strokeDashoffset={-(MATCHED + 3)}
        />
        {/* what matched */}
        <circle
          cx="16"
          cy="16"
          r={RADIUS}
          stroke="#ffffff"
          strokeWidth="3"
          strokeDasharray={`${MATCHED} ${CIRCUMFERENCE - MATCHED}`}
        />
      </g>
      {/* the call it locked onto */}
      <circle cx="16" cy="16" r="3.25" fill="#ffffff" />
    </svg>
  )
}

/**
 * Mark plus wordmark. `tone` is the ground it sits on, not the ink: pass
 * "dark" on the auth screens so the wordmark stays legible.
 */
export function BrandLockup({
  size = 'sm',
  tone = 'light',
  className = '',
  showWordmark = true,
}: {
  size?: Size
  tone?: 'light' | 'dark'
  className?: string
  showWordmark?: boolean
}) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <BrandMark size={size} />
      {showWordmark && (
        <span
          className={`${WORDMARK_CLASSES[size]} font-semibold tracking-[-0.01em] ${
            tone === 'dark' ? 'text-white' : 'text-gpt-gray-900'
          }`}
        >
          <span className={tone === 'dark' ? 'text-cobalt-300' : 'text-cobalt-600'}>AI</span>GrantMentor
        </span>
      )}
    </span>
  )
}

export default BrandMark
