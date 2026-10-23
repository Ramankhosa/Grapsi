// Local UI verification. All API requests are fulfilled with synthetic fixtures;
// this never authenticates to the application or invokes paid search providers.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
let activeBrowser

async function main() {
  const preview = new URL(process.env.DISCOVERY_PREVIEW_URL || 'http://127.0.0.1:3065')
  if (!['127.0.0.1', 'localhost'].includes(preview.hostname)) throw new Error('Use a local preview for this fixture-only verification.')
  const browser = await chromium.launch({ headless: true })
  activeBrowser = browser
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const area = { id: 'scientify:discipline:bio', label: 'Biotechnology' }
  const call = { id: 'fixture-call', schemeTitle: 'Translational biosensors for early cancer detection', agencyName: 'Research Foundation',
    shortDescription: 'Support for interdisciplinary teams developing accessible diagnostic technologies, from proof of concept to clinical validation.',
    closeDate: '2026-12-15', isRolling: false, disciplines: ['Biotechnology'], matchReasons: ['Matches the selected Biotechnology research area.'] }
  const person = { id: 'fixture-person', name: 'Dr Example Researcher', designation: 'Associate Professor', school: 'School of Biotechnology', department: 'Bioengineering',
    summary: 'Research on microfluidic biosensors and point-of-care diagnostics.', areas: ['Biosensors', 'Microfluidics'], standardAreas: [area], savedAreas: [{ id: 'interest', label: 'Low-cost cancer diagnostics' }], matchReason: 'Relevant publication and a linked standard area.' }
  const requests = []
  await page.addInitScript(() => {
    const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }))
    localStorage.setItem('auth_token', `fixture.${payload}.not-a-real-signature`)
  })
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url())
    let data = { modules: [] }
    if (url.pathname === '/api/v1/auth/whoami') data = { user_id: 'fixture-user', email: 'fixture@example.test', tenant_id: 'fixture-tenant', roles: ['ADMIN'], ati_id: null }
    if (url.pathname === '/api/funding-dept/me') data = { isMember: false, isHead: false, schools: [], reachSchools: [], managedUnits: [], canAdminister: true, capabilities: { canAssign: true, canViewReports: true, isTenantWide: true } }
    if (url.pathname === '/api/discovery/calls' && request.method() === 'GET') data = { areas: [area, { id: 'scientify:discipline:ai', label: 'Artificial Intelligence' }, { id: 'scientify:discipline:med', label: 'Medical Sciences' }] }
    if (url.pathname === '/api/discovery/people' && request.method() === 'GET') data = { canSearchPeople: true, scopeLabel: 'Your organisation', units: [{ id: 'biotech', name: 'School of Biotechnology', kind: 'SCHOOL' }, { id: 'dept', name: 'Bioengineering', kind: 'DEPARTMENT' }] }
    if (url.pathname.startsWith('/api/discovery/') && request.method() === 'POST') {
      const body = request.postDataJSON(); requests.push({ path: url.pathname, ...body })
      if (body.query === 'slow search') await new Promise(resolve => setTimeout(resolve, 800))
      data = url.pathname.endsWith('/calls') ? { calls: [call], total: 1, page: 1, totalPages: 1, basis: body.mode === 'semantic' ? 'semantic' : 'directory' }
        : { people: [person], total: 1, page: 1, totalPages: 1, basis: body.kind === 'person' ? 'identity' : body.kind === 'standard' ? 'standard' : 'semantic', warning: body.kind === 'call' ? 'Research fit does not confirm eligibility.' : null }
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
  })
  await page.goto(new URL('/discovery', preview).href, { waitUntil: 'networkidle', timeout: 120000 })
  console.log('Page loaded; checking standard-area controls')
  await page.getByRole('checkbox', { name: 'Biotechnology', exact: true }).check()
  await page.getByRole('button', { name: 'Find calls', exact: true }).click()
  await page.getByRole('heading', { name: '1 funding call', exact: true }).waitFor()
  assert.deepEqual(requests.at(-1).areaIds, [area.id])
  page.once('dialog', dialog => dialog.accept('Biotechnology funding'))
  await page.getByRole('button', { name: 'Save search', exact: true }).click()
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('grapsi:discovery:fixture-user') || '[]'))
  assert.equal(saved[0].name, 'Biotechnology funding')
  assert.deepEqual(Object.keys(saved[0]).sort(), ['name', 'state'], 'saved searches contain context, not returned faculty records')
  const output = path.join(process.cwd(), 'outputs', 'research-discovery')
  fs.mkdirSync(output, { recursive: true })
  await page.screenshot({ path: path.join(output, 'calls-desktop.png'), fullPage: true })
  await page.getByRole('button', { name: 'Find aligned people' }).click()
  await page.getByRole('button', { name: 'Find aligned people' }).click()
  await page.getByRole('heading', { name: '1 research suggestion', exact: true }).waitFor()
  assert.equal(requests.at(-1).kind, 'call')
  assert.equal(requests.at(-1).callId, call.id)
  await page.getByRole('tab', { name: /A person’s research/ }).click()
  await page.getByLabel('Name, email or employee ID', { exact: true }).fill('Example')
  await page.getByRole('button', { name: 'Find person', exact: true }).click()
  await page.getByRole('heading', { name: 'Dr Example Researcher' }).waitFor()
  assert.equal(requests.at(-1).kind, 'person')
  await page.getByRole('button', { name: /Find calls in these areas/ }).click()
  await page.getByRole('button', { name: 'Find calls', exact: true }).click()
  await page.getByRole('heading', { name: '1 funding call', exact: true }).waitFor()
  assert.deepEqual(requests.at(-1).areaIds, [area.id])
  await page.getByRole('tab', { name: /People by area/ }).click()
  await page.getByLabel('School or department').selectOption('biotech')
  await page.getByRole('button', { name: 'Find people', exact: true }).click()
  await page.getByRole('heading', { name: 'Dr Example Researcher' }).waitFor()
  assert.equal(requests.at(-1).unitId, 'biotech')
  await page.screenshot({ path: path.join(output, 'people-desktop.png'), fullPage: true })
  await page.getByRole('radio', { name: 'Own words' }).check()
  await page.getByLabel('Describe the research').fill('slow search')
  await page.getByRole('button', { name: 'Find people', exact: true }).click()
  await page.getByRole('tab', { name: /Calls by area/ }).click()
  await page.waitForTimeout(1000)
  assert.equal(await page.getByRole('heading', { name: 'Dr Example Researcher' }).count(), 0, 'late response must not populate another task')
  await page.getByRole('tab', { name: /Calls by area/ }).focus()
  await page.keyboard.press('ArrowRight')
  await page.getByRole('tab', { name: /People by area/ }).getAttribute('aria-selected').then(value => assert.equal(value, 'true'))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, 'mobile must not overflow horizontally')
  assert.deepEqual(errors, [], 'no client runtime errors')
  console.log('Passed: standard calls, saved search context, call alignment, identity search, person-to-calls, scoped people, stale-response cancellation, keyboard tabs, mobile layout; no API requests reached the server.')
  await browser.close()
}
main().catch(async error => {
  console.error(error.message)
  const page = activeBrowser?.contexts()[0]?.pages()[0]
  if (page) {
    console.error((await page.locator('body').innerText()).slice(0, 3500))
    await page.screenshot({ path: path.join(process.cwd(), 'outputs', 'discovery-ui-failure.png'), fullPage: true })
  }
  await activeBrowser?.close()
  process.exitCode = 1
})
