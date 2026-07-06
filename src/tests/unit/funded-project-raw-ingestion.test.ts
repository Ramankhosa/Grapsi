import { describe, expect, it } from 'vitest'

import {
  FUNDED_PROJECT_RAW_SOURCE_NAMES,
  __fundedProjectRawIngestionTestables,
} from '@/lib/fundedProjects/rawIngestion'

describe('funded project raw ingestion helpers', () => {
  it('exposes the top five funded-project raw source names', () => {
    expect(FUNDED_PROJECT_RAW_SOURCE_NAMES).toEqual([
      'NIH_REPORTER',
      'NSF_AWARD_SEARCH',
      'CORDIS',
      'UKRI_GTR',
      'NWO_NWOPEN',
    ])
  })

  it('extracts CORDIS project hits from singleton and array response shapes', () => {
    expect(
      __fundedProjectRawIngestionTestables.cordisHits({
        result: { hits: { hit: { project: { id: '101', title: 'One project' } } } },
      })
    ).toEqual([{ id: '101', title: 'One project' }])

    expect(
      __fundedProjectRawIngestionTestables.cordisHits({
        result: { hits: { hit: [{ project: { id: '102' } }, { project: { id: '103' } }] } },
      })
    ).toEqual([{ id: '102' }, { id: '103' }])
  })

  it('extracts UKRI lead institution and award reference without normalizing the raw record', () => {
    const project = {
      identifiers: { identifier: [{ type: 'OTHER', value: 'x' }, { type: 'RCUK', value: 'EP/Y000001/1' }] },
      participantValues: {
        participant: [
          { role: 'COLLABORATOR', organisationName: 'Partner University' },
          { role: 'LEAD_PARTICIPANT', organisationName: 'Lead University' },
        ],
      },
    }

    expect(__fundedProjectRawIngestionTestables.ukriReference(project)).toBe('EP/Y000001/1')
    expect(__fundedProjectRawIngestionTestables.ukriLeadInstitution(project)).toBe('Lead University')
  })
})
