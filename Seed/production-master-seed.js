#!/usr/bin/env node

/**
 * ============================================================================
 * PRODUCTION MASTER SEED SCRIPT
 * ============================================================================
 * 
 * Orchestrates all production seed scripts in the correct order.
 * Safe to run multiple times (all sub-scripts are idempotent).
 * 
 * Usage:
 *   node Seed/production-master-seed.js [options]
 * 
 * Options:
 *   --skip-plans       Skip plans/features seeding
 *   --skip-countries   Skip country configurations
 *   --skip-llm         Skip LLM models and workflow stages
 *   --skip-users       Skip admin user creation
 *   --users-only       Only run user creation (for adding admins later)
 *   --help             Show this help message
 * 
 * Examples:
 *   node Seed/production-master-seed.js                    # Run all seeds
 *   node Seed/production-master-seed.js --skip-users       # Skip user creation
 *   node Seed/production-master-seed.js --users-only       # Only create users
 */

const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');

// ============================================================================
// PRODUCTION COUNTRY DATA (All 30 jurisdictions)
// ============================================================================
const PRODUCTION_COUNTRIES = [
  { code: 'AU', name: 'Australia', continent: 'Oceania' },
  { code: 'BD', name: 'Bangladesh', continent: 'Asia' },
  { code: 'BR', name: 'Brazil', continent: 'South America' },
  { code: 'CA', name: 'Canada', continent: 'North America' },
  { code: 'CH', name: 'Switzerland', continent: 'Europe' },
  { code: 'CN', name: 'China', continent: 'Asia' },
  { code: 'DE', name: 'Germany', continent: 'Europe' },
  { code: 'EP', name: 'European Patent Office', continent: 'Europe' },
  { code: 'ES', name: 'Spain', continent: 'Europe' },
  { code: 'EU', name: 'European Union', continent: 'Europe' },
  { code: 'FR', name: 'France', continent: 'Europe' },
  { code: 'IL', name: 'Israel', continent: 'Asia' },
  { code: 'IN', name: 'India', continent: 'Asia' },
  { code: 'IR', name: 'Iran', continent: 'Asia' },
  { code: 'JP', name: 'Japan', continent: 'Asia' },
  { code: 'KR', name: 'South Korea', continent: 'Asia' },
  { code: 'MX', name: 'Mexico', continent: 'North America' },
  { code: 'MY', name: 'Malaysia', continent: 'Asia' },
  { code: 'NZ', name: 'New Zealand', continent: 'Oceania' },
  { code: 'PCT', name: 'PCT International', continent: 'International' },
  { code: 'PK', name: 'Pakistan', continent: 'Asia' },
  { code: 'PL', name: 'Poland', continent: 'Europe' },
  { code: 'RU', name: 'Russia', continent: 'Europe' },
  { code: 'SA', name: 'Saudi Arabia', continent: 'Asia' },
  { code: 'SE', name: 'Sweden', continent: 'Europe' },
  { code: 'TW', name: 'Taiwan', continent: 'Asia' },
  { code: 'UAE', name: 'United Arab Emirates', continent: 'Asia' },
  { code: 'UK', name: 'United Kingdom', continent: 'Europe' },
  { code: 'US', name: 'United States of America', continent: 'North America' },
  { code: 'ZA', name: 'South Africa', continent: 'Africa' }
];

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  skipPlans: args.includes('--skip-plans'),
  skipCountries: args.includes('--skip-countries'),
  skipLlm: args.includes('--skip-llm'),
  skipUsers: args.includes('--skip-users'),
  usersOnly: args.includes('--users-only'),
  help: args.includes('--help') || args.includes('-h'),
};

// Show help
if (options.help) {
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║           PRODUCTION MASTER SEED SCRIPT                          ║
╚══════════════════════════════════════════════════════════════════╝

Usage: node Seed/production-master-seed.js [options]

Options:
  --skip-plans       Skip plans/features seeding
  --skip-countries   Skip country configurations  
  --skip-llm         Skip LLM models and workflow stages
  --skip-users       Skip admin user creation
  --users-only       Only run user creation (for adding admins later)
  --help, -h         Show this help message

Seed Order:
  1. Plans & Features      (scripts/seed-production-plans.js)
  2. Production Countries  (Direct: All 30 jurisdictions)
  3. Country Config        (Countries/MasterSeed.js)
  4. LLM Models            (Seed/seed-llm-models.js)
  5. Admin Users           (scripts/setup-full-hierarchy.js)

All scripts are idempotent - safe to run multiple times.
`);
  process.exit(0);
}

// Project root directory
const ROOT_DIR = path.resolve(__dirname, '..');

// Seed scripts configuration
const SEED_SCRIPTS = [
  {
    name: 'Plans & Features',
    script: 'scripts/seed-production-plans.js',
    skip: options.skipPlans || options.usersOnly,
    description: 'Seeds Features, Tasks, LLMModelClass, Plans (BASIC, PRO, ENTERPRISE)',
  },
  {
    name: 'Production Country Names',
    script: null, // Direct function call
    directFn: seedProductionCountries,
    skip: options.skipCountries || options.usersOnly,
    description: 'Seeds all 30 jurisdictions to country_names table',
  },
  {
    name: 'Country Configurations',
    script: 'Countries/MasterSeed.js',
    skip: options.skipCountries || options.usersOnly,
    description: 'Seeds superset sections, country names, mappings, prompts, profiles',
  },
  {
    name: 'LLM Models & Workflow Stages',
    script: 'Seed/seed-llm-models.js',
    skip: options.skipLlm || options.usersOnly,
    description: 'Seeds LLM models (28), workflow stages (38), PRODUCTION token limits',
  },
  {
    name: 'Admin Users & Tenants',
    script: 'scripts/setup-full-hierarchy.js',
    skip: options.skipUsers && !options.usersOnly,
    description: 'Creates super admin, sample tenants, ATI tokens',
  },
];

// ============================================================================
// SEED PRODUCTION COUNTRY NAMES (Direct DB insert - failsafe)
// ============================================================================
async function seedProductionCountries() {
  const prisma = new PrismaClient();
  
  try {
    console.log('   ⏳ Ensuring production countries exist...');
    let created = 0, existing = 0;
    
    for (const country of PRODUCTION_COUNTRIES) {
      const exists = await prisma.countryName.findUnique({
        where: { code: country.code }
      });
      
      if (exists) {
        existing++;
      } else {
        await prisma.countryName.create({ data: country });
        console.log(`      ✅ Created: ${country.code} - ${country.name}`);
        created++;
      }
    }
    
    console.log(`   📊 Countries: ${created} created, ${existing} already exist`);
    return true;
  } catch (error) {
    console.error(`   ❌ Error seeding countries: ${error.message}`);
    return false;
  } finally {
    await prisma.$disconnect();
  }
}

// Run a script and return success/failure
function runScript(scriptPath, name) {
  const fullPath = path.join(ROOT_DIR, scriptPath);
  
  if (!fs.existsSync(fullPath)) {
    console.error(`   ❌ Script not found: ${scriptPath}`);
    return false;
  }
  
  try {
    console.log(`   ⏳ Running...`);
    execSync(`node "${fullPath}"`, {
      cwd: ROOT_DIR,
      stdio: 'inherit',
      env: { ...process.env, FORCE_COLOR: '1' }
    });
    return true;
  } catch (error) {
    console.error(`   ❌ Failed with exit code: ${error.status}`);
    return false;
  }
}

// Main execution
async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║           🌱 PRODUCTION MASTER SEED                              ║
║           Running all production seed scripts                     ║
╚══════════════════════════════════════════════════════════════════╝
`);

  console.log('📋 Configuration:');
  console.log(`   Skip Plans:     ${options.skipPlans}`);
  console.log(`   Skip Countries: ${options.skipCountries}`);
  console.log(`   Skip LLM:       ${options.skipLlm}`);
  console.log(`   Skip Users:     ${options.skipUsers}`);
  console.log(`   Users Only:     ${options.usersOnly}`);
  console.log('');

  const results = [];
  let stepNumber = 0;

  for (const seed of SEED_SCRIPTS) {
    stepNumber++;
    
    console.log(`\n${'═'.repeat(66)}`);
    console.log(`📦 STEP ${stepNumber}: ${seed.name}`);
    console.log(`${'═'.repeat(66)}`);
    console.log(`   📄 Script: ${seed.script}`);
    console.log(`   📝 ${seed.description}`);
    
    if (seed.skip) {
      console.log(`   ⏭️  SKIPPED (by flag)`);
      results.push({ name: seed.name, status: 'skipped' });
      continue;
    }
    
    let success;
    if (seed.directFn) {
      // Direct function call (async)
      success = await seed.directFn();
    } else {
      // Script execution
      success = runScript(seed.script, seed.name);
    }
    
    results.push({ 
      name: seed.name, 
      status: success ? 'success' : 'failed',
      script: seed.script 
    });
    
    if (!success) {
      console.log(`\n⚠️  Script failed. Continue anyway? (y/n)`);
      // In non-interactive mode, continue but mark as failed
    }
  }

  // Summary
  console.log(`\n${'═'.repeat(66)}`);
  console.log('🏁 SEED SUMMARY');
  console.log(`${'═'.repeat(66)}`);
  
  const succeeded = results.filter(r => r.status === 'success').length;
  const failed = results.filter(r => r.status === 'failed').length;
  const skipped = results.filter(r => r.status === 'skipped').length;
  
  for (const result of results) {
    const icon = result.status === 'success' ? '✅' : 
                 result.status === 'skipped' ? '⏭️' : '❌';
    console.log(`   ${icon} ${result.name}: ${result.status.toUpperCase()}`);
  }
  
  console.log(`\n   Total: ${succeeded} succeeded, ${failed} failed, ${skipped} skipped`);
  
  if (failed > 0) {
    console.log(`\n⚠️  Some scripts failed. Check the output above for details.`);
    process.exit(1);
  }
  
  console.log(`\n✅ Production seeding completed successfully!`);
  console.log(`\n💡 Next steps:`);
  console.log(`   1. Verify data: npm run dev`);
  console.log(`   2. Login as superadmin (check .env for credentials)`);
  console.log(`   3. Visit /super-admin to verify configuration`);
}

main().catch(error => {
  console.error('❌ Master seed failed:', error);
  process.exit(1);
});












