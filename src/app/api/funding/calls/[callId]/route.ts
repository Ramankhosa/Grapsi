import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'
import { toFundingCallDetail, toFundingImportJobView } from '@/lib/fundingIntake/compat'
import { buildFundingCallAccessWhere, requireFundingImporterRequest } from '@/lib/fundingIntake/routeAuth'
import { fundingGuidelineService } from '@/lib/fundingGuidelines/service'
import { fundingIntakeService } from '@/lib/fundingIntake/service'
import { fundingTemplateService } from '@/lib/fundingTemplates/service'

export const runtime = 'nodejs'

function sanitizeText(value: unknown) {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  if (!trimmed || trimmed === '[object Object]' || trimmed === 'null' || trimmed === 'undefined') {
    return null
  }

  return trimmed
}

function sanitizeStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((item) => sanitizeText(item))
    .filter((item): item is string => Boolean(item))
}

function asRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function arrayCount(value: unknown) {
  return Array.isArray(value) ? value.length : 0
}

function summarizeTemplateBundle(bundle: unknown) {
  const bundleRecord = asRecord(bundle)
  const template = asRecord(bundleRecord?.template)

  if (!template) {
    return null
  }

  const grantTemplateJson = asRecord(template.grant_template_json) || {}
  const sections = Array.isArray(grantTemplateJson.sections) ? grantTemplateJson.sections : []
  const questions = Array.isArray(grantTemplateJson.questions) ? grantTemplateJson.questions : []
  const attachments = Array.isArray(grantTemplateJson.attachments) ? grantTemplateJson.attachments : []
  const sectionOutline = sections.slice(0, 12).map((section, index) => {
    const sectionRecord = asRecord(section) || {}
    return {
      key:
        sanitizeText(sectionRecord.key) ||
        sanitizeText(sectionRecord.sectionKey) ||
        `section-${index + 1}`,
      label:
        sanitizeText(sectionRecord.label) ||
        sanitizeText(sectionRecord.title) ||
        sanitizeText(sectionRecord.name) ||
        `Section ${index + 1}`,
    }
  })

  return {
    id: template.id,
    status: template.status || null,
    currentRevisionNo: template.current_revision_no ?? null,
    revisionCount: Array.isArray(bundleRecord?.revisions) ? bundleRecord.revisions.length : 0,
    assetCount: Array.isArray(bundleRecord?.assets) ? bundleRecord.assets.length : 0,
    runCount: Array.isArray(bundleRecord?.runs) ? bundleRecord.runs.length : 0,
    topLevelSectionCount: sections.length,
    questionCount: questions.length,
    attachmentCount: attachments.length,
    submissionRuleCount: arrayCount(grantTemplateJson.submissionRules),
    evaluationCriteriaCount: arrayCount(grantTemplateJson.evaluationCriteria),
    hasCompiledTemplate: Boolean(template.compiledGrantTemplateJson || template.compiled_grant_template_json),
    sectionOutline,
    rawJson: grantTemplateJson,
  }
}

function summarizeGuidelineBundle(bundle: unknown) {
  const bundleRecord = asRecord(bundle)
  const guideline = asRecord(bundleRecord?.guideline)

  if (!guideline) {
    return null
  }

  const guidelinePackJson = asRecord(guideline.guideline_pack_json) || {}
  const preview = (key: string) =>
    (Array.isArray(guidelinePackJson[key]) ? guidelinePackJson[key] : [])
      .slice(0, 6)
      .map((entry) => {
        const record = asRecord(entry) || {}
        return {
          key: sanitizeText(record.key),
          text: sanitizeText(record.text),
          importance: sanitizeText(record.importance),
        }
      })
      .filter((entry) => entry.text)

  return {
    id: guideline.id,
    status: guideline.status || null,
    currentRevisionNo: guideline.current_revision_no ?? null,
    revisionCount: Array.isArray(bundleRecord?.revisions) ? bundleRecord.revisions.length : 0,
    runCount: Array.isArray(bundleRecord?.runs) ? bundleRecord.runs.length : 0,
    priorityCount: arrayCount(guidelinePackJson.priorities),
    mustAddressCount: arrayCount(guidelinePackJson.mustAddress),
    evaluationCriteriaCount: arrayCount(guidelinePackJson.evaluationCriteria),
    reviewerSignalCount: arrayCount(guidelinePackJson.reviewerSignals),
    avoidCount: arrayCount(guidelinePackJson.avoid),
    budgetRuleCount: arrayCount(guidelinePackJson.budgetRules),
    durationRuleCount: arrayCount(guidelinePackJson.durationRules),
    deliverableRuleCount: arrayCount(guidelinePackJson.deliverableRules),
    submissionRuleCount: arrayCount(guidelinePackJson.submissionRules),
    formatRuleCount: arrayCount(guidelinePackJson.formatRules),
    prioritiesPreview: preview('priorities'),
    mustAddressPreview: preview('mustAddress'),
    evaluationCriteriaPreview: preview('evaluationCriteria'),
    reviewerSignalsPreview: preview('reviewerSignals'),
    rawJson: guidelinePackJson,
    summaryJson: guideline.summary_json || null,
  }
}

export async function GET(request: NextRequest, { params }: { params: { callId: string } }) {
  const auth = await requireFundingImporterRequest(request)
  if ('response' in auth) {
    return auth.response
  }

  try {
    const call = await prisma.fundingCall.findFirst({
      where: {
        AND: [{ id: params.callId }, buildFundingCallAccessWhere(auth.actor)],
      },
    })

    if (!call) {
      return NextResponse.json({ error: 'Funding call not found', code: 'NOT_FOUND' }, { status: 404 })
    }

    const recentJobRows = await prisma.fundingIntakeJob.findMany({
      where: { linked_funding_call_id: call.id },
      orderBy: { created_at: 'desc' },
      take: 5,
      select: { id: true },
    })

    const recentJobDetails = await Promise.all(
      recentJobRows.map((job) => fundingIntakeService.getJobDetails(job.id, auth.operator))
    )

    const [templateBundle, guidelineBundle] = await Promise.all([
      fundingTemplateService.getTemplateBundle(call.id).catch(() => null),
      fundingGuidelineService.getGuidelineBundle(call.id).catch(() => null),
    ])

    const detail = toFundingCallDetail(call, {
      recentJobs: recentJobDetails.filter(Boolean).map((detail) => toFundingImportJobView(detail)),
    })

    const geographyScope = sanitizeText(call.geography_scope)
    const geography =
      geographyScope ||
      sanitizeStringArray(call.eligible_countries).join(', ') ||
      sanitizeStringArray(call.host_countries).join(', ') ||
      sanitizeText(call.funder_country) ||
      null

    return NextResponse.json({
      call: {
        ...detail,
        agencyName: sanitizeText(call.agency_name) || detail.agencyName || null,
        description: sanitizeText(call.description) || detail.description || null,
        summary: sanitizeText(call.summary) || detail.summary || null,
        sponsorType: sanitizeText(call.sponsor_type),
        geographyScope,
        geography,
        isRolling: Boolean(call.is_rolling),
        openDate: call.open_date?.toISOString?.() || null,
        eligibleCountries: sanitizeStringArray(call.eligible_countries),
        eligibleRegions: sanitizeStringArray(call.eligible_regions),
        hostCountries: sanitizeStringArray(call.host_countries),
        funderCountry: sanitizeText(call.funder_country),
        fundingKinds: sanitizeStringArray(call.funding_kinds),
        institutionTypes: sanitizeStringArray(call.institution_types),
        careerStages: sanitizeStringArray(call.career_stages),
        citizenshipRequirements: sanitizeStringArray(call.citizenship_requirements),
        residencyRequirements: sanitizeStringArray(call.residency_requirements),
        applicationLanguages: sanitizeStringArray(call.application_languages),
        disciplines: sanitizeStringArray(call.disciplines),
        eligibilityText: sanitizeText(call.eligibility_text),
        expectedDeliverablesText: sanitizeText(call.expected_deliverables_text),
        officialUrls: sanitizeStringArray(call.official_urls),
        contactInfo: sanitizeText(call.contact_info),
        sponsorTypeLabel:
          sanitizeText(call.sponsor_type)?.replace(/_/g, ' ') || sanitizeText(call.agency_name) || null,
        templateStatus: sanitizeText(call.template_status),
        guidelineStatus: sanitizeText(call.guideline_status),
        catalogStatus: sanitizeText(call.catalog_status),
        visibility: sanitizeText(call.visibility),
        inputType: sanitizeText(call.input_type),
        sourceType: sanitizeText(call.source),
        uploadedBy: sanitizeText(call.uploaded_by),
        rawTextAvailable: Boolean(call.raw_text),
        normalizedTextAvailable: Boolean(call.normalized_text),
      },
      templateWorkspace: summarizeTemplateBundle(templateBundle),
      guidelineWorkspace: summarizeGuidelineBundle(guidelineBundle),
    })
  } catch (error) {
    console.error('[Funding/Calls/:callId] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch funding call' }, { status: 500 })
  }
}
