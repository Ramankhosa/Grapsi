import { assertLegacyEngine } from './engine'

export type ExtractedOpportunity = {
  title: string; funder?: string; deadline?: string; amount?: string; link?: string; eligibility?: string
}
export type TriageResult = {
  verdict: 'NEW_OPPORTUNITY' | 'UPDATE' | 'COSMETIC' | 'UNKNOWN'
  confidence: number; opportunities: ExtractedOpportunity[]; summary: string
}
/** Legacy rollback records diffs for human review and never makes paid calls. */
export async function triageChange(_input: {
  sourceName: string; sourceUrl: string; keywords: string; added: string; removed: string
}): Promise<TriageResult | null> {
  assertLegacyEngine('Legacy source triage')
  return null
}
