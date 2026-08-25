// Local stand-in for https://patentnest.ai/api/v1 so the Patent Search UI can be
// exercised end-to-end without a real pn_live_ key (see the grapsi-dev-patentmock
// launch config). Mirrors the v1.1 contract: POST /api/v1/patents/search
// {query, limit}, GET /api/v1/patents/{number}, bearer auth (pn_live_mock),
// {data, meta} envelope, coverage manifest, RateLimit-* headers. Queries containing
// "ratelimit", "corpus down" or "nothing" trigger 429 / 503 / empty responses.
// Run: node scripts/dev/patentnest-mock-server.js   (MOCK_PORT, default 4010)
const http = require('http')

const PORT = Number(process.env.MOCK_PORT || 4010)
const KEY = 'pn_live_mock'

const PATENTS = [
  ['IN 202041012345 A', '2020/DEL/12345', 'A', 'IN', 'Graphene oxide composite membrane for arsenic removal from groundwater', 'A layered graphene-oxide membrane functionalised with iron oxide nanoparticles removes arsenic(III) and arsenic(V) from groundwater at household scale. The membrane is fabricated by vacuum filtration of a graphene oxide dispersion onto a polysulfone support and cross-linked with polyethyleneimine, giving a rejection above 95% at 2 bar with flux suitable for a gravity-fed rural unit.', [['Indian Institute of Technology, Delhi', 'Hauz Khas, New Delhi 110016']], ['Anita Sharma', 'Rahul Verma', 'K. Subramanian'], ['B01D 71/02', 'C02F 1/44', 'B01D 69/12'], '2020-03-21', '2021-09-24', 18, 12, 0.93, 'journal-2021-39.pdf', 1041, 0.91, 0.94, 0.52],
  ['IN 201921034567 A', '2019/CHE/34567', 'A', 'IN', 'Low-cost ceramic water filter impregnated with silver nanoparticles', 'A clay-sawdust ceramic pot filter impregnated with silver nanoparticles for point-of-use drinking water treatment in rural households, achieving a 4-log reduction in E. coli and partial removal of turbidity and iron.', [['Tamil Nadu Agricultural University', 'Coimbatore']], ['S. Murugan'], ['C02F 1/50', 'C02F 1/00'], '2019-08-27', '2021-02-26', 11, 8, 0.88, 'journal-2021-09.pdf', 433, 0.66, 0.71, 0.31],
  ['US 10,456,789 B2', '16/123,456', 'B2', 'US', 'Electrochemical biosensor with screen-printed carbon electrodes for glucose detection', 'A disposable electrochemical biosensor comprising screen-printed carbon electrodes modified with glucose oxidase immobilised in a chitosan matrix, read by a low-power potentiostat suitable for point-of-care use in low-resource settings.', [['Acme Diagnostics Inc.', 'Austin, TX']], ['J. Doe', 'M. Lee'], ['G01N 27/327', 'C12Q 1/00'], '2018-06-12', '2019-10-29', 24, 20, 0.97, null, null, 0.58, 0.62, 0.22],
  ['EP 3456789 A1', 'EP17190001', 'A1', 'EP', 'Membrane module for decentralised arsenic removal', 'A spiral-wound nanofiltration membrane module with an integrated adsorbent pre-bed for decentralised removal of arsenic and fluoride from groundwater, including backwash control for intermittent power supply.', [['Aqua Membranes GmbH', 'Munich']], ['H. Müller'], ['B01D 61/02', 'C02F 1/44', 'C02F 1/28'], '2017-09-01', '2019-03-06', 30, 15, 0.9, null, null, 0.74, 0.8, 0.4],
  ['IN 202111045678 A', '2021/MUM/45678', 'A', 'IN', 'Iron oxide coated sand filter for arsenic and fluoride removal', 'Sand coated with iron oxyhydroxide packed in a gravity column for simultaneous removal of arsenic and fluoride from tube-well water, regenerable with dilute sodium hydroxide.', [['Indian Institute of Technology, Delhi', 'Hauz Khas, New Delhi 110016'], ['Central Ground Water Board', 'Faridabad']], ['Anita Sharma', 'P. Ghosh'], ['C02F 1/28', 'B01J 20/06'], '2021-10-08', '2023-04-14', 14, 10, 0.86, 'journal-2023-15.pdf', 610, 0.7, 0.73, 0.45],
  ['IN 201811056789 A', '2018/KOL/56789', 'A', 'IN', 'Solar powered groundwater treatment unit for rural communities', 'A solar photovoltaic powered treatment unit combining aeration, sand filtration and activated alumina adsorption for iron, arsenic and fluoride removal, sized for a village hand pump.', [['Jadavpur University', 'Kolkata']], ['B. Banerjee', 'S. Das'], ['C02F 9/00', 'C02F 1/28', 'H02S 10/00'], '2018-12-03', '2020-06-05', 9, 6, 0.8, 'journal-2020-23.pdf', 318, 0.49, 0.55, 0.2],
  ['WO 2020/123456 A1', 'PCT/IN2019/050123', 'A1', 'WO', 'Graphene based adsorbent for heavy metal removal', 'Reduced graphene oxide decorated with manganese dioxide nanorods as a regenerable adsorbent for lead, cadmium and arsenic ions in water, with a capacity above 200 mg per gram.', [['Council of Scientific and Industrial Research', 'New Delhi']], ['R. Iyer'], ['B01J 20/20', 'C02F 1/28'], '2019-12-20', '2020-06-25', 27, 18, 0.92, null, null, 0.63, 0.69, 0.3],
  ['IN 202241067890 A', '2022/DEL/67890', 'A', 'IN', 'Machine learning based water quality prediction for tube wells', 'A method for predicting arsenic contamination of tube wells from geological and satellite features using a gradient boosted model, with a mobile application for field workers.', [['Indian Institute of Technology, Kanpur', 'Kanpur']], ['N. Gupta'], ['G06N 20/00', 'G01N 33/18'], '2022-11-25', '2024-05-31', 16, 9, 0.84, 'journal-2024-22.pdf', 902, 0.41, 0.5, 0.15],
]

function record([publicationNumber, applicationNumber, kind, country, title, abstract, applicants, inventors, classifications, filingDate, publicationDate, numberOfPages, numberOfClaims, extractionConfidence, document, page, score, semanticScore, textScore], withRelevance) {
  return {
    publicationNumber, applicationNumber, kind, country, title, abstract,
    applicants: applicants.map(([name, address], index) => ({ name, address, sequence: index + 1 })),
    inventors, classifications, filingDate, publicationDate, numberOfPages, numberOfClaims, extractionConfidence,
    source: { name: 'IP India Patent Journal', document, page },
    ...(withRelevance ? { relevance: { score, semanticScore, textScore, matchedFields: ['title', 'abstract'] } } : {}),
  }
}

function norm(value) { return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '') }

let minuteCount = 0
function send(res, status, body, extra = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'X-Request-ID': `mock-${Date.now()}`,
    'RateLimit-Limit': '30', 'RateLimit-Remaining': String(Math.max(0, 30 - minuteCount)), 'RateLimit-Reset': '45',
    'X-RateLimit-Daily-Remaining': String(2000 - minuteCount), 'X-RateLimit-Monthly-Remaining': '49980',
    ...extra,
  })
  res.end(JSON.stringify(body))
}

const server = http.createServer((req, res) => {
  let raw = ''
  req.on('data', (chunk) => { raw += chunk })
  req.on('end', () => {
    const started = Date.now()
    const auth = req.headers.authorization || ''
    if (auth !== `Bearer ${KEY}`) return send(res, 401, { error: { code: 'INVALID_API_KEY', message: 'invalid', requestId: 'mock' } })
    minuteCount += 1
    const url = new URL(req.url, `http://localhost:${PORT}`)
    if (req.method === 'POST' && url.pathname === '/api/v1/patents/search') {
      let body = {}
      try { body = JSON.parse(raw || '{}') } catch { return send(res, 400, { error: { code: 'INVALID_REQUEST', message: 'bad json', requestId: 'mock' } }) }
      const unsupported = Object.keys(body).filter((key) => !['query', 'limit'].includes(key))
      if (unsupported.length) return send(res, 400, { error: { code: 'INVALID_REQUEST', message: `Unsupported request field: ${unsupported[0]}.`, requestId: 'mock' } })
      const query = String(body.query || '')
      if (query.toLowerCase().includes('ratelimit')) return send(res, 429, { error: { code: 'RATE_LIMIT_EXCEEDED', message: 'slow down', requestId: 'mock' } }, { 'Retry-After': '20' })
      if (query.toLowerCase().includes('corpus down')) return send(res, 503, { error: { code: 'CORPUS_NOT_READY', message: 'rebuilding', requestId: 'mock' } })
      if (query.toLowerCase().includes('nothing')) return send(res, 200, { data: { query, count: 0, results: [], coverage: coverage() }, meta: { requestId: 'mock-empty', durationMs: 5 } })
      const limit = Number(body.limit || 20)
      const results = PATENTS.slice(0, limit).map((row) => record(row, true))
      return send(res, 200, { data: { query, count: results.length, results, coverage: coverage() }, meta: { requestId: `mock-${Date.now()}`, durationMs: Date.now() - started + 180 } })
    }
    const match = /^\/api\/v1\/patents\/(.+)$/.exec(url.pathname)
    if (req.method === 'GET' && match) {
      const key = norm(decodeURIComponent(match[1]))
      const row = PATENTS.find((entry) => norm(entry[0]) === key)
      if (!row) return send(res, 404, { error: { code: 'PATENT_NOT_FOUND', message: 'No patent was found for that publication number.', requestId: 'mock' } })
      return send(res, 200, { data: record(row, false), meta: { requestId: `mock-${Date.now()}`, durationMs: 12 } })
    }
    return send(res, 404, { error: { code: 'NOT_FOUND', message: 'no route', requestId: 'mock' } })
  })
})

function coverage() {
  return { corpus: 'indian-patent-journal', description: 'Indian patent corpus sourced from IP India Patent Journal publications (mock)', jurisdiction: 'IN', documents: 160412, semanticCoveragePercent: 99.4, searchMode: 'hybrid-semantic-text', embeddingModel: 'voyage-3.5-lite' }
}

server.listen(PORT, () => console.log(`[patentnest-mock] listening on http://localhost:${PORT} (key ${KEY})`))
