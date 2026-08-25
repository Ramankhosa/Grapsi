import 'dotenv/config'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PrismaClient } from '@prisma/client'
import {
  ComplianceBars, ConsistencyFlags, CriterionBars, NoveltyBlock, PriorityActions,
  ReportCover, ReportJumpBar, SectionReviewCard, SectionScoreBars, anchorFor,
} from '@/components/reviewer/report/ReportBlocks'

const prisma = new PrismaClient()
async function main() {
  const callId = 'cmq0o9bel00o214iusm84d32n'
  const call = await prisma.reviewerCall.findUnique({ where: { id: callId }, select: { project_title: true, agency_name: true, overall_review_json: true } })
  const sections = await prisma.reviewerSection.findMany({ where: { call_id: callId, status: 'reviewed' } })
  const overall: any = call!.overall_review_json
  const fakeNovelty = { verdict: 'generic', confidence: 'medium', evidence_coverage: 'partial', positioning_summary: 'Established pattern.', already_done: [{ ref: 'x', kind: 'funded', title: 'IoT yield', overlap: 'sensors', leaves_open: 'pests' }], generic_signals: ['no crop named'], distinctive_claims: [], what_would_make_it_distinctive: [{ change: 'Pick a crop', why: 'specificity', effort: 'quick', section: 'Objectives' }] }
  const parts: Record<string, string> = {
    jump: renderToStaticMarkup(<ReportJumpBar items={[{ id: 'overview', label: 'Overview' }, { id: 'scores', label: 'Scores' }]} />),
    cover: renderToStaticMarkup(<ReportCover overall={overall} projectTitle={call!.project_title || ''} agencyName={call!.agency_name} generatedAt={overall.generated_at} reviewedCount={3} pendingDrafts={{ Methodology: 2 }} scoredVersions={overall.score_basis?.scoredVersions || {}} />),
    novelty: renderToStaticMarkup(<NoveltyBlock novelty={fakeNovelty} />),
    scores: renderToStaticMarkup(<SectionScoreBars rows={sections.map((s: any) => ({ title: s.section_title, version: s.version, score: s.ai_review_json?.score ?? null, delta: 0.8, previousScore: 6.2, improvement: true, pendingDraft: null, inReport: true, headline: null }))} />),
    criteria: renderToStaticMarkup(<CriterionBars rows={[{ criterion: 'Scientific merit', weight: 30, score: 6.5, verdict: 'ok', evidence_sections: ['Methodology / Approach'] }, { criterion: 'Impact', weight: 20, score: null, verdict: 'not evidenced' }]} />),
    actions: renderToStaticMarkup(<PriorityActions actions={[{ rank: 1, section: 'Budget', issue: 'x', action: 'y', impact: 'high', effort: 'quick', expected_gain: 'z' }]} />),
    flags: renderToStaticMarkup(<ConsistencyFlags flags={[{ issue: 'contradiction', sections: ['Work plan', 'Timeline'], severity: 'high' }]} />),
    compliance: renderToStaticMarkup(<ComplianceBars compliance={overall.compliance} />),
    section: renderToStaticMarkup(<SectionReviewCard section={sections[0]} inReportVersion={1} pendingDraft={null} expanded={false} onToggleExpand={() => {}} />),
  }
  for (const [name, html] of Object.entries(parts)) console.log(name.padEnd(11), 'len', String(html.length).padStart(6), html.includes('undefined') ? '⚠ contains "undefined"' : 'ok')
  console.log('anchor sample:', anchorFor(sections[0].section_title))
}
main().then(() => process.exit(0)).catch((e) => { console.error('ERR', e); process.exit(1) })
