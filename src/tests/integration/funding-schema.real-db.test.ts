import fs from 'fs'
import path from 'path'

import { afterEach, describe, expect, it } from 'vitest'

import { prisma } from '@/lib/prisma'
import { createTenant, createUser, resetPhase1Data } from '@/tests/integration/helpers/phase1-test-helpers'

afterEach(async () => {
  await resetPhase1Data()
})

describe('Phase 2 funding schema real DB validation', () => {
  it('allows a global funding import job with null tenantId and global visibility', async () => {
    const user = await createUser({
      tenantId: null,
      emailPrefix: 'phase2-schema-global-admin',
      roles: ['SUPER_ADMIN'],
    })

    const job = await prisma.fundingImportJob.create({
      data: {
        tenantId: null,
        visibility: 'GLOBAL_PUBLISHED',
        sourceType: 'TEXT',
        sourceLocator: 'inline text',
        createdByUserId: user.id,
        updatedByUserId: user.id,
      },
    })

    expect(job.tenantId).toBeNull()
    expect(job.visibility).toBe('GLOBAL_PUBLISHED')
  })

  it('persists funding import assets linked to a job and call', async () => {
    const tenant = await createTenant('phase2-schema-tenant')
    const user = await createUser({
      tenantId: tenant.id,
      emailPrefix: 'phase2-schema-user',
      roles: ['ANALYST'],
    })

    const fundingCall = await prisma.fundingCall.create({
      data: {
        tenantId: tenant.id,
        visibility: 'TENANT_PRIVATE',
        status: 'PUBLISHED',
        title: 'Schema Funding Call',
        sourceType: 'URL',
        sourceUrl: 'https://example.com/schema-call',
        createdByUserId: user.id,
        updatedByUserId: user.id,
      },
    })

    const job = await prisma.fundingImportJob.create({
      data: {
        tenantId: tenant.id,
        visibility: 'TENANT_PRIVATE',
        fundingCallId: fundingCall.id,
        sourceType: 'FILE',
        sourceLocator: 'schema-call.pdf',
        status: 'COMPLETED',
        createdByUserId: user.id,
        updatedByUserId: user.id,
      },
    })

    const asset = await prisma.fundingImportAsset.create({
      data: {
        jobId: job.id,
        fundingCallId: fundingCall.id,
        kind: 'NORMALIZED_TEXT',
        mimeType: 'text/plain',
        textContent: 'Normalized schema fixture text',
      },
    })

    expect(asset.jobId).toBe(job.id)
    expect(asset.fundingCallId).toBe(fundingCall.id)
  })

  it('phase 2 migration SQL contains funding ingestion enums, assets, and nullable job tenant handling', () => {
    const migrationPath = path.join(
      process.cwd(),
      'prisma',
      'migrations',
      '20260416000000_phase2_funding_ingestion_core',
      'migration.sql'
    )
    const migrationSql = fs.readFileSync(migrationPath, 'utf8')

    expect(migrationSql).toContain('FUNDING_CALL_INGEST')
    expect(migrationSql).toContain('FundingImportOutcome')
    expect(migrationSql).toContain('FundingImportAssetKind')
    expect(migrationSql).toContain('ALTER COLUMN "tenantId" DROP NOT NULL')
    expect(migrationSql).toContain('CREATE TABLE "funding_import_assets"')
  })
})
