import 'dotenv/config'

async function main() {
  // Case 1: kill switch off -> null
  process.env.REVIEWER_LANDSCAPE_ENABLED = 'false'
  const { buildReviewerLandscape } = await import('@/lib/reviewer/landscape')
  const off = await buildReviewerLandscape({
    callId: 'cmq0o9bel00o214iusm84d32n',
    projectTitle: 'x', parsedContext: null, modelType: 'G', sections: [],
  })
  console.log('kill switch -> landscape is null:', off === null)

  // Case 2: bogus PatentNest key that passes the format check -> patents status 'error', step still resolves
  process.env.REVIEWER_LANDSCAPE_ENABLED = 'true'
  process.env.PATENTNEST_API_KEY = 'pn_live_bogus_key_for_failure_injection'
  const on = await buildReviewerLandscape({
    callId: 'cmq0o9bel00o214iusm84d32n',
    projectTitle: 'Nanocatalysts for green synthesis',
    parsedContext: null,
    modelType: 'G',
    sections: [{ title: 'Objectives', contextSummary: 'Transition-metal nanocatalysts for selective hydrogenation.', userInput: '' }],
  })
  console.log('bogus key -> resolved:', Boolean(on), '| status:', on?.status, '| patents:', JSON.stringify(on?.sources.patents))
}
main().then(() => process.exit(0)).catch((e) => { console.error('ERR', e.message); process.exit(1) })
