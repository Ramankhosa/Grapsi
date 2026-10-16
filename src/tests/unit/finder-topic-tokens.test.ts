import { describe, expect, it } from 'vitest'

import { normalizeTopicKey, tokenizeTopicText } from '@/lib/services/recommendationSearchService'

describe('topic tokens', () => {
  it('folds diacritics instead of dropping the letter', () => {
    expect(normalizeTopicKey('São Paulo')).toBe('sao paulo')
    expect(normalizeTopicKey('Übergewicht & Adipositas')).toBe('ubergewicht and adipositas')
    expect(tokenizeTopicText('Übergewicht und Adipositas verstehen')).toContain('ubergewicht')
  })

  it('keeps letters of non-Latin scripts', () => {
    expect(tokenizeTopicText('עידוד להתמחות בהמטולוגיה')).toEqual(['עידוד', 'להתמחות', 'בהמטולוגיה'])
    expect(tokenizeTopicText('Квантовые материалы').length).toBe(2)
  })

  it('tokenizes plain English exactly as before', () => {
    expect(tokenizeTopicText('Cystic fibrosis clinical trials')).toEqual(['cystic', 'fibrosi', 'clinical', 'trial'])
  })
})
