/** Optional persistent worker. Run under the app owner with the app environment. */
import 'dotenv/config'
import prisma from '../src/lib/prisma'
import { runAiReviewStep } from '../src/lib/fundingCatalogImport/aiReview'

let stopping = false
process.on('SIGTERM', () => { stopping = true })
process.on('SIGINT', () => { stopping = true })
async function main() {
  while (!stopping) {
    const batch = await prisma.catalogAiReviewBatch.findFirst({ where: { status: { in: ['QUEUED', 'RUNNING'] } }, orderBy: { created_at: 'asc' } })
    if (batch) await runAiReviewStep(prisma, batch.id)
    if (process.argv.includes('--once')) break
    await new Promise(resolve => setTimeout(resolve, batch ? 1500 : 5000))
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 }).finally(() => prisma.$disconnect())
