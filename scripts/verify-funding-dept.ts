/**
 * Verification harness for the Funding Department module.
 *
 * Read-only by default: checks the schema landed correctly (enum order, the two
 * accountability indexes, new columns) and prints the current department state
 * per tenant.
 *
 * Pass --scope <userId> to print the ManagedScope resolveManagedScope() derives
 * for one user — the fastest way to confirm coverage rows actually grant reach.
 *
 * Pass --sweep to fire due reminders and --digest to send the weekly digests,
 * running the same service functions the cron routes call. Both are idempotent,
 * so running them twice is itself the test. Add --no-email to blank the Mailjet
 * keys so mail is logged rather than sent.
 *
 * Usage: node ./node_modules/tsx/dist/cli.cjs scripts/verify-funding-dept.ts
 *          [--scope <userId>] [--sweep] [--digest] [--no-email]
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
    delete process.env[key]
  }
  console.log('(--no-email: Mailjet keys blanked, emails will be logged only)\n')
}

async function main() {
  const { default: prisma } = await import('../src/lib/prisma');

  console.log('1) CallAssignmentStatus declaration order (drives ORDER BY status):');
  const enumVals = await prisma.$queryRawUnsafe<Array<{ enumlabel: string }>>(
    `SELECT enumlabel FROM pg_enum e
       JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'CallAssignmentStatus'
      ORDER BY enumsortorder`
  );
  console.log('   ', enumVals.map((v) => v.enumlabel).join(' -> '));

  console.log('\n2) New call_assignments columns:');
  const cols = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'call_assignments'
        AND column_name IN ('declined_reason','responded_at')
      ORDER BY column_name`
  );
  console.log('   ', cols.map((c) => c.column_name).join(', ') || '(none — migration not applied)');

  console.log('\n3) Accountability indexes:');
  const idx = await prisma.$queryRawUnsafe<Array<{ indexname: string; indexdef: string }>>(
    `SELECT indexname, indexdef FROM pg_indexes
      WHERE indexname IN (
        'funding_dept_one_head_key',
        'funding_dept_school_one_member_key',
        'idx_assignment_follow_ups_due'
      )
      ORDER BY indexname`
  );
  for (const row of idx) {
    console.log(`    ${row.indexname}\n      ${row.indexdef.replace(' USING btree', '')}`);
  }
  if (idx.length !== 3) console.log('    !! expected 3 indexes, found', idx.length);

  console.log('\n4) Department state by tenant:');
  const members = await prisma.fundingDeptMember.findMany({
    include: {
      user: { select: { email: true, name: true } },
      tenant: { select: { name: true } },
      school_assignments: { include: { org_unit: { select: { name: true } } } },
    },
    orderBy: [{ tenant_id: 'asc' }, { is_head: 'desc' }],
  });
  if (members.length === 0) {
    console.log('    (no funding department members yet)');
  }
  for (const m of members) {
    const schools = m.school_assignments.map((s) => s.org_unit.name).join(', ') || 'none';
    console.log(
      `    [${m.tenant.name}] ${m.user.name || m.user.email}${m.is_head ? ' (HEAD)' : ''}` +
        `${m.is_active ? '' : ' (inactive)'} — schools: ${schools}`
    );
  }

  const followUps = await prisma.assignmentFollowUp.count();
  const dueReminders = await prisma.assignmentFollowUp.count({
    where: { remind_at: { not: null, lte: new Date() }, reminder_sent_at: null },
  });
  console.log(`\n5) Follow-ups: ${followUps} total, ${dueReminders} reminder(s) due now`);

  const scopeFlagIndex = process.argv.indexOf('--scope');
  if (scopeFlagIndex !== -1 && process.argv[scopeFlagIndex + 1]) {
    const userId = process.argv[scopeFlagIndex + 1];
    const { resolveManagedScope } = await import('../src/lib/orgUnits/scope');
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, roles: true, tenantId: true, tenant: { select: { org_scope_enforced: true } } },
    });
    if (!user?.tenantId) {
      console.log(`\n6) --scope: user ${userId} not found or has no tenant`);
    } else {
      const scope = await resolveManagedScope({
        tenantId: user.tenantId,
        userId: user.id,
        roles: user.roles as string[],
        enforceScope: user.tenant?.org_scope_enforced,
      });
      console.log(`\n6) ManagedScope for ${user.email} (roles: ${user.roles.join(',')}):`);
      console.log('   ', JSON.stringify(scope, null, 2).split('\n').join('\n    '));
    }
  }

  if (process.argv.includes('--sweep')) {
    const { sweepDueReminders } = await import('../src/lib/fundingDept/reminderService');
    const { sweepDeadlineEscalations } = await import('../src/lib/fundingDept/escalationService');
    console.log('\n7) Sweep (first run) — the same two jobs the cron route runs:');
    console.log('     reminders  ', JSON.stringify(await sweepDueReminders()));
    console.log('     escalations', JSON.stringify(await sweepDeadlineEscalations()));
    console.log('    Second run — every unit of work already claimed, so nothing should send:');
    console.log('     reminders  ', JSON.stringify(await sweepDueReminders()));
    console.log('     escalations', JSON.stringify(await sweepDeadlineEscalations()));
  }

  if (process.argv.includes('--digest')) {
    const { sendWeeklyDigests } = await import('../src/lib/fundingDept/weeklyReportService');
    console.log('\n8) Weekly digest (first run):');
    console.log('   ', JSON.stringify(await sendWeeklyDigests()));
    console.log('    Second run — the stamps should skip every recipient:');
    console.log('   ', JSON.stringify(await sendWeeklyDigests()));
  }

  const emailFlagIndex = process.argv.indexOf('--email-test');
  if (emailFlagIndex !== -1 && process.argv[emailFlagIndex + 1]) {
    const to = process.argv[emailFlagIndex + 1];
    const [{ sendEmail }, { assignmentNotificationTemplate }] = await Promise.all([
      import('../src/lib/mailer'),
      import('../src/lib/email-templates'),
    ]);
    console.log(`\n9) Sending one assignment email to ${to} …`);
    try {
      const result = await sendEmail({
        to,
        toName: 'Test Recipient',
        ...assignmentNotificationTemplate({
          email: to,
          name: 'Test Recipient',
          assignerName: 'Funding Department (test)',
          callTitle: 'Deliverability test — please ignore',
          agency: 'Test Agency',
          deadline: '31 Dec 2026',
          message: 'This is a delivery check for the assignment notification template.',
        }),
      });
      // sendEmail returns {sent:false} when keys are absent and throws on a
      // non-2xx, so `sent: true` means Mailjet accepted the message.
      console.log('    result:', JSON.stringify(result));
    } catch (error) {
      console.log('    FAILED:', error instanceof Error ? error.message : String(error));
    }
  }

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
