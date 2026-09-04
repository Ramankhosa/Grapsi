import Anthropic from '@anthropic-ai/sdk'

export type ExtractedOpportunity = {
  title: string
  funder?: string
  deadline?: string
  amount?: string
  link?: string
  eligibility?: string
}

export type TriageResult = {
  verdict: 'NEW_OPPORTUNITY' | 'UPDATE' | 'COSMETIC' | 'UNKNOWN'
  confidence: number
  opportunities: ExtractedOpportunity[]
  summary: string
}

/**
 * Deliberately calls the Anthropic SDK directly rather than going through the
 * metering provider stack: triage is platform infrastructure that runs on the
 * central watch list, not a tenant's billable action, so it must not draw down
 * a tenant quota. It also only runs on pages that actually changed, which
 * keeps the spend to pennies a day across hundreds of sources.
 */
const SYSTEM_PROMPT = `You triage webpage changes for a university funding office. You are shown the diff of a monitored funding-source page. Decide whether the change announces a genuinely new funding opportunity (grant, fellowship, call for proposals, scheme), an update to an existing one (e.g. deadline extension), or is cosmetic noise.

Respond with ONLY a JSON object, no other text:
{
  "verdict": "NEW_OPPORTUNITY" | "UPDATE" | "COSMETIC",
  "confidence": 0.0-1.0,
  "summary": "one sentence describing what changed",
  "opportunities": [
    {
      "title": "...",
      "funder": "..." or null,
      "deadline": "..." or null,
      "amount": "..." or null,
      "link": "https://..." or null,
      "eligibility": "..." or null
    }
  ]
}

"opportunities" lists each new or updated funding opportunity visible in the added lines (empty array for COSMETIC). Extract only what the diff actually shows — never invent deadlines, amounts, or links. Links in the diff appear as "text — url"; use the url part.`

export async function triageChange(input: {
  sourceName: string
  sourceUrl: string
  keywords: string
  added: string
  removed: string
}): Promise<TriageResult | null> {
  const apiKey = process.env.MONITOR_TRIAGE_API_KEY || process.env.ANTHROPIC_API_KEY
  if (!apiKey) return null

  const client = new Anthropic({ apiKey })
  const model = process.env.MONITOR_TRIAGE_MODEL || 'claude-haiku-4-5'

  const userMessage = [
    `Monitored source: ${input.sourceName}`,
    `URL: ${input.sourceUrl}`,
    input.keywords ? `Priority keywords: ${input.keywords}` : null,
    ``,
    `--- LINES ADDED ---`,
    input.added.slice(0, 8000) || '(none)',
    ``,
    `--- LINES REMOVED ---`,
    input.removed.slice(0, 4000) || '(none)',
  ]
    .filter((line) => line !== null)
    .join('\n')

  try {
    const response = await client.messages.create({
      model,
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    })

    let text = ''
    for (const block of response.content) {
      if (block.type === 'text') text += block.text
    }
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null
    const parsed = JSON.parse(jsonMatch[0])

    const verdict = ['NEW_OPPORTUNITY', 'UPDATE', 'COSMETIC'].includes(parsed.verdict)
      ? parsed.verdict
      : 'UNKNOWN'
    const opportunities: ExtractedOpportunity[] = Array.isArray(parsed.opportunities)
      ? parsed.opportunities
          .filter(
            (o: unknown) =>
              o && typeof o === 'object' && typeof (o as { title?: unknown }).title === 'string'
          )
          .map((o: Record<string, unknown>) => ({
            title: String(o.title).slice(0, 300),
            funder: o.funder ? String(o.funder).slice(0, 200) : undefined,
            deadline: o.deadline ? String(o.deadline).slice(0, 100) : undefined,
            amount: o.amount ? String(o.amount).slice(0, 100) : undefined,
            link: o.link ? String(o.link).slice(0, 1000) : undefined,
            eligibility: o.eligibility ? String(o.eligibility).slice(0, 500) : undefined,
          }))
      : []

    return {
      verdict,
      confidence:
        typeof parsed.confidence === 'number' ? Math.min(1, Math.max(0, parsed.confidence)) : 0.5,
      opportunities,
      summary: typeof parsed.summary === 'string' ? parsed.summary.slice(0, 500) : '',
    }
  } catch (error) {
    console.error('[monitor] triage failed:', error instanceof Error ? error.message : error)
    return null
  }
}
