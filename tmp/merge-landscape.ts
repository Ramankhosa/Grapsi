import 'dotenv/config'
import fs from 'fs'
import { PrismaClient } from '@prisma/client'
import { buildReviewerLandscape } from '@/lib/reviewer/landscape'

const prisma = new PrismaClient()

async function main() {
  const callId = 'cmq0o9bel00o214iusm84d32n'
  const call = await prisma.reviewerCall.findUnique({
    where: { id: callId },
    select: { overall_review_json: true, project_title: true, parsed_json: true, LLM_model_used: true },
  })
  if (!call?.overall_review_json) throw new Error('no existing report')
  // Backup before touching the stored report
  fs.writeFileSync('tmp/overall_review_backup_' + callId + '.json', JSON.stringify(call.overall_review_json))

  // Chemistry-flavoured sections so the dev corpus produces rows for the visual check
  const landscape = await buildReviewerLandscape({
    callId,
    projectTitle: 'Novel nanocatalysts for sustainable chemical synthesis',
    parsedContext: { description: 'Call for research on advanced materials and green chemistry.' },
    modelType: 'G',
    sections: [
      { title: 'Objectives', contextSummary: 'Design transition-metal nanocatalysts for selective hydrogenation and oxidation reactions with reduced energy input.', userInput: '' },
      { title: 'Methodology', contextSummary: 'Synthesis of metal-oxide nanoparticles, spectroscopic characterization, catalytic performance testing in flow reactors.', userInput: '' },
      { title: 'Expected Outcomes', contextSummary: 'Greener synthesis routes for fine chemicals and pharmaceuticals with higher atom economy.', userInput: '' },
    ],
  })
  if (!landscape) throw new Error('kill switch off?')
  const merged = { ...(call.overall_review_json as any), landscape }
  await prisma.reviewerCall.update({ where: { id: callId }, data: { overall_review_json: merged } })
  console.log('merged landscape status:', landscape.status, 'rows:', landscape.priorWork.rows.length)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
