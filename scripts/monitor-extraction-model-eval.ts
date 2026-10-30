/**
 * Replays recent gpt-5.2 Source Watch extractions against cheaper models on the identical
 * evidence and scores every answer with the production checker (validateExtraction +
 * extractionQuality). The evidence is rebuilt from stored page versions and accepted only
 * when its fingerprint equals the cache key of the original extraction.
 *
 * Read-only on the database. The only spend is the candidate models' own calls, which are
 * made directly and are NOT booked in the Source Watch budget (about 0.3-1¢ each).
 *
 *   tsx scripts/monitor-extraction-model-eval.ts [--limit 15] [--models a,b+thinking] [--out file.json]
 */
import dotenv from 'dotenv'
import { writeFileSync } from 'node:fs'
dotenv.config()

const arg = (name: string, fallback: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback }
const KEY_FIELDS = ['scheme_title', 'agency_name', 'open_date', 'close_date', 'is_rolling', 'amount_min', 'amount_max', 'currency']
const same = (a: unknown, b: unknown) => JSON.stringify(typeof a === 'string' ? a.trim().toLowerCase() : a) === JSON.stringify(typeof b === 'string' ? b.trim().toLowerCase() : b)

async function main() {
  const limit = Number(arg('limit', '15'))
  const models = arg('models', 'deepseek-v4-pro+thinking,deepseek-v4-pro,deepseek-v4-flash+thinking').split(',').map(s => s.trim()).filter(Boolean)
  const out = arg('out', '/tmp/extraction-model-eval.json')
  const { prisma } = await import('../src/lib/prisma')
  const { segmentsFromVersion } = await import('../src/lib/monitor/content')
  const { evidenceFingerprint, renderEvidence } = await import('../src/lib/monitor/evidence')
  const { EXTRACT_VERSION, EXTRACTION_JSON_SCHEMA, EXTRACTION_SYSTEM_PROMPT, extractionPrompt, validateExtraction } = await import('../src/lib/monitor/extract')
  const { EXTRACTION_SCHEMA, REQUIRED_FIELDS, extractionQuality } = await import('../src/lib/monitor/extractionContract')
  const { ROUTING_POLICY_VERSION, jsonResponseText, paidPromptText } = await import('../src/lib/monitor/paidCall')
  // Called directly: the API takes `thinking` as a top-level field, which the provider cannot send yet.
  const OpenAI = (await import('openai')).default
  const client = new OpenAI({ apiKey: process.env.DEEPSEEK_API_KEY, baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com' })
  const prices = new Map((await prisma.lLMModel.findMany({ where: { code: { in: ['gpt-5.2', ...models.map(m => m.split('+')[0])] } } })).map(m => [m.code, m]))

  type Validated = ReturnType<typeof validateExtraction>
  const score = (v: Validated) => {
    const hard = v.conflicts.filter(c => [...REQUIRED_FIELDS, 'open_date', 'close_date', 'is_rolling'].some(k => c === `Unsupported or invalid ${k}`))
    const fields = v.payload.fields as Record<string, { value: unknown; status: string }>
    return { quality: extractionQuality(v.payload, v.coverage, v.invitationVerified, hard).state, hard, supported: Object.values(fields).filter(f => f.status === 'supported').length, invitation: v.invitationVerified, values: Object.fromEntries(KEY_FIELDS.map(k => [k, fields[k]?.status === 'supported' ? fields[k].value : null])) }
  }

  try {
    const attempts = await prisma.monitorLlmAttempt.findMany({ where: { stage: 'FUNDING_SOURCE_EXTRACT', model: 'gpt-5.2', status: { in: ['SUCCEEDED', 'FAILED_BILLABLE'] } }, orderBy: { created_at: 'desc' }, take: 300 })
    const samples: Array<{ cacheKey: string; text: string; costCents: number }> = []
    for (const a of attempts) {
      const text = (a.usage as { outputText?: string } | null)?.outputText
      const cacheKey = a.operation_key.replace(/^extract:/, '').replace(/:second$/, '')
      if (text && a.operation_key.startsWith('extract:') && !samples.some(s => s.cacheKey === cacheKey)) samples.push({ cacheKey, text, costCents: Number(a.actual_cost_micros ?? 0n) / 10000 })
    }
    const rows: Array<Record<string, unknown>> = []
    let skipped = 0
    for (const sample of samples) {
      if (rows.length >= limit) break
      const opportunity = await prisma.monitorOpportunity.findFirst({ where: { field_evidence: { path: ['cacheKey'], equals: sample.cacheKey } }, include: { primary_resource: true } })
      if (!opportunity?.drafted_from_version_ids.length) { skipped++; continue }
      const versions = await prisma.monitorResourceVersion.findMany({ where: { id: { in: opportunity.drafted_from_version_ids } } })
      const resources = await prisma.monitorResource.findMany({ where: { id: { in: versions.map(v => v.resource_id) } } })
      const segments = opportunity.drafted_from_version_ids.flatMap(id => {
        const version = versions.find(v => v.id === id); const resource = version && resources.find(r => r.id === version.resource_id)
        return version && resource ? segmentsFromVersion(resource, version) : []
      })
      // Only an exact rebuild of the original input is a fair comparison.
      if (evidenceFingerprint(segments, { prompt: EXTRACT_VERSION, schema: EXTRACTION_SCHEMA, routing: ROUTING_POLICY_VERSION, funder: opportunity.funder_id, updateContext: null }) !== sample.cacheKey) { skipped++; continue }
      const bundle = renderEvidence(segments)
      let gptParsed: unknown = null
      try { gptParsed = JSON.parse(jsonResponseText(sample.text)) } catch { /* scored as unparsable */ }
      const gpt = gptParsed ? score(validateExtraction(gptParsed, bundle.segments)) : null
      const fullPrompt = paidPromptText({ systemPrompt: EXTRACTION_SYSTEM_PROMPT, prompt: extractionPrompt(bundle, null), jsonSchema: EXTRACTION_JSON_SCHEMA })
      const host = (() => { try { return new URL(opportunity.primary_resource?.canonical_url ?? '').host } catch { return '?' } })()
      const results = await Promise.all(models.map(async spec => {
        const [code, mode] = spec.split('+')
        const thinking = mode === 'thinking'
        const started = Date.now()
        const call = async (responseFormat: unknown) => {
          const r = await client.chat.completions.create({ model: code, messages: [{ role: 'user', content: fullPrompt }], temperature: 0, max_tokens: thinking ? 16000 : 6000, response_format: responseFormat, thinking: { type: thinking ? 'enabled' : 'disabled' } } as never) as any
          const u = r.usage ?? {}
          return { output: r.choices?.[0]?.message?.content ?? '', metadata: { inputTokens: u.prompt_tokens, outputTokens: u.completion_tokens, thoughtTokens: 0, finishReason: r.choices?.[0]?.finish_reason } }
        }
        let format = 'json_schema'
        try {
          let response
          try { response = await call({ type: 'json_schema', json_schema: { name: EXTRACTION_JSON_SCHEMA.name, schema: EXTRACTION_SCHEMA, strict: true } }) }
          catch (error) { if (!/response_format|json_schema|schema/i.test(String((error as Error)?.message))) throw error; format = 'json_object'; response = await call({ type: 'json_object' }) }
          const meta = (response.metadata ?? {}) as { inputTokens?: number; outputTokens?: number; thoughtTokens?: number; finishReason?: string }
          const price = prices.get(code)
          const costCents = price ? ((meta.inputTokens ?? 0) * price.inputCostPer1M + ((meta.outputTokens ?? 0) + (meta.thoughtTokens ?? 0)) * price.outputCostPer1M) / 1e6 : null
          let parsed: unknown = null
          try { parsed = JSON.parse(jsonResponseText(String(response.output ?? ''))) } catch { /* unparsable */ }
          return { model: spec, format, seconds: (Date.now() - started) / 1000, costCents, tokens: meta, finish: meta.finishReason, parsed: Boolean(parsed), raw: String(response.output ?? '').slice(0, 4000), ...(parsed ? score(validateExtraction(parsed, bundle.segments)) : {}) }
        } catch (error) { return { model: spec, error: String((error as Error)?.message ?? error).slice(0, 200), seconds: (Date.now() - started) / 1000 } }
      }))
      rows.push({ opportunityId: opportunity.id, host, title: opportunity.title, gpt: gpt && { ...gpt, costCents: sample.costCents }, results })
      console.log(`${rows.length}. ${host.padEnd(28)} gpt-5.2 ${gpt ? `${gpt.quality.padEnd(12)} ${String(gpt.supported).padStart(2)} fields ${gpt.hard.length} hard` : 'unparsable'}  ${sample.costCents.toFixed(2)}¢`)
      for (const r of results as Array<Record<string, any>>) console.log(`    ${String(r.model).padEnd(28)} ${r.error ? `ERROR ${r.error}` : !r.parsed ? 'unparsable' : `${String(r.quality).padEnd(12)} ${String(r.supported).padStart(2)} fields ${r.hard.length} hard  ${r.costCents?.toFixed(2)}¢  ${r.seconds.toFixed(0)}s  ${r.format}${r.finish && r.finish !== 'stop' ? ` finish=${r.finish}` : ''}`}`)
      writeFileSync(out, JSON.stringify(rows, null, 1))
    }

    console.log(`\n${rows.length} pages compared, ${skipped} skipped (input could not be rebuilt exactly)`)
    const gpts = rows.map(r => r.gpt as ReturnType<typeof score> & { costCents: number } | null)
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
    console.log(`gpt-5.2                       READY ${gpts.filter(g => g?.quality === 'READY').length}  PARTIAL ${gpts.filter(g => g?.quality === 'PARTIAL').length}  hard ${sum(gpts.map(g => g?.hard.length ?? 0))}  fields ${sum(gpts.map(g => g?.supported ?? 0))}  cost ${sum(gpts.map(g => g?.costCents ?? 0)).toFixed(2)}¢`)
    for (const model of models) {
      const rs = rows.map(r => (r.results as Array<Record<string, any>>).find(x => x.model === model)!)
      let agree = 0, differ = 0, gptOnly = 0, modelOnly = 0
      rs.forEach((r, i) => { const g = gpts[i]; if (!g || !r.values) return; for (const k of KEY_FIELDS) { const a = g.values[k], b = r.values[k]; if (a === null && b === null) continue; if (a !== null && b !== null) same(a, b) ? agree++ : differ++; else if (a !== null) gptOnly++; else modelOnly++ } })
      console.log(`${model.padEnd(29)} READY ${rs.filter(r => r.quality === 'READY').length}  PARTIAL ${rs.filter(r => r.quality === 'PARTIAL').length}  hard ${sum(rs.map(r => r.hard?.length ?? 0))}  fields ${sum(rs.map(r => r.supported ?? 0))}  cost ${sum(rs.map(r => r.costCents ?? 0)).toFixed(2)}¢  errors ${rs.filter(r => r.error || !r.parsed).length}  key fields vs gpt: agree ${agree} differ ${differ} gpt-only ${gptOnly} model-only ${modelOnly}`)
    }
    console.log(`details: ${out}`)
  } finally { await prisma.$disconnect() }
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1 })
