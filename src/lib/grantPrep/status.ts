import type { GrantPrepStatus } from '@/lib/grantPrep/types'

export function isPostLaunchGrantPrepStatus(status?: string | null) {
  return status === 'launched' || status === 'handed_off'
}

export function resolveMutableGrantPrepStatus(input: {
  currentStatus?: string | null
  isReady: boolean
}): GrantPrepStatus {
  if (isPostLaunchGrantPrepStatus(input.currentStatus)) {
    return input.currentStatus as GrantPrepStatus
  }

  return input.isReady ? 'ready' : 'active'
}
