#!/usr/bin/env node

/**
 * Database Seed Data Export Script
 *
 * This script exports all current data from the database to create a seed file
 * for populating the database after schema changes or resets.
 */

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function exportTableData(tableName, modelName) {
  try {
    console.log(`Exporting ${tableName}...`);

    // Define appropriate orderBy for each table
    const orderByMap = {
      tenant: { createdAt: 'asc' },
      user: { createdAt: 'asc' },
      aTIToken: { createdAt: 'asc' },
      auditLog: { createdAt: 'asc' },
      project: { createdAt: 'asc' },
      applicantProfile: { createdAt: 'asc' },
      projectCollaborator: { createdAt: 'asc' },
      patent: { createdAt: 'asc' },
      annexureVersion: { createdAt: 'asc' },
      job: { createdAt: 'asc' },
      plan: { createdAt: 'asc' },
      tenantPlan: { effectiveFrom: 'asc' },
      feature: { id: 'asc' },
      planFeature: { planId: 'asc' },
      task: { id: 'asc' },
      lLMModelClass: { id: 'asc' },
      planLLMAccess: { planId: 'asc' },
      policyRule: { id: 'asc' },
      usageReservation: { createdAt: 'asc' },
      usageMeter: { lastUpdated: 'asc' },
      usageLog: { startedAt: 'asc' },
      quotaAlert: { notifiedAt: 'asc' },
      priorArtSearchBundle: { createdAt: 'asc' },
      priorArtSearchHistory: { timestamp: 'asc' },
      priorArtQueryVariant: { createdAt: 'asc' },
      priorArtRun: { createdAt: 'asc' },
      priorArtQueryVariantExecution: { executedAt: 'asc' },
      priorArtRawResult: { receivedAt: 'asc' },
      priorArtRawDetail: { fetchedAt: 'asc' },
      priorArtPatent: { firstSeenAt: 'asc' },
      priorArtVariantHit: { foundAt: 'asc' },
      priorArtPatentDetail: { fetchedAt: 'asc' },
      priorArtUnifiedResult: { createdAt: 'asc' },
      priorArtScholarContent: { fetchedAt: 'asc' },
      localPatent: { createdAt: 'asc' },
      noveltyAssessmentRun: { createdAt: 'asc' },
      noveltyAssessmentLLMCall: { calledAt: 'asc' },
      userCredit: { userId: 'asc' },
      tokenNotification: { sentAt: 'asc' }
    };

    const orderBy = orderByMap[modelName] || { id: 'asc' };

    const data = await prisma[modelName].findMany({
      orderBy,
      include: getIncludesForModel(modelName)
    });
    console.log(`Found ${data.length} records in ${tableName}`);
    return data;
  } catch (error) {
    console.error(`Error exporting ${tableName}:`, error.message);
    return [];
  }
}

function getIncludesForModel(modelName) {
  const includes = {
    Tenant: {
      users: true,
      atiTokens: true,
      tenantPlans: {
        include: {
          plan: true
        }
      }
    },
    User: {
      tenant: true,
      projects: {
        include: {
          applicantProfile: true
        }
      },
      annexureVersions: true,
      auditLogs: true,
      priorArtBundles: {
        include: {
          creator: true,
          approver: true,
          history: true,
          queryVariants: true,
          runs: {
            include: {
              user: true,
              bundle: true,
              queryVariants: true,
              rawResults: true,
              variantHits: true,
              unifiedResults: true
            }
          }
        }
      },
      priorArtHistory: true,
      priorArtRuns: true,
      credits: true,
      noveltyAssessments: {
        include: {
          patent: true,
          user: true,
          llmCalls: true
        }
      }
    },
    Project: {
      user: true,
      applicantProfile: true,
      collaborators: {
        include: {
          user: true
        }
      },
      patents: {
        include: {
          creator: true,
          annexureVersions: true,
          jobs: true,
          priorArtBundles: true,
          noveltyAssessments: true
        }
      }
    },
    Patent: {
      project: true,
      creator: true,
      annexureVersions: true,
      jobs: true,
      priorArtBundles: true,
      noveltyAssessments: true
    },
    ATIToken: {
      tenant: true,
      signupUsers: true
    },
    TenantPlan: {
      tenant: true,
      plan: {
        include: {
          tenantPlans: true,
          planFeatures: {
            include: {
              feature: true
            }
          },
          planLLMAccess: {
            include: {
              task: true,
              defaultClass: true
            }
          },
          policyRules: true
        }
      }
    },
    Plan: {
      tenantPlans: true,
      planFeatures: {
        include: {
          feature: true
        }
      },
      planLLMAccess: {
        include: {
          task: true,
          defaultClass: true
        }
      },
      policyRules: true
    },
    PriorArtSearchBundle: {
      patent: true,
      creator: true,
      approver: true,
      history: true,
      queryVariants: true,
      runs: {
        include: {
          user: true,
          queryVariants: true,
          rawResults: true,
          variantHits: true,
          unifiedResults: true,
          level0Results: true
        }
      }
    },
    NoveltyAssessmentRun: {
      patent: true,
      user: true,
      llmCalls: true
    }
  };

  return includes[modelName] || {};
}

async function createSeedScript() {
  console.log('Starting database seed data export...\n');

  try {
    // Export all data from each table
    const seedData = {
      exportedAt: new Date().toISOString(),
      version: '1.0',
      tables: {}
    };

    // Core system tables
    seedData.tables.tenants = await exportTableData('tenants', 'tenant');
    seedData.tables.users = await exportTableData('users', 'user');
    seedData.tables.atiTokens = await exportTableData('ati_tokens', 'aTIToken');
    seedData.tables.auditLogs = await exportTableData('audit_logs', 'auditLog');

    // Project and patent data
    seedData.tables.projects = await exportTableData('projects', 'project');
    seedData.tables.applicantProfiles = await exportTableData('applicant_profiles', 'applicantProfile');
    seedData.tables.projectCollaborators = await exportTableData('project_collaborators', 'projectCollaborator');
    seedData.tables.patents = await exportTableData('patents', 'patent');
    seedData.tables.annexureVersions = await exportTableData('annexure_versions', 'annexureVersion');
    seedData.tables.jobs = await exportTableData('jobs', 'job');

    // Metering system
    seedData.tables.plans = await exportTableData('plans', 'plan');
    seedData.tables.tenantPlans = await exportTableData('tenant_plans', 'tenantPlan');
    seedData.tables.features = await exportTableData('features', 'feature');
    seedData.tables.planFeatures = await exportTableData('plan_features', 'planFeature');
    seedData.tables.tasks = await exportTableData('tasks', 'task');
    seedData.tables.llmModelClasses = await exportTableData('llm_model_classes', 'lLMModelClass');
    seedData.tables.planLLMAccess = await exportTableData('plan_llm_access', 'planLLMAccess');
    seedData.tables.policyRules = await exportTableData('policy_rules', 'policyRule');
    seedData.tables.usageReservations = await exportTableData('usage_reservations', 'usageReservation');
    seedData.tables.usageMeters = await exportTableData('usage_meters', 'usageMeter');
    seedData.tables.usageLogs = await exportTableData('usage_logs', 'usageLog');
    seedData.tables.quotaAlerts = await exportTableData('quota_alerts', 'quotaAlert');

    // Prior art search data
    seedData.tables.priorArtSearchBundles = await exportTableData('prior_art_search_bundles', 'priorArtSearchBundle');
    seedData.tables.priorArtSearchHistory = await exportTableData('prior_art_search_history', 'priorArtSearchHistory');
    seedData.tables.priorArtQueryVariants = await exportTableData('prior_art_query_variants', 'priorArtQueryVariant');
    seedData.tables.priorArtRuns = await exportTableData('prior_art_runs', 'priorArtRun');
    seedData.tables.priorArtQueryVariantExecutions = await exportTableData('prior_art_query_variant_executions', 'priorArtQueryVariantExecution');
    seedData.tables.priorArtRawResults = await exportTableData('prior_art_raw_results', 'priorArtRawResult');
    seedData.tables.priorArtRawDetails = await exportTableData('prior_art_raw_details', 'priorArtRawDetail');
    seedData.tables.priorArtPatents = await exportTableData('prior_art_patents', 'priorArtPatent');
    seedData.tables.priorArtVariantHits = await exportTableData('prior_art_variant_hits', 'priorArtVariantHit');
    seedData.tables.priorArtPatentDetails = await exportTableData('prior_art_patent_details', 'priorArtPatentDetail');
    seedData.tables.priorArtUnifiedResults = await exportTableData('prior_art_unified_results', 'priorArtUnifiedResult');
    seedData.tables.priorArtScholarContent = await exportTableData('prior_art_scholar_content', 'priorArtScholarContent');

    // Local patent dataset
    seedData.tables.localPatents = await exportTableData('local_patents', 'localPatent');

    // Novelty assessment
    seedData.tables.noveltyAssessmentRuns = await exportTableData('novelty_assessment_runs', 'noveltyAssessmentRun');
    seedData.tables.noveltyAssessmentLLMCalls = await exportTableData('novelty_assessment_llm_calls', 'noveltyAssessmentLLMCall');

    // User credits
    seedData.tables.userCredits = await exportTableData('user_credits', 'userCredit');

    // Token notifications
    seedData.tables.tokenNotifications = await exportTableData('token_notifications', 'tokenNotification');

    // Write seed data to file
    const seedFilePath = path.join(__dirname, '..', 'prisma', 'seed-data.json');
    fs.writeFileSync(seedFilePath, JSON.stringify(seedData, null, 2));

    console.log(`\n✅ Seed data exported successfully to: ${seedFilePath}`);

    // Generate summary
    const summary = Object.entries(seedData.tables).map(([table, data]) => ({
      table,
      count: Array.isArray(data) ? data.length : 0
    })).filter(item => item.count > 0);

    console.log('\n📊 Export Summary:');
    summary.forEach(({ table, count }) => {
      console.log(`  ${table}: ${count} records`);
    });

    const totalRecords = summary.reduce((sum, { count }) => sum + count, 0);
    console.log(`\n🎯 Total records exported: ${totalRecords}`);

  } catch (error) {
    console.error('❌ Error during seed data export:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the export
createSeedScript().catch(console.error);
