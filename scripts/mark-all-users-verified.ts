/*
  One-time script to mark all existing users as emailVerified=true.

  Usage:
    1) Ensure your database env vars are set (same as app).
    2) Run with ts-node or tsx, or transpile to JS and run with node.

       npx tsx scripts/mark-all-users-verified.ts

    3) You should see the number of affected rows in the console.
*/

import { prisma } from '@/lib/prisma'

async function main() {
  const result = await prisma.user.updateMany({
    data: { emailVerified: true },
  })
  console.log(`✅ Marked emailVerified=true for ${result.count} user(s).`)
}

main()
  .catch((err) => {
    console.error('Failed to mark users verified:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

