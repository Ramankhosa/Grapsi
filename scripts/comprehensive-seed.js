#!/usr/bin/env node

/**
 * Comprehensive Database Seed Script
 *
 * This script exports all existing data and then seeds the complete database
 * with all necessary data for development and testing.
 *
 * Usage:
 *   node scripts/comprehensive-seed.js [--export-only] [--skip-export]
 */

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

// Configuration
const EXPORT_DIR = path.join(__dirname, '..', 'database-backup');
const COUNTRIES_DIR = path.join(__dirname, '..', 'Countries');

// Ensure export directory exists
if (!fs.existsSync(EXPORT_DIR)) {
  fs.mkdirSync(EXPORT_DIR, { recursive: true });
}

const prisma = new PrismaClient();

// Replicate auth functions
function generateATIToken() {
  return crypto.randomBytes(32).toString('hex').toUpperCase();
}

function hashATIToken(token) {
  return bcrypt.hashSync(token, 12);
}

function createATIFingerprint(tokenHash) {
  return tokenHash.substring(tokenHash.length - 6).toUpperCase();
}

// Export functions
async function exportTableData(tableName, where = {}) {
  console.log(`📤 Exporting ${tableName}...`);
  const data = await prisma[tableName].findMany({
    where
  });

  const exportPath = path.join(EXPORT_DIR, `${tableName}.json`);
  fs.writeFileSync(exportPath, JSON.stringify(data, null, 2));
  console.log(`✅ Exported ${data.length} ${tableName} records to ${exportPath}`);
  return data;
}

async function exportAllData() {
  console.log('🚀 Starting data export...\n');

  const exports = {
    tenants: await exportTableData('tenant'),
    users: await exportTableData('user'),
    aTITokens: await exportTableData('aTIToken'),
    auditLogs: await exportTableData('auditLog'),
    plans: await exportTableData('plan'),
    features: await exportTableData('feature'),
    tasks: await exportTableData('task'),
    planFeatures: await exportTableData('planFeature'),
    planLLMAccess: await exportTableData('planLLMAccess'),
    lLMModelClasses: await exportTableData('lLMModelClass'),
    policyRules: await exportTableData('policyRule'),
    tenantPlans: await exportTableData('tenantPlan'),
    usageReservations: await exportTableData('usageReservation'),
    usageMeters: await exportTableData('usageMeter'),
    usageLogs: await exportTableData('usageLog'),
    lLMModelPrices: await exportTableData('lLMModelPrice'),
    quotaAlerts: await exportTableData('quotaAlert'),
    projects: await exportTableData('project'),
    applicantProfiles: await exportTableData('applicantProfile'),
    projectCollaborators: await exportTableData('projectCollaborator'),
    patents: await exportTableData('patent'),
    annexureVersions: await exportTableData('annexureVersion'),
    jobs: await exportTableData('job'),
    tokenNotifications: await exportTableData('tokenNotification'),
    priorArtSearchBundles: await exportTableData('priorArtSearchBundle'),
    priorArtSearchHistory: await exportTableData('priorArtSearchHistory'),
    priorArtQueryVariants: await exportTableData('priorArtQueryVariant'),
    priorArtRuns: await exportTableData('priorArtRun'),
    priorArtQueryVariantExecutions: await exportTableData('priorArtQueryVariantExecution'),
    priorArtRawResults: await exportTableData('priorArtRawResult'),
    priorArtRawDetails: await exportTableData('priorArtRawDetail'),
    priorArtPatents: await exportTableData('priorArtPatent'),
    priorArtVariantHits: await exportTableData('priorArtVariantHit'),
    priorArtPatentDetails: await exportTableData('priorArtPatentDetail'),
    priorArtUnifiedResults: await exportTableData('priorArtUnifiedResult'),
    priorArtScholarContent: await exportTableData('priorArtScholarContent'),
    localPatents: await exportTableData('localPatent'),
    noveltyAssessmentRuns: await exportTableData('noveltyAssessmentRun'),
    noveltyAssessmentLLMCalls: await exportTableData('noveltyAssessmentLLMCall'),
    noveltySearchRuns: await exportTableData('noveltySearchRun'),
    noveltySearchLLMCalls: await exportTableData('noveltySearchLLMCall'),
    featureMapCells: await exportTableData('featureMapCell'),
    aggregationSnapshots: await exportTableData('aggregationSnapshot'),
    featureMapOverrides: await exportTableData('featureMapOverride'),
    featureMappingCaches: await exportTableData('featureMappingCache'),
    draftingSessions: await exportTableData('draftingSession'),
    ideaRecords: await exportTableData('ideaRecord'),
    referenceMaps: await exportTableData('referenceMap'),
    figurePlans: await exportTableData('figurePlan'),
    diagramSources: await exportTableData('diagramSource'),
    annexureDrafts: await exportTableData('annexureDraft'),
    relatedArtRuns: await exportTableData('relatedArtRun'),
    relatedArtSelections: await exportTableData('relatedArtSelection'),
    ideaBankSuggestions: await exportTableData('ideaBankSuggestion'),
    draftingHistory: await exportTableData('draftingHistory'),
    userCredits: await exportTableData('userCredit'),
    ideaBankIdeas: await exportTableData('ideaBankIdea'),
    ideaBankReservations: await exportTableData('ideaBankReservation'),
    ideaBankHistory: await exportTableData('ideaBankHistory'),
    styleProfiles: await exportTableData('styleProfile'),
    styleTrainingJobs: await exportTableData('styleTrainingJob'),
    documents: await exportTableData('document'),
    countryProfiles: await exportTableData('countryProfile'),
    countrySectionMappings: await exportTableData('countrySectionMapping'),
    countryNames: await exportTableData('countryName'),
    emailVerificationTokens: await exportTableData('emailVerificationToken'),
    passwordResetTokens: await exportTableData('passwordResetToken')
  };

  // Create export summary
  const summaryPath = path.join(EXPORT_DIR, 'export-summary.json');
  const summary = {
    exportedAt: new Date().toISOString(),
    version: '1.0',
    tables: Object.keys(exports).reduce((acc, table) => {
      acc[table] = exports[table].length;
      return acc;
    }, {})
  };
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  console.log('\n✅ Data export completed!');
  console.log(`📁 Export directory: ${EXPORT_DIR}`);
  console.log(`📊 Summary saved to: ${summaryPath}\n`);

  return exports;
}

// Seed functions
async function seedUserHierarchy() {
  console.log('👑 PHASE 1: Creating User Hierarchy');

  // Super Admin Setup
  const superAdminEmail = 'superadmin@spotipr.com';
  const superAdminPassword = 'SuperSecure123!';
  const superAdminName = 'Super Admin';

  const superAdminPasswordHash = await bcrypt.hash(superAdminPassword, 12);

  // Create platform tenant
  const platformTenant = await prisma.tenant.upsert({
    where: { atiId: 'PLATFORM' },
    update: {},
    create: {
      name: 'Platform Administration',
      atiId: 'PLATFORM',
      status: 'ACTIVE'
    }
  });

  // Generate platform ATI token
  const rawToken = generateATIToken();
  const tokenHash = hashATIToken(rawToken);
  const fingerprint = createATIFingerprint(tokenHash);

  let platformToken = await prisma.aTIToken.findFirst({
    where: { tokenHash }
  })

  if (!platformToken) {
    platformToken = await prisma.aTIToken.create({
      data: {
        tenantId: platformTenant.id,
        tokenHash,
        rawToken,
        rawTokenExpiry: new Date(Date.now() + 24 * 60 * 60 * 1000),
        fingerprint,
        status: 'ISSUED',
        planTier: 'PLATFORM_ADMIN',
        notes: 'Super Admin Onboarding Token',
        maxUses: 5
      }
    })
  };

  const superAdmin = await prisma.user.upsert({
    where: { email: superAdminEmail },
    update: {
      passwordHash: superAdminPasswordHash,
      name: superAdminName,
      status: 'ACTIVE'
    },
    create: {
      tenantId: platformTenant.id,
      email: superAdminEmail,
      passwordHash: superAdminPasswordHash,
      name: superAdminName,
      roles: ['SUPER_ADMIN'],
      status: 'ACTIVE',
      signupAtiTokenId: platformToken.id
    }
  });

  console.log(`✅ Super Admin: ${superAdminEmail} / ${superAdminPassword}`);
  console.log(`🎫 ATI Token: ${rawToken}`);

  // Tenant Admin Setup
  const tenantAdminEmail = 'tenantadmin@spotipr.com';
  const tenantAdminPassword = 'TenantAdmin123!';
  const tenantAdminName = 'Tenant Admin';

  const testTenant = await prisma.tenant.upsert({
    where: { atiId: 'TESTTENANT' },
    update: {},
    create: {
      name: 'Test Company Inc.',
      atiId: 'TESTTENANT',
      status: 'ACTIVE'
    }
  });

  // Clean up old ATI tokens
  await prisma.aTIToken.deleteMany({
    where: { tenantId: testTenant.id, tokenHash: { not: tokenHash } }
  });

  const tenantRawToken = generateATIToken();
  const tenantTokenHash = hashATIToken(tenantRawToken);
  const tenantFingerprint = createATIFingerprint(tenantTokenHash);

  let tenantToken = await prisma.aTIToken.findFirst({
    where: { tokenHash: tenantTokenHash }
  })

  if (!tenantToken) {
    tenantToken = await prisma.aTIToken.create({
      data: {
        tenantId: testTenant.id,
        tokenHash: tenantTokenHash,
        rawToken: tenantRawToken,
        rawTokenExpiry: new Date(Date.now() + 24 * 60 * 60 * 1000),
        fingerprint: tenantFingerprint,
        status: 'ISSUED',
        planTier: 'FREE_PLAN',
        notes: 'Tenant Admin Onboarding Token',
        maxUses: 5
      }
    })
  };

  const tenantAdminPasswordHash = await bcrypt.hash(tenantAdminPassword, 12);

  const tenantAdmin = await prisma.user.upsert({
    where: { email: tenantAdminEmail },
    update: {
      passwordHash: tenantAdminPasswordHash,
      name: tenantAdminName,
      roles: ['ADMIN'],
      status: 'ACTIVE'
    },
    create: {
      tenantId: testTenant.id,
      email: tenantAdminEmail,
      passwordHash: tenantAdminPasswordHash,
      name: tenantAdminName,
      roles: ['ADMIN'],
      status: 'ACTIVE',
      signupAtiTokenId: tenantToken.id
    }
  });

  console.log(`✅ Tenant Admin: ${tenantAdminEmail} / ${tenantAdminPassword}`);
  console.log(`🎫 ATI Token: ${tenantRawToken}`);

  // Analyst Setup
  const analystEmail = 'analyst@spotipr.com';
  const analystPassword = 'AnalystPass123!';
  const analystName = 'Test Analyst';

  const analystRawToken = generateATIToken();
  const analystTokenHash = hashATIToken(analystRawToken);
  const analystFingerprint = createATIFingerprint(analystTokenHash);

  let analystToken = await prisma.aTIToken.findFirst({
    where: { tokenHash: analystTokenHash }
  })

  if (!analystToken) {
    analystToken = await prisma.aTIToken.create({
      data: {
        tenantId: testTenant.id,
        tokenHash: analystTokenHash,
        rawToken: analystRawToken,
        rawTokenExpiry: new Date(Date.now() + 24 * 60 * 60 * 1000),
        fingerprint: analystFingerprint,
        status: 'ISSUED',
        planTier: 'FREE_PLAN',
        notes: 'Analyst Onboarding Token',
        maxUses: 10
      }
    })
  }

  const analystPasswordHash = await bcrypt.hash(analystPassword, 12);

  const analyst = await prisma.user.upsert({
    where: { email: analystEmail },
    update: {
      passwordHash: analystPasswordHash,
      name: analystName,
      roles: ['ANALYST'],
      status: 'ACTIVE'
    },
    create: {
      tenantId: testTenant.id,
      email: analystEmail,
      passwordHash: analystPasswordHash,
      name: analystName,
      roles: ['ANALYST'],
      status: 'ACTIVE',
      signupAtiTokenId: analystToken.id
    }
  });

  console.log(`✅ Analyst: ${analystEmail} / ${analystPassword}`);
  console.log(`🎫 ATI Token: ${analystRawToken}\n`);

  return { superAdmin, tenantAdmin, analyst, testTenant };
}

async function seedPlansAndFeatures() {
  console.log('📋 PHASE 2: Creating Plans and Features');

  // Create features
  const features = [
    { code: 'PRIOR_ART_SEARCH', name: 'Patent and Literature Search', unit: 'queries' },
    { code: 'PATENT_DRAFTING', name: 'AI-Assisted Patent Drafting', unit: 'tokens' },
    { code: 'DIAGRAM_GENERATION', name: 'Technical Diagram Generation', unit: 'diagrams' },
    { code: 'IDEA_BANK', name: 'Idea Bank Access', unit: 'reservations' },
    { code: 'PERSONA_SYNC', name: 'PersonaSync Style Learning', unit: 'trainings' },
    { code: 'PAPER_DRAFTING', name: 'Academic Paper Drafting', unit: 'tokens' }
  ];

  const createdFeatures = {};
  for (const featureData of features) {
    const feature = await prisma.feature.upsert({
      where: { code: featureData.code },
      update: {},
      create: featureData
    });
    createdFeatures[featureData.code] = feature;
  }
  console.log('✅ Created features');

  // Create tasks
  const tasks = [
    { code: 'LLM1_PRIOR_ART', name: 'Prior Art Search', linkedFeature: 'PRIOR_ART_SEARCH' },
    { code: 'LLM2_DRAFT', name: 'Patent Drafting', linkedFeature: 'PATENT_DRAFTING' },
    { code: 'LLM3_DIAGRAM', name: 'Diagram Generation', linkedFeature: 'DIAGRAM_GENERATION' },
    { code: 'LLM4_NOVELTY_SCREEN', name: 'Novelty Screening', linkedFeature: 'PRIOR_ART_SEARCH' },
    { code: 'LLM5_NOVELTY_ASSESS', name: 'Novelty Assessment', linkedFeature: 'PRIOR_ART_SEARCH' },
    { code: 'LLM6_REPORT_GENERATION', name: 'Report Generation', linkedFeature: 'PRIOR_ART_SEARCH' },
    { code: 'IDEA_BANK_ACCESS', name: 'Idea Bank Access', linkedFeature: 'IDEA_BANK' },
    { code: 'IDEA_BANK_RESERVE', name: 'Idea Reservation', linkedFeature: 'IDEA_BANK' },
    { code: 'IDEA_BANK_EDIT', name: 'Idea Editing', linkedFeature: 'IDEA_BANK' },
    { code: 'PERSONA_SYNC_LEARN', name: 'Style Learning', linkedFeature: 'PERSONA_SYNC' },
    { code: 'LITERATURE_RELEVANCE', name: 'Literature Relevance Analysis', linkedFeature: 'PAPER_DRAFTING' }
  ];

  const createdTasks = {};
  for (const taskData of tasks) {
    const task = await prisma.task.upsert({
      where: { code: taskData.code },
      update: {},
      create: {
        code: taskData.code,
        name: taskData.name,
        linkedFeatureId: createdFeatures[taskData.linkedFeature].id
      }
    });
    createdTasks[taskData.code] = task;
  }
  console.log('✅ Created tasks');

  // Create LLM Model Classes
  const modelClasses = [
    { code: 'BASE_S', name: 'Base Small' },
    { code: 'BASE_M', name: 'Base Medium' },
    { code: 'PRO_M', name: 'Professional Medium' },
    { code: 'PRO_L', name: 'Professional Large' },
    { code: 'ADVANCED', name: 'Advanced' }
  ];

  const createdModelClasses = {};
  for (const mcData of modelClasses) {
    const modelClass = await prisma.lLMModelClass.upsert({
      where: { code: mcData.code },
      update: {},
      create: mcData
    });
    createdModelClasses[mcData.code] = modelClass;
  }
  console.log('✅ Created LLM model classes');

  // Create plans
  const plans = [
    { code: 'FREE_PLAN', name: 'Basic Plan', cycle: 'MONTHLY', status: 'ACTIVE' },
    { code: 'PRO_PLAN', name: 'Professional Plan', cycle: 'MONTHLY', status: 'ACTIVE' },
    { code: 'ENTERPRISE_PLAN', name: 'Enterprise Plan', cycle: 'MONTHLY', status: 'ACTIVE' }
  ];

  const createdPlans = {};
  for (const planData of plans) {
    const plan = await prisma.plan.upsert({
      where: { code: planData.code },
      update: {},
      create: planData
    });
    createdPlans[planData.code] = plan;
  }
  console.log('✅ Created plans');

  // Set up plan features
  const planFeatures = [
    { planCode: 'FREE_PLAN', featureCode: 'PRIOR_ART_SEARCH', monthlyQuota: 50, dailyQuota: 10 },
    { planCode: 'FREE_PLAN', featureCode: 'PATENT_DRAFTING', monthlyQuota: 1000, dailyQuota: 100 },
    { planCode: 'FREE_PLAN', featureCode: 'PAPER_DRAFTING', monthlyQuota: 1000, dailyQuota: 100 },
    { planCode: 'PRO_PLAN', featureCode: 'PRIOR_ART_SEARCH', monthlyQuota: 1000, dailyQuota: 100 },
    { planCode: 'PRO_PLAN', featureCode: 'PATENT_DRAFTING', monthlyQuota: 10000, dailyQuota: 1000 },
    { planCode: 'PRO_PLAN', featureCode: 'DIAGRAM_GENERATION', monthlyQuota: 200, dailyQuota: 40 },
    { planCode: 'PRO_PLAN', featureCode: 'IDEA_BANK', monthlyQuota: 50, dailyQuota: 10 },
    { planCode: 'PRO_PLAN', featureCode: 'PAPER_DRAFTING', monthlyQuota: 10000, dailyQuota: 1000 },
    { planCode: 'ENTERPRISE_PLAN', featureCode: 'PRIOR_ART_SEARCH', monthlyQuota: 5000, dailyQuota: 500 },
    { planCode: 'ENTERPRISE_PLAN', featureCode: 'PATENT_DRAFTING', monthlyQuota: 50000, dailyQuota: 5000 },
    { planCode: 'ENTERPRISE_PLAN', featureCode: 'DIAGRAM_GENERATION', monthlyQuota: 500, dailyQuota: 100 },
    { planCode: 'ENTERPRISE_PLAN', featureCode: 'IDEA_BANK', monthlyQuota: 200, dailyQuota: 50 },
    { planCode: 'ENTERPRISE_PLAN', featureCode: 'PERSONA_SYNC', monthlyQuota: 50, dailyQuota: 10 },
    { planCode: 'ENTERPRISE_PLAN', featureCode: 'PAPER_DRAFTING', monthlyQuota: 50000, dailyQuota: 5000 }
  ];

  for (const pfData of planFeatures) {
    await prisma.planFeature.upsert({
      where: {
        planId_featureId: {
          planId: createdPlans[pfData.planCode].id,
          featureId: createdFeatures[pfData.featureCode].id
        }
      },
      update: {},
      create: {
        planId: createdPlans[pfData.planCode].id,
        featureId: createdFeatures[pfData.featureCode].id,
        monthlyQuota: pfData.monthlyQuota,
        dailyQuota: pfData.dailyQuota
      }
    });
  }
  console.log('✅ Created plan features');

  // Set up LLM access
  const llmAccess = [
    { planCode: 'FREE_PLAN', taskCode: 'LLM1_PRIOR_ART', allowedClasses: ['BASE_S'], defaultClass: 'BASE_S' },
    { planCode: 'FREE_PLAN', taskCode: 'LLM2_DRAFT', allowedClasses: ['BASE_S'], defaultClass: 'BASE_S' },
    { planCode: 'FREE_PLAN', taskCode: 'LLM4_NOVELTY_SCREEN', allowedClasses: ['BASE_S'], defaultClass: 'BASE_S' },
    { planCode: 'FREE_PLAN', taskCode: 'LLM5_NOVELTY_ASSESS', allowedClasses: ['BASE_S'], defaultClass: 'BASE_S' },
    { planCode: 'FREE_PLAN', taskCode: 'LLM6_REPORT_GENERATION', allowedClasses: ['BASE_S'], defaultClass: 'BASE_S' },
    { planCode: 'FREE_PLAN', taskCode: 'LITERATURE_RELEVANCE', allowedClasses: ['BASE_S', 'BASE_M'], defaultClass: 'BASE_S' },
    { planCode: 'PRO_PLAN', taskCode: 'LLM1_PRIOR_ART', allowedClasses: ['BASE_S', 'BASE_M', 'PRO_M'], defaultClass: 'PRO_M' },
    { planCode: 'PRO_PLAN', taskCode: 'LLM2_DRAFT', allowedClasses: ['BASE_S', 'BASE_M', 'PRO_M', 'PRO_L'], defaultClass: 'PRO_L' },
    { planCode: 'PRO_PLAN', taskCode: 'LLM3_DIAGRAM', allowedClasses: ['BASE_M', 'PRO_M'], defaultClass: 'PRO_M' },
    { planCode: 'PRO_PLAN', taskCode: 'LLM4_NOVELTY_SCREEN', allowedClasses: ['BASE_S', 'BASE_M'], defaultClass: 'BASE_M' },
    { planCode: 'PRO_PLAN', taskCode: 'LLM5_NOVELTY_ASSESS', allowedClasses: ['BASE_M', 'PRO_M'], defaultClass: 'PRO_M' },
    { planCode: 'PRO_PLAN', taskCode: 'LLM6_REPORT_GENERATION', allowedClasses: ['BASE_M', 'PRO_M'], defaultClass: 'PRO_M' },
    { planCode: 'PRO_PLAN', taskCode: 'IDEA_BANK_ACCESS', allowedClasses: ['BASE_S', 'BASE_M'], defaultClass: 'BASE_M' },
    { planCode: 'PRO_PLAN', taskCode: 'IDEA_BANK_RESERVE', allowedClasses: ['BASE_S', 'BASE_M'], defaultClass: 'BASE_M' },
    { planCode: 'PRO_PLAN', taskCode: 'IDEA_BANK_EDIT', allowedClasses: ['BASE_S', 'BASE_M'], defaultClass: 'BASE_M' },
    { planCode: 'PRO_PLAN', taskCode: 'LITERATURE_RELEVANCE', allowedClasses: ['BASE_M', 'PRO_M'], defaultClass: 'PRO_M' },
    { planCode: 'ENTERPRISE_PLAN', taskCode: 'LLM1_PRIOR_ART', allowedClasses: ['BASE_S', 'BASE_M', 'PRO_M', 'PRO_L', 'ADVANCED'], defaultClass: 'ADVANCED' },
    { planCode: 'ENTERPRISE_PLAN', taskCode: 'LLM2_DRAFT', allowedClasses: ['BASE_S', 'BASE_M', 'PRO_M', 'PRO_L', 'ADVANCED'], defaultClass: 'ADVANCED' },
    { planCode: 'ENTERPRISE_PLAN', taskCode: 'LLM3_DIAGRAM', allowedClasses: ['BASE_M', 'PRO_M', 'PRO_L', 'ADVANCED'], defaultClass: 'ADVANCED' },
    { planCode: 'ENTERPRISE_PLAN', taskCode: 'LLM4_NOVELTY_SCREEN', allowedClasses: ['BASE_S', 'BASE_M', 'PRO_M', 'PRO_L'], defaultClass: 'PRO_L' },
    { planCode: 'ENTERPRISE_PLAN', taskCode: 'LLM5_NOVELTY_ASSESS', allowedClasses: ['BASE_M', 'PRO_M', 'PRO_L', 'ADVANCED'], defaultClass: 'ADVANCED' },
    { planCode: 'ENTERPRISE_PLAN', taskCode: 'LLM6_REPORT_GENERATION', allowedClasses: ['BASE_M', 'PRO_M', 'PRO_L', 'ADVANCED'], defaultClass: 'ADVANCED' },
    { planCode: 'ENTERPRISE_PLAN', taskCode: 'IDEA_BANK_ACCESS', allowedClasses: ['BASE_S', 'BASE_M', 'PRO_M'], defaultClass: 'PRO_M' },
    { planCode: 'ENTERPRISE_PLAN', taskCode: 'IDEA_BANK_RESERVE', allowedClasses: ['BASE_S', 'BASE_M', 'PRO_M'], defaultClass: 'PRO_M' },
    { planCode: 'ENTERPRISE_PLAN', taskCode: 'IDEA_BANK_EDIT', allowedClasses: ['BASE_S', 'BASE_M', 'PRO_M'], defaultClass: 'PRO_M' },
    { planCode: 'ENTERPRISE_PLAN', taskCode: 'PERSONA_SYNC_LEARN', allowedClasses: ['BASE_M', 'PRO_M', 'PRO_L', 'ADVANCED'], defaultClass: 'ADVANCED' },
    { planCode: 'ENTERPRISE_PLAN', taskCode: 'LITERATURE_RELEVANCE', allowedClasses: ['BASE_M', 'PRO_M', 'PRO_L', 'ADVANCED'], defaultClass: 'ADVANCED' }
  ];

  for (const accessData of llmAccess) {
    await prisma.planLLMAccess.upsert({
      where: {
        planId_taskCode: {
          planId: createdPlans[accessData.planCode].id,
          taskCode: accessData.taskCode
        }
      },
      update: {},
      create: {
        planId: createdPlans[accessData.planCode].id,
        taskCode: accessData.taskCode,
        allowedClasses: JSON.stringify(accessData.allowedClasses),
        defaultClassId: createdModelClasses[accessData.defaultClass].id
      }
    });
  }
  console.log('✅ Created LLM access rules');

  // Assign plans to tenants
  const tenants = await prisma.tenant.findMany({
    include: { users: { select: { roles: true } } }
  });

  for (const tenant of tenants) {
    let assignedPlanCode = 'FREE_PLAN';
    const hasSuperAdmin = tenant.users.some(user => user.roles?.includes('SUPER_ADMIN'));
    const hasAdmin = tenant.users.some(user => user.roles?.includes('ADMIN'));
    const hasAnalyst = tenant.users.some(user => user.roles?.includes('ANALYST'));

    if (hasSuperAdmin) assignedPlanCode = 'ENTERPRISE_PLAN';
    else if (hasAdmin || hasAnalyst) assignedPlanCode = 'PRO_PLAN';

    await prisma.tenantPlan.upsert({
      where: {
        tenantId_planId_effectiveFrom: {
          tenantId: tenant.id,
          planId: createdPlans[assignedPlanCode].id,
          effectiveFrom: new Date()
        }
      },
      update: {},
      create: {
        tenantId: tenant.id,
        planId: createdPlans[assignedPlanCode].id,
        effectiveFrom: new Date(),
        status: 'ACTIVE'
      }
    });
  }
  console.log('✅ Assigned plans to tenants\n');

  return { createdPlans, createdFeatures, createdTasks, createdModelClasses };
}

async function seedCountryData() {
  console.log('🌍 PHASE 3: Seeding Country Data');

  // Seed superset sections (canonical section keys used throughout drafting)
  // These keys must match:
  // - CountrySectionMapping.sectionKey
  // - AnnexureDraft legacy columns + extraSections keys
  // - src/lib/multi-jurisdiction-service.ts (SUPERSET_SECTIONS)
  const supersetSections = [
    { sectionKey: 'title', displayOrder: 1, label: 'Title of the Invention', isRequired: true, aliases: ['title_of_invention', 'titleofinvention'], requiresPriorArt: false, requiresFigures: false, requiresClaims: false, requiresComponents: false },
    { sectionKey: 'preamble', displayOrder: 2, label: 'Preamble', isRequired: false, aliases: ['opening_statement'], requiresPriorArt: false, requiresFigures: false, requiresClaims: false, requiresComponents: false },
    { sectionKey: 'crossReference', displayOrder: 3, label: 'Cross-Reference to Related Applications', isRequired: false, aliases: ['cross_reference', 'cross-reference', 'cross reference', 'crossReferences', 'cross_references'], requiresPriorArt: true, requiresFigures: false, requiresClaims: false, requiresComponents: false },
    { sectionKey: 'fieldOfInvention', displayOrder: 4, label: 'Field of the Invention', isRequired: true, aliases: ['field', 'technicalField', 'technical_field', 'field_of_invention', 'technicalfield', 'techfield'], requiresPriorArt: false, requiresFigures: false, requiresClaims: false, requiresComponents: false },
    { sectionKey: 'background', displayOrder: 5, label: 'Background of the Invention', isRequired: true, aliases: ['background_art', 'backgroundOfInvention', 'background_of_invention', 'priorArt', 'prior_art', 'backgroundart'], requiresPriorArt: true, requiresFigures: false, requiresClaims: false, requiresComponents: false },
    { sectionKey: 'objectsOfInvention', displayOrder: 6, label: 'Objects of the Invention', isRequired: false, aliases: ['objects', 'objects_of_invention', 'objectOfInvention', 'object_of_the_invention'], requiresPriorArt: true, requiresFigures: false, requiresClaims: false, requiresComponents: false },
    { sectionKey: 'summary', displayOrder: 7, label: 'Summary of the Invention', isRequired: true, aliases: ['summary_of_invention', 'summaryOfInvention', 'disclosureOfInvention', 'disclosure_of_invention', 'summaryoftheinvention'], requiresPriorArt: false, requiresFigures: false, requiresClaims: true, requiresComponents: true },
    { sectionKey: 'technicalProblem', displayOrder: 8, label: 'Technical Problem', isRequired: false, aliases: ['technical_problem', 'problem_to_be_solved', 'techproblem', 'problemtobesolved'], requiresPriorArt: true, requiresFigures: false, requiresClaims: false, requiresComponents: false },
    { sectionKey: 'technicalSolution', displayOrder: 9, label: 'Technical Solution', isRequired: false, aliases: ['technical_solution', 'solution_to_problem', 'techsolution', 'meansforsolving'], requiresPriorArt: false, requiresFigures: false, requiresClaims: true, requiresComponents: true },
    { sectionKey: 'advantageousEffects', displayOrder: 10, label: 'Advantageous Effects', isRequired: false, aliases: ['advantageous_effects', 'effects', 'beneficialeffects', 'beneficial_effects'], requiresPriorArt: false, requiresFigures: false, requiresClaims: false, requiresComponents: false },
    { sectionKey: 'briefDescriptionOfDrawings', displayOrder: 11, label: 'Brief Description of the Drawings', isRequired: true, aliases: ['brief_drawings', 'brief_description_of_drawings', 'drawings', 'figures', 'briefdescriptionofdrawings'], requiresPriorArt: false, requiresFigures: true, requiresClaims: false, requiresComponents: false },
    { sectionKey: 'detailedDescription', displayOrder: 12, label: 'Detailed Description of the Invention', isRequired: true, aliases: ['detailed_description', 'description', 'detailedDescriptionOfInvention', 'detaileddescription'], requiresPriorArt: false, requiresFigures: true, requiresClaims: true, requiresComponents: true },
    { sectionKey: 'bestMethod', displayOrder: 13, label: 'Best Mode', isRequired: false, aliases: ['bestMode', 'best_mode', 'best_method', 'bestmodeofcarryingout'], requiresPriorArt: false, requiresFigures: true, requiresClaims: false, requiresComponents: true },
    { sectionKey: 'industrialApplicability', displayOrder: 14, label: 'Industrial Applicability', isRequired: false, aliases: ['industrial_applicability', 'utility', 'industrialapplicability'], requiresPriorArt: false, requiresFigures: false, requiresClaims: false, requiresComponents: false },
    { sectionKey: 'claims', displayOrder: 15, label: 'Claims', isRequired: true, aliases: ['patentclaims', 'patent_claims'], requiresPriorArt: false, requiresFigures: false, requiresClaims: false, requiresComponents: true },
    { sectionKey: 'abstract', displayOrder: 16, label: 'Abstract', isRequired: true, aliases: ['abstract_of_invention', 'abstractofinvention'], requiresPriorArt: false, requiresFigures: true, requiresClaims: true, requiresComponents: false },
    { sectionKey: 'listOfNumerals', displayOrder: 17, label: 'List of Reference Numerals', isRequired: false, aliases: ['list_of_numerals', 'reference_numerals', 'reference_signs', 'numeral_list', 'numeralList'], requiresPriorArt: false, requiresFigures: false, requiresClaims: false, requiresComponents: true }
  ];

  for (const sec of supersetSections) {
    await prisma.supersetSection.upsert({
      where: { sectionKey: sec.sectionKey },
      update: {
        aliases: sec.aliases,
        displayOrder: sec.displayOrder,
        label: sec.label,
        description: null,
        instruction: `Seeded placeholder for ${sec.sectionKey}. Update this with actual prompt content via admin panel.`,
        constraints: [],
        isRequired: sec.isRequired,
        isActive: true,
        requiresPriorArt: sec.requiresPriorArt,
        requiresFigures: sec.requiresFigures,
        requiresClaims: sec.requiresClaims,
        requiresComponents: sec.requiresComponents
      },
      create: {
        sectionKey: sec.sectionKey,
        aliases: sec.aliases,
        displayOrder: sec.displayOrder,
        label: sec.label,
        description: null,
        instruction: `Seeded placeholder for ${sec.sectionKey}. Update this with actual prompt content via admin panel.`,
        constraints: [],
        isRequired: sec.isRequired,
        isActive: true,
        requiresPriorArt: sec.requiresPriorArt,
        requiresFigures: sec.requiresFigures,
        requiresClaims: sec.requiresClaims,
        requiresComponents: sec.requiresComponents
      }
    });
  }
  console.log(`ƒo. Seeded/updated ${supersetSections.length} superset sections`);

  // Seed country names
  const countryNamesPath = path.join(COUNTRIES_DIR, 'countryname.csv');
  if (fs.existsSync(countryNamesPath)) {
    const countryNames = [];
    fs.createReadStream(countryNamesPath)
      .pipe(csv())
      .on('data', (row) => {
        const [code, name] = Object.values(row);
        countryNames.push({ code, name, continent: 'Unknown' });
      })
      .on('end', async () => {
        for (const country of countryNames) {
          await prisma.countryName.upsert({
            where: { code: country.code },
            update: {},
            create: country
          });
        }
        console.log(`✅ Seeded ${countryNames.length} country names`);
      });
  }

  // Seed country section mappings from Finalmapping.csv
  const finalMappingPath = path.join(COUNTRIES_DIR, 'Finalmapping.csv');
  if (fs.existsSync(finalMappingPath)) {
    const mappings = [];
    const csvData = fs.readFileSync(finalMappingPath, 'utf-8');
    const lines = csvData.split('\n').filter(line => line.trim());

    if (lines.length > 0) {
      const headers = lines[0].split(',').map(h => h.trim());
      const countryCodes = headers.slice(1); // Skip first column (Superset Section)

      for (let i = 1; i < lines.length; i++) {
        const cells = lines[i].split(',').map(cell => cell.trim());
        const supersetCode = cells[0];

        for (let j = 1; j < cells.length; j++) {
          const countryCode = countryCodes[j - 1];
          let heading = cells[j];

          // Clean up quotes and handle special cases
          heading = heading.replace(/^"|"$/g, '').replace(/""/g, '"');

          if (heading && heading !== '(N/A)' && heading !== '(Implicit)' && heading !== '') {
            // Create section key from superset code
            const sectionKey = supersetCode.toLowerCase()
              .replace(/\./g, '_')
              .replace(/\s+/g, '_')
              .replace(/^(\d+)_/, '');

            mappings.push({
              countryCode,
              supersetCode,
              sectionKey,
              heading
            });
          }
        }
      }

      for (const mapping of mappings) {
        await prisma.countrySectionMapping.upsert({
          where: {
            countryCode_supersetCode: {
              countryCode: mapping.countryCode,
              supersetCode: mapping.supersetCode
            }
          },
          update: {},
          create: mapping
        });
      }
      console.log(`✅ Seeded ${mappings.length} country section mappings`);
    }
  }

  // Seed country profiles from JSON files
  const countryFiles = fs.readdirSync(COUNTRIES_DIR).filter(file => file.endsWith('.json'));
  let profileCount = 0;

  for (const file of countryFiles) {
    const countryCode = file.replace('.json', '');
    const filePath = path.join(COUNTRIES_DIR, file);

    try {
      const profileData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

      // Get the first analyst user to use as creator
      const analystUser = await prisma.user.findFirst({
        where: { roles: { has: 'ANALYST' } }
      });

      if (analystUser) {
        await prisma.countryProfile.upsert({
          where: { countryCode },
          update: {},
          create: {
            countryCode,
            name: profileData.country_name || countryCode,
            profileData,
            version: 1,
            status: 'ACTIVE',
            createdBy: analystUser.id,
            updatedBy: analystUser.id
          }
        });
        profileCount++;
      }
    } catch (error) {
      console.warn(`⚠️  Failed to seed country profile ${countryCode}:`, error.message);
    }
  }
  console.log(`✅ Seeded ${profileCount} country profiles\n`);
}

async function seedCountryDataV2() {
  console.log('PHASE 3 (v2): Seeding Country Data');

  const readCsvRows = async (filePath) => {
    const rows = [];
    await new Promise((resolve, reject) => {
      fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (row) => rows.push(row))
        .on('end', resolve)
        .on('error', reject);
    });
    return rows;
  };

  const supersetSections = [
    { sectionKey: 'title', displayOrder: 1, label: 'Title of the Invention', isRequired: true, aliases: ['title_of_invention', 'titleofinvention'], requiresPriorArt: false, requiresFigures: false, requiresClaims: false, requiresComponents: false },
    { sectionKey: 'preamble', displayOrder: 2, label: 'Preamble', isRequired: false, aliases: ['opening_statement'], requiresPriorArt: false, requiresFigures: false, requiresClaims: false, requiresComponents: false },
    { sectionKey: 'crossReference', displayOrder: 3, label: 'Cross-Reference to Related Applications', isRequired: false, aliases: ['cross_reference', 'cross-reference', 'cross reference', 'crossReferences', 'cross_references'], requiresPriorArt: true, requiresFigures: false, requiresClaims: false, requiresComponents: false },
    { sectionKey: 'fieldOfInvention', displayOrder: 4, label: 'Field of the Invention', isRequired: true, aliases: ['field', 'technicalField', 'technical_field', 'field_of_invention', 'technicalfield', 'techfield'], requiresPriorArt: false, requiresFigures: false, requiresClaims: false, requiresComponents: false },
    { sectionKey: 'background', displayOrder: 5, label: 'Background of the Invention', isRequired: true, aliases: ['background_art', 'backgroundOfInvention', 'background_of_invention', 'priorArt', 'prior_art', 'backgroundart'], requiresPriorArt: true, requiresFigures: false, requiresClaims: false, requiresComponents: false },
    { sectionKey: 'objectsOfInvention', displayOrder: 6, label: 'Objects of the Invention', isRequired: false, aliases: ['objects', 'objects_of_invention', 'objectOfInvention', 'object_of_the_invention'], requiresPriorArt: true, requiresFigures: false, requiresClaims: false, requiresComponents: false },
    { sectionKey: 'summary', displayOrder: 7, label: 'Summary of the Invention', isRequired: true, aliases: ['summary_of_invention', 'summaryOfInvention', 'disclosureOfInvention', 'disclosure_of_invention', 'summaryoftheinvention'], requiresPriorArt: false, requiresFigures: false, requiresClaims: true, requiresComponents: true },
    { sectionKey: 'technicalProblem', displayOrder: 8, label: 'Technical Problem', isRequired: false, aliases: ['technical_problem', 'problem_to_be_solved', 'techproblem', 'problemtobesolved'], requiresPriorArt: true, requiresFigures: false, requiresClaims: false, requiresComponents: false },
    { sectionKey: 'technicalSolution', displayOrder: 9, label: 'Technical Solution', isRequired: false, aliases: ['technical_solution', 'solution_to_problem', 'techsolution', 'meansforsolving'], requiresPriorArt: false, requiresFigures: false, requiresClaims: true, requiresComponents: true },
    { sectionKey: 'advantageousEffects', displayOrder: 10, label: 'Advantageous Effects', isRequired: false, aliases: ['advantageous_effects', 'effects', 'beneficialeffects', 'beneficial_effects'], requiresPriorArt: false, requiresFigures: false, requiresClaims: false, requiresComponents: false },
    { sectionKey: 'briefDescriptionOfDrawings', displayOrder: 11, label: 'Brief Description of the Drawings', isRequired: true, aliases: ['brief_drawings', 'brief_description_of_drawings', 'drawings', 'figures', 'briefdescriptionofdrawings'], requiresPriorArt: false, requiresFigures: true, requiresClaims: false, requiresComponents: false },
    { sectionKey: 'detailedDescription', displayOrder: 12, label: 'Detailed Description of the Invention', isRequired: true, aliases: ['detailed_description', 'description', 'detailedDescriptionOfInvention', 'detaileddescription'], requiresPriorArt: false, requiresFigures: true, requiresClaims: true, requiresComponents: true },
    { sectionKey: 'bestMethod', displayOrder: 13, label: 'Best Mode', isRequired: false, aliases: ['bestMode', 'best_mode', 'best_method', 'bestmodeofcarryingout'], requiresPriorArt: false, requiresFigures: true, requiresClaims: false, requiresComponents: true },
    { sectionKey: 'industrialApplicability', displayOrder: 14, label: 'Industrial Applicability', isRequired: false, aliases: ['industrial_applicability', 'utility', 'industrialapplicability'], requiresPriorArt: false, requiresFigures: false, requiresClaims: false, requiresComponents: false },
    { sectionKey: 'claims', displayOrder: 15, label: 'Claims', isRequired: true, aliases: ['patentclaims', 'patent_claims'], requiresPriorArt: false, requiresFigures: false, requiresClaims: false, requiresComponents: true },
    { sectionKey: 'abstract', displayOrder: 16, label: 'Abstract', isRequired: true, aliases: ['abstract_of_invention', 'abstractofinvention'], requiresPriorArt: false, requiresFigures: true, requiresClaims: true, requiresComponents: false },
    { sectionKey: 'listOfNumerals', displayOrder: 17, label: 'List of Reference Numerals', isRequired: false, aliases: ['list_of_numerals', 'reference_numerals', 'reference_signs', 'numeral_list', 'numeralList'], requiresPriorArt: false, requiresFigures: false, requiresClaims: false, requiresComponents: true }
  ];

  for (const sec of supersetSections) {
    await prisma.supersetSection.upsert({
      where: { sectionKey: sec.sectionKey },
      update: {
        aliases: sec.aliases,
        displayOrder: sec.displayOrder,
        label: sec.label,
        description: null,
        instruction: `Seeded placeholder for ${sec.sectionKey}. Update this with actual prompt content via admin panel.`,
        constraints: [],
        isRequired: sec.isRequired,
        isActive: true,
        requiresPriorArt: sec.requiresPriorArt,
        requiresFigures: sec.requiresFigures,
        requiresClaims: sec.requiresClaims,
        requiresComponents: sec.requiresComponents
      },
      create: {
        sectionKey: sec.sectionKey,
        aliases: sec.aliases,
        displayOrder: sec.displayOrder,
        label: sec.label,
        description: null,
        instruction: `Seeded placeholder for ${sec.sectionKey}. Update this with actual prompt content via admin panel.`,
        constraints: [],
        isRequired: sec.isRequired,
        isActive: true,
        requiresPriorArt: sec.requiresPriorArt,
        requiresFigures: sec.requiresFigures,
        requiresClaims: sec.requiresClaims,
        requiresComponents: sec.requiresComponents
      }
    });
  }

  const countryNamesPath = path.join(COUNTRIES_DIR, 'countryname.csv');
  if (fs.existsSync(countryNamesPath)) {
    const rows = await readCsvRows(countryNamesPath);
    for (const row of rows) {
      const [code, name] = Object.values(row);
      if (!code || !name) continue;
      await prisma.countryName.upsert({
        where: { code },
        update: { name, continent: 'Unknown' },
        create: { code, name, continent: 'Unknown' }
      });
    }
  }

  const finalMappingPath = path.join(COUNTRIES_DIR, 'Finalmapping.csv');
  if (fs.existsSync(finalMappingPath)) {
    const supersetOrderByKey = new Map(supersetSections.map(s => [s.sectionKey, s.displayOrder]));
    const supersetRequiredByKey = new Map(supersetSections.map(s => [s.sectionKey, s.isRequired]));
    const supersetCodeToSectionKey = {
      '01. Title': 'title',
      '02. Preamble': 'preamble',
      '03. Cross-Ref/Fed': 'crossReference',
      '04. Tech Field': 'fieldOfInvention',
      '05. Background': 'background',
      '06. Objects': 'objectsOfInvention',
      '07. Summary (Gen)': 'summary',
      '07a. Tech Problem': 'technicalProblem',
      '07b. Tech Solution': 'technicalSolution',
      '07c. Effects': 'advantageousEffects',
      '08. Drawings': 'briefDescriptionOfDrawings',
      '09. Detailed Desc': 'detailedDescription',
      '10. Best Mode': 'bestMethod',
      '11. Ind. Applicability': 'industrialApplicability',
      '12. Claims': 'claims',
      '13. Abstract': 'abstract'
    };

    const rows = await readCsvRows(finalMappingPath);
    let mappingsCount = 0;

    for (const row of rows) {
      const supersetCode = String(row['Superset Section'] || '').trim();
      const sectionKey = supersetCodeToSectionKey[supersetCode];
      if (!sectionKey) continue;

      const displayOrder = supersetOrderByKey.get(sectionKey) || null;
      const isRequired = supersetRequiredByKey.get(sectionKey);

      for (const [countryCode, rawHeading] of Object.entries(row)) {
        if (countryCode === 'Superset Section') continue;
        let heading = typeof rawHeading === 'string' ? rawHeading.trim() : '';
        if (!heading) continue;
        heading = heading.replace(/^\"|\"$/g, '').replace(/\"\"/g, '\"').trim();

        await prisma.countrySectionMapping.upsert({
          where: {
            countryCode_supersetCode: {
              countryCode,
              supersetCode
            }
          },
          update: {
            sectionKey,
            heading,
            isEnabled: true,
            isRequired: typeof isRequired === 'boolean' ? isRequired : true,
            displayOrder
          },
          create: {
            countryCode,
            supersetCode,
            sectionKey,
            heading,
            isEnabled: true,
            isRequired: typeof isRequired === 'boolean' ? isRequired : true,
            displayOrder
          }
        });
        mappingsCount++;
      }
    }

    console.log(`Seeded/updated ${mappingsCount} country section mappings (v2)`);
  }

  const countryFiles = fs.readdirSync(COUNTRIES_DIR).filter(file => file.endsWith('.json'));
  const analystUser = await prisma.user.findFirst({ where: { roles: { has: 'ANALYST' } } });
  let profileCount = 0;

  for (const file of countryFiles) {
    const countryCode = file.replace('.json', '');
    const filePath = path.join(COUNTRIES_DIR, file);
    try {
      const profileData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (!analystUser) continue;
      await prisma.countryProfile.upsert({
        where: { countryCode },
        update: {
          name: profileData.country_name || countryCode,
          profileData,
          status: 'ACTIVE',
          updatedBy: analystUser.id
        },
        create: {
          countryCode,
          name: profileData.country_name || countryCode,
          profileData,
          version: 1,
          status: 'ACTIVE',
          createdBy: analystUser.id,
          updatedBy: analystUser.id
        }
      });
      profileCount++;
    } catch (error) {
      console.warn(`Failed to seed country profile ${countryCode}:`, error.message);
    }
  }

  console.log(`Seeded/updated ${profileCount} country profiles (v2)`);
}

async function seedSampleData() {
  console.log('🎯 PHASE 4: Creating Sample Data');

  // Create sample projects
  const analystUser = await prisma.user.findFirst({
    where: { roles: { has: 'ANALYST' } }
  });

  if (analystUser) {
    // Create sample project
    const sampleProject = await prisma.project.upsert({
      where: {
        userId_name: {
          userId: analystUser.id,
          name: 'Sample Innovation Project'
        }
      },
      update: {},
      create: {
        name: 'Sample Innovation Project',
        userId: analystUser.id
      }
    });

    // Create sample patent
    const samplePatent = await prisma.patent.upsert({
      where: {
        projectId_title: {
          projectId: sampleProject.id,
          title: 'AI-Powered Medical Diagnosis System'
        }
      },
      update: {},
      create: {
        projectId: sampleProject.id,
        title: 'AI-Powered Medical Diagnosis System',
        createdBy: analystUser.id
      }
    });

    console.log('✅ Created sample project and patent');

    // Create sample idea bank ideas
    const sampleIdeas = [
      {
        title: 'AI-Powered Medical Diagnosis System',
        description: 'A machine learning system that analyzes medical images and patient data to provide early disease detection with 95% accuracy.',
        domainTags: ['AI/ML', 'Medical Devices'],
        status: 'PUBLIC',
        createdBy: analystUser.id
      },
      {
        title: 'Smart Grid Energy Optimization',
        description: 'An intelligent energy management system for power grids using predictive analytics.',
        domainTags: ['Energy', 'IoT'],
        status: 'PUBLIC',
        createdBy: analystUser.id
      },
      {
        title: 'Blockchain Supply Chain Tracking',
        description: 'A decentralized platform for transparent supply chain management.',
        domainTags: ['Blockchain', 'Supply Chain'],
        status: 'PUBLIC',
        createdBy: analystUser.id
      }
    ];

    for (const idea of sampleIdeas) {
      await prisma.ideaBankIdea.upsert({
        where: {
          title_createdBy: {
            title: idea.title,
            createdBy: idea.createdBy
          }
        },
        update: {},
        create: idea
      });
    }
    console.log('✅ Created sample idea bank ideas');
  } else {
    console.log('⚠️  No analyst user found, skipping sample data creation');
  }
  console.log();
}

async function runComprehensiveSeed(options = {}) {
  const { exportOnly = false, skipExport = false } = options;

  try {
    console.log('🚀 Starting Comprehensive Database Seed\n');
    console.log('=' .repeat(60) + '\n');

    // Export existing data
    if (!skipExport) {
      await exportAllData();
      if (exportOnly) {
        console.log('✅ Export-only mode completed. Exiting.');
        return;
      }
    }

    // Seed user hierarchy
    await seedUserHierarchy();

    // Seed plans and features
    await seedPlansAndFeatures();

    // Seed country data
    await seedCountryDataV2();

    // Seed sample data
    await seedSampleData();

    // Final statistics
    const finalStats = {
      tenants: await prisma.tenant.count(),
      users: await prisma.user.count(),
      plans: await prisma.plan.count(),
      features: await prisma.feature.count(),
      tasks: await prisma.task.count(),
      countryProfiles: await prisma.countryProfile.count(),
      countrySectionMappings: await prisma.countrySectionMapping.count(),
      ideaBankIdeas: await prisma.ideaBankIdea.count()
    };

    console.log('🎉 COMPREHENSIVE SEEDING COMPLETED!');
    console.log('=' .repeat(60));
    console.log('\n📊 Final Statistics:');
    Object.entries(finalStats).forEach(([key, value]) => {
      console.log(`  ${key}: ${value}`);
    });

    console.log('\n👑 SUPER ADMIN:');
    console.log('   Login: superadmin@spotipr.com / SuperSecure123!');

    console.log('\n🏢 TENANT ADMIN:');
    console.log('   Login: tenantadmin@spotipr.com / TenantAdmin123!');

    console.log('\n👤 ANALYST:');
    console.log('   Login: analyst@spotipr.com / AnalystPass123!');

    console.log('\n🚀 NEXT STEPS:');
    console.log('1. Start server: npm run dev');
    console.log('2. Login as analyst and test features');
    console.log('3. Access admin panel as super admin');
    console.log('\n💡 All data has been backed up to database-backup/ folder\n');

  } catch (error) {
    console.error('❌ Error during comprehensive seeding:', error);
    console.error('Stack:', error.stack);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// CLI handling
if (require.main === module) {
  const args = process.argv.slice(2);
  const options = {
    exportOnly: args.includes('--export-only'),
    skipExport: args.includes('--skip-export')
  };

  runComprehensiveSeed(options);
}

module.exports = { runComprehensiveSeed, exportAllData };
