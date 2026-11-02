// Local fixture-only browser checks. Every API is intercepted; no emails or real records.
const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const base = process.env.PERSONAL_GRANTS_PREVIEW_URL || 'http://127.0.0.1:3072'
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname))
const out = path.join(process.cwd(), 'outputs', 'personal-grants-20261101')
fs.mkdirSync(out, { recursive: true })
const title = 'Translational research for sustainable water systems'
const call = { id: 'call', title, scheme_title: title, agencyName: 'Research Foundation', agency_name: 'Research Foundation', deadlineAt: '2090-11-15T00:00:00Z', close_date: '2090-11-15T00:00:00Z' }
const opportunity = { id: 'call', agencyName: call.agencyName, schemeTitle: title, shortDescription: 'Support interdisciplinary teams developing affordable water treatment and monitoring technologies with measurable community impact.', closeDate: call.close_date, isRolling: false, amountMin: 2500000, amountMax: 5000000, currency: 'INR', eligibleCountries: ['India'], eligibleRegions: [], hostCountries: [], fundingKinds: ['Research grant'], careerStages: [], institutionTypes: [], disciplines: [], officialUrls: [], isCatalog: true, authoringReady: true, eligibilityVerdict: null, profileMatch: null, limitedSubmissions: false }
const personal = { id: 'personal', funding_call_id: 'call', is_favourite: false, notes: '', notes_revision: 0, events: [], funding_call: call }
let browser, page
async function main() {
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, timezoneId: 'Asia/Kolkata' })
  page = await context.newPage()
  const errors = [], writes = []
  let failCalendar = false, conflict = false, failFavourite = false
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => localStorage.setItem('auth_token', `fixture.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }))}.fixture`))
  const json = (route, data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
  await page.route('**/api/**', async route => {
    const req = route.request(), url = new URL(req.url()), method = req.method()
    const body = ['POST', 'PATCH', 'DELETE'].includes(method) ? req.postDataJSON() : null
    let data = { modules: [], results: [], items: [], areas: [], selected: [], total: 0, runs: [] }
    if (url.pathname === '/api/v1/auth/whoami') data = { user_id: 'fixture', email: 'preview@example.test', tenant_id: 'fixture-tenant', roles: ['ADMIN'], ati_id: null }
    if (url.pathname === '/api/v1/me/entitlements') data = { plan: null, featureCodes: [], modules: [], isPlatform: true }
    if (url.pathname === '/api/v1/me/tenant-settings') data = { timezone: 'Asia/Kolkata', locale: 'en-IN', currency: 'INR' }
    if (url.pathname === '/api/researcher/context') data = { profile: null, researchAreas: [], publications: [] }
    if (url.pathname === '/api/recommendations/manual-search') data = { results: [opportunity], page: 1, totalPages: 1, totalResults: 1, hasNextPage: false, hasPreviousPage: false }
    if (url.pathname === '/api/recommendations/directory/facets') data = { facets: {}, toggles: { membershipRequired: 0 } }
    if (url.pathname === '/api/recommendations/directory/statistics') data = { asOf: '1 Nov 2026', lifecycle: [], fundingKinds: [], origins: [] }
    if (url.pathname === '/api/funding-dept/me') data = { isMember: false, isHead: false, canAccess: false, managedUnits: [], schools: [], member: null }
    if (url.pathname === '/api/notifications') data = { notifications: [], unreadCount: 0 }
    if (url.pathname === '/api/funding/personal-grants') {
      const saved = personal.is_favourite || personal.notes || personal.events.length
      const visible = url.searchParams.has('callIds') || (saved && (url.searchParams.get('view') !== 'favourites' || personal.is_favourite))
      const query = url.searchParams.get('q') || ''
      const items = visible && title.toLowerCase().includes(query.toLowerCase()) ? [personal] : []
      data = { items, total: items.length, page: 1, pageSize: 24 }
    }
    if (url.pathname === '/api/funding/personal-grants/call') {
      if (method === 'PATCH') {
        writes.push({ path: url.pathname, method, body })
        if (failFavourite && body.is_favourite !== undefined) return json(route, { message: 'Could not save favourite.' }, 500)
        if (body.notes !== undefined) {
          if (conflict) { conflict = false; personal.notes_revision++; return json(route, { message: 'Your notes changed in another tab. Copy your draft, then reload the saved notes.' }, 409) }
          personal.notes = body.notes; personal.notes_revision++
        }
        if (body.is_favourite !== undefined) personal.is_favourite = body.is_favourite
      }
      data = { item: personal }
    }
    if (url.pathname === '/api/funding/personal-grants/call/events') {
      writes.push({ path: url.pathname, method, body })
      const event = { id: 'event', title: body.title, event_at: new Date(`${body.local_event_at}:00+05:30`).toISOString(), timezone: body.timezone, reminder_at: body.reminder_local_at ? new Date(`${body.reminder_local_at}:00+05:30`).toISOString() : null, reminder_state: body.reminder_local_at ? 'PENDING' : 'NONE', sent_at: null, revision: 0 }
      personal.events.push(event); return json(route, { event }, 201)
    }
    if (url.pathname === '/api/funding/personal-grants/events/event') {
      writes.push({ path: url.pathname, method, body })
      if (method === 'DELETE') { personal.events = []; data = { event: null } }
      else { Object.assign(personal.events[0], { title: body.title, reminder_at: body.reminder_local_at ? new Date(`${body.reminder_local_at}:00+05:30`).toISOString() : null, reminder_state: body.reminder_local_at ? 'PENDING' : 'NONE', revision: personal.events[0].revision + 1 }); data = { event: personal.events[0] } }
    }
    if (url.pathname === '/api/funding/personal-grants/calendar') {
      if (failCalendar) return json(route, { message: 'Calendar is temporarily unavailable.' }, 500)
      const events = personal.events.filter(event => event.event_at >= url.searchParams.get('from') && event.event_at < url.searchParams.get('to')).map(event => ({ ...event, personal_grant: personal }))
      data = { events, total: events.length, page: 1, pageSize: 200 }
    }
    return json(route, data)
  })
  const goto = async url => { try { await page.goto(`${base}${url}`, { waitUntil: 'domcontentloaded', timeout: 120000 }) } catch (e) { if (!String(e).includes('ERR_ABORTED')) throw e; await page.goto(`${base}${url}`, { waitUntil: 'domcontentloaded', timeout: 120000 }) } }
  const overflow = async () => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'horizontal overflow')
  await goto('/finder')
  const star = page.getByRole('button', { name: `Favourite ${title}`, exact: true })
  await star.waitFor({ state: 'visible' }); await star.click()
  await page.getByRole('button', { name: `Remove ${title} from favourites`, exact: true }).waitFor()
  assert.equal(personal.is_favourite, true)
  await page.getByRole('button', { name: 'Plan & notes', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Personal notes', { exact: true }).fill('Discuss pilot sites with the water research group. Prepare the budget and ethics checklist.')
  await dialog.getByRole('button', { name: 'Save notes', exact: true }).click()
  await dialog.getByText('Personal notes saved.', { exact: true }).waitFor()
  await dialog.getByRole('button', { name: 'Add calendar entry', exact: true }).click()
  await dialog.getByLabel('Entry title', { exact: true }).fill('Review pilot budget')
  await dialog.getByLabel('Calendar date and time', { exact: true }).fill('2090-11-10T10:00')
  await dialog.getByLabel('Time zone', { exact: true }).fill('Asia/Kolkata')
  await dialog.getByLabel('Email me a reminder', { exact: true }).check()
  await dialog.getByLabel('Send reminder on', { exact: true }).fill('2090-11-09T09:00')
  await dialog.getByRole('button', { name: 'Add to calendar', exact: true }).click()
  await dialog.getByText('Calendar entry saved.', { exact: true }).waitFor()
  await dialog.getByText('Review pilot budget', { exact: true }).waitFor()
  assert.equal(personal.events[0].reminder_at, '2090-11-09T03:30:00.000Z')
  await page.screenshot({ path: path.join(out, 'grant-notes-and-reminder-desktop.png') })
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await goto('/funding/my-grants')
  await page.getByText('1 favourite grant', { exact: true }).waitFor()
  await page.getByText(personal.notes, { exact: true }).waitFor()
  await overflow(); await page.screenshot({ path: path.join(out, 'favourites-desktop.png'), fullPage: true })
  await page.getByRole('button', { name: 'Grant calendar', exact: true }).click()
  await page.getByLabel('Calendar month', { exact: true }).fill('2090-11')
  await page.getByRole('heading', { name: 'Review pilot budget', exact: true }).waitFor()
  await overflow(); await page.screenshot({ path: path.join(out, 'calendar-desktop.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: path.join(out, 'calendar-mobile.png'), fullPage: true }); await overflow()
  await page.getByRole('button', { name: /Plan & notes/ }).click()
  await dialog.getByLabel('Personal notes', { exact: true }).fill('Unsaved draft')
  await page.keyboard.press('Escape')
  await dialog.getByText('You have unsaved changes. Close without saving?', { exact: true }).waitFor()
  await dialog.getByRole('button', { name: 'Keep editing', exact: true }).click()
  assert.equal(await dialog.getByLabel('Personal notes', { exact: true }).inputValue(), 'Unsaved draft')
  conflict = true
  await dialog.getByRole('button', { name: 'Save notes', exact: true }).click()
  await dialog.getByRole('button', { name: 'Load latest saved notes', exact: true }).click()
  await dialog.getByText('Latest saved notes loaded.', { exact: true }).waitFor()
  assert.equal(await dialog.getByLabel('Personal notes', { exact: true }).inputValue(), personal.notes)
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click()
  failCalendar = true
  await page.getByRole('button', { name: 'Next month', exact: true }).click()
  await page.getByRole('alert').getByText('Calendar is temporarily unavailable.', { exact: false }).waitFor()
  assert.equal(await page.getByRole('heading', { name: 'Review pilot budget', exact: true }).count(), 0)
  failCalendar = false
  await page.getByRole('button', { name: 'Previous month', exact: true }).click()
  await page.getByRole('heading', { name: 'Review pilot budget', exact: true }).waitFor()
  await page.getByRole('button', { name: /Plan & notes/ }).click()
  await dialog.getByRole('button', { name: 'Edit', exact: true }).click()
  await dialog.getByLabel('Email me a reminder', { exact: true }).uncheck()
  await dialog.getByRole('button', { name: 'Save calendar entry', exact: true }).click()
  await dialog.getByText('No email reminder', { exact: true }).waitFor()
  assert.equal(personal.events[0].reminder_at, null)
  await dialog.getByRole('button', { name: 'Remove entry', exact: true }).click()
  await dialog.getByRole('button', { name: 'Remove and cancel', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  assert.equal(personal.events.length, 0); assert.ok(personal.notes)
  await page.getByRole('button', { name: 'Favourites', exact: true }).click()
  await page.getByText('1 favourite grant', { exact: true }).waitFor()
  failFavourite = true
  await page.getByRole('button', { name: `Remove ${title} from favourites`, exact: true }).click()
  await page.getByRole('alert').getByText('Could not save favourite.', { exact: true }).waitFor()
  assert.equal(personal.is_favourite, true)
  failFavourite = false
  await page.getByRole('button', { name: `Remove ${title} from favourites`, exact: true }).click()
  await page.getByText('0 favourite grants', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'All saved grants', exact: true }).click()
  await page.getByText(personal.notes, { exact: true }).waitFor(); await overflow()
  await page.screenshot({ path: path.join(out, 'saved-notes-mobile.png'), fullPage: true })
  assert.equal(errors.length, 0, errors.join('\n'))
  const report = { checkedAt: new Date().toISOString(), fixtureOnly: true, productionDeployed: false, writes, checks: ['favourite persists across navigation', 'notes saved and recalled', 'calendar and email time zone', 'calendar desktop/mobile', 'unsaved draft protection', 'note conflict recovery', 'stale calendar hidden on failure', 'reminder cancellation', 'entry removal preserves notes', 'failed favourite save preserves state', 'unfavourite preserves notebook', 'no horizontal overflow or browser errors'] }
  fs.rmSync(path.join(out, 'failure.png'), { force: true })
  fs.writeFileSync(path.join(out, 'browser-verification.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ ok: true, checks: report.checks.length, screenshots: fs.readdirSync(out).filter(file => file.endsWith('.png')) }))
}
main().catch(async error => { console.error(error); if (page) await page.screenshot({ path: path.join(out, 'failure.png'), fullPage: true }).catch(() => {}); process.exitCode = 1 }).finally(async () => { if (browser) await browser.close() })
