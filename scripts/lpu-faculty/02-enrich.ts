/**
 * Step 2 — ask Claude to read each researcher's publication record and derive
 * their research profile.
 *
 * The source spreadsheet carries only titles, journal names and author roles:
 * no abstracts, no keywords, no areas. Claude reads the whole publication list
 * for one researcher at a time (their titles ARE the evidence) and returns
 * research areas, keywords, a research summary, and a shortlist of the most
 * representative publications with a synthesized scope note for each.
 *
 * Those scope notes are NOT the published abstracts — they are derived from the
 * title and venue alone. Step 3 tags every one of them so nothing downstream can
 * mistake them for real abstract text.
 *
 *   npx tsx scripts/lpu-faculty/02-enrich.ts --limit=12          # sample, live calls
 *   npx tsx scripts/lpu-faculty/02-enrich.ts --batch             # all 855 via Batches API (50% cost)
 *   npx tsx scripts/lpu-faculty/02-enrich.ts --batch --poll=<id> # resume polling an existing batch
 *   npx tsx scripts/lpu-faculty/02-enrich.ts --resume            # live, skip already-enriched UIDs
 */

import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import Anthropic from '@anthropic-ai/sdk'
import type { AggregatedAuthor } from './01-aggregate'

const MODEL = 'claude-opus-5'
const STRUCTURED_OUTPUT_BETA = 'structured-outputs-2025-11-13'
const IN_PATH = path.join(__dirname, 'data', '01-authors.json')
const OUT_PATH = path.join(__dirname, 'data', '02-enriched.json')
const BATCH_STATE_PATH = path.join(__dirname, 'data', '02-batch-state.json')
/** Matches MAX_FUNDING_PUBLICATIONS in src/lib/researcherProfile/funding-publications.ts. */
const MAX_INFLUENTIAL = 5
const LIVE_CONCURRENCY = 6
const MAX_ATTEMPTS = 4

const args = process.argv.slice(2)
const flag = (name: string) => args.find((a) => a.startsWith('--' + name + '='))?.split('=').slice(1).join('=')
const has = (name: string) => args.some((a) => a === '--' + name || a.startsWith('--' + name + '='))

const LIMIT = Number(flag('limit') || 0)
const EFFORT = flag('effort') || 'medium'
const USE_BATCH = has('batch')
const RESUME = has('resume')
const POLL_ID = flag('poll')
/** Explicit UID list, so a reviewer can re-run just the profiles they doubt. */
const SAMPLE_UIDS = flag('uids')?.split(',').map((s) => s.trim()).filter(Boolean)

const client = new Anthropic()

// ---------------------------------------------------------------------------
// Prompt + schema
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = [
  "You are a research-intelligence analyst at a university's Directorate of Sponsored Research.",
  '',
  'You will be given one researcher\'s publication record: the titles of papers they authored as first and/or corresponding author between January 2024 and August 2026, plus the journal each appeared in. You will NOT be given abstracts, citation counts, or dates — the titles and venues are all the evidence there is.',
  '',
  'From that evidence alone, build the researcher\'s profile.',
  '',
  'RESEARCH AREAS',
  '- 2 to 5 areas, ordered most to least central to their work.',
  '- Name a real, recognisable field of study at the granularity a funding call would use: "Wireless Sensor Networks", "Medicinal Chemistry", "Post-Harvest Technology". Not a single vague word ("Engineering"), not a restatement of a paper title.',
  '- Cover their actual spread. If someone publishes in both machine learning and crop science, say both rather than averaging them into something that describes neither.',
  '',
  'KEYWORDS',
  '- 5 to 10 specific technical terms, methods, materials, organisms, or applications drawn from the titles.',
  '- Prefer what a matching engine could hit on: "graphene oxide", "LSTM", "Fusarium wilt". Avoid generic filler like "analysis", "study", "novel approach".',
  '',
  'RESEARCH SUMMARY',
  '- 55 to 100 words, written in the first person, as the researcher would describe their own programme on a funding profile.',
  '- Ground every claim in the titles. Describe what they work on and the methods they use. Do NOT invent affiliations, collaborations, grants, awards, impact claims, or student numbers.',
  '',
  'INFLUENTIAL PUBLICATIONS',
  '- Select up to ' + MAX_INFLUENTIAL + ' publications that best represent the researcher\'s programme, referencing them by their given index.',
  '- Choose for representativeness and standing, not recency: favour papers where they were first AND corresponding author, papers in the stronger journals, and papers that together span their areas rather than five variations of one result.',
  '- For each, write a "scopeNote": 60 to 100 words describing what the paper most likely investigates, in the register of a journal abstract.',
  '',
  'CRITICAL — the scope note is an inference, not a record.',
  'You have never seen these papers. Write only what the title and venue actually support. Never state a specific numeric result, sample size, accuracy figure, p-value, dataset name, or funding source, because you would be inventing it. Hedge where the title is ambiguous. It is correct for a scope note to be general.',
  '',
  'CONFIDENCE',
  '- HIGH: many titles converging on a coherent programme.',
  '- MEDIUM: a few titles, or a somewhat scattered record.',
  '- LOW: one or two titles, or titles too generic to place confidently.',
].join('\n')

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    // Structured outputs reject minItems/maxItems above 1, so counts are
    // stated in the prompt and clamped in shapeResult() instead.
    researchAreas: { type: 'array', items: { type: 'string' } },
    primaryDiscipline: {
      type: 'string',
      description: 'Broad parent field, e.g. "Computer Science", "Chemistry", "Agricultural Sciences".',
    },
    keywords: { type: 'array', items: { type: 'string' } },
    researchSummary: { type: 'string' },
    confidence: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'] },
    influentialPublications: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer', description: 'Index of the publication in the supplied list.' },
          scopeNote: { type: 'string' },
          whySelected: { type: 'string' },
        },
        required: ['index', 'scopeNote', 'whySelected'],
        additionalProperties: false,
      },
    },
  },
  required: [
    'researchAreas',
    'primaryDiscipline',
    'keywords',
    'researchSummary',
    'confidence',
    'influentialPublications',
  ],
  additionalProperties: false,
}

const ROLE_LABEL: Record<string, string> = {
  FIRST_AND_CORRESPONDING: 'first + corresponding author',
  CORRESPONDING: 'corresponding author',
  FIRST: 'first author',
  UNKNOWN: 'author role not recorded',
}

function buildUserPrompt(author: AggregatedAuthor) {
  const lines = author.publications.map(
    (p, i) =>
      '[' + i + '] "' + p.title + '"\n     Journal: ' + (p.venue || 'not recorded') + ' — ' + (ROLE_LABEL[p.role] || p.role)
  )
  return [
    'Researcher: ' + author.name,
    'Staff UID: ' + author.uid,
    'Institution: Lovely Professional University, Punjab, India',
    'Publications on record (' + author.publicationCount + '):',
    '',
    lines.join('\n'),
    '',
    'Build this researcher\'s profile from the record above. Select at most ' +
      Math.min(MAX_INFLUENTIAL, author.publicationCount) +
      ' influential publications.',
  ].join('\n')
}

function requestParams(author: AggregatedAuthor) {
  return {
    model: MODEL,
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user' as const, content: buildUserPrompt(author) }],
    output_config: { format: { type: 'json_schema', schema: OUTPUT_SCHEMA }, effort: EFFORT },
  }
}

// ---------------------------------------------------------------------------
// Result shaping
// ---------------------------------------------------------------------------

export interface EnrichedAuthor extends AggregatedAuthor {
  researchAreas: string[]
  primaryDiscipline: string
  keywords: string[]
  researchSummary: string
  confidence: 'HIGH' | 'MEDIUM' | 'LOW'
  influentialPublications: Array<{
    title: string
    venue: string
    role: string
    /** Inferred from title + venue by Claude. NOT the published abstract. */
    scopeNote: string
    whySelected: string
  }>
  derivedBy: string
}

function parseResponseText(content: any[]): any {
  const text = content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
  if (!text.trim()) throw new Error('empty response text')
  return JSON.parse(text)
}

/** Claude returns publication indices; resolve them and drop anything out of range. */
function shapeResult(author: AggregatedAuthor, parsed: any): EnrichedAuthor {
  const seen = new Set<number>()
  const influential = (parsed.influentialPublications || [])
    .filter((p: any) => {
      const i = Number(p.index)
      if (!Number.isInteger(i) || i < 0 || i >= author.publications.length || seen.has(i)) return false
      seen.add(i)
      return true
    })
    .slice(0, MAX_INFLUENTIAL)
    .map((p: any) => {
      const source = author.publications[Number(p.index)]
      return {
        title: source.title,
        venue: source.venue,
        role: source.role,
        scopeNote: String(p.scopeNote || '').trim(),
        whySelected: String(p.whySelected || '').trim(),
      }
    })

  if (influential.length === 0) throw new Error('no valid publication indices returned')

  return {
    ...author,
    researchAreas: (parsed.researchAreas || []).map(String).slice(0, 5),
    primaryDiscipline: String(parsed.primaryDiscipline || ''),
    keywords: (parsed.keywords || []).map(String).slice(0, 10),
    researchSummary: String(parsed.researchSummary || '').trim(),
    confidence: parsed.confidence,
    influentialPublications: influential,
    derivedBy: MODEL + '/effort=' + EFFORT,
  }
}

// ---------------------------------------------------------------------------
// Live mode
// ---------------------------------------------------------------------------

const usage = { input: 0, output: 0, cacheRead: 0 }

async function enrichLive(author: AggregatedAuthor): Promise<EnrichedAuthor> {
  let lastError: unknown
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response: any = await client.beta.messages.create({
        ...(requestParams(author) as any),
        betas: [STRUCTURED_OUTPUT_BETA],
      })
      usage.input += response.usage?.input_tokens || 0
      usage.output += response.usage?.output_tokens || 0
      usage.cacheRead += response.usage?.cache_read_input_tokens || 0
      if (response.stop_reason === 'refusal') throw new Error('refusal')
      return shapeResult(author, parseResponseText(response.content))
    } catch (error: any) {
      lastError = error
      const retryable =
        error instanceof Anthropic.RateLimitError ||
        error instanceof Anthropic.APIConnectionError ||
        (error instanceof Anthropic.APIError && (error.status ?? 0) >= 500) ||
        error?.message === 'refusal' ||
        error instanceof SyntaxError
      if (!retryable || attempt === MAX_ATTEMPTS) break
      await new Promise((r) => setTimeout(r, 1500 * attempt * attempt))
    }
  }
  throw lastError
}

async function runLive(authors: AggregatedAuthor[], existing: Map<string, EnrichedAuthor>) {
  const results: EnrichedAuthor[] = []
  const failures: Array<{ uid: string; name: string; error: string }> = []
  let cursor = 0
  let done = 0

  async function worker() {
    while (cursor < authors.length) {
      const author = authors[cursor++]
      try {
        results.push(await enrichLive(author))
      } catch (error: any) {
        failures.push({ uid: author.uid, name: author.name, error: error?.message || String(error) })
      }
      done += 1
      if (done % 10 === 0 || done === authors.length) {
        console.log('  ' + done + '/' + authors.length + ' processed (' + failures.length + ' failed)')
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(LIVE_CONCURRENCY, authors.length) }, worker))
  writeOutput(existing, results)
  reportUsage(false)
  reportFailures(failures)
}

// ---------------------------------------------------------------------------
// Batch mode — 50% cost, the right call for the full 855
// ---------------------------------------------------------------------------

async function runBatch(authors: AggregatedAuthor[], existing: Map<string, EnrichedAuthor>) {
  let batchId = POLL_ID
  const byUid = new Map(authors.map((a) => [a.uid, a]))

  if (!batchId) {
    console.log('Submitting ' + authors.length + ' requests to the Batches API...')
    const batch: any = await client.beta.messages.batches.create({
      betas: [STRUCTURED_OUTPUT_BETA],
      requests: authors.map((author) => ({
        custom_id: 'uid-' + author.uid,
        params: requestParams(author) as any,
      })),
    } as any)
    batchId = batch.id
    fs.writeFileSync(BATCH_STATE_PATH, JSON.stringify({ batchId, submitted: authors.length }, null, 2))
    console.log('Batch ' + batchId + ' submitted. Resume anytime with --batch --poll=' + batchId)
  }

  let batch: any
  for (;;) {
    batch = await client.beta.messages.batches.retrieve(batchId!)
    if (batch.processing_status === 'ended') break
    const c = batch.request_counts
    console.log(
      '  status=' + batch.processing_status + ' processing=' + c.processing + ' succeeded=' + c.succeeded + ' errored=' + c.errored
    )
    await new Promise((r) => setTimeout(r, 60_000))
  }

  console.log('Batch ended: ' + JSON.stringify(batch.request_counts))

  const results: EnrichedAuthor[] = []
  const failures: Array<{ uid: string; name: string; error: string }> = []

  for await (const entry of await client.beta.messages.batches.results(batchId!)) {
    const uid = entry.custom_id.replace(/^uid-/, '')
    const author = byUid.get(uid)
    if (!author) continue
    const result: any = entry.result
    if (result.type !== 'succeeded') {
      failures.push({ uid, name: author.name, error: result.type + ': ' + (result.error?.type || '') })
      continue
    }
    usage.input += result.message.usage?.input_tokens || 0
    usage.output += result.message.usage?.output_tokens || 0
    try {
      results.push(shapeResult(author, parseResponseText(result.message.content)))
    } catch (error: any) {
      failures.push({ uid, name: author.name, error: error?.message || String(error) })
    }
  }

  writeOutput(existing, results)
  reportUsage(true)
  reportFailures(failures)
}

// ---------------------------------------------------------------------------

function writeOutput(existing: Map<string, EnrichedAuthor>, fresh: EnrichedAuthor[]) {
  for (const item of fresh) existing.set(item.uid, item)
  const all = [...existing.values()].sort(
    (a, b) => b.publicationCount - a.publicationCount || a.uid.localeCompare(b.uid)
  )
  fs.writeFileSync(OUT_PATH, JSON.stringify(all, null, 2))
  console.log('\nWrote ' + all.length + ' enriched profiles to ' + OUT_PATH)
}

function reportUsage(batched: boolean) {
  // claude-opus-5 list price, halved on the Batches API.
  const rate = batched ? { input: 2.5, output: 12.5 } : { input: 5, output: 25 }
  const cost = (usage.input / 1e6) * rate.input + (usage.output / 1e6) * rate.output
  console.log(
    'Tokens: ' +
      usage.input.toLocaleString() +
      ' in / ' +
      usage.output.toLocaleString() +
      ' out' +
      (usage.cacheRead ? ' (' + usage.cacheRead.toLocaleString() + ' cache read)' : '') +
      ' — approx $' +
      cost.toFixed(2) +
      (batched ? ' (batch rate)' : '')
  )
}

function reportFailures(failures: Array<{ uid: string; name: string; error: string }>) {
  if (!failures.length) {
    console.log('No failures.')
    return
  }
  console.log('\n' + failures.length + ' failed — re-run with --resume to retry only these:')
  failures.slice(0, 20).forEach((f) => console.log('  ' + f.uid + ' ' + f.name + ': ' + f.error))
}

async function main() {
  const all: AggregatedAuthor[] = JSON.parse(fs.readFileSync(IN_PATH, 'utf8'))
  const existing = new Map<string, EnrichedAuthor>(
    fs.existsSync(OUT_PATH)
      ? (JSON.parse(fs.readFileSync(OUT_PATH, 'utf8')) as EnrichedAuthor[]).map((a) => [a.uid, a] as const)
      : []
  )

  let targets = all
  if (SAMPLE_UIDS) targets = all.filter((a) => SAMPLE_UIDS.includes(a.uid))
  if (RESUME || POLL_ID) targets = targets.filter((a) => !existing.has(a.uid))
  if (LIMIT > 0) targets = targets.slice(0, LIMIT)

  if (!targets.length) {
    console.log('Nothing to do — every targeted author is already enriched.')
    return
  }

  console.log(
    'Enriching ' + targets.length + ' researchers with ' + MODEL + ' (effort=' + EFFORT + ', ' + (USE_BATCH ? 'batch' : 'live') + ' mode)'
  )
  if (USE_BATCH) await runBatch(targets, existing)
  else await runLive(targets, existing)
}

main().catch((error) => {
  console.error('Enrichment failed:', error)
  process.exitCode = 1
})
