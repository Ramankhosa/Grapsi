import type { FundingActor } from '@/lib/funding/access'

import { toFundingOperator } from './auth'
import type { IntakeOperator } from './types'

export async function requireFundingImporter(actor: FundingActor, _unused?: unknown): Promise<IntakeOperator | null> {
  return toFundingOperator(actor)
}
