import 'dotenv/config'

import { PrismaClient } from '@prisma/client'
import { buildReviewerLandscape } from '@/lib/reviewer/landscape'

const prisma = new PrismaClient()

async function main() {
  const callId = process.argv[2] || 'cmq0o9bel00o214iusm84d32n'
  const call = await prisma.reviewerCall.findUnique({
    where: { id: callId },
    select: { id: true, project_title: true, parsed_json: true, LLM_model_used: true },
  })
  if (!call) throw new Error('call not found')
  const sections = await prisma.reviewerSection.findMany({
    where: { call_id: callId, status: 'reviewed' },
    select: { section_title: true, context_summary: true, user_input: true },
  })
  console.log('call:', call.project_title, '| reviewed sections:', sections.length)

  const started = Date.now()
  const landscape = await buildReviewerLandscape({
    callId,
    projectTitle: call.project_title || '',
    parsedContext: (call.parsed_json as any) || null,
    modelType: call.LLM_model_used === 'OPENAI' ? 'O' : 'G',
    sections: sections.map((s) => ({ title: s.section_title, contextSummary: s.context_summary, userInput: s.user_input || '' })),
  })
  console.log('took ms:', Date.now() - started)
  if (!landscape) { console.log('landscape: null (kill switch)'); return }
  console.log(JSON.stringify({
    status: landscape.status,
    facetSource: landscape.facetSource,
    assessmentSource: landscape.assessmentSource,
    facets: landscape.facets,
    semanticQuery: landscape.semanticQuery.slice(0, 140),
    sources: landscape.sources,
    summary: landscape.priorWork.summary,
    topRows: landscape.priorWork.rows.slice(0, 4).map((r) => ({
      kind: r.kind, title: r.title.slice(0, 70), facets: r.facetsCovered, basis: r.matchBasis.slice(0, 90),
    })),
    gaps: landscape.priorWork.gaps.map((g) => ({ facet: g.facet, reading: g.reading })),
    bytes: JSON.stringify(landscape).length,
  }, null, 2))
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
