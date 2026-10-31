// Synthetic local browser fixtures. All API requests are intercepted.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path')
let browser, page
async function main() {
  const base = new URL(process.env.DSR_PREVIEW_URL || 'http://127.0.0.1:3065')
  assert.ok(['localhost', '127.0.0.1'].includes(base.hostname))
  const output = path.join(process.cwd(), 'outputs', 'lpu-routing-groundwork'); fs.mkdirSync(output, { recursive: true })
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
  page = await context.newPage()
  const errors = [], requests = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => localStorage.setItem('auth_token', `fixture.${btoa(JSON.stringify({ exp: Math.floor(Date.now()/1000) + 3600 }))}.fixture`))
  const person = i => ({ id: `p${i}`, name: `Matched researcher ${i}`, unitName: 'Microbiology', score: .8, band: 'strong', reason: 'Research on microbial biosensors', eligibility: 'REVIEW_REQUIRED', eligibilityNotes: ['Full call eligibility and lead-investigator requirements have not been verified.'] })
  const school = count => ({ id: 'biotech', name: 'Biotechnology', coordinator: 'School coordinator', institutional: false,
    status: 'RESEARCHER_FIT', people: Array.from({ length: count }, (_, i) => person(i + 1)), matchingPeople: count, strongPeople: count, borderlinePeople: 1,
    placementConflicts: 2, explanation: 'These individuals support school relevance. Review evidence and eligibility before creating responsibility.' })
  const payload = (id = 'call') => ({ previewOnly: true, activationEnabled: false, asOf: new Date().toISOString(), width: 'NARROW',
    calls: [{ id: 'call', title: 'Biosensor call' }, { id: 'large', title: 'Larger matching list' }, { id: 'missing', title: 'Call awaiting matching' }], page: 1, pageSize: 20, totalCalls: 3,
    coverage: { profiles: 768, unplaced: 153, invalidPlacement: 0, missingEmbedding: 0, missingResearch: 0 },
    issues: [{ id: 'unplaced', name: 'Researcher awaiting placement', issue: 'School placement missing' }], coverageNote: 'Eligibility and complete matching coverage still need validation.',
    call: { id, title: id === 'large' ? 'Larger matching list' : id === 'missing' ? 'Call awaiting matching' : 'Biosensor call' },
    snapshotStatus: id === 'missing' ? 'MISSING' : id === 'large' ? 'STALE' : 'RECORDED',
    snapshot: id === 'missing' ? null : { version: 'call-people-census-v2', fingerprint: 'fixture', basis: 'rerank', refreshedAt: new Date().toISOString() },
    schools: id === 'missing' ? [] : [school(id === 'large' ? 15 : 8), { ...school(0), id: 'cse', name: 'CSE', coordinator: null,
      institutional: true, status: 'INSTITUTIONAL_REVIEW', borderlinePeople: 0, placementConflicts: 0, explanation: 'Institutional scope needs review; no qualifying person is recorded.' }] })
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()); requests.push({ path: url.pathname, method: request.method() })
    let data = { modules: [] }
    if (url.pathname === '/api/v1/auth/whoami') data = { user_id: 'fixture', email: 'head@example.test', tenant_id: 'fixture-lpu', roles: ['ADMIN'] }
    if (url.pathname === '/api/funding-dept/me') data = { isMember: true, isHead: true, reachSchools: [], schools: [], managedUnits: [], capabilities: { isTenantWide: true, canAssign: true, canViewReports: true } }
    if (url.pathname === '/api/funding-dept/routing-preview') {
      data = payload(url.searchParams.get('callId') || 'call')
      if (url.searchParams.get('search') === 'slow') {
        await new Promise(resolve => setTimeout(resolve, 600)); data = { ...payload(), call: { id: 'slow', title: 'Obsolete slow response' } }
      }
      if (url.searchParams.get('search') === 'fast') data = { ...payload(), call: { id: 'fast', title: 'Latest search result' } }
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
  })
  await page.goto(new URL('/funding-dept/routing-preview', base).href, { waitUntil: 'networkidle', timeout: 120000 })
  await page.getByRole('heading', { name: 'Researcher routing preview', exact: true }).waitFor()
  await page.getByText('8 matching researchers', { exact: true }).waitFor()
  const biotech = page.getByRole('article', { name: 'Biotechnology', exact: true })
  assert.equal(await biotech.locator('li').count(), 8)
  assert.equal(await page.getByText('Matched researcher 9', { exact: false }).count(), 0)
  await page.getByText('Preview only — live routing is unchanged.', { exact: true }).waitFor()
  await page.getByText('Profiles needing attention', { exact: false }).click()
  await page.getByText('Researcher awaiting placement', { exact: false }).waitFor()
  await page.screenshot({ path: path.join(output, 'routing-preview-desktop.png'), fullPage: true })
  await page.getByRole('combobox', { name: 'Choose call' }).selectOption('large')
  await page.getByText('15 matching researchers', { exact: true }).waitFor()
  await page.getByText('Saved matching is outdated', { exact: false }).waitFor()
  assert.equal(await biotech.locator('li').count(), 10)
  await biotech.getByRole('button', { name: 'Next researchers' }).click()
  assert.equal(await biotech.locator('li').count(), 5)
  await page.getByRole('combobox', { name: 'Choose call' }).selectOption('missing')
  await page.getByText('Matching not recorded', { exact: true }).waitFor()
  await page.getByText('No saved routes match this filter.', { exact: false }).waitFor()
  await page.getByRole('textbox', { name: 'Find a call' }).fill('slow')
  await page.getByRole('button', { name: 'Search calls', exact: true }).click()
  await page.getByRole('textbox', { name: 'Find a call' }).fill('fast')
  await page.getByRole('button', { name: 'Search calls', exact: true }).click()
  await page.getByRole('heading', { name: 'Latest search result', exact: true }).waitFor()
  await page.waitForTimeout(750)
  assert.equal(await page.getByRole('heading', { name: 'Obsolete slow response' }).count(), 0)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(new URL('/funding-dept/routing-preview', base).href, { waitUntil: 'networkidle', timeout: 120000 })
  await page.getByText('8 matching researchers', { exact: true }).waitFor()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, 'Mobile preview must not overflow')
  await page.screenshot({ path: path.join(output, 'routing-preview-mobile.png'), fullPage: true })
  assert.deepEqual(errors, [])
  assert.equal(requests.filter(r => r.path === '/api/funding-dept/routing-preview' && r.method !== 'GET').length, 0)
  assert.equal(requests.some(r => r.path.includes('refresh-match') || r.path.endsWith('/routing')), false)
  await browser.close(); browser = null
  console.log('PASS desktop/mobile routing preview: eight-count/eight-list, full pagination, missing/stale states, unplaced-profile explanation, race protection and no mutations/provider actions.')
}
main().catch(async error => {
  console.error(error)
  if (page) await page.screenshot({ path: path.join(process.cwd(), 'outputs', 'lpu-routing-groundwork', 'ui-failure.png'), fullPage: true }).catch(() => {})
  if (browser) await browser.close()
  process.exitCode = 1
})
