import { describe, expect, it } from 'vitest'

import {
  buildGrantProjectOpenUrl,
  buildGrantWorkspaceUrl,
  resolveGrantWorkspaceStage,
  resolveGrantWorkspaceStageForGrantStatus,
  resolveGrantWorkspaceStageForPrepStatus,
  withGrantWorkspaceStage,
} from '@/lib/grants/workspaceNavigation'
import { resolveMutableGrantPrepStatus } from '@/lib/grantPrep/status'
import { draftingFilterMatches } from '@/components/stages/PaperVerticalStageNav'

describe('grant workspace navigation', () => {
  it('opens active prep sessions on GrantMentor and launched sessions on Section Drafting', () => {
    expect(resolveGrantWorkspaceStageForPrepStatus('active')).toBe('GRANTMENTOR')
    expect(resolveGrantWorkspaceStageForPrepStatus('ready')).toBe('GRANTMENTOR')
    expect(resolveGrantWorkspaceStageForPrepStatus('launched')).toBe('SECTION_DRAFTING')
    expect(resolveGrantWorkspaceStageForPrepStatus('handed_off')).toBe('SECTION_DRAFTING')
  })

  it('maps grant session statuses onto the unified workspace stages', () => {
    expect(resolveGrantWorkspaceStageForGrantStatus('BLUEPRINT')).toBe('SECTION_DRAFTING')
    expect(resolveGrantWorkspaceStageForGrantStatus('DRAFTING')).toBe('SECTION_DRAFTING')
    expect(resolveGrantWorkspaceStageForGrantStatus('REVIEW')).toBe('SECTION_DRAFTING')
    expect(resolveGrantWorkspaceStageForGrantStatus('PREP_OPTIONAL')).toBeNull()
    expect(resolveGrantWorkspaceStageForGrantStatus('SETUP')).toBeNull()
  })

  it('prefers concrete grant workspace progress over prep status', () => {
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
    })).toBe('/projects/project-1/grants/grant-1/workspace?stage=SECTION_DRAFTING')

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
    })).toBe('/projects/project-1/grants/grant-1/workspace?stage=SECTION_DRAFTING')

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
