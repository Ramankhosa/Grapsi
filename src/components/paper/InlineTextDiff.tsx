'use client'

import { useMemo } from 'react'

type DiffSegment = {
  type: 'same' | 'add' | 'remove'
  text: string
}

export default function InlineTextDiff({
  original,
  revised,
}: {
  original: string
  revised: string
}) {
  const diffSegments = useMemo(() => {
    try {
      if (!original && !revised) return []
      if (!original) return [{ type: 'add' as const, text: revised }]
      if (!revised) return [{ type: 'remove' as const, text: original }]
      if (original === revised) return [{ type: 'same' as const, text: '(No changes)' }]

      const originalWords = original.split(/(\s+)/)
      const revisedWords = revised.split(/(\s+)/)
      const maxElements = 4000

      if (originalWords.length > maxElements || revisedWords.length > maxElements) {
        return [{ type: 'same' as const, text: 'Content too large for inline diff.' }]
      }

      const lcs: number[][] = Array(originalWords.length + 1)
        .fill(null)
        .map(() => Array(revisedWords.length + 1).fill(0))

      for (let left = 1; left <= originalWords.length; left += 1) {
        for (let right = 1; right <= revisedWords.length; right += 1) {
          lcs[left][right] = originalWords[left - 1] === revisedWords[right - 1]
            ? lcs[left - 1][right - 1] + 1
            : Math.max(lcs[left - 1][right], lcs[left][right - 1])
        }
      }

      const stack: DiffSegment[] = []
      let left = originalWords.length
      let right = revisedWords.length

      while (left > 0 || right > 0) {
        if (left > 0 && right > 0 && originalWords[left - 1] === revisedWords[right - 1]) {
          stack.push({ type: 'same', text: originalWords[left - 1] })
          left -= 1
          right -= 1
          continue
        }

        if (right > 0 && (left === 0 || lcs[left][right - 1] >= lcs[left - 1][right])) {
          stack.push({ type: 'add', text: revisedWords[right - 1] })
          right -= 1
          continue
        }

        stack.push({ type: 'remove', text: originalWords[left - 1] })
        left -= 1
      }

      const diff = stack.reverse()
      const merged: DiffSegment[] = []

      for (const segment of diff) {
        const previous = merged[merged.length - 1]
        if (previous && previous.type === segment.type) {
          previous.text += segment.text
          continue
        }
        merged.push({ ...segment })
      }

      return merged
    } catch {
      return [{ type: 'same' as const, text: 'Unable to compute diff.' }]
    }
  }, [original, revised])

  if (diffSegments.length === 0) {
    return <span className="italic text-slate-400">No changes detected</span>
  }

  return (
    <div className="text-sm leading-relaxed">
      {diffSegments.map((segment, index) => {
        if (segment.type === 'same') {
          return (
            <span key={index} className="text-slate-700">
              {segment.text}
            </span>
          )
        }

        if (segment.type === 'add') {
          return (
            <span key={index} className="rounded bg-emerald-200 px-0.5 text-emerald-900">
              {segment.text}
            </span>
          )
        }

        return (
          <span key={index} className="rounded bg-rose-200 px-0.5 text-rose-900 line-through">
            {segment.text}
          </span>
        )
      })}
    </div>
  )
}
