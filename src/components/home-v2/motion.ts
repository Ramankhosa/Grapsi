'use client'

import { useReducedMotion } from 'framer-motion'

export function useHomeMotion() {
  const prefersReducedMotion = useReducedMotion()

  return {
    reduced: Boolean(prefersReducedMotion),
    reveal: prefersReducedMotion
      ? {}
      : {
          initial: { opacity: 0, y: 12 },
          whileInView: { opacity: 1, y: 0 },
          viewport: { once: true, margin: '-80px' },
          transition: { duration: 0.5, ease: 'easeOut' },
        },
  }
}
