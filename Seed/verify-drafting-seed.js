#!/usr/bin/env node
/**
 * ============================================================================
 * DRAFTING PIPELINE SEED VERIFICATION SCRIPT
 * ============================================================================
 * 
 * Validates that the database is properly seeded for the drafting pipeline.
 * Run this AFTER MasterSeed.js to ensure all required data is in place.
 * 
 * Usage:
 *   node Seed/verify-drafting-seed.js
 * 
 * This script checks:
 *   1. SupersetSection table has all 17 required sections
 *   2. All sections have required aliases for key resolution
 *   3. CountrySectionMapping exists for key jurisdictions
 *   4. Legacy column keys match SupersetSection canonical keys
 *   5. Display ordering is correct
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Expected canonical section keys (must match ANNEXURE_LEGACY_COLUMNS for legacy columns)
const EXPECTED_SUPERSET_KEYS = [
  'title',
  'preamble',
  'fieldOfInvention',
  'background',
  'objectsOfInvention',
  'summary',
  'technicalProblem',
  'technicalSolution',
  'advantageousEffects',
  'briefDescriptionOfDrawings',
  'detailedDescription',
  'bestMethod',  // Must be 'bestMethod' to match DB column
  'industrialApplicability',
  'claims',
  'abstract',
  'listOfNumerals',
  'crossReference'
];

// Legacy columns in AnnexureDraft table (must match SupersetSection canonical keys)
const ANNEXURE_LEGACY_COLUMNS = [
  'title',
  'fieldOfInvention',
  'background',
  'summary',
  'briefDescriptionOfDrawings',
  'detailedDescription',
  'bestMethod',
  'claims',
  'abstract',
  'industrialApplicability',
  'listOfNumerals'
];

// Key jurisdictions that must have mappings
const KEY_JURISDICTIONS = ['IN', 'US', 'EP', 'PCT', 'CA', 'AU', 'JP'];

// Minimum sections per jurisdiction
const MIN_SECTIONS_PER_JURISDICTION = 7;

// Critical aliases that must be defined for backward compatibility
const CRITICAL_ALIASES = {
  'fieldOfInvention': ['field', 'technical_field', 'technicalField'],
  'background': ['backgroundOfInvention', 'priorArt'],
  'detailedDescription': ['detailed_description', 'description'],
  'bestMethod': ['best_mode', 'bestMode', 'best_method'],
  'objectsOfInvention': ['objects'],
  'summary': ['summaryOfInvention']
};

let errors = [];
let warnings = [];

async function verifySuperset() {
  console.log('\n📦 Checking SupersetSection table...');
  
  const sections = await prisma.supersetSection.findMany({
    where: { isActive: true },
    orderBy: { displayOrder: 'asc' }
  });
  
  if (sections.length === 0) {
    errors.push('❌ SupersetSection table is EMPTY! Run MasterSeed.js first.');
    return false;
  }
  
  console.log(`   Found ${sections.length} active sections`);
  
  // Check all expected keys exist
  const foundKeys = new Set(sections.map(s => s.sectionKey));
  const missingKeys = EXPECTED_SUPERSET_KEYS.filter(k => !foundKeys.has(k));
  
  if (missingKeys.length > 0) {
    errors.push(`❌ Missing SupersetSection keys: ${missingKeys.join(', ')}`);
  }
  
  // Verify legacy column compatibility
  console.log('\n   Checking legacy column compatibility...');
  for (const legacyCol of ANNEXURE_LEGACY_COLUMNS) {
    const section = sections.find(s => s.sectionKey === legacyCol);
    if (!section) {
      errors.push(`❌ Legacy column '${legacyCol}' has no matching SupersetSection.sectionKey`);
    } else {
      console.log(`   ✅ ${legacyCol} → SupersetSection found`);
    }
  }
  
  // Check critical aliases
  console.log('\n   Checking critical aliases...');
  for (const [canonical, requiredAliases] of Object.entries(CRITICAL_ALIASES)) {
    const section = sections.find(s => s.sectionKey === canonical);
    if (!section) {
      warnings.push(`⚠️  Section '${canonical}' not found for alias check`);
      continue;
    }
    
    const sectionAliases = section.aliases || [];
    const missingAliases = requiredAliases.filter(a => !sectionAliases.includes(a));
    
    if (missingAliases.length > 0) {
      warnings.push(`⚠️  Section '${canonical}' missing aliases: ${missingAliases.join(', ')}`);
    } else {
      console.log(`   ✅ ${canonical} has all critical aliases`);
    }
  }
  
  // Check display ordering
  console.log('\n   Checking display ordering...');
  const orders = sections.map(s => s.displayOrder);
  const uniqueOrders = new Set(orders);
  if (orders.length !== uniqueOrders.size) {
    warnings.push('⚠️  Duplicate displayOrder values found in SupersetSection');
  }
  
  return missingKeys.length === 0;
}

async function verifyCountryMappings() {
  console.log('\n🗺️  Checking CountrySectionMapping table...');
  
  const mappings = await prisma.countrySectionMapping.findMany({
    where: { isEnabled: true }
  });
  
  if (mappings.length === 0) {
    errors.push('❌ CountrySectionMapping table is EMPTY! Run MasterSeed.js first.');
    return false;
  }
  
  console.log(`   Found ${mappings.length} enabled mappings`);
  
  // Group by country
  const byCountry = {};
  for (const m of mappings) {
    byCountry[m.countryCode] = byCountry[m.countryCode] || [];
    byCountry[m.countryCode].push(m);
  }
  
  // Check key jurisdictions
  console.log('\n   Checking key jurisdictions...');
  for (const code of KEY_JURISDICTIONS) {
    const countryMappings = byCountry[code] || [];
    if (countryMappings.length === 0) {
      errors.push(`❌ No mappings found for jurisdiction: ${code}`);
    } else if (countryMappings.length < MIN_SECTIONS_PER_JURISDICTION) {
      warnings.push(`⚠️  ${code} only has ${countryMappings.length} sections (expected >= ${MIN_SECTIONS_PER_JURISDICTION})`);
    } else {
      console.log(`   ✅ ${code}: ${countryMappings.length} sections`);
    }
  }
  
  // Verify mapping sectionKeys reference valid SupersetSection keys
  const supersetKeys = await prisma.supersetSection.findMany({
    select: { sectionKey: true, aliases: true }
  });
  const validKeys = new Set();
  for (const s of supersetKeys) {
    validKeys.add(s.sectionKey);
    (s.aliases || []).forEach(a => validKeys.add(a));
  }
  
  console.log('\n   Validating sectionKey references...');
  const invalidMappings = mappings.filter(m => !validKeys.has(m.sectionKey));
  if (invalidMappings.length > 0) {
    for (const m of invalidMappings) {
      errors.push(`❌ Invalid sectionKey '${m.sectionKey}' in ${m.countryCode} mapping`);
    }
  } else {
    console.log('   ✅ All sectionKey references are valid');
  }
  
  return true;
}

async function verifyCountryNames() {
  console.log('\n🌍 Checking CountryName table...');
  
  const countries = await prisma.countryName.findMany();
  
  if (countries.length === 0) {
    errors.push('❌ CountryName table is EMPTY!');
    return false;
  }
  
  console.log(`   Found ${countries.length} countries`);
  
  const codes = new Set(countries.map(c => c.code));
  for (const jurisdiction of KEY_JURISDICTIONS) {
    if (!codes.has(jurisdiction)) {
      errors.push(`❌ Missing country: ${jurisdiction}`);
    }
  }
  
  return true;
}

async function verifyCountryProfiles() {
  console.log('\n📋 Checking CountryProfile table...');
  
  const profiles = await prisma.countryProfile.findMany({
    where: { status: 'ACTIVE' }
  });
  
  console.log(`   Found ${profiles.length} active profiles`);
  
  if (profiles.length === 0) {
    warnings.push('⚠️  No active CountryProfiles found (prompts may use defaults)');
  }
  
  return true;
}

async function verifySectionPrompts() {
  console.log('\n📝 Checking CountrySectionPrompt table...');
  
  const prompts = await prisma.countrySectionPrompt.findMany({
    where: { status: 'ACTIVE' }
  });
  
  console.log(`   Found ${prompts.length} active prompts`);
  
  if (prompts.length === 0) {
    warnings.push('⚠️  No active CountrySectionPrompts found (will use base prompts only)');
  }
  
  return true;
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║       🔍 DRAFTING PIPELINE SEED VERIFICATION                   ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  
  try {
    await verifySuperset();
    await verifyCountryMappings();
    await verifyCountryNames();
    await verifyCountryProfiles();
    await verifySectionPrompts();
    
    // Summary
    console.log('\n' + '═'.repeat(68));
    console.log('                         📊 VERIFICATION SUMMARY');
    console.log('═'.repeat(68));
    
    if (errors.length > 0) {
      console.log('\n❌ ERRORS (must fix before running):');
      errors.forEach(e => console.log(`   ${e}`));
    }
    
    if (warnings.length > 0) {
      console.log('\n⚠️  WARNINGS (may cause issues):');
      warnings.forEach(w => console.log(`   ${w}`));
    }
    
    if (errors.length === 0 && warnings.length === 0) {
      console.log('\n✅ All checks passed! Database is ready for drafting pipeline.');
    } else if (errors.length === 0) {
      console.log('\n✅ No critical errors. Database should work with warnings noted above.');
    } else {
      console.log('\n❌ CRITICAL ERRORS FOUND. Run MasterSeed.js to fix:');
      console.log('   node Countries/MasterSeed.js --force');
      process.exit(1);
    }
    
  } catch (error) {
    console.error('\n❌ Verification failed:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();

