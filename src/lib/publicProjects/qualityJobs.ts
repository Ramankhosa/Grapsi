import { createHash } from 'node:crypto'

import { Prisma } from '@/lib/prisma-generated'
import prisma from '@/lib/prisma'
import { literatureSearchService } from '@/lib/services/literature-search-service'

type JobOptions = {
  limit?: number
  dryRun?: boolean
}

function clampLimit(value: unknown, fallback = 100) {
  const parsed = Number(value)
  return Math.min(Math.max(Number.isFinite(parsed) ? parsed : fallback, 1), 1000)
}

function normalizeText(value: unknown, maxLength = 4000) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength)
}

function isMissingAbstract(value: unknown) {
  const text = normalizeText(value, 80).toLowerCase()
  return !text || text === 'na' || text === 'n/a' || text === 'not available' || text === 'not provided'
}

function titleFingerprint(title: string, institution?: string | null) {
  return createHash('sha256')
    .update(`${normalizeText(title).toLowerCase()}|${normalizeText(institution).toLowerCase()}`)
    .digest('hex')
}

function richnessScore(project: {
  abstractText: string | null
  executiveSummary: string | null
  objectivesText: string | null
  outcomes: Prisma.JsonValue | null
  budgetAmount: Prisma.Decimal | null
  detailUrl: string | null
}) {
  return [
    !isMissingAbstract(project.abstractText) ? 4 : 0,
    project.executiveSummary ? 3 : 0,
    project.objectivesText ? 2 : 0,
    project.outcomes ? 1 : 0,
    project.budgetAmount ? 1 : 0,
    project.detailUrl ? 1 : 0,
  ].reduce((sum, value) => sum + value, 0)
}

function heuristicResearchAreas(project: {
  title: string
  discipline: string | null
  areaName: string | null
  subAreaName: string | null
  keywords: string[]
  schemeName: string | null
}) {
  const seed = [
    project.discipline,
    project.areaName,
    project.subAreaName,
    project.schemeName,
    ...project.keywords,
  ].map((value) => normalizeText(value, 120)).filter(Boolean)

  const text = `${project.title} ${seed.join(' ')}`.toLowerCase()
  const rules: Array<[string, string, string]> = [
    ['health|medical|clinical|disease|diagnostic|drug|biomed|cancer|patient', 'Health and biomedical sciences', 'HLS'],
    ['agri|crop|soil|farm|food|seed|livestock|plant', 'Agriculture and food systems', 'AGR'],
    ['energy|battery|solar|hydrogen|power|renewable|grid', 'Energy and sustainability', 'ENE'],
    ['climate|water|pollution|environment|waste|biodiversity', 'Environment and climate', 'ENV'],
    ['ai|machine learning|computer|software|data|digital|robot|sensor', 'Digital technologies and AI', 'ICT'],
    ['material|nanotech|polymer|manufactur|device|semiconductor', 'Materials and manufacturing', 'MAT'],
    ['education|social|policy|community|gender|tribal|rural', 'Social sciences and public policy', 'SOC'],
  ]

  const labels = new Map<string, { label: string; code: string; confidence: number; rationale: string }>()
  for (const [pattern, label, code] of rules) {
    if (new RegExp(pattern).test(text)) {
      labels.set(label, {
        label,
        code,
        confidence: 0.72,
        rationale: `Matched project title/metadata terms for ${label.toLowerCase()}.`,
      })
    }
  }

  for (const value of seed.slice(0, 4)) {
    if (!labels.has(value)) {
      labels.set(value, {
        label: value,
        code: 'GEN',
        confidence: 0.55,
        rationale: 'Derived from source-provided project discipline, area, scheme, or keyword metadata.',
      })
    }
  }

  return Array.from(labels.values()).slice(0, 5)
}

function metadataGloss(project: {
  title: string
  sourceKey: string
  schemeName: string | null
  programName: string | null
  discipline: string | null
  areaName: string | null
  primaryInstitutionName: string | null
}) {
  return [
    `This record describes a funded project titled "${project.title}".`,
    [project.sourceKey, project.programName, project.schemeName].filter(Boolean).length
      ? `It is associated with ${[project.sourceKey, project.programName, project.schemeName].filter(Boolean).join(', ')}.`
      : '',
    [project.discipline, project.areaName].filter(Boolean).length
      ? `The available source metadata places it in ${[project.discipline, project.areaName].filter(Boolean).join(' / ')}.`
      : '',
    project.primaryInstitutionName ? `The listed institution is ${project.primaryInstitutionName}.` : '',
    'The original source did not provide a full abstract, so this generated metadata gloss must not be treated as author-supplied evidence.',
  ].filter(Boolean).join(' ')
}

export async function dedupePublicProjects(options: JobOptions = {}) {
  const limit = clampLimit(options.limit, 200)
  const candidates = await prisma.publicProject.findMany({
    where: { recordStatus: 'ACTIVE' },
    select: {
      id: true,
      title: true,
      primaryInstitutionName: true,
      duplicateFingerprint: true,
      abstractText: true,
      executiveSummary: true,
      objectivesText: true,
      outcomes: true,
      budgetAmount: true,
      detailUrl: true,
      createdAt: true,
    },
    orderBy: { updatedAt: 'asc' },
    take: limit * 20,
  })

  const byFingerprint = new Map<string, typeof candidates>()
  for (const project of candidates) {
    const fingerprint = project.duplicateFingerprint || titleFingerprint(project.title, project.primaryInstitutionName)
    byFingerprint.set(fingerprint, [...(byFingerprint.get(fingerprint) || []), project])
  }
  const groups = Array.from(byFingerprint.values())
    .filter((projects) => projects.length > 1)
    .sort((a, b) => b.length - a.length)
    .slice(0, limit)

  let duplicateCount = 0
  for (const projects of groups) {
    const [winner, ...duplicates] = [...projects].sort((a, b) => richnessScore(b) - richnessScore(a))
    duplicateCount += duplicates.length
    if (options.dryRun) continue

    await prisma.publicProject.updateMany({
      where: { id: { in: duplicates.map((project) => project.id) } },
      data: {
        recordStatus: 'INACTIVE',
        duplicateOfId: winner.id,
        dedupedAt: new Date(),
      },
    })
  }

  return { scanned: candidates.length, groups: groups.length, duplicates: duplicateCount, dryRun: Boolean(options.dryRun) }
}

export async function enrichTitleOnlyPublicProjects(options: JobOptions = {}) {
  const limit = clampLimit(options.limit, 50)
  const projects = await prisma.publicProject.findMany({
    where: {
      recordStatus: 'ACTIVE',
      enrichedAbstract: null,
    },
    select: {
      id: true,
      title: true,
      sourceKey: true,
      abstractText: true,
      schemeName: true,
      programName: true,
      discipline: true,
      areaName: true,
      primaryInstitutionName: true,
    },
    orderBy: { updatedAt: 'asc' },
    take: limit,
  })

  let enriched = 0
  for (const project of projects.filter((item) => isMissingAbstract(item.abstractText))) {
    let abstract = ''
    let source = 'metadata_gloss'
    let metadata: Record<string, unknown> = { generatedFrom: 'project_metadata' }

    try {
      const search = await literatureSearchService.search(project.title, {
        sources: ['semantic_scholar', 'openalex', 'crossref'],
        limit: 3,
        includeAbstract: true,
        hasAbstract: true,
      })
      const match = search.results.find((result) => result.abstract && result.title)
      if (match?.abstract) {
        abstract = normalizeText(match.abstract, 2500)
        source = `literature:${match.source}`
        metadata = { matchedTitle: match.title, doi: match.doi || null, url: match.url || null, citationCount: match.citationCount || null }
      }
    } catch {
      // Fall back to a labelled metadata gloss below.
    }

    if (!abstract) {
      abstract = metadataGloss(project)
    }
    if (!abstract) continue

    enriched += 1
    if (options.dryRun) continue

    await prisma.publicProject.update({
      where: { id: project.id },
      data: {
        enrichedAbstract: abstract,
        enrichmentSource: source,
        enrichmentMetadata: metadata as Prisma.InputJsonValue,
        embeddingStatus: 'stale',
      },
    })
  }

  return { scanned: projects.length, enriched, dryRun: Boolean(options.dryRun) }
}

export async function assignPublicProjectTaxonomy(options: JobOptions = {}) {
  const limit = clampLimit(options.limit, 200)
  const projects = await prisma.publicProject.findMany({
    where: {
      recordStatus: 'ACTIVE',
      OR: [{ taxonomyStatus: null }, { taxonomyStatus: { not: 'assigned' } }],
    },
    select: {
      id: true,
      title: true,
      discipline: true,
      areaName: true,
      subAreaName: true,
      keywords: true,
      schemeName: true,
    },
    orderBy: { updatedAt: 'asc' },
    take: limit,
  })

  let tagged = 0
  for (const project of projects) {
    const areas = heuristicResearchAreas(project)
    if (!areas.length) continue
    tagged += 1
    if (options.dryRun) continue

    await prisma.$transaction([
      ...areas.map((area) => prisma.publicProjectResearchArea.upsert({
        where: { projectId_label: { projectId: project.id, label: area.label } },
        create: {
          projectId: project.id,
          label: area.label,
          taxonomyLevel1Code: area.code,
          confidence: area.confidence,
          source: 'heuristic',
          rationale: area.rationale,
        },
        update: {
          taxonomyLevel1Code: area.code,
          confidence: area.confidence,
          source: 'heuristic',
          rationale: area.rationale,
        },
      })),
      prisma.publicProject.update({
        where: { id: project.id },
        data: {
          taxonomyStatus: 'assigned',
          taxonomyMetadata: { method: 'heuristic_v1', areaCount: areas.length } as Prisma.InputJsonValue,
        },
      }),
    ])
  }

  return { scanned: projects.length, tagged, dryRun: Boolean(options.dryRun) }
}

export async function runPublicProjectQualityJobs(options: JobOptions & {
  dedupe?: boolean
  enrich?: boolean
  taxonomy?: boolean
} = {}) {
  const runAll = !options.dedupe && !options.enrich && !options.taxonomy
  return {
    dedupe: runAll || options.dedupe ? await dedupePublicProjects(options) : null,
    enrichment: runAll || options.enrich ? await enrichTitleOnlyPublicProjects(options) : null,
    taxonomy: runAll || options.taxonomy ? await assignPublicProjectTaxonomy(options) : null,
  }
}
