import { reviewResponseSchema, REVIEW_SYSTEM_PROMPT } from './aiReviewPolicy'

export const DEFAULT_REVIEW_MODEL = 'gpt-5.4-mini'
export const REVIEW_MODELS = [
  { id: 'gpt-5.4-mini', name: 'GPT-5.4 mini', provider: 'OpenAI', description: 'Recommended balance of review quality and cost', inputRate: 0.75, outputRate: 4.50, maxOutput: 8192 },
  { id: 'gpt-5-mini', name: 'GPT-5 mini', provider: 'OpenAI', description: 'Legacy economy option (deprecated); use only while account access remains available', inputRate: 0.25, outputRate: 2.00, maxOutput: 8192 },
] as const
export function reviewModel(id: string) {
  const model = REVIEW_MODELS.find(m => m.id === id)
  if (!model) throw new Error('Select a supported review model')
  return model
}
let discovery: { until: number; ids: Set<string> } | undefined
export async function availableReviewModels() {
  if (!process.env.OPENAI_API_KEY) return REVIEW_MODELS.map(m => ({ ...m, available: false }))
  if (!discovery || discovery.until < Date.now()) {
    const response = await fetch('https://api.openai.com/v1/models', { headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, signal: AbortSignal.timeout(15000) })
    if (!response.ok) throw new Error('Could not verify model availability with OpenAI. Try again shortly.')
    const body = await response.json()
    discovery = { until: Date.now() + 120000, ids: new Set((body.data || []).map((m: any) => m.id)) }
  }
  return REVIEW_MODELS.map(m => ({ ...m, available: discovery!.ids.has(m.id) }))
}
export function strictReviewSchema(schema: any = reviewResponseSchema): any {
  const out: any = { ...schema, type: schema.type.toLowerCase() }
  if (schema.properties) {
    out.properties = Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => [key, strictReviewSchema(value)]))
    out.additionalProperties = false
  }
  if (schema.items) out.items = strictReviewSchema(schema.items)
  return out
}
export function openAiReviewRequest(modelId: string, snapshot: unknown, previousError?: string | null) {
  const model = reviewModel(modelId)
  return {
    model: model.id, reasoning_effort: 'medium', max_completion_tokens: model.maxOutput,
    messages: [
      { role: 'developer', content: REVIEW_SYSTEM_PROMPT },
      ...(previousError ? [{ role: 'developer', content: `A previous attempt failed validation: ${previousError.slice(0, 500)}. Correct that issue using exact stored evidence; never invent missing text.` }] : []),
      { role: 'user', content: JSON.stringify(snapshot) },
    ],
    response_format: { type: 'json_schema', json_schema: { name: 'catalog_conflict_review', strict: true, schema: strictReviewSchema() } },
  }
}
