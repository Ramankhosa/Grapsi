import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  const calls = await prisma.reviewerCall.findMany({
    orderBy: { updated_at: 'desc' },
    take: 8,
    select: {
      id: true, project_title: true, tenantId: true, user_id: true,
      overall_review_json: true, updated_at: true,
      reviewer_sections: { select: { status: true } },
    },
  })
  for (const call of calls) {
    const reviewed = call.reviewer_sections.filter((s) => s.status === 'reviewed').length
    console.log(JSON.stringify({
      id: call.id, title: call.project_title?.slice(0, 60), tenant: call.tenantId,
      sections: call.reviewer_sections.length, reviewed,
      hasReport: Boolean(call.overall_review_json),
    }))
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
