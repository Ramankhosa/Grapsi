/** Read-only upstream contract/search/lookup smoke check; never calls paid analysis. */
import { loadEnvConfig } from '@next/env'
import { strict as assert } from 'node:assert'
import { PatentNestClient, isPatentNestConfigured, resolvePatentNestBaseUrl } from '../src/lib/patentnest/client'
import type { PatentNestSearchRequest } from '../src/lib/patentnest/types'

async function main() {
  loadEnvConfig(process.cwd(), true)
  const base = resolvePatentNestBaseUrl()
  const specResponse = await fetch(`${base}/api/v1/openapi.json`, { signal: AbortSignal.timeout(25000) })
  assert.equal(specResponse.status, 200)
  const spec = await specResponse.json()
  const schema = spec.paths['/api/v1/patents/search'].post.requestBody.content['application/json'].schema
  for (const field of ['filters', 'mode', 'offset', 'fields', 'sort', 'jurisdictions']) assert.ok(schema.properties[field], `Missing upstream search property: ${field}`)
  assert.ok(schema.properties.fields.items.enum.includes('grantDate'))
  console.log(`PatentNest OpenAPI ${spec.info.version}: v1.3 search capabilities verified.`)

  if (!isPatentNestConfigured()) {
    console.log('Authenticated checks skipped: PATENTNEST_API_KEY is not configured in this environment.')
    return
  }
  const client = new PatentNestClient({ maxRetries: 0, timeoutMs: 25000 })
  const request: PatentNestSearchRequest = { mode: 'structured', filters: { title: 'battery' }, fields: ['title', 'grantDate', 'filingDate'], sort: 'publicationDateDesc', limit: 2, offset: 0 }
  const first = await client.searchPatents(request)
  assert.equal(first.data.mode, 'structured')
  assert.ok(Array.isArray(first.data.results))
  assert.equal(first.data.pagination?.offset, 0)
  assert.equal(first.data.pagination?.limit, 2)
  for (const record of first.data.results) {
    assert.ok(record.publicationNumber)
    assert.ok(record.source?.name)
    assert.ok(!Object.prototype.hasOwnProperty.call(record, 'abstract'), 'Field selection was ignored')
  }
  if (first.data.pagination?.nextOffset !== null && first.data.pagination?.nextOffset !== undefined) {
    const next = await client.searchPatents({ ...request, offset: first.data.pagination.nextOffset })
    assert.equal(next.data.pagination?.offset, first.data.pagination.nextOffset)
    assert.ok(!next.data.results.some(row => first.data.results.some(previous => previous.publicationNumber === row.publicationNumber)), 'Pages overlap')
    console.log('Authenticated structured search, field selection and next page verified.')
  } else console.log('Authenticated structured search and field selection verified; no next page.')
  if (first.data.results[0]?.publicationNumber) {
    const detail = await client.getPatent(first.data.results[0].publicationNumber, { fields: ['title', 'grantDate'] })
    assert.equal(detail.data.publicationNumber, first.data.results[0].publicationNumber)
    assert.ok(detail.data.source?.name)
    console.log('Authenticated selected-field detail lookup verified.')
  }
}

main().catch(error => {
  // Only emit sanitized client errors; never dump environment or request headers.
  console.error(error instanceof Error ? error.message : 'PatentNest verification failed.')
  process.exitCode = 1
})
