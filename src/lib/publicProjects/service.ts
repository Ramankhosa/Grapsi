import crypto from 'node:crypto'
import os from 'node:os'

import type {
  Prisma,
  PublicProjectCrawlMode,
  PublicProjectCrawlStatus,
  PublicProjectSourceKey,
} from '@/lib/prisma-generated'
import { Prisma as PrismaNamespace } from '@/lib/prisma-generated'
import prisma from '@/lib/prisma'
import { EmbeddingService } from '@/lib/services/embeddingService'

import { getPublicProjectConnector, PUBLIC_PROJECT_SOURCE_DEFINITIONS } from './sourceRegistry'
import type {
  JsonRecord,
  NormalizedPublicProject,
  PublicProjectConnector,
  PublicProjectDiscoveredRecord,
} from './types'
import { PublicProjectSourceBlockedError } from './types'

const embeddingService = new EmbeddingService()
const PUBLIC_PROJECT_EMBEDDING_TASK_TYPE = 'RETRIEVAL_DOCUMENT' as const
const PUBLIC_PROJECT_EMBEDDING_VERSION_PREFIX = 'public-project-v1'

type SourceRecord = Awaited<ReturnType<typeof publicProjectCorpusService.ensureSource>>

function asObject(value: Prisma.JsonValue | null | undefined): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {}
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }

  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`
}

function sha256(value: unknown) {
  return crypto.createHash('sha256').update(typeof value === 'string' ? value : stableStringify(value)).digest('hex')
}

function cleanText(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null
  }

  const text = String(value)
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return text.length > 0 ? text : null
}

function toJsonInput(value: unknown): Prisma.InputJsonValue | typeof PrismaNamespace.JsonNull {
  if (value === null || value === undefined) {
    return PrismaNamespace.JsonNull
  }
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

function toRequiredJsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue
}

function toDateInput(value: Date | null | undefined) {
  return value && !Number.isNaN(value.getTime()) ? value : null
}

function toDecimalInput(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') {
    return null
  }
  const normalized = Number(String(value).replace(/,/g, ''))
  return Number.isFinite(normalized) ? new PrismaNamespace.Decimal(normalized) : null
}

function getEmbeddingHealth() {
  return embeddingService.getHealth({ taskType: PUBLIC_PROJECT_EMBEDDING_TASK_TYPE })
}

function getEmbeddingVersion() {
  const health = getEmbeddingHealth()
  return `${PUBLIC_PROJECT_EMBEDDING_VERSION_PREFIX}:${health.provider}:${health.modelName}:${PUBLIC_PROJECT_EMBEDDING_TASK_TYPE.toLowerCase()}:${health.outputDimensionality}`
}

function getEmbeddingColumn() {
  const health = getEmbeddingHealth()
  return health.provider === 'voyage' && health.outputDimensionality === 1024 ? 'embedding_voyage_1024' : 'embedding'
}

function embeddingColumnSql() {
  return PrismaNamespace.raw(getEmbeddingColumn())
}

function vectorLiteralSql(embedding: number[]) {
  return PrismaNamespace.raw(`'[${embedding.join(',')}]'::vector`)
}

export function buildPublicProjectEmbeddingInput(project: {
  title: string
  sourceKey?: string
  abstractText?: string | null
  enrichedAbstract?: string | null
  executiveSummary?: string | null
  objectivesText?: string | null
}): string {
  const sourceKey = String(project.sourceKey || '')
  const sourceAbstract = cleanText(project.abstractText)
  const sourceAbstractIsPlaceholder = !sourceAbstract || ['na', 'n/a', 'not available', 'not provided'].includes(sourceAbstract.toLowerCase())
  const fallback =
    cleanText(project.enrichedAbstract) ||
    (sourceAbstractIsPlaceholder ? null : sourceAbstract) ||
    cleanText(project.executiveSummary) ||
    cleanText(project.objectivesText) ||
    ''

  if (!fallback && ['BIRAC', 'ICMR'].includes(sourceKey)) {
    return `Title: ${cleanText(project.title) || ''}`
  }

  return [`Title: ${cleanText(project.title) || ''}`, fallback ? `Abstract: ${fallback}` : null]
    .filter(Boolean)
    .join('\n')
}

function buildDuplicateFingerprint(project: NormalizedPublicProject) {
  return sha256(
    [
      cleanText(project.title)?.toLowerCase() || '',
      cleanText(project.primaryInvestigatorName)?.toLowerCase() || '',
      cleanText(project.primaryInstitutionName)?.toLowerCase() || '',
      project.sanctionYear || '',
    ].join('|')
  )
}

function validateProject(project: NormalizedPublicProject) {
  const errors: string[] = []
  if (!cleanText(project.sourceRecordKey)) errors.push('missing_source_record_key')
  if (!cleanText(project.externalId)) errors.push('missing_external_id')
  if (!cleanText(project.title)) errors.push('missing_title')
  if (!cleanText(project.detailUrl) && !cleanText(project.sourceUrl)) errors.push('missing_provenance_url')
  return errors
}

function buildProjectContent(project: NormalizedPublicProject) {
  return {
    sourceKey: project.sourceKey,
    externalId: project.externalId,
    sourceVariant: project.sourceVariant,
    sourceRecordKey: project.sourceRecordKey,
    fileNumber: cleanText(project.fileNumber),
    projectNumber: cleanText(project.projectNumber),
    sourceUrl: cleanText(project.sourceUrl),
    detailUrl: cleanText(project.detailUrl),
    statusText: cleanText(project.statusText),
    projectType: cleanText(project.projectType),
    programName: cleanText(project.programName),
    schemeName: cleanText(project.schemeName),
    schemeHierarchy: project.schemeHierarchy || null,
    category: cleanText(project.category),
    theme: cleanText(project.theme),
    discipline: cleanText(project.discipline),
    areaName: cleanText(project.areaName),
    subAreaName: cleanText(project.subAreaName),
    title: cleanText(project.title) || project.externalId,
    abstractText: cleanText(project.abstractText),
    executiveSummary: cleanText(project.executiveSummary),
    objectivesText: cleanText(project.objectivesText),
    milestonesText: cleanText(project.milestonesText),
    deliverablesText: cleanText(project.deliverablesText),
    outputPlannedText: cleanText(project.outputPlannedText),
    outputAchievedText: cleanText(project.outputAchievedText),
    keywords: project.keywords || [],
    primaryInvestigatorName: cleanText(project.primaryInvestigatorName),
    primaryInstitutionName: cleanText(project.primaryInstitutionName),
    departmentName: cleanText(project.departmentName),
    city: cleanText(project.city),
    state: cleanText(project.state),
    country: cleanText(project.country) || 'India',
    sanctionYear: project.sanctionYear || null,
    startDate: project.startDate ? project.startDate.toISOString() : null,
    endDate: project.endDate ? project.endDate.toISOString() : null,
    durationMonths: project.durationMonths || null,
    budgetAmount: project.budgetAmount === null || project.budgetAmount === undefined ? null : String(project.budgetAmount),
    budgetCurrency: cleanText(project.budgetCurrency) || 'INR',
    budgetComponents: project.budgetComponents || null,
    manpower: project.manpower || null,
    equipment: project.equipment || null,
    publications: project.publications || null,
    patents: project.patents || null,
    outcomes: project.outcomes || null,
    extendedFields: project.extendedFields || null,
    participants: project.participants || [],
  }
}

function buildProjectWriteData(
  source: SourceRecord,
  project: NormalizedPublicProject,
  contentHash: string,
  detailHash: string | null,
  validationErrors: string[]
) {
  const recordStatus = validationErrors.length > 0 ? 'QUARANTINED' : 'ACTIVE'
  return {
    sourceId: source.id,
    sourceKey: project.sourceKey,
    externalId: project.externalId,
    fileNumber: cleanText(project.fileNumber),
    projectNumber: cleanText(project.projectNumber),
    sourceUrl: cleanText(project.sourceUrl),
    detailUrl: cleanText(project.detailUrl),
    sourceVariant: project.sourceVariant || 'online',
    sourceRecordKey: project.sourceRecordKey,
    statusText: cleanText(project.statusText),
    projectType: cleanText(project.projectType),
    recordStatus,
    validationErrors: validationErrors.length > 0 ? toJsonInput(validationErrors) : PrismaNamespace.JsonNull,
    programName: cleanText(project.programName),
    schemeName: cleanText(project.schemeName),
    schemeHierarchy: toJsonInput(project.schemeHierarchy),
    category: cleanText(project.category),
    theme: cleanText(project.theme),
    discipline: cleanText(project.discipline),
    areaName: cleanText(project.areaName),
    subAreaName: cleanText(project.subAreaName),
    title: cleanText(project.title) || project.externalId,
    abstractText: cleanText(project.abstractText),
    executiveSummary: cleanText(project.executiveSummary),
    objectivesText: cleanText(project.objectivesText),
    milestonesText: cleanText(project.milestonesText),
    deliverablesText: cleanText(project.deliverablesText),
    outputPlannedText: cleanText(project.outputPlannedText),
    outputAchievedText: cleanText(project.outputAchievedText),
    keywords: project.keywords || [],
    primaryInvestigatorName: cleanText(project.primaryInvestigatorName),
    primaryInstitutionName: cleanText(project.primaryInstitutionName),
    departmentName: cleanText(project.departmentName),
    city: cleanText(project.city),
    state: cleanText(project.state),
    country: cleanText(project.country) || 'India',
    sanctionYear: project.sanctionYear || null,
    startDate: toDateInput(project.startDate),
    endDate: toDateInput(project.endDate),
    durationMonths: project.durationMonths || null,
    budgetAmount: toDecimalInput(project.budgetAmount),
    budgetCurrency: cleanText(project.budgetCurrency) || 'INR',
    budgetComponents: toJsonInput(project.budgetComponents),
    manpower: toJsonInput(project.manpower),
    equipment: toJsonInput(project.equipment),
    publications: toJsonInput(project.publications),
    patents: toJsonInput(project.patents),
    outcomes: toJsonInput(project.outcomes),
    rawPayload: toJsonInput(project.rawPayload),
    extendedFields: toJsonInput(project.extendedFields),
    contentHash,
    detailHash,
    duplicateFingerprint: buildDuplicateFingerprint(project),
    missingFullRunCount: 0,
    lastSeenAt: new Date(),
    lastChangedAt: new Date(),
    inactiveAt: null,
  } satisfies Prisma.PublicProjectUncheckedCreateInput
}

function buildEmbeddingQueueData(
  project: Pick<NormalizedPublicProject, 'title' | 'abstractText' | 'executiveSummary' | 'objectivesText'>,
  existing?: {
    embeddingStatus: string
    embeddingInputHash: string | null
    embeddingVersion: string | null
  } | null
) {
  const input = buildPublicProjectEmbeddingInput(project)
  const inputHash = sha256(input)
  const embeddingVersion = getEmbeddingVersion()

  if (!input.trim()) {
    return {
      embeddingStatus: 'failed' as const,
      embeddingError: 'No title/abstract/objective text available for embedding',
      embeddingInputHash: inputHash,
      embeddingVersion,
    }
  }

  if (
    existing &&
    existing.embeddingInputHash === inputHash &&
    existing.embeddingVersion === embeddingVersion &&
    ['generated', 'processing'].includes(existing.embeddingStatus)
  ) {
    return {}
  }

  return {
    embeddingStatus: existing?.embeddingStatus === 'generated' ? ('stale' as const) : ('not_generated' as const),
    embeddingError: null,
    embeddingInputHash: inputHash,
    embeddingVersion,
  }
}

async function updateStoredEmbedding(projectId: string, embedding: number[]) {
  await prisma.$executeRaw`
    UPDATE public_projects
    SET ${embeddingColumnSql()} = ${vectorLiteralSql(embedding)}
    WHERE id = ${projectId}
  `
}

export interface CreatePublicProjectRunInput {
  sourceKey: PublicProjectSourceKey
  mode: PublicProjectCrawlMode
  filters?: {
    states?: string[]
    maxRecords?: number
    onlinePerState?: number
    legacyPerState?: number
    skipExisting?: boolean
  }
  confirmFullProduction?: boolean
}

export interface ProcessRunOptions {
  workerId?: string
  runId?: string
  maxItems?: number
}

const DISCOVERY_WRITE_BATCH_SIZE = 500
const DEFAULT_EXTRACTION_BATCH_SIZE = 100
const MAX_ITEM_ATTEMPTS = 3

function boundedPositiveInteger(value: unknown, fallback: number, maximum: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.floor(parsed), maximum) : fallback
}

function extractionConcurrency(sourceKey: PublicProjectSourceKey) {
  if (sourceKey !== 'PRISM') {
    return 1
  }

  return boundedPositiveInteger(process.env.PRISM_FETCH_CONCURRENCY, 4, 8)
}

async function forEachWithConcurrency<T>(
  items: T[],
  concurrency: number,
  operation: (item: T) => Promise<void>
) {
  let nextIndex = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      await operation(items[index])
    }
  })
  await Promise.all(workers)
}

export class PublicProjectCorpusService {
  async ensureSources() {
    await Promise.all(PUBLIC_PROJECT_SOURCE_DEFINITIONS.map((definition) => this.ensureSource(definition.sourceKey)))
  }

  async ensureSource(sourceKey: PublicProjectSourceKey) {
    const definition = PUBLIC_PROJECT_SOURCE_DEFINITIONS.find((item) => item.sourceKey === sourceKey)
    if (!definition) {
      throw new Error(`Unknown public-project source: ${sourceKey}`)
    }

    return prisma.publicProjectSource.upsert({
      where: { sourceKey },
      create: {
        sourceKey,
        name: definition.name,
        baseUrl: definition.baseUrl,
        enabled: definition.enabled,
        crawlConfig: toJsonInput(definition.crawlConfig),
        scheduleConfig: toJsonInput(definition.scheduleConfig),
      },
      update: {
        name: definition.name,
        baseUrl: definition.baseUrl,
        enabled: definition.enabled,
        crawlConfig: toJsonInput(definition.crawlConfig),
        scheduleConfig: toJsonInput(definition.scheduleConfig),
      },
    })
  }

  async listSources() {
    await this.ensureSources()
    const [sources, coverage] = await Promise.all([
      prisma.publicProjectSource.findMany({
        orderBy: { sourceKey: 'asc' },
        include: {
          _count: {
            select: {
              projects: true,
              crawlRuns: true,
            },
          },
        },
      }),
      this.getEmbeddingCoverage(),
    ])

    return {
      sources,
      embeddingHealth: getEmbeddingHealth(),
      coverage,
    }
  }

  async createRun(input: CreatePublicProjectRunInput, requestedByUserId?: string | null) {
    const source = await this.ensureSource(input.sourceKey)
    if (!source.enabled) {
      throw new Error(`${input.sourceKey} source is registered but not enabled`)
    }

    if (input.mode === 'full') {
      const isProduction = process.env.NODE_ENV === 'production' || process.env.PUBLIC_PROJECT_ALLOW_FULL_CRAWL === 'true'
      if (!isProduction || input.confirmFullProduction !== true) {
        throw new Error('Full public-project crawl requires production confirmation')
      }
    }

    const definition = PUBLIC_PROJECT_SOURCE_DEFINITIONS.find((item) => item.sourceKey === input.sourceKey)
    const defaultConfig = definition?.crawlConfig || {}
    const filters = {
      ...(input.mode === 'pilot'
        ? input.sourceKey === 'PRISM'
          ? {
              states: input.filters?.states?.length
                ? input.filters.states.map((state) => state.toUpperCase())
                : (defaultConfig.pilotStates as string[] | undefined) || ['PUNJAB', 'DELHI'],
              maxRecords: input.filters?.maxRecords ?? Number(defaultConfig.pilotRecordCap || 20),
              onlinePerState: input.filters?.onlinePerState ?? Number(defaultConfig.onlinePerState || 5),
              legacyPerState: input.filters?.legacyPerState ?? Number(defaultConfig.legacyPerState || 5),
            }
          : {
              maxRecords: input.filters?.maxRecords ?? Number(defaultConfig.pilotRecordCap || 20),
            }
        : input.filters || {}),
    }

    return prisma.publicProjectCrawlRun.create({
      data: {
        sourceId: source.id,
        mode: input.mode,
        filters: toJsonInput(filters),
        status: 'queued',
        requestedByUserId: requestedByUserId || null,
        cursor: toJsonInput({
          sourceKey: input.sourceKey,
          checkpoint: 'queued',
        }),
      },
      include: { source: true },
    })
  }

  async listRuns(limit = 20) {
    await this.ensureSources()
    return prisma.publicProjectCrawlRun.findMany({
      take: Math.min(Math.max(limit, 1), 100),
      orderBy: { createdAt: 'desc' },
      include: {
        source: true,
        items: {
          take: 5,
          orderBy: { updatedAt: 'desc' },
        },
      },
    })
  }

  async getRun(runId: string) {
    return prisma.publicProjectCrawlRun.findUnique({
      where: { id: runId },
      include: {
        source: true,
        items: {
          orderBy: { updatedAt: 'desc' },
          take: 100,
        },
      },
    })
  }

  async cancelRun(runId: string) {
    const run = await prisma.publicProjectCrawlRun.findUnique({
      where: { id: runId },
      select: { status: true },
    })
    if (!run) {
      throw new Error('Crawl run not found')
    }
    if (['completed', 'completed_with_errors', 'failed', 'blocked', 'canceled'].includes(run.status)) {
      return prisma.publicProjectCrawlRun.findUniqueOrThrow({ where: { id: runId } })
    }

    const now = new Date()
    return prisma.publicProjectCrawlRun.update({
      where: { id: runId },
      data:
        run.status === 'queued'
          ? {
              status: 'canceled',
              cancelRequestedAt: now,
              completedAt: now,
              heartbeatAt: now,
              lockedAt: null,
              lockedBy: null,
            }
          : {
              status: 'cancel_requested',
              cancelRequestedAt: now,
            },
    })
  }

  async retryRun(runId: string, requestedByUserId?: string | null) {
    const run = await prisma.publicProjectCrawlRun.findUnique({
      where: { id: runId },
      include: { source: true },
    })
    if (!run) {
      throw new Error('Crawl run not found')
    }

    return this.createRun(
      {
        sourceKey: run.source.sourceKey,
        mode: run.mode,
        filters: asObject(run.filters as Prisma.JsonValue) as CreatePublicProjectRunInput['filters'],
        confirmFullProduction: run.mode !== 'full' || process.env.NODE_ENV === 'production',
      },
      requestedByUserId
    )
  }

  async processNextRun(options: ProcessRunOptions = {}) {
    const workerId = options.workerId || `public-project-worker:${os.hostname()}:${process.pid}`
    const run = options.runId
      ? await this.claimSpecificRun(options.runId, workerId)
      : await this.claimQueuedRun(workerId)

    if (!run) {
      return null
    }

    await this.processClaimedRun(run.id, workerId, options)
    return this.getRun(run.id)
  }

  private async claimSpecificRun(runId: string, workerId: string) {
    const run = await prisma.publicProjectCrawlRun.findUnique({ where: { id: runId } })
    if (!run || !['queued', 'running'].includes(run.status)) {
      return null
    }

    const staleBefore = new Date(
      Date.now() - boundedPositiveInteger(process.env.PUBLIC_PROJECT_CRAWLER_STALE_LOCK_SECONDS, 300, 3600) * 1000
    )
    if (
      run.status === 'running' &&
      run.lockedBy !== workerId &&
      run.heartbeatAt &&
      run.heartbeatAt > staleBefore
    ) {
      return null
    }

    return prisma.publicProjectCrawlRun.update({
      where: { id: runId },
      data: {
        status: 'running',
        lockedBy: workerId,
        lockedAt: new Date(),
        heartbeatAt: new Date(),
        startedAt: run.startedAt || new Date(),
      },
    })
  }

  private async claimQueuedRun(workerId: string) {
    return prisma.$transaction(async (tx) => {
      const staleBefore = new Date(
        Date.now() - boundedPositiveInteger(process.env.PUBLIC_PROJECT_CRAWLER_STALE_LOCK_SECONDS, 300, 3600) * 1000
      )
      const rows = await tx.$queryRaw<Array<{ id: string }>>(PrismaNamespace.sql`
        SELECT id
        FROM public_project_crawl_runs
        WHERE status = 'queued'
           OR (status = 'running' AND (heartbeat_at IS NULL OR heartbeat_at < ${staleBefore}))
        ORDER BY
          CASE WHEN status = 'queued' THEN 0 ELSE 1 END,
          updated_at ASC,
          created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `)
      const id = rows[0]?.id
      if (!id) {
        return null
      }

      const existing = await tx.publicProjectCrawlRun.findUnique({ where: { id } })
      return tx.publicProjectCrawlRun.update({
        where: { id },
        data: {
          status: 'running',
          lockedBy: workerId,
          lockedAt: new Date(),
          heartbeatAt: new Date(),
          startedAt: existing?.startedAt || new Date(),
        },
      })
    })
  }

  private async processClaimedRun(runId: string, workerId: string, options: ProcessRunOptions) {
    const run = await prisma.publicProjectCrawlRun.findUnique({
      where: { id: runId },
      include: { source: true },
    })

    if (!run) {
      return
    }

    const connector = getPublicProjectConnector(run.source.sourceKey)
    const filters = asObject(run.filters as Prisma.JsonValue)
    const processLimit = boundedPositiveInteger(
      options.maxItems ?? process.env.PUBLIC_PROJECT_CRAWLER_BATCH_SIZE,
      DEFAULT_EXTRACTION_BATCH_SIZE,
      500
    )

    try {
      const cursor = asObject(run.cursor as Prisma.JsonValue)
      if (!['discovered', 'extracting'].includes(String(cursor.checkpoint || ''))) {
        await this.discoverRunItems(runId, connector, run.mode, filters)
      }

      if (await this.cancelRunIfRequested(runId)) {
        return
      }

      // A process can terminate after claiming an item. Return those rows to the
      // retry queue; attemptCount prevents permanent poison records from looping.
      await prisma.publicProjectCrawlItem.updateMany({
        where: { runId, status: 'processing' },
        data: {
          status: 'failed',
          errorCode: 'INTERRUPTED',
          errorMessage: 'Extraction worker stopped before the item completed',
        },
      })

      const items = await prisma.publicProjectCrawlItem.findMany({
        where: {
          runId,
          OR: [
            { status: 'discovered' },
            { status: 'failed', attemptCount: { lt: MAX_ITEM_ATTEMPTS } },
          ],
        },
        take: processLimit,
        orderBy: { createdAt: 'asc' },
      })
      const skipExisting = filters.skipExisting !== false

      await forEachWithConcurrency(items, extractionConcurrency(run.source.sourceKey), async (item) => {
        await this.processDiscoveredRecord(
          run.source,
          runId,
          connector,
          this.discoveredRecordFromItem(run.source.sourceKey, item),
          item.attemptCount,
          skipExisting
        )
      })

      const remaining = await prisma.publicProjectCrawlItem.count({
        where: {
          runId,
          OR: [
            { status: 'discovered' },
            { status: 'processing' },
            { status: 'failed', attemptCount: { lt: MAX_ITEM_ATTEMPTS } },
          ],
        },
      })

      if (remaining > 0) {
        await prisma.publicProjectCrawlRun.update({
          where: { id: runId },
          data: {
            status: 'queued',
            lockedAt: null,
            lockedBy: null,
            heartbeatAt: new Date(),
            cursor: toJsonInput({
              sourceKey: run.source.sourceKey,
              checkpoint: 'extracting',
              remaining,
            }),
          },
        })
        return
      }

      const finalRun = await prisma.publicProjectCrawlRun.findUnique({ where: { id: runId } })
      const finalStatus: PublicProjectCrawlStatus =
        (finalRun?.failedCount || 0) > 0 ? 'completed_with_errors' : 'completed'

      await prisma.publicProjectCrawlRun.update({
        where: { id: runId },
        data: {
          status: finalStatus,
          completedAt: new Date(),
          heartbeatAt: new Date(),
          lockedAt: null,
          lockedBy: null,
          cursor: toJsonInput({
            sourceKey: run.source.sourceKey,
            checkpoint: 'completed',
          }),
        },
      })

      if (run.mode === 'full') {
        await this.markMissingProjectsAfterFullRun(run.sourceId, runId)
      }

      await prisma.publicProjectSource.update({
        where: { id: run.sourceId },
        data: {
          lastRunAt: new Date(),
          ...(finalStatus === 'completed'
            ? {
                lastSuccessfulRunId: runId,
                lastError: null,
              }
            : {}),
        },
      })
    } catch (error) {
      if (error instanceof PublicProjectSourceBlockedError) {
        await prisma.publicProjectCrawlRun.update({
          where: { id: runId },
          data: {
            status: 'blocked',
            errorCode: 'SOURCE_BLOCKED',
            errorMessage: error.message,
            completedAt: new Date(),
            heartbeatAt: new Date(),
          },
        })
        await prisma.publicProjectSource.update({
          where: { id: run.sourceId },
          data: {
            lastRunAt: new Date(),
            lastError: error.message,
          },
        })
        return
      }

      const message = error instanceof Error ? error.message : String(error)
      await prisma.publicProjectCrawlRun.update({
        where: { id: runId },
        data: {
          status: 'failed',
          errorCode: 'RUN_FAILED',
          errorMessage: message,
          completedAt: new Date(),
          heartbeatAt: new Date(),
        },
      })
      await prisma.publicProjectSource.update({
        where: { id: run.sourceId },
        data: {
          lastRunAt: new Date(),
          lastError: message,
        },
      })
    }
  }

  private async discoverRunItems(
    runId: string,
    connector: PublicProjectConnector,
    mode: PublicProjectCrawlMode,
    filters: JsonRecord
  ) {
    await prisma.publicProjectCrawlRun.update({
      where: { id: runId },
      data: {
        heartbeatAt: new Date(),
        cursor: toJsonInput({ sourceKey: connector.sourceKey, checkpoint: 'discovering' }),
      },
    })

    let buffer: PublicProjectDiscoveredRecord[] = []
    const flush = async () => {
      if (buffer.length === 0) return
      const batch = buffer
      buffer = []
      const created = await prisma.publicProjectCrawlItem.createMany({
        data: batch.map((discovered) => ({
          runId,
          sourceRecordKey: discovered.sourceRecordKey,
          sourceVariant: discovered.sourceVariant,
          externalId: discovered.externalId,
          state: discovered.state || null,
          status: 'discovered' as const,
          listingPayload: toJsonInput(discovered.listingPayload),
          detailPayload: toJsonInput({ detailUrl: discovered.detailUrl || null }),
        })),
        skipDuplicates: true,
      })
      await prisma.publicProjectCrawlRun.update({
        where: { id: runId },
        data: {
          discoveredCount: { increment: created.count },
          heartbeatAt: new Date(),
        },
      })
    }

    for await (const discovered of connector.discover({
      mode,
      states: Array.isArray(filters.states) ? (filters.states as string[]) : undefined,
      maxRecords: typeof filters.maxRecords === 'number' ? filters.maxRecords : undefined,
      onlinePerState: typeof filters.onlinePerState === 'number' ? filters.onlinePerState : undefined,
      legacyPerState: typeof filters.legacyPerState === 'number' ? filters.legacyPerState : undefined,
    })) {
      buffer.push(discovered)
      if (buffer.length >= DISCOVERY_WRITE_BATCH_SIZE) {
        await flush()
        if (await this.cancelRunIfRequested(runId)) return
      }
    }
    await flush()
    await prisma.publicProjectCrawlRun.update({
      where: { id: runId },
      data: {
        heartbeatAt: new Date(),
        cursor: toJsonInput({ sourceKey: connector.sourceKey, checkpoint: 'discovered' }),
      },
    })
  }

  private async cancelRunIfRequested(runId: string) {
    const latest = await prisma.publicProjectCrawlRun.findUnique({
      where: { id: runId },
      select: { status: true },
    })
    if (latest?.status === 'canceled') return true
    if (latest?.status !== 'cancel_requested') return false
    await prisma.publicProjectCrawlRun.update({
      where: { id: runId },
      data: {
        status: 'canceled',
        completedAt: new Date(),
        heartbeatAt: new Date(),
        lockedAt: null,
        lockedBy: null,
      },
    })
    return true
  }

  private discoveredRecordFromItem(
    sourceKey: PublicProjectSourceKey,
    item: {
      sourceRecordKey: string
      sourceVariant: string | null
      externalId: string | null
      state: string | null
      listingPayload: Prisma.JsonValue | null
      detailPayload: Prisma.JsonValue | null
    }
  ): PublicProjectDiscoveredRecord {
    return {
      sourceKey,
      sourceRecordKey: item.sourceRecordKey,
      sourceVariant: item.sourceVariant || 'online',
      externalId: item.externalId || item.sourceRecordKey,
      state: item.state,
      detailUrl: cleanText(asObject(item.detailPayload).detailUrl),
      listingPayload: asObject(item.listingPayload),
    }
  }

  private async processDiscoveredRecord(
    source: SourceRecord,
    runId: string,
    connector: PublicProjectConnector,
    discovered: PublicProjectDiscoveredRecord,
    previousAttemptCount: number,
    skipExisting: boolean
  ) {
    await prisma.publicProjectCrawlItem.update({
      where: {
        runId_sourceRecordKey: {
          runId,
          sourceRecordKey: discovered.sourceRecordKey,
        },
      },
      data: {
        status: 'processing',
        attemptCount: { increment: 1 },
      },
    })

    try {
      if (skipExisting) {
        const existing = await prisma.publicProject.findUnique({
          where: {
            sourceId_sourceRecordKey: {
              sourceId: source.id,
              sourceRecordKey: discovered.sourceRecordKey,
            },
          },
          select: { id: true, contentHash: true, recordStatus: true },
        })
        if (existing) {
          await prisma.$transaction([
            prisma.publicProject.update({
              where: { id: existing.id },
              data: {
                lastSeenAt: new Date(),
                missingFullRunCount: 0,
                ...(existing.recordStatus === 'INACTIVE'
                  ? { recordStatus: 'ACTIVE' as const, inactiveAt: null }
                  : {}),
              },
            }),
            prisma.publicProjectCrawlItem.update({
              where: { runId_sourceRecordKey: { runId, sourceRecordKey: discovered.sourceRecordKey } },
              data: {
                projectId: existing.id,
                status: 'skipped',
                contentHash: existing.contentHash,
                processedAt: new Date(),
                errorCode: null,
                errorMessage: null,
              },
            }),
            prisma.publicProjectCrawlRun.update({
              where: { id: runId },
              data: { processedCount: { increment: 1 } },
            }),
          ])
          return
        }
      }

      const normalized = await connector.fetchAndNormalize(discovered)
      const result = await this.upsertNormalizedProject(source, runId, discovered, normalized)

      await prisma.publicProjectCrawlItem.update({
        where: {
          runId_sourceRecordKey: {
            runId,
            sourceRecordKey: discovered.sourceRecordKey,
          },
        },
        data: {
          projectId: result.projectId,
          status: result.recordStatus === 'QUARANTINED' ? 'quarantined' : 'completed',
          contentHash: result.contentHash,
          detailPayload: toJsonInput(normalized.rawPayload || {}),
          processedAt: new Date(),
          errorCode: null,
          errorMessage: null,
        },
      })

      await prisma.publicProjectCrawlRun.update({
        where: { id: runId },
        data: {
          processedCount: { increment: 1 },
          ...(result.recordStatus === 'QUARANTINED'
            ? { quarantinedCount: { increment: 1 } }
            : { succeededCount: { increment: 1 } }),
        },
      })

    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const isFinalAttempt = previousAttemptCount + 1 >= MAX_ITEM_ATTEMPTS
      await prisma.publicProjectCrawlItem.update({
        where: {
          runId_sourceRecordKey: {
            runId,
            sourceRecordKey: discovered.sourceRecordKey,
          },
        },
        data: {
          status: 'failed',
          errorCode: 'ITEM_FAILED',
          errorMessage: message,
          processedAt: new Date(),
        },
      })

      await prisma.publicProjectCrawlRun.update({
        where: { id: runId },
        data: isFinalAttempt
          ? { processedCount: { increment: 1 }, failedCount: { increment: 1 } }
          : { heartbeatAt: new Date() },
      })
      if (error instanceof PublicProjectSourceBlockedError) {
        throw error
      }
    }
  }

  private async markMissingProjectsAfterFullRun(sourceId: string, runId: string) {
    await prisma.$executeRaw(PrismaNamespace.sql`
      UPDATE public_projects project
      SET
        missing_full_run_count = project.missing_full_run_count + 1,
        record_status = CASE
          WHEN project.missing_full_run_count + 1 >= 2 THEN 'INACTIVE'::"PublicProjectRecordStatus"
          ELSE project.record_status
        END,
        inactive_at = CASE
          WHEN project.missing_full_run_count + 1 >= 2 AND project.inactive_at IS NULL THEN CURRENT_TIMESTAMP
          ELSE project.inactive_at
        END,
        updated_at = CURRENT_TIMESTAMP
      WHERE project.source_id = ${sourceId}
        AND NOT EXISTS (
          SELECT 1
          FROM public_project_crawl_items item
          WHERE item.run_id = ${runId}
            AND item.source_record_key = project.source_record_key
        )
    `)
  }

  async upsertNormalizedProject(
    source: SourceRecord,
    runId: string | null,
    discovered: PublicProjectDiscoveredRecord | null,
    normalized: NormalizedPublicProject
  ): Promise<{ projectId: string; contentHash: string; recordStatus: 'ACTIVE' | 'QUARANTINED' }> {
    const validationErrors = validateProject(normalized)
    const content = buildProjectContent(normalized)
    const contentHash = sha256(content)
    const detailHash = normalized.rawPayload ? sha256(normalized.rawPayload) : null
    const writeData = buildProjectWriteData(source, normalized, contentHash, detailHash, validationErrors)

    const existing = await prisma.publicProject.findUnique({
      where: {
        sourceId_sourceRecordKey: {
          sourceId: source.id,
          sourceRecordKey: normalized.sourceRecordKey,
        },
      },
    })
    const embeddingQueueData = buildEmbeddingQueueData(normalized, existing)

    const project = await prisma.publicProject.upsert({
      where: {
        sourceId_sourceRecordKey: {
          sourceId: source.id,
          sourceRecordKey: normalized.sourceRecordKey,
        },
      },
      create: {
        ...writeData,
        ...embeddingQueueData,
      },
      update: {
        ...writeData,
        ...embeddingQueueData,
        lastChangedAt: existing?.contentHash === contentHash ? existing.lastChangedAt : new Date(),
        firstSeenAt: existing?.firstSeenAt || undefined,
      },
    })

    if (!existing || existing.contentHash !== contentHash) {
      await prisma.publicProjectRevision.upsert({
        where: {
          projectId_contentHash: {
            projectId: project.id,
            contentHash,
          },
        },
        create: {
          projectId: project.id,
          runId: runId || null,
          contentHash,
          normalizedPayload: toRequiredJsonInput(content),
          rawPayload: toJsonInput(normalized.rawPayload || {}),
        },
        update: {},
      })

      await this.replaceParticipantsAndContacts(project.id, normalized)
    }

    return {
      projectId: project.id,
      contentHash,
      recordStatus: validationErrors.length > 0 ? 'QUARANTINED' : 'ACTIVE',
    }
  }

  private async replaceParticipantsAndContacts(projectId: string, normalized: NormalizedPublicProject) {
    await prisma.$transaction([
      prisma.publicProjectParticipant.deleteMany({ where: { projectId } }),
      prisma.publicProjectPrivateContact.deleteMany({ where: { projectId } }),
      ...(normalized.participants || [])
        .filter((participant) => cleanText(participant.name))
        .map((participant) =>
          prisma.publicProjectParticipant.create({
            data: {
              projectId,
              role: participant.role,
              name: cleanText(participant.name)!,
              institutionName: cleanText(participant.institutionName),
              departmentName: cleanText(participant.departmentName),
              city: cleanText(participant.city),
              state: cleanText(participant.state),
              country: cleanText(participant.country) || 'India',
              sourcePayload: toJsonInput(participant.sourcePayload),
            },
          })
        ),
      ...(normalized.contacts || [])
        .filter((contact) => cleanText(contact.value))
        .map((contact) =>
          prisma.publicProjectPrivateContact.create({
            data: {
              projectId,
              contactType: contact.contactType,
              label: cleanText(contact.label),
              value: cleanText(contact.value)!,
              sourcePayload: toJsonInput(contact.sourcePayload),
            },
          })
        ),
    ])
  }

  private async generateEmbeddingForProject(project: {
    id: string
    sourceKey?: PublicProjectSourceKey | string
    title: string
    abstractText: string | null
    executiveSummary: string | null
    objectivesText: string | null
  }) {
    const input = buildPublicProjectEmbeddingInput(project)
    const inputHash = sha256(input)
    const embeddingVersion = getEmbeddingVersion()

    if (!input.trim()) {
      await prisma.publicProject.update({
        where: { id: project.id },
        data: {
          embeddingStatus: 'failed',
          embeddingError: 'No title/abstract/objective text available for embedding',
          embeddingInputHash: inputHash,
          embeddingVersion,
        },
      })
      return true
    }

    await prisma.publicProject.update({
      where: { id: project.id },
      data: {
        embeddingStatus: 'processing',
        embeddingError: null,
        embeddingInputHash: inputHash,
        embeddingVersion,
      },
    })

    const health = getEmbeddingHealth()
    const result = await embeddingService.generateEmbedding(input, undefined, {
      taskType: PUBLIC_PROJECT_EMBEDDING_TASK_TYPE,
      title: project.title,
    })

    if (result.error || result.embedding.length === 0) {
      await prisma.publicProject.update({
        where: { id: project.id },
        data: {
          embeddingStatus: 'failed',
          embeddingError: result.error || 'Embedding provider returned an empty vector',
          embeddingProvider: result.provider || health.provider,
          embeddingModel: result.modelName || health.modelName,
          embeddingDimension: result.outputDimensionality || health.outputDimensionality,
          embeddingVersion,
        },
      })
      return true
    }

    await updateStoredEmbedding(project.id, result.embedding)
    await prisma.publicProject.update({
      where: { id: project.id },
      data: {
        embeddingStatus: 'generated',
        embeddingError: null,
        embeddingProvider: result.provider || health.provider,
        embeddingModel: result.modelName || health.modelName,
        embeddingDimension: result.outputDimensionality || health.outputDimensionality,
        embeddingVersion,
        embeddingInputHash: inputHash,
      },
    })

    return false
  }

  async processPendingEmbeddings(options: { limit?: number; includeFailed?: boolean } = {}) {
    const limit = Math.min(Math.max(options.limit || 25, 1), 200)
    const currentVersion = getEmbeddingVersion()
    const activeCrawls = await prisma.publicProjectCrawlRun.count({
      where: { status: { in: ['queued', 'running', 'cancel_requested'] } },
    })
    if (activeCrawls > 0) {
      return {
        selected: 0,
        succeeded: 0,
        failed: 0,
        errors: [],
        deferred: true,
        deferredReason: `${activeCrawls} extraction run(s) are still active`,
        coverage: await this.getEmbeddingCoverage(),
      }
    }

    const projects = await prisma.publicProject.findMany({
      where: {
        recordStatus: 'ACTIVE',
        OR: [
          { embeddingStatus: { in: ['not_generated', 'stale'] } },
          { embeddingVersion: { not: currentVersion } },
          ...(options.includeFailed ? [{ embeddingStatus: 'failed' as const }] : []),
        ],
      },
      take: limit,
      orderBy: [{ lastSeenAt: 'desc' }],
      select: {
        id: true,
        sourceKey: true,
        title: true,
        abstractText: true,
        enrichedAbstract: true,
        executiveSummary: true,
        objectivesText: true,
      },
    })

    let succeeded = 0
    let failed = 0
    const errors: Array<{ id: string; error: string }> = []

    for (const project of projects) {
      try {
        const didFail = await this.generateEmbeddingForProject(project)
        if (didFail) {
          failed += 1
          const refreshed = await prisma.publicProject.findUnique({
            where: { id: project.id },
            select: { embeddingError: true },
          })
          errors.push({ id: project.id, error: refreshed?.embeddingError || 'Embedding failed' })
        } else {
          succeeded += 1
        }
      } catch (error) {
        failed += 1
        const message = error instanceof Error ? error.message : String(error)
        errors.push({ id: project.id, error: message })
        await prisma.publicProject.update({
          where: { id: project.id },
          data: {
            embeddingStatus: 'failed',
            embeddingError: message,
          },
        })
      }
    }

    return {
      selected: projects.length,
      succeeded,
      failed,
      errors,
      deferred: false,
      coverage: await this.getEmbeddingCoverage(),
    }
  }

  async getEmbeddingCoverage() {
    const currentVersion = getEmbeddingVersion()
    const rows = await prisma.$queryRaw<
      Array<{
        total: bigint | number
        active: bigint | number
        generated: bigint | number
        failed: bigint | number
        stale: bigint | number
        pending: bigint | number
        processing: bigint | number
      }>
    >(PrismaNamespace.sql`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE record_status = 'ACTIVE') AS active,
        COUNT(*) FILTER (
          WHERE record_status = 'ACTIVE'
            AND embedding_status = 'generated'
            AND embedding_version = ${currentVersion}
            AND ${embeddingColumnSql()} IS NOT NULL
        ) AS generated,
        COUNT(*) FILTER (WHERE embedding_status = 'failed') AS failed,
        COUNT(*) FILTER (
          WHERE record_status = 'ACTIVE'
            AND embedding_status = 'generated'
            AND COALESCE(embedding_version, '') <> ${currentVersion}
        ) AS stale,
        COUNT(*) FILTER (
          WHERE record_status = 'ACTIVE'
            AND embedding_status IN ('not_generated', 'stale')
        ) AS pending,
        COUNT(*) FILTER (
          WHERE record_status = 'ACTIVE'
            AND embedding_status = 'processing'
        ) AS processing
      FROM public_projects
    `)

    const row = rows[0] || { total: 0, active: 0, generated: 0, failed: 0, stale: 0, pending: 0, processing: 0 }
    return {
      total: Number(row.total || 0),
      active: Number(row.active || 0),
      generated: Number(row.generated || 0),
      failed: Number(row.failed || 0),
      stale: Number(row.stale || 0),
      pending: Number(row.pending || 0),
      processing: Number(row.processing || 0),
      currentEmbeddingVersion: currentVersion,
    }
  }

  async listProjects(options: {
    sourceKey?: PublicProjectSourceKey | null
    status?: string | null
    query?: string | null
    state?: string | null
    limit?: number
    includeContacts?: boolean
  }) {
    const limit = Math.min(Math.max(options.limit || 50, 1), 200)
    const where: Prisma.PublicProjectWhereInput = {
      ...(options.sourceKey ? { sourceKey: options.sourceKey } : {}),
      ...(options.status ? { recordStatus: options.status as any } : {}),
      ...(options.state ? { state: { equals: options.state, mode: 'insensitive' } } : {}),
      ...(options.query
        ? {
            OR: [
              { title: { contains: options.query, mode: 'insensitive' } },
              { abstractText: { contains: options.query, mode: 'insensitive' } },
              { objectivesText: { contains: options.query, mode: 'insensitive' } },
              { primaryInvestigatorName: { contains: options.query, mode: 'insensitive' } },
              { primaryInstitutionName: { contains: options.query, mode: 'insensitive' } },
            ],
          }
        : {}),
    }

    return prisma.publicProject.findMany({
      where,
      take: limit,
      orderBy: [{ lastSeenAt: 'desc' }],
      include: {
        participants: true,
        contacts: options.includeContacts || false,
      },
    })
  }

  async getProject(projectId: string, includeContacts = false) {
    return prisma.publicProject.findUnique({
      where: { id: projectId },
      include: {
        participants: true,
        contacts: includeContacts,
        revisions: {
          take: 10,
          orderBy: { createdAt: 'desc' },
        },
      },
    })
  }
}

export const publicProjectCorpusService = new PublicProjectCorpusService()
