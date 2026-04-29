import { describe, expect, it } from 'vitest'

import {
  buildGrantWorkspaceUrl,
  resolveGrantWorkspaceStageForPrepStatus,
  withGrantWorkspaceStage,
} from '@/lib/grants/workspaceNavigation'
import { resolveMutableGrantPrepStatus } from '@/lib/grantPrep/status'

describe('grant workspace navigation', () => {
  it('opens active prep sessions on GrantMentor and launched sessions on Blueprint', () => {
    expect(resolveGrantWorkspaceStageForPrepStatus('active')).toBe('GRANTMENTOR')
    expect(resolveGrantWorkspaceStageForPrepStatus('ready')).toBe('GRANTMENTOR')
    expect(resolveGrantWorkspaceStageForPrepStatus('launched')).toBe('BLUEPRINT')
    expect(resolveGrantWorkspaceStageForPrepStatus('handed_off')).toBe('BLUEPRINT')
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
})
