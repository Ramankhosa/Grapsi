import { describe, expect, it } from 'vitest'

import { sectionContentHash } from '@/lib/reviewer/content'

describe('sectionContentHash', () => {
  it('is stable across HTML markup and whitespace differences', () => {
    const plain = sectionContentHash('The project will deploy 40 sensors across 3 districts.')
    const marked = sectionContentHash('<p>The project   will deploy 40 sensors\n across 3 districts.</p>')
    expect(marked).toBe(plain)
  })

  it('changes when the content changes', () => {
    const a = sectionContentHash('The project will deploy 40 sensors.')
    const b = sectionContentHash('The project will deploy 45 sensors.')
    expect(a).not.toBe(b)
  })

  it('distinguishes empty from non-empty content', () => {
    expect(sectionContentHash('')).not.toBe(sectionContentHash('x'))
    expect(sectionContentHash('<p>&nbsp;</p>')).toBe(sectionContentHash(''))
  })

  it('is deterministic', () => {
    const input = 'Repeated hashing of the same section text.'
    expect(sectionContentHash(input)).toBe(sectionContentHash(input))
  })
})
