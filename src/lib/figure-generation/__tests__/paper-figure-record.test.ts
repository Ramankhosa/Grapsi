import { describe, expect, it } from 'vitest'

import {
  getPaperFigureCaption,
  getPaperFigureGenerationPrompt,
  getPaperFigureImageVersion,
  getPaperFigureSafeDescription,
} from '../paper-figure-record'

describe('paper figure record helpers', () => {
  it('separates leaked generation prompts from captions', () => {
    const meta = {
      category: 'ILLUSTRATED_FIGURE',
      caption: 'Show a pipeline with 5 stages',
      generationPrompt: 'Show a pipeline with 5 stages',
      suggestionMeta: {
        illustrationSpecV2: {
          captionDraft: 'Five-stage experimental pipeline.',
        },
      },
    }

    expect(getPaperFigureGenerationPrompt(meta, 'Show a pipeline with 5 stages')).toBe('Show a pipeline with 5 stages')
    expect(getPaperFigureCaption(meta, 'Show a pipeline with 5 stages')).toBe('Five-stage experimental pipeline.')
    expect(getPaperFigureSafeDescription(meta, 'Show a pipeline with 5 stages')).toBe('Five-stage experimental pipeline.')
  })

  it('falls back to inferred summaries for safe captions', () => {
    const meta = {
      category: 'DIAGRAM',
      inferredImageMeta: {
        summary: 'System architecture linking ingestion, ranking, and export modules.',
      },
    }

    expect(getPaperFigureCaption(meta, '')).toBe('System architecture linking ingestion, ranking, and export modules.')
    expect(getPaperFigureSafeDescription(meta, '')).toBe('System architecture linking ingestion, ranking, and export modules.')
  })

  it('prefers checksum then generatedAt when deriving image versions', () => {
    expect(getPaperFigureImageVersion({ checksum: 'abc123', generatedAt: 'older' }, '/uploads/a.png')).toBe('abc123')
    expect(getPaperFigureImageVersion({ generatedAt: '2026-03-11T12:00:00.000Z' }, '/uploads/a.png')).toBe('2026-03-11T12:00:00.000Z')
    expect(getPaperFigureImageVersion({}, '/uploads/a.png')).toBe('/uploads/a.png')
  })
})
