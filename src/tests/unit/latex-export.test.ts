import { describe, expect, it } from 'vitest'

import { buildLatexExport } from '@/lib/export/latex-export'

describe('latex-export', () => {
  it('uses IEEE-specific front matter without injecting multicol', () => {
    const result = buildLatexExport({
      title: 'Adaptive Export Test',
      sections: [
        { key: 'introduction', title: 'Introduction', content: 'Body [CITE:test2024].' },
      ],
      formatting: {
        documentClass: 'IEEEtran',
        documentClassOptions: ['conference'],
        columnLayout: 2,
        fontSizePt: 10,
        citationCommand: '\\cite',
      },
    })

    expect(result.latex).toContain('\\documentclass[10pt,conference]{IEEEtran}')
    expect(result.latex).toContain('\\IEEEauthorblockN{Generated Manuscript}\\\\')
    expect(result.latex).toContain('\\IEEEauthorblockA{Papsi Export}')
    expect(result.latex).not.toContain('\\begin{multicols}{2}')
  })

  it('adds a warning comment for custom document classes', () => {
    const result = buildLatexExport({
      title: 'Custom Template',
      sections: [],
      formatting: {
        documentClass: 'custom',
      },
    })

    expect(result.latex).toContain('% WARNING: custom export class uses generic front matter')
    expect(result.latex).toContain('\\documentclass[12pt]{custom}')
  })
})
