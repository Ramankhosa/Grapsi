import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_GRANT_PIPELINE_PREFS,
  buildGrantPipelineStages,
  buildGrantPrepEntryUrl,
  buildGrantProjectOpenUrl,
  buildGrantWorkspaceUrl,
  normalizeGrantPipelinePrefs,
  resolveGrantPipelineEntryStage,
  resolveGrantWorkspaceStage,
  resolveGrantWorkspaceStageForGrantStatus,
  resolveGrantWorkspaceStageForPrepStatus,
  withGrantWorkspaceStage,
} from '@/lib/grants/workspaceNavigation'
import { resolveMutableGrantPrepStatus } from '@/lib/grantPrep/status'
import { draftingFilterMatches } from '@/components/stages/PaperVerticalStageNav'

describe('grant workspace navigation', () => {
  it('opens active prep sessions on GrantMentor and launched sessions on Blueprint', () => {
    expect(resolveGrantWorkspaceStageForPrepStatus('active')).toBe('GRANTMENTOR')
    expect(resolveGrantWorkspaceStageForPrepStatus('ready')).toBe('GRANTMENTOR')
    expect(resolveGrantWorkspaceStageForPrepStatus('launched')).toBe('BLUEPRINT')
    expect(resolveGrantWorkspaceStageForPrepStatus('handed_off')).toBe('BLUEPRINT')
  })

  it('maps grant session statuses onto the unified workspace stages', () => {
    expect(resolveGrantWorkspaceStageForGrantStatus('BLUEPRINT')).toBe('BLUEPRINT')
    expect(resolveGrantWorkspaceStageForGrantStatus('DRAFTING')).toBe('SECTION_DRAFTING')
    expect(resolveGrantWorkspaceStageForGrantStatus('REVIEW')).toBe('SECTION_DRAFTING')
    expect(resolveGrantWorkspaceStageForGrantStatus('PREP_OPTIONAL')).toBeNull()
    expect(resolveGrantWorkspaceStageForGrantStatus('SETUP')).toBeNull()
  })

  it('prefers concrete grant workspace progress over prep status', () => {
    expect(resolveGrantWorkspaceStage({
      prepStatus: 'launched',
      grantStatus: 'BLUEPRINT',
    })).toBe('BLUEPRINT')

    expect(resolveGrantWorkspaceStage({
      prepStatus: 'launched',
      grantStatus: 'DRAFTING',
    })).toBe('SECTION_DRAFTING')

    expect(resolveGrantWorkspaceStage({
      prepStatus: 'active',
      grantStatus: 'REVIEW',
    })).toBe('SECTION_DRAFTING')

    expect(resolveGrantWorkspaceStage({
      prepStatus: 'active',
      grantStatus: 'PREP_OPTIONAL',
    })).toBe('GRANTMENTOR')
  })

  it('builds canonical workspace links for pre-launch and launched sessions', () => {
    expect(buildGrantWorkspaceUrl({
      projectId: 'project-1',
      grantSessionId: 'grant-1',
      prepStatus: 'active',
    })).toBe('/projects/project-1/grants/grant-1/workspace?stage=GRANTMENTOR')

    expect(buildGrantWorkspaceUrl({
      projectId: 'project-1',
      grantSessionId: 'grant-1',
      prepStatus: 'launched',
    })).toBe('/projects/project-1/grants/grant-1/workspace?stage=BLUEPRINT')

    expect(buildGrantWorkspaceUrl({
      projectId: 'project-1',
      grantSessionId: 'grant-1',
      prepStatus: 'launched',
      grantStatus: 'BLUEPRINT',
    })).toBe('/projects/project-1/grants/grant-1/workspace?stage=BLUEPRINT')

    expect(buildGrantWorkspaceUrl({
      projectId: 'project-1',
      grantSessionId: 'grant-1',
      prepStatus: 'launched',
      grantStatus: 'DRAFTING',
    })).toBe('/projects/project-1/grants/grant-1/workspace?stage=SECTION_DRAFTING')
  })

  it('builds grant project open URLs from latest prep and grant metadata', () => {
    expect(buildGrantProjectOpenUrl({
      projectId: 'project-1',
      prepSession: {
        status: 'active',
        grant_session_id: 'grant-1',
      },
      grantSession: null,
    })).toBe('/projects/project-1/grants/grant-1/workspace?stage=GRANTMENTOR')

    expect(buildGrantProjectOpenUrl({
      projectId: 'project-1',
      prepSession: {
        status: 'launched',
        grant_session_id: 'grant-1',
      },
      grantSession: {
        id: 'grant-1',
        status: 'BLUEPRINT',
      },
    })).toBe('/projects/project-1/grants/grant-1/workspace?stage=BLUEPRINT')

    expect(buildGrantProjectOpenUrl({
      projectId: 'project-1',
      prepSession: {
        status: 'launched',
        grant_session_id: 'grant-1',
      },
      grantSession: {
        id: 'grant-1',
        status: 'REVIEW',
      },
    })).toBe('/projects/project-1/grants/grant-1/workspace?stage=SECTION_DRAFTING')

    expect(buildGrantProjectOpenUrl({
      projectId: 'project-1',
      prepSession: null,
      grantSession: null,
    })).toBeNull()

    expect(buildGrantProjectOpenUrl({
      projectId: 'project-1',
      prepSession: null,
      grantSession: {
        id: 'grant-1',
        status: 'PREP_OPTIONAL',
      },
    })).toBeNull()

    expect(buildGrantProjectOpenUrl({
      projectId: 'project-1',
      prepSession: null,
      grantSession: {
        id: 'grant-1',
        status: 'DRAFTING',
      },
    })).toBe('/projects/project-1/grants/grant-1/workspace?stage=SECTION_DRAFTING')
  })

  describe('grant prep entry routing', () => {
    afterEach(() => {
      vi.unstubAllEnvs()
    })

    it('defaults preparation entry to Draft Zero when enabled, Grant Prep otherwise', () => {
      expect(buildGrantPrepEntryUrl({ projectId: 'project-1', grantOrPrepSessionId: 'prep-1' }))
        .toBe('/projects/project-1/grants/prep-1/prep')

      vi.stubEnv('FEATURE_ENABLE_DRAFT_ZERO', 'true')
      expect(buildGrantPrepEntryUrl({ projectId: 'project-1', grantOrPrepSessionId: 'prep-1' }))
        .toBe('/projects/project-1/grants/prep-1/draft-zero')
    })

    it('opens pre-launch grant projects on Draft Zero when enabled', () => {
      vi.stubEnv('FEATURE_ENABLE_DRAFT_ZERO', 'true')
      expect(buildGrantProjectOpenUrl({
        projectId: 'project-1',
        prepSession: {
          status: 'active',
          grant_session_id: 'grant-1',
        },
        grantSession: null,
      })).toBe('/projects/project-1/grants/grant-1/draft-zero')

      // Launched sessions keep opening on their workspace stage.
      expect(buildGrantProjectOpenUrl({
        projectId: 'project-1',
        prepSession: {
          status: 'launched',
          grant_session_id: 'grant-1',
        },
        grantSession: {
          id: 'grant-1',
          status: 'BLUEPRINT',
        },
      })).toBe('/projects/project-1/grants/grant-1/workspace?stage=BLUEPRINT')
    })
  })

  it('replaces an existing workspace stage query parameter', () => {
    expect(withGrantWorkspaceStage(
      '/projects/project-1/grants/grant-1/workspace?stage=GRANTMENTOR&foo=bar',
      'BLUEPRINT'
    )).toBe('/projects/project-1/grants/grant-1/workspace?stage=BLUEPRINT&foo=bar')
  })

  it('preserves launched prep status while allowing post-launch edits', () => {
    expect(resolveMutableGrantPrepStatus({ currentStatus: 'launched', isReady: false })).toBe('launched')
    expect(resolveMutableGrantPrepStatus({ currentStatus: 'handed_off', isReady: true })).toBe('handed_off')
    expect(resolveMutableGrantPrepStatus({ currentStatus: 'active', isReady: true })).toBe('ready')
    expect(resolveMutableGrantPrepStatus({ currentStatus: 'ready', isReady: false })).toBe('active')
  })

  it('includes structured budget sections in the App drafting filter', () => {
    const budgetSection = {
      key: 'budget',
      workflowMode: 'team_manual',
      sectionType: 'budget_rows',
      dimensions: [],
    }

    expect(draftingFilterMatches(budgetSection, 'all')).toBe(true)
    expect(draftingFilterMatches(budgetSection, 'app_draft')).toBe(true)
  })

  it('includes bibliography in App drafting', () => {
    const bibliographySection = {
      key: 'bibliography',
      workflowMode: 'app_draft',
      sectionType: 'narrative',
      dimensions: ['background'],
    }

    expect(draftingFilterMatches(bibliographySection, 'all')).toBe(true)
    expect(draftingFilterMatches(bibliographySection, 'app_draft')).toBe(true)
  })
})

describe('grant pipeline route', () => {
  it('builds the streamlined route from the author\'s opt-ins', () => {
    expect(buildGrantPipelineStages({ literatureSearch: true, deepAnalysis: true })).toEqual([
      'LITERATURE_SEARCH',
      'FULL_TEXT_EVIDENCE_EXTRACTION',
      'SECTION_DRAFTING',
      'REVIEWER',
    ])

    expect(buildGrantPipelineStages({ literatureSearch: true, deepAnalysis: false })).toEqual([
      'LITERATURE_SEARCH',
      'SECTION_DRAFTING',
      'REVIEWER',
    ])

    expect(buildGrantPipelineStages({ literatureSearch: false, deepAnalysis: false })).toEqual([
      'SECTION_DRAFTING',
      'REVIEWER',
    ])
  })

  it('never routes to deep analysis without literature search', () => {
    // Deep analysis reads the papers literature search mapped, so it cannot
    // stand alone even if a stored payload claims otherwise.
    expect(normalizeGrantPipelinePrefs({ literatureSearch: false, deepAnalysis: true })).toEqual({
      literatureSearch: false,
      deepAnalysis: false,
    })

    expect(buildGrantPipelineStages({ literatureSearch: false, deepAnalysis: true })).toEqual([
      'SECTION_DRAFTING',
      'REVIEWER',
    ])
  })

  it('lands the launch on the first stage of the chosen route', () => {
    expect(resolveGrantPipelineEntryStage({ literatureSearch: true, deepAnalysis: false })).toBe('LITERATURE_SEARCH')
    expect(resolveGrantPipelineEntryStage({ literatureSearch: false, deepAnalysis: false })).toBe('SECTION_DRAFTING')
  })

  it('reports no prefs for grants launched before the route existed', () => {
    // Null keeps the workspace on the legacy full stage rail instead of hiding
    // stages an older grant still depends on.
    expect(normalizeGrantPipelinePrefs(undefined)).toBeNull()
    expect(normalizeGrantPipelinePrefs(null)).toBeNull()
    expect(normalizeGrantPipelinePrefs({})).toBeNull()
    expect(normalizeGrantPipelinePrefs('literature')).toBeNull()
    expect(normalizeGrantPipelinePrefs([true, false])).toBeNull()
  })

  it('defaults to searching citations before drafting', () => {
    expect(DEFAULT_GRANT_PIPELINE_PREFS).toEqual({ literatureSearch: true, deepAnalysis: false })
    expect(resolveGrantPipelineEntryStage(DEFAULT_GRANT_PIPELINE_PREFS)).toBe('LITERATURE_SEARCH')
  })
})
