/**
 * Cross-tenant account surgery for a single user.
 *
 * Emails are globally unique (`User.email @unique`) and signup takes its tenant
 * from the ATI token, so an account created against the wrong token cannot be
 * re-pointed from any screen: `/super-admin/users` has no delete and no tenant
 * picker for an existing row, `changeTenantAdmin` refuses a user whose
 * `tenantId` is not already the target, and `provisionUser` returns EMAIL_TAKEN
 * rather than adopting the address. This script is the escape hatch.
 *
 * Two modes:
 *   move    - repoint the account at another tenant, keeping the login intact
 *   release - rename the address so it can be re-registered from scratch
 *
 * Nothing is written without --apply.
 *
 *   node scripts/move-user-to-tenant.js --email a@b.com
 *   node scripts/move-user-to-tenant.js --email a@b.com --tenant LPU --roles MEMBER --apply
 *   node scripts/move-user-to-tenant.js --email a@b.com --release a+old@b.com --apply
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const VALID_ROLES = [
  'SUPER_ADMIN', 'SUPER_ADMIN_VIEWER', 'PLATFORM_STAFF',
  'OWNER', 'ADMIN', 'MANAGER', 'ANALYST', 'VIEWER',
  'MEMBER', 'CALL_ASSIGNER', 'CALL_ADMIN', 'QUALITY_AUDITOR'
];

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    if (key === 'apply') {
      args.apply = true;
      continue;
    }
    args[key] = argv[i + 1];
    i += 1;
  }
  return args;
}

async function describe(email) {
  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true, email: true, name: true, roles: true, status: true,
      emailVerified: true, createdAt: true, tenantId: true,
      tenant: { select: { id: true, name: true, atiId: true } },
      researcher_profile: { select: { id: true, org_unit_id: true } },
      _count: {
        select: {
          projects: true, draftingSessions: true, notifications: true,
          usageLogs: true, auditLogs: true, oauthAccounts: true
        }
      }
    }
  });

  if (!user) {
    console.log(`No account found for ${email}.`);
    return null;
  }

  console.log('Account');
  console.log(`  id            ${user.id}`);
  console.log(`  email         ${user.email}`);
  console.log(`  name          ${user.name || '(none)'}`);
  console.log(`  roles         ${user.roles.join(', ')}`);
  console.log(`  status        ${user.status}  emailVerified=${user.emailVerified}`);
  console.log(`  created       ${user.createdAt.toISOString()}`);
  console.log(`  tenant        ${user.tenant ? `${user.tenant.name} (${user.tenant.atiId}) ${user.tenant.id}` : '(none)'}`);
  console.log(`  oauth links   ${user._count.oauthAccounts}`);
  console.log('Owned rows that stay attached to this account through a move');
  console.log(`  projects ${user._count.projects}  drafting ${user._count.draftingSessions}  notifications ${user._count.notifications}  usage ${user._count.usageLogs}  audit ${user._count.auditLogs}`);
  if (user.researcher_profile) {
    console.log(`  researcher profile ${user.researcher_profile.id} org_unit=${user.researcher_profile.org_unit_id || '(none)'}`);
  }
  return user;
}

async function listTenants() {
  const tenants = await prisma.tenant.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, name: true, atiId: true, _count: { select: { users: true } } },
    orderBy: { name: 'asc' }
  });
  console.log(`\nActive tenants (${tenants.length}), most populated first:`);
  tenants
    .sort((a, b) => b._count.users - a._count.users)
    .slice(0, 15)
    .forEach(t => console.log(`  ${t.atiId.padEnd(20)} ${String(t._count.users).padStart(5)} users  ${t.name}  ${t.id}`));
}

async function move(user, tenantKey, rolesArg, apply) {
  const tenant = await prisma.tenant.findFirst({
    where: { OR: [{ atiId: tenantKey }, { id: tenantKey }] },
    select: { id: true, name: true, atiId: true, status: true }
  });

  if (!tenant) {
    throw new Error(`No tenant matches "${tenantKey}" by ATI id or id.`);
  }
  if (tenant.id === user.tenantId) {
    console.log(`\n${user.email} is already in ${tenant.name}. Nothing to do.`);
    return;
  }

  const roles = rolesArg
    ? rolesArg.split(',').map(r => r.trim().toUpperCase()).filter(Boolean)
    : user.roles;
  const invalid = roles.filter(r => !VALID_ROLES.includes(r));
  if (invalid.length > 0) {
    throw new Error(`Unknown role(s): ${invalid.join(', ')}`);
  }

  console.log(`\nMove ${user.email}`);
  console.log(`  from  ${user.tenant ? `${user.tenant.name} (${user.tenant.atiId})` : '(no tenant)'}`);
  console.log(`  to    ${tenant.name} (${tenant.atiId})${tenant.status !== 'ACTIVE' ? `  [tenant is ${tenant.status}]` : ''}`);
  console.log(`  roles ${user.roles.join(', ')} -> ${roles.join(', ')}`);
  console.log('  Rows written under the old tenant (projects, grant sessions, funding');
  console.log('  assignments, audit entries) keep their old tenantId and drop out of');
  console.log('  this account view. Fine for a test account, not for a live one.');

  if (!apply) {
    console.log('\nDry run. Re-run with --apply to write.');
    return;
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { tenantId: tenant.id, roles },
    select: { email: true, roles: true, tenant: { select: { name: true, atiId: true } } }
  });
  console.log(`\nMoved. ${updated.email} is now ${updated.roles.join(', ')} in ${updated.tenant.name} (${updated.tenant.atiId}).`);
  console.log('Existing sessions carry the old tenant until the access token expires. Log out and back in.');
}

async function release(user, newEmail, apply) {
  const target = newEmail.trim().toLowerCase();
  if (!target.includes('@')) {
    throw new Error(`"${newEmail}" is not an email address.`);
  }
  const clash = await prisma.user.findUnique({ where: { email: target }, select: { id: true } });
  if (clash) {
    throw new Error(`${target} is already taken by another account.`);
  }

  console.log(`\nRelease ${user.email} -> ${target}`);
  console.log('  The account, its data and its password stay put under the new address.');
  console.log(`  ${user.email} becomes free to register again against any ATI token.`);
  if (user._count.oauthAccounts > 0) {
    console.log(`  ${user._count.oauthAccounts} social login link(s) stay on the renamed account.`);
  }

  if (!apply) {
    console.log('\nDry run. Re-run with --apply to write.');
    return;
  }

  await prisma.user.update({ where: { id: user.id }, data: { email: target } });
  console.log(`\nReleased. ${user.email} is now free; the old account lives at ${target}.`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.email) {
    console.log('Usage: node scripts/move-user-to-tenant.js --email <address> [--tenant <ATI_ID|id> [--roles A,B]] [--release <new address>] [--apply]');
    process.exitCode = 1;
    return;
  }

  const email = args.email.trim().toLowerCase();
  const user = await describe(email);
  if (!user) {
    process.exitCode = 1;
    return;
  }

  if (args.tenant && args.release) {
    throw new Error('Pick one of --tenant or --release, not both.');
  }

  if (args.tenant) {
    await move(user, args.tenant, args.roles, Boolean(args.apply));
  } else if (args.release) {
    await release(user, args.release, Boolean(args.apply));
  } else {
    await listTenants();
    console.log('\nPass --tenant <ATI_ID> to move this account, or --release <new address> to free the email.');
  }
}

main()
  .catch(error => {
    console.error(`\nFailed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
