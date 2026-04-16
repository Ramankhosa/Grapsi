import { describe, expect, it } from 'vitest'

import {
  normalizeExportProfile,
  normalizeExportProfilePartial,
  SYSTEM_DEFAULTS,
} from '@/lib/export/export-profile-schema'

describe('export-profile-schema', () => {
  it('clamps unsafe numeric values and normalizes unknown fonts', () => {
    const profile = normalizeExportProfilePartial({
      fontFamily: 'Unknown Serif',
      fontSizePt: 72,
      lineSpacing: 0,
      margins: {
        topCm: 0.1,
        bottomCm: 9,
        leftCm: 2,
        rightCm: 2,
      },
    })

    expect(profile.fontFamily).toBe('Times New Roman')
    expect(profile.fontSizePt).toBe(24)
    expect(profile.lineSpacing).toBe(0.5)
    expect(profile.margins?.topCm).toBe(0.5)
    expect(profile.margins?.bottomCm).toBe(5)
    expect(profile.fieldConfidences?.fontFamily).toBe(0.3)
  })

  it('fills missing fields from system defaults and normalizes citation styles', () => {
    const profile = normalizeExportProfile({
      citationStyle: 'apa',
    })

    expect(profile.citationStyle).toBe('APA7')
    expect(profile.bibliographyStyle).toBe('apalike')
    expect(profile.citationCommand).toBe('\\citep')
    expect(profile.documentClass).toBe(SYSTEM_DEFAULTS.documentClass)
    expect(profile.pageSize).toBe(SYSTEM_DEFAULTS.pageSize)
  })
})
