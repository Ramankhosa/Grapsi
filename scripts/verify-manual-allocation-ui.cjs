/* Browser smoke checks against a local dev server; all API calls are mocked. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const base = process.env.ALLOCATION_UI_URL || 'http://localhost:3010'
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Use a local development server.')
const output = path.resolve('test-results/manual-allocation-ui')
fs.mkdirSync(output, { recursive: true })
const person = { userId: 'person', name: 'Faculty Example', email: 'faculty@example.invalid', employeeId: 'EMP-101', school: 'Engineering', department: 'Design', researchAreas: [], hasEmbedding: false, activated: true, liveAssignments: 0, publicationCount: 0 }
const school = { id: 'school', name: 'Engineering', departments: [{ id: 'dept', name: 'Design' }] }
const me = { isMember: true, isHead: false, memberId: 'member', title: 'Coordinator', schools: [school], reachSchools: [school], managedUnits: [], canAdminister: false, capabilities: { canAssign: true, canViewReports: true, isTenantWide: false } }
const openCall = { id: 'ui-call', title: 'Unrelated research call', agency: 'Example Agency', closeDate: '2099-10-01T00:00:00Z', isClosed: false, existingAssignment: null, responsibility: { schoolId: 'school', schoolName: 'Engineering', willReopen: false, previousReason: null } }
const expired = { ...openCall, id: 'expired', title: 'Closed interdisciplinary call', closeDate: '2000-01-01T00:00:00Z', isClosed: true, responsibility: { ...openCall.responsibility, willReopen: true, previousReason: 'Earlier head decision' } }
const saved = { id: 'saved', status: 'ASSIGNED', allocationMethod: 'MANUAL', allocationReason: 'FACULTY_WILLINGNESS', allocationNote: 'Agreed to explore', message: 'Please review', deadlineAt: null, outcome: 'PENDING', call: { id: 'ui-call', title: openCall.title }, assignee: { id: person.userId, name: person.name, email: person.email }, assignedBy: { id: 'officer', name: 'DSR officer' } }

async function main() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const token = `test.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.test`
  await context.addInitScript(value => localStorage.setItem('auth_token', value), token)
  let submitted = [], facultyQueries = [], callQueries = [], showExisting = false
  const errors = []
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await context.route('**/api/**', async route => {
    const url = new URL(route.request().url()), p = url.pathname, q = url.searchParams
    const send = data => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
    if (p === '/api/v1/auth/whoami') return send({ user_id: 'officer', email: 'officer@example.invalid', tenant_id: 'tenant', ati_id: 'TEST', roles: ['MANAGER'] })
    if (p === '/api/funding-dept/me') return send(me)
    if (p === '/api/v1/me/entitlements') return send({ plan: null, featureCodes: [], modules: [], isPlatform: false })
    if (p === '/api/tenant-admin/faculty') return send(q.get('action') === 'facets' ? { schools: ['Engineering'], departments: ['Design'], designations: [], departmentsBySchool: { Engineering: ['Design'] } } : { faculty: [person], total: 1, embedded: 0, activatedCount: 1 })
    if (p === '/api/researcher-matching') return send(q.get('action') === 'profile' ? { profile: { ...person, userId: person.userId, links: {}, languages: [], keywords: [], publications: [] } } : { schools: [school] })
    if (p === '/api/assignments/options/calls') {
      callQueries.push(Object.fromEntries(q))
      let calls = q.get('callId') === 'expired' ? [expired] : [openCall]
      if (q.get('includeClosed') === 'true' && !q.get('callId')) calls = [openCall, expired]
      if (q.get('q') === 'old') { await new Promise(resolve => setTimeout(resolve, 650)); calls = [{ ...openCall, title: 'Stale result' }] }
      if (q.get('q') === 'new') calls = [{ ...openCall, title: 'Latest result' }]
      if (showExisting) calls = [{ ...openCall, existingAssignment: { id: 'saved', status: 'DECLINED' } }]
      try { return await send({ calls, total: q.get('callId') ? 1 : 42, limit: 20, offset: Number(q.get('offset') || 0) }) } catch { return }
    }
    if (p === '/api/assignments/options/faculty') {
      facultyQueries.push(Object.fromEntries(q))
      return send({ schools: [school], faculty: q.get('schoolId') ? [{ ...person, existingAssignment: null }] : [], total: q.get('schoolId') ? 1 : 0 })
    }
    if (p === '/api/assignments' && route.request().method() === 'POST') {
      submitted.push(route.request().postDataJSON())
      await new Promise(resolve => setTimeout(resolve, 200))
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ assignment: saved }) })
    }
    if (p === '/api/assignments/saved') return send({ assignment: saved })
    if (p === '/api/funding/calls/ui-call') return send({ call: { ...openCall, agencyName: 'Example Agency', deadlineAt: openCall.closeDate, visibility: 'TENANT_PRIVATE', status: 'PUBLISHED', catalogStatus: 'PUBLISHED', assets: [], recentJobs: [] } })
    return send({ notifications: [], unreadCount: 0, assignments: [], areas: [] })
  })
  try {
    await page.goto(`${base}/funding-dept/faculty`, { timeout: 120000 })
    const origin = page.getByRole('button', { name: 'Allocate call', exact: true })
    await origin.click()
    let dialog = page.getByRole('dialog', { name: /Allocate call/ })
    await dialog.getByRole('button', { name: 'Next', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('[role="dialog"]')?.textContent.includes('21–'))
    assert.equal(callQueries.at(-1).offset, '20')
    const search = dialog.getByLabel('Search calls')
    await search.fill('old')
    await page.waitForRequest(request => request.url().includes('q=old'))
    await search.fill('new')
    await dialog.getByText('Latest result', { exact: true }).waitFor()
    await page.waitForTimeout(750)
    assert.equal(await dialog.getByText('Stale result', { exact: true }).count(), 0)
    await search.fill('')
    await dialog.getByText(openCall.title, { exact: true }).waitFor()
    await dialog.getByRole('button', { name: 'Choose call' }).click()
    await dialog.getByLabel('Allocation reason (required)').waitFor()
    assert.equal(await dialog.getByRole('button', { name: 'Allocate and notify' }).isDisabled(), true)
    await dialog.getByLabel('Allocation reason (required)').selectOption('FACULTY_WILLINGNESS')
    await dialog.getByLabel('Allocation note (optional, visible to faculty)').fill('Agreed to explore')
    await dialog.getByLabel('Message to the faculty member').fill('Please review')
    await dialog.getByLabel('Internal deadline', { exact: true }).fill('2099-10-02')
    await dialog.getByText(/That is after the call closes/).waitFor()
    await page.screenshot({ path: path.join(output, 'faculty-allocation-desktop.png') })
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab')
      assert.equal(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')), true)
    }
    await dialog.getByRole('button', { name: 'Allocate and notify' }).evaluate(button => { button.click(); button.click() })
    await dialog.waitFor({ state: 'hidden' })
    assert.equal(submitted.length, 1)
    assert.equal(submitted[0].assigneeUserId, person.userId)
    assert.equal(submitted[0].allocationReason, 'FACULTY_WILLINGNESS')
    assert.equal(submitted[0].matchScore, undefined)
    await page.waitForFunction(() => document.activeElement?.textContent === 'Allocate call')

    await page.getByRole('button', { name: 'Profile', exact: true }).click()
    await page.getByRole('dialog', { name: 'Faculty profile', exact: true }).getByRole('button', { name: 'Allocate call', exact: true }).click()
    dialog = page.getByRole('dialog', { name: /Allocate call/ })
    await dialog.getByRole('button', { name: 'Choose call' }).waitFor()
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden' })
    assert.equal(await page.getByRole('dialog', { name: 'Faculty profile', exact: true }).isVisible(), true)
    await page.waitForFunction(() => document.activeElement?.textContent === 'Allocate call')
    await page.getByRole('button', { name: 'Close profile' }).click()

    await page.getByRole('button', { name: 'Allocate call', exact: true }).click()
    dialog = page.getByRole('dialog', { name: /Allocate call/ })
    await dialog.getByLabel('Include closed calls').check()
    await dialog.getByText(expired.title, { exact: true }).waitFor()
    await dialog.getByRole('button', { name: 'Choose call' }).nth(1).click()
    await dialog.getByText(/The submission deadline has passed/).waitFor()
    await dialog.getByText(/will reopen Engineering/).waitFor()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: path.join(output, 'closed-call-mobile.png') })
    const bounds = await dialog.boundingBox()
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 391)
    await page.keyboard.press('Escape')

    await page.goto(`${base}/funding/calls/ui-call`, { timeout: 120000 })
    await page.getByRole('button', { name: 'Allocate to faculty', exact: true }).click()
    dialog = page.getByRole('dialog', { name: /Allocate call/ })
    await dialog.getByLabel('Department (optional)').selectOption('dept')
    await dialog.getByLabel('Search faculty').fill('EMP-101')
    await page.waitForRequest(request => request.url().includes('EMP-101'))
    await dialog.getByRole('button', { name: 'Choose faculty', exact: true }).click()
    await dialog.getByLabel('Allocation reason (required)').waitFor()
    assert.equal(facultyQueries.at(-1).schoolId, 'school')
    assert.equal(facultyQueries.at(-1).departmentId, 'dept')
    assert.equal(facultyQueries.at(-1).q, 'EMP-101')
    await dialog.getByLabel('Allocation reason (required)').selectOption('INDIRECT_FIT')
    await dialog.getByRole('button', { name: 'Allocate and notify' }).click()
    await dialog.waitFor({ state: 'hidden' })
    assert.equal(submitted.length, 2)
    assert.equal(submitted[1].fundingCallId, 'ui-call')

    showExisting = true
    await page.goto(`${base}/funding-dept/faculty`)
    await page.getByRole('button', { name: 'Allocate call', exact: true }).click()
    dialog = page.getByRole('dialog', { name: /Allocate call/ })
    await dialog.getByRole('link', { name: /Open allocation/ }).click()
    await page.getByText('Manual allocation · Faculty willingness', { exact: true }).waitFor()
    assert.ok(page.url().includes('assignmentId=saved'))
    assert.equal(submitted.length, 2)
    assert.deepEqual(errors, [])
    console.log('Passed browser checks: both entry directions, search/pagination, stale responses, required reason, double-click guard, nested Escape, keyboard focus, mobile layout, expiry/reopening warnings, and existing-allocation navigation. API requests were mocked; no notifications sent.')
  } catch (error) {
    await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined)
    fs.writeFileSync(path.join(output, 'failure.txt'), errors.join('\n') + '\n' + await page.locator('body').innerText().catch(() => ''))
    throw error
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
