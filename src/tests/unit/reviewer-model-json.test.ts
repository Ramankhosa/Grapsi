import { describe, expect, it } from 'vitest'

import {
  hasUsableKeys,
  looksTruncated,
  parseReviewerModelJson,
  repairTruncatedJson,
  ReviewerModelJsonError,
} from '@/lib/reviewer/modelJson'

describe('parseReviewerModelJson', () => {
  it('parses a bare object', () => {
    const { value, repaired } = parseReviewerModelJson('{"score": 7.5, "summary": "Solid."}')
    expect(value.score).toBe(7.5)
    expect(repaired).toBe(false)
  })

  it('parses a fenced object', () => {
    const raw = '```json\n{"score": 6}\n```'
    expect(parseReviewerModelJson(raw).value.score).toBe(6)
  })

  it('parses a fence whose language tag is uppercase and unpadded', () => {
    const raw = '```JSON{"score": 6}```'
    expect(parseReviewerModelJson(raw).value.score).toBe(6)
  })

  it('parses an object introduced by prose', () => {
    const raw = 'Here is the review you asked for:\n\n{"score": 8, "summary": "Good."}\n\nHope that helps.'
    expect(parseReviewerModelJson(raw).value.score).toBe(8)
  })

  it('tolerates a trailing comma', () => {
    const raw = '{"strengths": ["a", "b",], "score": 5,}'
    const { value } = parseReviewerModelJson(raw)
    expect(value.strengths).toEqual(['a', 'b'])
    expect(value.score).toBe(5)
  })

  it('recovers a reply cut off part-way through an array', () => {
    // What a revision review looks like when it runs out of output budget.
    const raw = `{
      "score": 7,
      "summary": "The revision answers most of the earlier remarks.",
      "addressed_previous_points": [
        {"point": "No power calculation", "status": "addressed", "evidence": "Section 3.2"},
        {"point": "Budget unjustified", "status": "partially", "evidence": "Table 4 lists`
    const { value, repaired } = parseReviewerModelJson(raw)
    expect(repaired).toBe(true)
    expect(value.score).toBe(7)
    // The first point survives whole; the second keeps the fields the model
    // finished writing and loses only the evidence it was cut off inside.
    expect(value.addressed_previous_points).toHaveLength(2)
    expect(value.addressed_previous_points[0].point).toBe('No power calculation')
    expect(value.addressed_previous_points[1]).toEqual({
      point: 'Budget unjustified',
      status: 'partially',
    })
  })

  it('recovers a reply cut off inside an unterminated code fence', () => {
    const raw = '```json\n{"score": 4, "weaknesses": ["Vague objectives", "No timeline'
    const { value, repaired } = parseReviewerModelJson(raw)
    expect(repaired).toBe(true)
    expect(value.score).toBe(4)
    expect(value.weaknesses).toEqual(['Vague objectives'])
  })

  it('keeps completed nested objects when the cut lands after them', () => {
    const raw = '{"a": {"b": 1}, "c": [1, 2], "d": "unfinis'
    const { value } = parseReviewerModelJson(raw)
    expect(value).toEqual({ a: { b: 1 }, c: [1, 2] })
  })

  it('does not mistake a brace inside a string for structure', () => {
    const raw = '{"summary": "Uses the phrase {objectives} verbatim", "score": 3}'
    expect(parseReviewerModelJson(raw).value.summary).toBe('Uses the phrase {objectives} verbatim')
  })

  it('throws with truncated=true when nothing survives the cut', () => {
    let thrown: unknown
    try {
      parseReviewerModelJson('The reviewer notes that the proposal is')
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(ReviewerModelJsonError)
  })

  it('throws on an empty reply without claiming truncation', () => {
    expect(() => parseReviewerModelJson('   ')).toThrow(ReviewerModelJsonError)
    try {
      parseReviewerModelJson('')
    } catch (error) {
      expect((error as ReviewerModelJsonError).truncated).toBe(false)
    }
  })
})

describe('repairTruncatedJson', () => {
  it('returns null when there is no complete value to keep', () => {
    expect(repairTruncatedJson('not json at all')).toBeNull()
  })

  it('salvages an empty object from a reply cut inside its first value', () => {
    expect(repairTruncatedJson('{"executive_summary": "The proposal des')).toBe('{}')
  })
})

describe('looksTruncated', () => {
  it('is true for an unclosed structure', () => {
    expect(looksTruncated('{"a": [1, 2')).toBe(true)
  })

  it('is true for an unterminated string', () => {
    expect(looksTruncated('{"a": "unfinished')).toBe(true)
  })

  it('is false for a complete object', () => {
    expect(looksTruncated('{"a": [1, 2]}')).toBe(false)
  })
})

describe('hasUsableKeys', () => {
  it('rejects the empty salvage', () => {
    expect(hasUsableKeys({}, ['score', 'summary'])).toBe(false)
  })

  it('accepts an object carrying one of the required keys', () => {
    expect(hasUsableKeys({ score: 6 }, ['score', 'summary'])).toBe(true)
  })

  it('treats a blank string as missing', () => {
    expect(hasUsableKeys({ summary: '   ' }, ['summary'])).toBe(false)
  })

  it('treats a zero score as present', () => {
    expect(hasUsableKeys({ score: 0 }, ['score'])).toBe(true)
  })
})
