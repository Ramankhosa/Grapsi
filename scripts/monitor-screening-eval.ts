/**
 * Re-screens chosen Source Watch pages with the screening prompt from before
 * triage-3 and with the current one, side by side, on the stage's first model.
 *
 * Read-only on the database. The model calls are made directly and are NOT
 * booked in the Source Watch budget (about 0.05¢ a page).
 *
 *   tsx scripts/monitor-screening-eval.ts --urls urls.txt [--out file.json]
 */
import dotenv from 'dotenv'
import { readFileSync, writeFileSync } from 'node:fs'
dotenv.config()

const arg = (name: string, fallback: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback }

async function main() {
  const urls = readFileSync(arg('urls', 'urls.txt'), 'utf8').split('\n').map(s => s.trim()).filter(Boolean)
  const out = arg('out', '/tmp/screening-eval.json')
  const { prisma } = await import('../src/lib/prisma')
  const { TRIAGE_SYSTEM_PROMPT, TRIAGE_SCHEMA } = await import('../src/lib/monitor/candidates')
  const { paidPromptText, jsonResponseText } = await import('../src/lib/monitor/paidCall')
  const { GeminiProvider } = await import('../src/lib/metering/providers/gemini-provider')
  const provider = new GeminiProvider({ apiKey: process.env.GOOGLE_AI_API_KEY, baseURL: 'https://generativelanguage.googleapis.com/v1beta' } as never)
  const before = TRIAGE_SYSTEM_PROMPT.split(' The request gives')[0]
  try {
    const items: Array<Record<string, unknown>> = []
    for (const url of urls) {
      const r = await prisma.monitorResource.findFirst({ where: { canonical_url: url } })
      if (!r?.current_version_id) { console.log('missing', url); continue }
      const v = await prisma.monitorResourceVersion.findUnique({ where: { id: r.current_version_id }, select: { text: true } })
      const local = await prisma.monitorLocalAnalysisResult.findFirst({ where: { resource_id: r.id }, orderBy: { created_at: 'desc' }, select: { decision: true } })
      const text = v?.text ?? ''
      items.push({ id: r.id, title: r.title, url: r.canonical_url, localSuggestion: local ? { decision: local.decision } : null, text: text.slice(0, 5000), completeness: text.length <= 5000 ? 'available-text' : 'PARTIAL' })
    }
    const ask = async (systemPrompt: string, withDate: boolean) => {
      const decisions = new Map<string, { verdict: string; confidence: number; reason: string }>()
      for (let i = 0; i < items.length; i += 10) {
        const prompt = JSON.stringify(withDate ? { today: new Date().toISOString().slice(0, 10), items: items.slice(i, i + 10) } : { items: items.slice(i, i + 10) })
        const response = await provider.execute({ modelClass: 'gemini-3.1-flash', prompt: paidPromptText({ systemPrompt, prompt, jsonSchema: TRIAGE_SCHEMA }), parameters: { temperature: 0, maxTokensOut: 4800, responseMimeType: 'application/json', responseSchema: TRIAGE_SCHEMA.schema, thinking_level: 'low' } } as never, { allowed: true, maxTokensOut: 4800 } as never)
        for (const d of (JSON.parse(jsonResponseText(String(response.output))) as { items: Array<{ id: string; verdict: string; confidence: number; reason: string }> }).items) decisions.set(d.id, d)
      }
      return decisions
    }
    const [old, current] = await Promise.all([ask(before, false), ask(TRIAGE_SYSTEM_PROMPT, true)])
    const rows = items.map(item => ({ url: item.url, before: old.get(String(item.id)), after: current.get(String(item.id)) }))
    for (const row of rows) console.log(`${String(row.before?.verdict).padEnd(18)} -> ${String(row.after?.verdict).padEnd(18)} ${String(row.url).slice(0, 90)}\n    ${String(row.after?.reason ?? '').slice(0, 160)}`)
    writeFileSync(out, JSON.stringify(rows, null, 1))
  } finally { await prisma.$disconnect() }
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1 })
