// Local browser verification. Every API response is synthetic; no application
// login, database write or paid provider call is made.
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
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, timezoneId: 'America/Los_Angeles' })
  const page = await context.newPage()
  const errors = [], requests = []
  page.on('pageerror', error => errors.push(error.message))
  const output = path.join(process.cwd(), 'outputs', 'research-discovery')
  fs.mkdirSync(output, { recursive: true })
  const area = { id: 'scientify:discipline:bio', label: 'Biotechnology' }
  const call = { id: 'fixture-call', schemeTitle: 'Translational biosensors for early cancer detection', agencyName: 'Research Foundation',
    shortDescription: 'Support for interdisciplinary teams developing accessible diagnostic technologies, from proof of concept to clinical validation.',
    description: 'Develop and validate affordable diagnostic technologies.', fullDescription: null,
    closeDate: '2026-12-15', isRolling: false, disciplines: ['Biotechnology'], matchReasons: ['Related to biosensor research.'],
    fundingKinds: ['Research Grant'], eligibleCountries: ['India'], eligibleRegions: [], hostCountries: [], institutionTypes: ['University'], careerStages: [],
    sponsorType: null, officialUrls: ['https://example.test/call'], profileMatch: null, eligibilitySummary: 'Check the official guidance.',
    amountMin: 10000, amountMax: 100000, currency: 'USD', eligibilityText: 'Open to university researchers.', geographyScope: 'INTERNATIONAL',
    funderCountry: null, contactInfo: null, score: 0.8, authoringReady: false }
  const person = { id: 'fixture-person', name: 'Dr Example Researcher', designation: 'Associate Professor', school: 'School of Biotechnology', department: 'Bioengineering',
    summary: 'Research on microfluidic biosensors and point-of-care diagnostics.', areas: ['Biosensors', 'Microfluidics'], standardAreas: [area],
    savedAreas: [{ id: 'interest', label: 'Low-cost cancer diagnostics' }], matchReason: 'Relevant publication and a linked standard area.' }
  const profile = { userId: person.id, name: person.name, email: 'researcher@example.test', employeeId: null, designation: person.designation, school: person.school,
    department: person.department, institution: 'Example University', careerStage: 'SENIOR', yearsOfExperience: 12, country: 'India', languages: ['English'],
    summary: person.summary, researchAreas: person.areas, keywords: [], links: { googleScholar: null, scopus: null, orcid: null, linkedin: null },
    publications: [{ id: 'pub', title: 'Accessible microfluidic diagnostics', authors: ['Example Researcher'], year: 2025, venue: 'Research Journal', doi: '10.0000/example', url: null }] }
  const dept = { id: 'dept', name: 'Bioengineering', code: 'BIO', parentId: 'biotech', depth: 1, path: ['biotech', 'dept'], levelLabel: 'Department', directCount: 24, rollupCount: 24, heads: [], areas: [area], children: [] }
  const school = { id: 'biotech', name: 'School of Biotechnology', code: 'BT', parentId: null, depth: 0, path: ['biotech'], levelLabel: 'School', directCount: 1, rollupCount: 25,
    heads: [{ userId: person.id, name: person.name, title: 'Head' }], areas: [area], children: [dept] }
  const capabilities = { canAssign: false, canOpenMatching: false, canSeeEmployeeIds: false }
  await page.addInitScript(() => {
    const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }))
    localStorage.setItem('auth_token', `fixture.${payload}.not-a-real-signature`)
    if (!localStorage.getItem('grapsi:discovery:fixture-user')) localStorage.setItem('grapsi:discovery:fixture-user', JSON.stringify([
      { name: 'Legacy colleague search', state: { task: 'person', mode: 'standard', query: 'Example', areaIds: [], unitId: '', callId: '', callTitle: '' } },
    ]))
  })
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url())
    const body = request.method() === 'POST' ? request.postDataJSON() : null
    requests.push({ path: url.pathname, method: request.method(), ...body })
    let status = 200, data = { modules: [], items: [] }
    if (url.pathname === '/api/v1/auth/whoami') data = { user_id: 'fixture-user', email: 'fixture@example.test', tenant_id: 'fixture-tenant', roles: ['MEMBER'], ati_id: null }
    if (url.pathname === '/api/funding-dept/me') data = { isMember: false, isHead: false, schools: [], reachSchools: [], managedUnits: [], canAdminister: false, capabilities: { ...capabilities, canViewReports: false, isTenantWide: false } }
    if (url.pathname === '/api/discovery/calls') data = body ? { calls: [call], total: 1, page: 1, totalPages: 1, basis: body.mode === 'semantic' ? 'semantic' : 'directory', bounded: body.mode === 'semantic' }
      : { areas: [area, { id: 'scientify:discipline:ai', label: 'Artificial Intelligence' }] }
    if (url.pathname === '/api/discovery/people' && !body) data = { canSearchPeople: true, scopeLabel: 'Your organisation', capabilities,
      designations: [{ value: 'Associate Professor', count: 12 }], careerStages: [{ value: 'SENIOR', count: 12 }] }
    if (url.pathname === '/api/discovery/org') data = { roots: [school], areaFilter: 'importedAreaIds', unplacedCount: 1, totalPeople: 26 }
    if (url.pathname === `/api/discovery/people/${person.id}`) data = { profile }
    if (url.pathname === `/api/funding/calls/${call.id}`) data = { call: { ...call, title: call.schemeTitle, deadlineAt: call.closeDate,
      citizenshipRequirements: ['India'], residencyRequirements: [], applicationLanguages: ['English'], visibility: 'GLOBAL_PUBLISHED' } }
    if (url.pathname === '/api/recommendations/manual-search') data = { results: [call], totalResults: 13, page: body.page || 1, totalPages: 2, hasNextPage: (body.page || 1) < 2, hasPreviousPage: body.page > 1 }
    if (url.pathname === '/api/recommendations/directory/facets') data = { totalPublished: 13, facets: { fundingKind: [{ value: 'Research Grant', label: 'Research Grant', count: 13 }] } }
    if (url.pathname === '/api/recommendations/directory/areas') data = { areas: [{ ...area, count: 13 }], selected: [{ ...area, count: 13 }], total: 1 }
    if (url.pathname === '/api/recommendations/directory/statistics') data = { asOf: '2026-11-03', lifecycle: [], fundingKinds: [], origins: [], unmapped: [] }
    if (url.pathname === '/api/discovery/people' && body) {
      if (body.query === 'slow search') await new Promise(resolve => setTimeout(resolve, 800))
      const semantic = ['semantic', 'call'].includes(body.kind)
      const total = body.query === 'nobody' ? 0 : body.kind === 'browse' && !body.unitId ? 26 : 1
      data = { people: total ? [{ ...person, eligibility: body.kind === 'call' ? { group: 'CONFLICT', conflicts: ['Career stage needs review'], toCheck: ['Citizenship not recorded'] } : null }] : [],
        total, page: body.page || 1, totalPages: total > 24 ? 2 : 1, basis: semantic ? 'semantic' : body.kind === 'person' ? 'identity' : body.kind === 'standard' ? 'standard' : 'directory', bounded: semantic }
      if (body.query === 'service failure') { status = 503; data = { error: 'People search is temporarily unavailable. Please retry.' } }
    }
    try { await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) }) } catch (error) { if (!/closed|handled/i.test(error.message)) throw error }
  })
  const last = path => requests.filter(request => request.path === path && request.method === 'POST').at(-1)
  const screenshot = name => page.screenshot({ path: path.join(output, name), fullPage: !/panel|profile|filters/.test(name), animations: 'disabled' })
  const noOverflow = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, 'page must not overflow horizontally')

  await page.goto(new URL('/discovery', preview).href, { waitUntil: 'networkidle', timeout: 120000 })
  await page.getByRole('heading', { name: call.schemeTitle, exact: true }).waitFor()
  await page.getByRole('checkbox', { name: 'Biotechnology', exact: false }).check()
  await page.waitForFunction(id => JSON.parse(new URL(location.href).searchParams.get('f')).importedAreaIds.includes(id), area.id)
  assert.deepEqual(last('/api/recommendations/manual-search').filters.importedAreaIds, [area.id])
  await page.getByRole('button', { name: 'Application language', exact: true }).click()
  await page.getByRole('checkbox', { name: 'English', exact: true }).check()
  await page.getByRole('navigation', { name: 'Pages', exact: true }).getByRole('button', { name: 'Next', exact: true }).click()
  await page.waitForFunction(() => new URL(location.href).searchParams.get('cpage') === '2')
  assert.deepEqual(last('/api/recommendations/manual-search').filters.applicationLanguages, ['English'])
  page.once('dialog', dialog => dialog.accept('Biotechnology funding'))
  await page.getByRole('button', { name: 'Save search', exact: true }).click()
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('grapsi:discovery:fixture-user')))
  assert.equal(saved[0].name, 'Biotechnology funding')
  assert.deepEqual(Object.keys(saved[0]).sort(), ['link', 'name'])
  await noOverflow(); await screenshot('calls-desktop.png')
  await page.getByRole('button', { name: 'Details', exact: true }).click()
  const detail = page.getByRole('dialog')
  await detail.getByRole('heading', { name: 'Who can apply' }).waitFor()
  await detail.getByText('15 Dec 2026', { exact: true }).waitFor()
  assert.match(await detail.innerText(), /USD 10,000/)
  await screenshot('call-panel-desktop.png')
  await detail.getByRole('button', { name: 'Find aligned people' }).click()
  await page.getByRole('heading', { name: '1 research suggestion', exact: true }).waitFor()
  assert.equal(last('/api/discovery/people').kind, 'call')
  await page.getByText('Eligibility conflict', { exact: true }).waitFor()
  assert.equal(await page.getByRole('link', { name: 'Open matching workspace' }).count(), 0)

  await page.getByRole('radio', { name: 'Name', exact: true }).check()
  await page.getByLabel('Name or email', { exact: true }).fill('Example')
  await page.getByRole('button', { name: 'Find people', exact: true }).click()
  await page.getByRole('heading', { name: person.name, exact: true }).waitFor()
  assert.equal(last('/api/discovery/people').kind, 'person')
  await page.getByRole('button', { name: 'View profile', exact: true }).click()
  await page.getByRole('dialog').getByText('Accessible microfluidic diagnostics', { exact: true }).waitFor()
  assert.equal(await page.getByRole('dialog').getByText(/Employee ID/).count(), 0)
  assert.equal(await page.getByRole('dialog').getByRole('button', { name: /Assign|Allocate/ }).count(), 0)
  for (let i = 0; i < 12; i++) await page.keyboard.press('Tab')
  assert.equal(await page.evaluate(() => document.querySelector('[role="dialog"]').contains(document.activeElement)), true, 'profile focus must stay inside its panel')
  await screenshot('profile-desktop.png')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'View profile', exact: true }).waitFor({ state: 'visible' })
  await page.waitForFunction(() => document.activeElement?.textContent === 'View profile')
  await screenshot('people-desktop.png')
  await page.getByRole('button', { name: /Find calls in these areas/ }).click()
  await page.getByRole('heading', { name: call.schemeTitle, exact: true }).waitFor()
  assert.deepEqual(last('/api/recommendations/manual-search').filters.importedAreaIds, [area.id])
  await page.getByRole('radio', { name: 'Describe your research', exact: true }).check()
  await page.getByRole('textbox', { name: 'Describe your research', exact: true }).fill('cancer biosensors')
  await page.getByRole('button', { name: 'Find suggestions', exact: true }).click()
  await page.getByText(/top results, up to 50/).waitFor()
  assert.deepEqual(last('/api/discovery/calls').filters.importedAreaIds, [area.id])
  await page.getByRole('button', { name: 'Application language', exact: true }).click()
  await page.getByRole('checkbox', { name: 'English', exact: true }).check()
  await page.waitForFunction(() => JSON.parse(new URL(location.href).searchParams.get('f')).applicationLanguages.includes('English'))
  assert.deepEqual(last('/api/discovery/calls').filters.applicationLanguages, ['English'])
  await screenshot('semantic-desktop.png')

  await page.getByRole('tab', { name: 'Organisation', exact: true }).click()
  const orgNav = page.getByRole('navigation', { name: 'Organisation units' })
  await orgNav.getByRole('button', { name: /^School of Biotechnology/ }).click()
  await page.getByRole('heading', { name: school.name, exact: true }).waitFor()
  await page.getByRole('heading', { name: person.name, exact: true }).waitFor()
  assert.equal(last('/api/discovery/people').unitId, 'biotech')
  await page.getByLabel('Include departments below this unit').uncheck()
  await page.getByLabel('Designation', { exact: true }).selectOption('Associate Professor')
  await page.getByRole('button', { name: 'Update people', exact: true }).click()
  await page.getByRole('heading', { name: person.name, exact: true }).waitFor()
  assert.equal(last('/api/discovery/people').includeSubunits, false)
  assert.equal(last('/api/discovery/people').designation, 'Associate Professor')
  await screenshot('organisation-desktop.png'); await noOverflow()
  await orgNav.getByRole('button', { name: /^Without an active unit/ }).click()
  await page.getByRole('heading', { name: 'People without a unit' }).waitFor()
  assert.equal(last('/api/discovery/people').unitId, '__unplaced__')
  await orgNav.getByRole('button', { name: /^School of Biotechnology/ }).click()
  await page.getByRole('button', { name: 'Find calls for these areas' }).click()
  await page.getByRole('heading', { name: call.schemeTitle, exact: true }).waitFor()
  assert.deepEqual(last('/api/recommendations/manual-search').filters.importedAreaIds, [area.id])

  await page.getByRole('tab', { name: 'People', exact: true }).click()
  await page.getByRole('radio', { name: 'Matched to a call', exact: true }).check()
  await page.getByRole('button', { name: 'Change call', exact: true }).click()
  await page.getByLabel('Call title or funder', { exact: true }).fill('biosensors')
  await page.getByRole('button', { name: 'Find a call', exact: true }).click()
  await page.getByRole('button', { name: new RegExp(call.schemeTitle) }).click()
  await page.getByRole('button', { name: 'Find aligned people', exact: true }).click()
  await page.getByRole('heading', { name: '1 research suggestion', exact: true }).waitFor()
  await page.getByRole('radio', { name: 'Name', exact: true }).check()
  await page.getByLabel('Name or email', { exact: true }).fill('nobody')
  await page.getByRole('button', { name: 'Find people', exact: true }).click()
  await page.getByRole('heading', { name: 'No people found' }).waitFor()
  await page.getByLabel('Name or email', { exact: true }).fill('service failure')
  await page.getByRole('button', { name: 'Find people', exact: true }).click()
  await page.getByRole('alert').getByText(/People search is temporarily unavailable/).waitFor()
  await page.getByRole('radio', { name: 'Standard areas', exact: true }).check()
  await page.getByRole('checkbox', { name: 'Biotechnology', exact: true }).check()
  await page.getByLabel('School or department', { exact: true }).selectOption('dept')
  await page.getByRole('button', { name: 'Find people', exact: true }).click()
  await page.getByRole('heading', { name: person.name, exact: true }).waitFor()
  assert.equal(last('/api/discovery/people').kind, 'standard')
  assert.equal(last('/api/discovery/people').unitId, 'dept')
  await page.getByRole('radio', { name: 'Describe expertise', exact: true }).check()
  await page.getByRole('textbox', { name: 'Describe expertise', exact: true }).fill('slow search')
  await page.getByRole('button', { name: 'Find people', exact: true }).click()
  await page.getByRole('tab', { name: 'Calls', exact: true }).click()
  await page.waitForTimeout(1000)
  assert.equal(await page.getByRole('heading', { name: person.name, exact: true }).count(), 0, 'late results must not populate another tab')
  await page.getByRole('tab', { name: 'Calls', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  assert.equal(await page.getByRole('tab', { name: 'People', exact: true }).getAttribute('aria-selected'), 'true')

  await page.setViewportSize({ width: 375, height: 812 })
  await page.getByRole('tab', { name: 'Calls', exact: true }).click()
  await page.getByRole('heading', { name: call.schemeTitle, exact: true }).waitFor()
  await noOverflow(); await screenshot('calls-mobile.png')
  await page.getByRole('button', { name: 'Filters', exact: true }).click()
  await page.getByRole('dialog').getByRole('heading', { name: 'Refine your search', exact: true }).waitFor()
  await screenshot('filters-mobile.png')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Details', exact: true }).click()
  await page.getByRole('dialog').getByRole('heading', { name: 'Who can apply', exact: true }).waitFor()
  await noOverflow(); await screenshot('call-panel-mobile.png')
  await page.getByRole('dialog').evaluate(node => { node.scrollTop = node.scrollHeight })
  const officialBox = await page.getByRole('dialog').getByRole('link', { name: 'https://example.test/call', exact: true }).boundingBox()
  const footerBox = await page.getByRole('dialog').getByRole('button', { name: 'Find aligned people', exact: true }).boundingBox()
  assert.ok(officialBox && footerBox && officialBox.y + officialBox.height <= footerBox.y, 'lower call details must scroll above the fixed actions')
  await screenshot('call-panel-bottom-mobile.png')
  await page.keyboard.press('Escape')
  await page.getByRole('tab', { name: 'People', exact: true }).click()
  await page.getByRole('radio', { name: 'Name', exact: true }).check()
  await page.getByLabel('Name or email', { exact: true }).fill('Example')
  await page.getByRole('button', { name: 'Find people', exact: true }).click()
  await page.getByRole('heading', { name: person.name, exact: true }).waitFor()
  await noOverflow(); await screenshot('people-mobile.png')
  await page.getByRole('tab', { name: 'Organisation', exact: true }).click()
  await page.getByRole('heading', { name: school.name, exact: true }).waitFor()
  await noOverflow(); await screenshot('organisation-mobile.png')

  await page.locator('summary').filter({ hasText: 'Saved on this browser' }).click()
  await page.getByRole('button', { name: 'Legacy colleague search', exact: true }).click()
  await page.getByRole('heading', { name: person.name, exact: true }).waitFor()
  assert.equal(await page.getByLabel('Name or email', { exact: true }).inputValue(), 'Example')
  assert.deepEqual(errors, [], 'no client runtime errors')
  console.log('Passed: shared directory filters and pagination; semantic filters; old saved searches; call/profile panels and focus; ordinary-member permissions; call picker and eligibility; organisation/subunit/unplaced browsing; people filters; errors and empty states; stale responses; keyboard tabs; 1280px and 375px layouts. All APIs used synthetic fixtures.')
  await browser.close()
}
main().catch(async error => {
  console.error(error.stack || error.message)
  const page = activeBrowser?.contexts()[0]?.pages()[0]
  if (page) {
    console.error((await page.locator('body').innerText()).slice(0, 5000))
    await page.screenshot({ path: path.join(process.cwd(), 'outputs', 'discovery-ui-failure.png'), fullPage: true })
  }
  await activeBrowser?.close()
  process.exitCode = 1
})
