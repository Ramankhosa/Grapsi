#!/usr/bin/env node

/**
 * Super admin snapshot seed utility.
 *
 * Use this to capture and restore platform-level configuration and super-admin
 * accounts around database resets.
 *
 * Usage:
 *   node scripts/production-seed-script.js export
 *   node scripts/production-seed-script.js import
 *   node scripts/production-seed-script.js export path/to/file.json
 */

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');
const { PrismaClient } = require('@prisma/client');

dotenv.config();

const prisma = new PrismaClient();

const DEFAULT_SNAPSHOT_PATH = path.join(
  process.cwd(),
  'prisma',
  'super-admin-settings.snapshot.json'
);

const SUPER_ADMIN_ROLE_FILTER = [{ roles: { has: 'SUPER_ADMIN' } }, { roles: { has: 'SUPER_ADMIN_VIEWER' } }];

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function hydrateDates(value) {
  if (Array.isArray(value)) {
    return value.map(hydrateDates);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  const hydrated = {};
  for (const [key, raw] of Object.entries(value)) {
    if (
      typeof raw === 'string' &&
      /(At|Date|From|Until|Expiry|Expires)$/i.test(key) &&
      !Number.isNaN(Date.parse(raw))
    ) {
      hydrated[key] = new Date(raw);
    } else {
      hydrated[key] = hydrateDates(raw);
    }
  }
  return hydrated;
}

async function ensureDefaultSuperAdmin() {
  const email = process.env.SUPER_ADMIN_EMAIL || 'superadmin@spotipr.com';
  const password = process.env.SUPER_ADMIN_PASSWORD || 'SuperSecure123!';
  const name = process.env.SUPER_ADMIN_NAME || 'Super Admin';
  const forceDefaultPassword = process.env.SUPER_ADMIN_FORCE_DEFAULT_PASSWORD === 'true';
  const passwordHash = await bcrypt.hash(password, 12);

  const platformTenant = await prisma.tenant.upsert({
    where: { atiId: 'PLATFORM' },
    update: {
      name: 'Platform Administration',
      status: 'ACTIVE',
    },
    create: {
      name: 'Platform Administration',
      atiId: 'PLATFORM',
      status: 'ACTIVE',
    },
  });

  const existing = await prisma.user.findUnique({ where: { email } });
  let superAdmin;

  if (existing) {
    const nextRoles = Array.isArray(existing.roles) ? [...existing.roles] : [];
    if (!nextRoles.includes('SUPER_ADMIN')) {
      nextRoles.push('SUPER_ADMIN');
    }

    const updateData = {
      tenantId: platformTenant.id,
      name: existing.name || name,
      status: 'ACTIVE',
      emailVerified: true,
      roles: nextRoles,
      signupAtiTokenId: null,
    };

    if (forceDefaultPassword) {
      updateData.passwordHash = passwordHash;
    }

    superAdmin = await prisma.user.update({
      where: { email },
      data: updateData,
    });
  } else {
    superAdmin = await prisma.user.create({
      data: {
        tenantId: platformTenant.id,
        email,
        name,
        passwordHash,
        status: 'ACTIVE',
        emailVerified: true,
        roles: ['SUPER_ADMIN'],
        signupAtiTokenId: null,
      },
    });
  }

  return {
    tenantId: platformTenant.id,
    userId: superAdmin.id,
  };
}

async function maybeResetSuperAdminPassword() {
  const newPassword = process.env.SUPER_ADMIN_RESET_PASSWORD;
  if (!newPassword) {
    return;
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.user.updateMany({
    where: {
      OR: SUPER_ADMIN_ROLE_FILTER,
    },
    data: {
      passwordHash,
      status: 'ACTIVE',
    },
  });
  console.log('[seed] Applied SUPER_ADMIN_RESET_PASSWORD to admin accounts.');
}

async function exportSnapshot(snapshotPath) {
  const users = await prisma.user.findMany({
    where: { OR: SUPER_ADMIN_ROLE_FILTER },
  });
  const userIds = unique(users.map((user) => user.id));
  const tenantIdsFromUsers = unique(users.map((user) => user.tenantId));

  const platformTenant = await prisma.tenant.findUnique({
    where: { atiId: 'PLATFORM' },
  });
  const tenantIds = unique([
    ...tenantIdsFromUsers,
    platformTenant ? platformTenant.id : null,
  ]);

  const snapshot = {
    meta: {
      exportedAt: new Date().toISOString(),
      version: 1,
    },
    tenants: tenantIds.length
      ? await prisma.tenant.findMany({ where: { id: { in: tenantIds } } })
      : [],
    users,
    tenantPlans: tenantIds.length
      ? await prisma.tenantPlan.findMany({ where: { tenantId: { in: tenantIds } } })
      : [],
    userServiceQuotas: userIds.length
      ? await prisma.userServiceQuota.findMany({ where: { userId: { in: userIds } } })
      : [],
    userCredits: userIds.length
      ? await prisma.userCredit.findMany({ where: { userId: { in: userIds } } })
      : [],

    // Platform-wide configurable catalogs
    plans: await prisma.plan.findMany(),
    features: await prisma.feature.findMany(),
    tasks: await prisma.task.findMany(),
    lLMModelClasses: await prisma.lLMModelClass.findMany(),
    planFeatures: await prisma.planFeature.findMany(),
    planLLMAccess: await prisma.planLLMAccess.findMany(),
    policyRules: await prisma.policyRule.findMany(),
    lLMModels: await prisma.lLMModel.findMany(),
    workflowStages: await prisma.workflowStage.findMany(),
    planStageModelConfigs: await prisma.planStageModelConfig.findMany(),
    planTaskModelConfigs: await prisma.planTaskModelConfig.findMany(),
    lLMModelPrices: await prisma.lLMModelPrice.findMany(),
    paperTypeDefinitions: await prisma.paperTypeDefinition.findMany(),
    citationStyleDefinitions: await prisma.citationStyleDefinition.findMany(),
    publicationVenues: await prisma.publicationVenue.findMany(),
    systemPromptTemplates: await prisma.systemPromptTemplate.findMany(),
    paperSupersetSections: await prisma.paperSupersetSection.findMany(),
    paperTypeSectionPrompts: await prisma.paperTypeSectionPrompt.findMany(),
    countryNames: await prisma.countryName.findMany(),
    supersetSections: await prisma.supersetSection.findMany(),
    countryProfiles: await prisma.countryProfile.findMany(),
    countrySectionMappings: await prisma.countrySectionMapping.findMany(),
    countrySectionPrompts: await prisma.countrySectionPrompt.findMany(),
    countrySectionValidations: await prisma.countrySectionValidation.findMany(),
    countryCrossValidations: await prisma.countryCrossValidation.findMany(),
    countryDiagramConfigs: await prisma.countryDiagramConfig.findMany(),
    countryDiagramHints: await prisma.countryDiagramHint.findMany(),
    countryExportConfigs: await prisma.countryExportConfig.findMany(),
    countryExportHeadings: await prisma.countryExportHeading.findMany(),
  };

  fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
  fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));

  const countSummary = Object.entries(snapshot)
    .filter(([key]) => key !== 'meta')
    .map(([key, value]) => `${key}=${Array.isArray(value) ? value.length : 0}`)
    .join(', ');

  console.log(`[seed] Exported super-admin snapshot to ${snapshotPath}`);
  console.log(`[seed] ${countSummary}`);
}

async function createMany(delegateName, rows, label) {
  if (!Array.isArray(rows) || rows.length === 0) {
    console.log(`[seed] ${label}: 0 rows`);
    return;
  }

  const hydratedRows = rows.map(hydrateDates);
  const result = await prisma[delegateName].createMany({
    data: hydratedRows,
    skipDuplicates: true,
  });
  console.log(`[seed] ${label}: inserted ${result.count}/${rows.length}`);
}

async function importSnapshot(snapshotPath) {
  if (!fs.existsSync(snapshotPath)) {
    console.log(`[seed] Snapshot not found at ${snapshotPath}. Seeding default super admin only.`);
    await ensureDefaultSuperAdmin();
    await maybeResetSuperAdminPassword();
    return;
  }

  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));

  // Clear migration-seeded catalog data so the snapshot's IDs take precedence
  // (migrations seed these tables with hardcoded IDs that differ from snapshot IDs).
  // Order matters: delete child FKs first.
  const catalogCleanup = [
    ['publicationVenue', 'publication_venues'],
    ['citationStyleDefinition', 'citation_style_definitions'],
    ['paperTypeDefinition', 'paper_type_definitions'],
    ['systemPromptTemplate', 'system_prompt_templates'],
  ];
  for (const [delegate, label] of catalogCleanup) {
    try {
      const del = await prisma[delegate].deleteMany({});
      if (del.count) console.log(`[seed] cleared ${del.count} migration-seeded ${label}`);
    } catch (_) { /* table may not exist yet */ }
  }

  // Core identities first
  await createMany('tenant', snapshot.tenants, 'tenants');
  await createMany('plan', snapshot.plans, 'plans');
  await createMany('feature', snapshot.features, 'features');
  await createMany('task', snapshot.tasks, 'tasks');
  await createMany('lLMModelClass', snapshot.lLMModelClasses, 'llm_model_classes');
  await createMany('lLMModel', snapshot.lLMModels, 'llm_models');
  await createMany('workflowStage', snapshot.workflowStages, 'workflow_stages');
  await createMany('paperTypeDefinition', snapshot.paperTypeDefinitions, 'paper_type_definitions');
  await createMany(
    'citationStyleDefinition',
    snapshot.citationStyleDefinitions,
    'citation_style_definitions'
  );
  await createMany('countryName', snapshot.countryNames, 'country_names');
  await createMany('supersetSection', snapshot.supersetSections, 'superset_sections');
  await createMany('paperSupersetSection', snapshot.paperSupersetSections, 'paper_superset_sections');

  // Users are sanitized to avoid stale token references.
  const sanitizedUsers = (snapshot.users || []).map((user) => ({
    ...user,
    signupAtiTokenId: null,
  }));
  await createMany('user', sanitizedUsers, 'users');

  // Always guarantee one valid SUPER_ADMIN login.
  const seedIdentity = await ensureDefaultSuperAdmin();

  await createMany('tenantPlan', snapshot.tenantPlans, 'tenant_plans');
  await createMany('userServiceQuota', snapshot.userServiceQuotas, 'user_service_quotas');
  await createMany('userCredit', snapshot.userCredits, 'user_credits');
  await createMany('planFeature', snapshot.planFeatures, 'plan_features');
  await createMany('planLLMAccess', snapshot.planLLMAccess, 'plan_llm_access');
  await createMany('policyRule', snapshot.policyRules, 'policy_rules');
  await createMany(
    'planStageModelConfig',
    snapshot.planStageModelConfigs,
    'plan_stage_model_configs'
  );
  await createMany('planTaskModelConfig', snapshot.planTaskModelConfigs, 'plan_task_model_configs');
  await createMany('lLMModelPrice', snapshot.lLMModelPrices, 'llm_model_prices');
  await createMany('publicationVenue', snapshot.publicationVenues, 'publication_venues');
  await createMany('systemPromptTemplate', snapshot.systemPromptTemplates, 'system_prompt_templates');

  // Country profiles require existing creator users; fall back to super-admin.
  const existingUsers = await prisma.user.findMany({ select: { id: true } });
  const existingUserIds = new Set(existingUsers.map((user) => user.id));
  const normalizedCountryProfiles = (snapshot.countryProfiles || []).map((profile) => ({
    ...profile,
    createdBy: existingUserIds.has(profile.createdBy) ? profile.createdBy : seedIdentity.userId,
    updatedBy:
      profile.updatedBy && existingUserIds.has(profile.updatedBy)
        ? profile.updatedBy
        : profile.updatedBy
          ? seedIdentity.userId
          : null,
  }));

  await createMany('countryProfile', normalizedCountryProfiles, 'country_profiles');
  await createMany('countrySectionMapping', snapshot.countrySectionMappings, 'country_section_mappings');
  await createMany('countrySectionPrompt', snapshot.countrySectionPrompts, 'country_section_prompts');
  await createMany(
    'countrySectionValidation',
    snapshot.countrySectionValidations,
    'country_section_validations'
  );
  await createMany(
    'countryCrossValidation',
    snapshot.countryCrossValidations,
    'country_cross_validations'
  );
  await createMany('countryDiagramConfig', snapshot.countryDiagramConfigs, 'country_diagram_configs');
  await createMany('countryDiagramHint', snapshot.countryDiagramHints, 'country_diagram_hints');
  await createMany('countryExportConfig', snapshot.countryExportConfigs, 'country_export_configs');
  await createMany('countryExportHeading', snapshot.countryExportHeadings, 'country_export_headings');
  await createMany(
    'paperTypeSectionPrompt',
    snapshot.paperTypeSectionPrompts,
    'paper_type_section_prompts'
  );

  await maybeResetSuperAdminPassword();
  console.log(`[seed] Import completed from ${snapshotPath}`);
}

async function main() {
  const mode = (process.argv[2] || 'import').toLowerCase();
  const snapshotPath = process.argv[3]
    ? path.resolve(process.cwd(), process.argv[3])
    : DEFAULT_SNAPSHOT_PATH;

  if (mode !== 'export' && mode !== 'import') {
    console.error('Usage: node scripts/super-admin-settings-seed.js <export|import> [snapshotPath]');
    process.exit(1);
  }

  if (mode === 'export') {
    await exportSnapshot(snapshotPath);
  } else {
    await importSnapshot(snapshotPath);
  }
}

main()
  .catch((error) => {
    console.error('[seed] Failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
