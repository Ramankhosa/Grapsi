import React from 'react'

import { MENTOR } from '@/lib/persona'

/**
 * The mentor's avatar.
 *
 * A circle, where the product mark is a rounded square — the shape itself says
 * "a person, not the system". The amber ring is the thread this design system
 * already uses for human experience (the live sessions with retired agency
 * scientists), so the AI mentor and her human counterparts read as one promise.
 */

type Size = 'xs' | 'sm' | 'md' | 'lg'

const BOX: Record<Size, string> = {
  xs: 'h-6 w-6',
  sm: 'h-8 w-8',
  md: 'h-10 w-10',
  lg: 'h-14 w-14',
}

const TYPE: Record<Size, string> = {
  xs: 'text-[10px]',
  sm: 'text-[12px]',
  md: 'text-[15px]',
  lg: 'text-[20px]',
}

export default function MentorAvatar({
  size = 'sm',
  className = '',
}: {
  size?: Size
  className?: string
}) {
  return (
    <span
      role="img"
      aria-label={`${MENTOR.name}, ${MENTOR.role}`}
      className={`grid shrink-0 place-items-center rounded-full bg-cobalt-800 font-semibold text-white ring-2 ring-amber-400/70 ${BOX[size]} ${TYPE[size]} ${className}`}
    >
      {MENTOR.initial}
    </span>
  )
}
