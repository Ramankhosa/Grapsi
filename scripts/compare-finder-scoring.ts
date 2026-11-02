/**
 * Finder scoring, side by side: the shipped formula against the reranker-scale
 * one behind FINDER_SEMANTIC_SCORE=rerank.
 *
 * The shipped formula scores a call's meaning as max(retrieval similarity,
 * reranker score), so the reranker can promote a call but never demote one it
 * judges irrelevant. The flagged formula uses the reranker's score directly,
 * on its own scale and with its own cutoffs. Read this output before flipping
 * the flag: it shows, per query, which calls each formula keeps, which it
 * drops, and where the reranker's scores sit, so the FINDER_RERANK_* cutoffs
 * can be set from this catalogue rather than guessed.
 *
 *   npx tsx scripts/compare-finder-scoring.ts
 *   npx tsx scripts/compare-finder-scoring.ts --queries queries.txt --top 10
 *
 * Read-only apart from Finder's own query caches. Each query costs two
 * searches (about two Voyage rerank calls) and may use the query-enrichment
 * model the first time a query is seen.
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'

import prisma from '../src/lib/prisma'
import { RecommendationSearchService, finderThresholds } from '../src/lib/services/recommendationSearchService'

const DEFAULT_QUERIES = [
  'quantum sensing for navigation',
  'antimicrobial resistance surveillance in hospitals',
  'machine learning for crop yield prediction',
  'battery materials for grid storage',
  'mental health of adolescents in rural areas',
  'coastal erosion and climate adaptation',
  'protein structure prediction',
  'urban air pollution and respiratory disease',
  'low-cost water purification membranes',
  'history of medieval trade routes',
]

function argument(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] ?? null : null
}

function percentile(values: number[], p: number) {
  if (!values.length) return NaN
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
}

const fmt = (value: number) => (Number.isFinite(value) ? value.toFixed(3) : '  —  ')

async function run(query: string, mode: 'max' | 'rerank') {
  process.env.FINDER_SEMANTIC_SCORE = mode
  const service = new RecommendationSearchService()
  const response = await service.search({ inputMode: 'research_area', query: { researchArea: query } } as never)
  return {
    lowConfidence: response.lowConfidence,
    results: response.rawResults.map((row) => ({ id: row.id, title: row.schemeTitle, score: row.score, semantic: row.semanticSimilarity })),
  }
}

async function main() {
  const file = argument('queries')
  const top = Number(argument('top') || 10)
  const queries = file
    ? readFileSync(file, 'utf8').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    : DEFAULT_QUERIES
  const original = process.env.FINDER_SEMANTIC_SCORE

  const rerankScores: number[] = []
  const finalScores: number[] = []
  let overlapTotal = 0
  let emptied = 0
  console.log(`Comparing ${queries.length} queries, top ${top}.`)
  console.log(`Reranker-scale cutoffs now: ${JSON.stringify(finderThresholds('rerank'))}\n`)

  for (const query of queries) {
    const shipped = await run(query, 'max')
    const flagged = await run(query, 'rerank')
    const shippedTop = shipped.results.slice(0, top)
    const flaggedTop = flagged.results.slice(0, top)
    const shippedIds = new Set(shippedTop.map((row) => row.id))
    const flaggedIds = new Set(flaggedTop.map((row) => row.id))
    const overlap = flaggedTop.filter((row) => shippedIds.has(row.id)).length
    overlapTotal += shippedTop.length ? overlap / Math.min(top, Math.max(shippedTop.length, flaggedTop.length)) : 1
    if (shipped.results.length && !flagged.results.length) emptied += 1
    rerankScores.push(...flagged.results.map((row) => row.semantic))
    finalScores.push(...flagged.results.map((row) => row.score))

    console.log(`== ${query}`)
    console.log(`   results: shipped ${shipped.results.length}${shipped.lowConfidence ? ' (low confidence)' : ''}, flagged ${flagged.results.length}${flagged.lowConfidence ? ' (low confidence)' : ''}; top-${top} overlap ${overlap}`)
    for (const row of shippedTop.filter((item) => !flaggedIds.has(item.id))) {
      console.log(`   - dropped  sem ${fmt(row.semantic)}  ${row.title}`)
    }
    for (const row of flaggedTop.filter((item) => !shippedIds.has(item.id))) {
      console.log(`   + gained   rerank ${fmt(row.semantic)}  ${row.title}`)
    }
  }

  if (original === undefined) delete process.env.FINDER_SEMANTIC_SCORE
  else process.env.FINDER_SEMANTIC_SCORE = original

  console.log('\n== Summary')
  console.log(`   mean top-${top} overlap: ${(100 * overlapTotal / Math.max(1, queries.length)).toFixed(0)}%`)
  console.log(`   queries the flagged formula left empty: ${emptied}`)
  console.log(`   reranker score of returned calls  p10 ${fmt(percentile(rerankScores, 10))}  p25 ${fmt(percentile(rerankScores, 25))}  p50 ${fmt(percentile(rerankScores, 50))}  p90 ${fmt(percentile(rerankScores, 90))}`)
  console.log(`   final score of returned calls     p10 ${fmt(percentile(finalScores, 10))}  p25 ${fmt(percentile(finalScores, 25))}  p50 ${fmt(percentile(finalScores, 50))}`)
  console.log('   Set FINDER_RERANK_TOPIC_THRESHOLD near the reranker score that separates the calls you would keep,')
  console.log('   and FINDER_RERANK_NO_RESULT_THRESHOLD below the final score of the weakest call you would still show.')
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
