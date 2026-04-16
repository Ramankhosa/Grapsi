const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
  const failed = await p.$queryRawUnsafe(
    `SELECT id, migration_name, LEFT(checksum,12) as chk, finished_at IS NOT NULL as done, rolled_back_at IS NOT NULL as rolled_back, logs
     FROM _prisma_migrations WHERE finished_at IS NULL ORDER BY started_at`
  );
  console.log("=== FAILED/INCOMPLETE MIGRATIONS ===");
  console.log(JSON.stringify(failed, null, 2));
  
  const total = await p.$queryRawUnsafe(
    `SELECT COUNT(*)::int as total FROM _prisma_migrations`
  );
  console.log("\n=== TOTAL RECORDS ===", JSON.stringify(total));
  
  const dupes = await p.$queryRawUnsafe(
    `SELECT migration_name, COUNT(*)::int as cnt FROM _prisma_migrations GROUP BY migration_name HAVING COUNT(*) > 1`
  );
  console.log("\n=== DUPLICATE MIGRATIONS ===");
  console.log(JSON.stringify(dupes, null, 2));
  
  await p.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
