import 'dotenv/config'

import { buildReviewerLandscape } from '@/lib/reviewer/landscape'

async function main() {
  const callId = 'cmq0o9bel00o214iusm84d32n' // real call, used for owner/tenant resolution only
  const started = Date.now()
  const landscape = await buildReviewerLandscape({
    callId,
    projectTitle: 'Novel nanocatalysts for sustainable chemical synthesis',
    parsedContext: { description: 'Call for research on advanced materials and green chemistry.' },
    modelType: 'G',
    sections: [
      { title: 'Objectives', contextSummary: 'Design transition-metal nanocatalysts for selective hydrogenation and oxidation reactions with reduced energy input.', userInput: '' },
      { title: 'Methodology', contextSummary: 'Synthesis of metal-oxide nanoparticles, spectroscopic characterization, catalytic performance testing in flow reactors.', userInput: '' },
      { title: 'Expected Outcomes', contextSummary: 'Greener synthesis routes for fine chemicals and pharmaceuticals with higher atom economy.', userInput: '' },
    ],
  })
  console.log('took ms:', Date.now() - started)
  if (!landscape) { console.log('null'); return }
  console.log(JSON.stringify({
    status: landscape.status,
    facetSource: landscape.facetSource,
    assessmentSource: landscape.assessmentSource,
    facets: landscape.facets,
    sources: landscape.sources,
    summary: landscape.priorWork.summary,
    topRows: landscape.priorWork.rows.slice(0, 5).map((r) => ({
      kind: r.kind, title: r.title.slice(0, 70), facets: r.facetsCovered, basis: r.matchBasis.slice(0, 110),
    })),
    coverage: landscape.priorWork.coverage.map((c) => ({ facet: c.facet.slice(0, 40), funded: c.funded.status, patented: c.patented.status, open: c.open })),
    bytes: JSON.stringify(landscape).length,
  }, null, 2))
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
