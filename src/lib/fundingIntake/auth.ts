import type { FundingActor } from '@/lib/funding/access'

import type { IntakeOperator } from './types'

function mapOperatorRole(actor: FundingActor): IntakeOperator['role'] | null {
  if (actor.isSuperAdminWriter) {
    return 'ADMIN'
  }

  if (actor.isSuperAdmin) {
    return 'CURATOR'
  }

  if (actor.tenantId) {
    return 'USER'
  }

  return null
}

export function toFundingOperator(actor: FundingActor): IntakeOperator | null {
  const role = mapOperatorRole(actor)
  if (!role) {
    return null
  }

  return {
    userId: actor.id,
    email: actor.email,
    role,
  }
}

export async function requireFundingOperator(actor: FundingActor, _unused?: unknown): Promise<IntakeOperator | null> {
  return toFundingOperator(actor)
}
