/**
 * Verification harness for the funding alert service.
 *
 * Read-only by default:
 *  - loads the service (validates prisma delegate + module wiring)
 *  - dispatches a nonexistent call id (must be a no-op)
 *  - lists sweep candidates (published calls never dispatched)
 *  - prints researcher-side embedding coverage the matcher depends on
 *
 * Pass --dispatch <fundingCallId> to run a real dispatch for one call
 * (creates alert + notification rows; emails only if Mailjet keys are set).
 * Add --no-email to blank the Mailjet keys for this run so the mailer logs
 * instead of sending.
 *
 * Usage: node ./node_modules/tsx/dist/cli.cjs scripts/verify-funding-alerts.ts [--dispatch <callId>] [--no-email]
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

function readEnvFile(envPath: string) {
  const buffer = fs.readFileSync(envPath);
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.toString('utf16le');
  }
  return buffer.toString('utf8');
}

for (const filename of ['.env', '.env.local']) {
  const envPath = path.join(process.cwd(), filename);
  if (fs.existsSync(envPath)) {
    const parsed = dotenv.parse(readEnvFile(envPath));
    for (const [key, value] of Object.entries(parsed)) {
      process.env[key] = value;
    }
  }
}

// Must happen before the mailer module is imported — it reads the keys at
// module load time.
if (process.argv.includes('--no-email')) {
  for (const key of ['MAILJET_API_KEY', 'MAILJET_API_SECRET', 'Mailjet_Key', 'Secret_Key']) {
    delete process.env[key];
  }
  console.log('(--no-email: Mailjet keys blanked, emails will be logged only)\n');
}

async function main() {
  const [{ fundingAlertService }, { default: prisma }] = await Promise.all([
    import('../src/lib/services/fundingAlertService'),
    import('../src/lib/prisma'),
  ]);

  console.log('1) Dispatch on nonexistent call (expect dispatched=false, reason=not_found):');
  const noCall = await fundingAlertService.dispatchAlertsForFundingCall('verify-nonexistent-id');
  console.log('   ', JSON.stringify(noCall));

  console.log('\n2) Sweep candidates (published, active, never dispatched):');
  const candidates = await prisma.$queryRawUnsafe<Array<{ id: string; title: string | null }>>(
    `
    SELECT id, COALESCE(scheme_title, title) AS title
    FROM funding_calls
    WHERE (catalog_status::text = 'PUBLISHED' OR status::text = 'PUBLISHED')
      AND COALESCE(is_active, true) = true
      AND COALESCE(metadata ->> 'alerts_dispatched_at', '') = ''
      AND (close_date IS NULL OR close_date > NOW())
      AND (expiration_date IS NULL OR expiration_date > NOW())
    ORDER BY "updatedAt" DESC
    LIMIT 10
    `
  );
  for (const row of candidates) {
    console.log(`    ${row.id}  ${row.title}`);
  }
  console.log(`    (${candidates.length} shown, max 10)`);

  console.log('\n3) Alert + notification state:');
  const [alerts, notifications] = await Promise.all([
    prisma.fundingCallAlert.count(),
    prisma.notification.count({ where: { category: 'FUNDING_MATCH' } }),
  ]);
  console.log(`    funding_call_alerts rows: ${alerts}`);
  console.log(`    FUNDING_MATCH notifications: ${notifications}`);
  const recent = await prisma.fundingCallAlert.findMany({
    orderBy: { created_at: 'desc' },
    take: 5,
    select: {
      user: { select: { email: true } },
      match_tier: true,
      match_score: true,
      score_basis: true,
      matched_sources: true,
      in_app_status: true,
      email_status: true,
      funding_call: { select: { scheme_title: true } },
    },
  });
  for (const row of recent) {
    console.log(
      `    · ${row.user.email} <- "${row.funding_call.scheme_title}" tier=${row.match_tier} score=${row.match_score} basis=${row.score_basis} sources=[${row.matched_sources.join(',')}] inApp=${row.in_app_status} email=${row.email_status}`
    );
  }

  console.log('\n4) Researcher-side embedding coverage (what the matcher searches):');
  const coverage = await prisma.$queryRawUnsafe<any[]>(
    `SELECT
       (SELECT COUNT(*) FROM researcher_profiles WHERE embedding IS NOT NULL OR embedding_voyage_1024 IS NOT NULL) AS profiles_embedded,
       (SELECT COUNT(*) FROM researcher_saved_research_areas WHERE use_for_alerts = true AND (embedding IS NOT NULL OR embedding_voyage_1024 IS NOT NULL)) AS alert_areas_embedded,
       (SELECT COUNT(*) FROM reference_library WHERE 'my-publication' = ANY(tags) AND (funding_embedding IS NOT NULL OR funding_embedding_voyage_1024 IS NOT NULL)) AS publications_embedded`
  );
  console.log('   ', JSON.stringify(coverage[0], (key, value) => (typeof value === 'bigint' ? Number(value) : value)));

  console.log('\n5) FUNDING_ALERTS entitlement coverage (delivery is plan-gated):');
  const entitlement = await prisma.$queryRawUnsafe<any[]>(
    `SELECT
       (SELECT COUNT(*) FROM features WHERE code::text = 'FUNDING_ALERTS') AS feature_seeded,
       (SELECT COUNT(DISTINCT tp."tenantId")
          FROM tenant_plans tp
          JOIN plans p ON p.id = tp."planId" AND p.status::text = 'ACTIVE'
          JOIN plan_features pf ON pf."planId" = p.id
          JOIN features f ON f.id = pf."featureId" AND f.code::text = 'FUNDING_ALERTS'
         WHERE tp.status::text = 'ACTIVE'
           AND tp."effectiveFrom" <= NOW()
           AND (tp."expiresAt" IS NULL OR tp."expiresAt" > NOW())) AS entitled_tenants,
       (SELECT COUNT(*) FROM tenants WHERE status::text = 'ACTIVE') AS active_tenants`
  );
  console.log('   ', JSON.stringify(entitlement[0], (key, value) => (typeof value === 'bigint' ? Number(value) : value)));
  if (!Number(entitlement[0]?.feature_seeded)) {
    console.log('    ⚠ FUNDING_ALERTS feature row missing — run `npm run seed:access-control`; no alerts will deliver until then.');
  }

  const digestIndex = process.argv.indexOf('--digest');
  if (digestIndex !== -1) {
    const frequency = process.argv[digestIndex + 1];
    if (frequency !== 'daily' && frequency !== 'weekly') {
      throw new Error('--digest requires "daily" or "weekly"');
    }
    console.log(`\n6) Digest run (${frequency}):`);
    const digest = await fundingAlertService.sendFundingAlertDigests(frequency);
    console.log('   ', JSON.stringify(digest));
  }

  const dispatchIndex = process.argv.indexOf('--dispatch');
  if (dispatchIndex !== -1) {
    const callId = process.argv[dispatchIndex + 1];
    if (!callId) {
      throw new Error('--dispatch requires a funding call id');
    }
    console.log(`\n7) Live dispatch for call ${callId}:`);
    const result = await fundingAlertService.dispatchAlertsForFundingCall(callId, { force: true });
    console.log('   ', JSON.stringify(result, null, 2));
  }

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error('VERIFY FAILED:', error);
  process.exitCode = 1;
});
