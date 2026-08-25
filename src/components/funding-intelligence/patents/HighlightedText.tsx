'use client'

import { useMemo } from 'react'

import { splitForHighlight } from '@/lib/patentIntelligence/searchCore'

/** Renders `text` with the query terms wrapped in <mark>. Safe: no HTML is injected. */
export default function HighlightedText({ text, terms, className }: { text: string | null | undefined; terms: string[]; className?: string }) {
  const chunks = useMemo(() => splitForHighlight(text, terms), [terms, text])
  if (!chunks.length) return null
  return (
    <span className={className}>
      {chunks.map((chunk, index) => (
        chunk.hit
          ? <mark key={index} className="rounded bg-amber-100 px-0.5 text-inherit">{chunk.text}</mark>
          : <span key={index}>{chunk.text}</span>
      ))}
    </span>
  )
}
