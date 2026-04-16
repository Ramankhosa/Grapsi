#!/usr/bin/env node

/**
 * ============================================================================
 * Export Current Prompts for Seed Script
 * ============================================================================
 * 
 * Exports current SupersetSection (base prompts) and CountrySectionPrompt 
 * (top-up prompts) from the production database.
 * 
 * This script helps you:
 * 1. Extract refined prompts that were edited via Super Admin panel
 * 2. Generate seed-compatible JavaScript code
 * 3. Compare with existing MasterSeed.js entries
 * 
 * Usage:
 *   node scripts/export-prompts-for-seed.js                    # Export all
 *   node scripts/export-prompts-for-seed.js --base-only        # Only base prompts
 *   node scripts/export-prompts-for-seed.js --topup-only       # Only top-up prompts
 *   node scripts/export-prompts-for-seed.js --country=IN       # Specific country top-ups
 *   node scripts/export-prompts-for-seed.js --json             # Output as JSON
 *   node scripts/export-prompts-for-seed.js --save             # Save to file
 */

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  baseOnly: args.includes('--base-only'),
  topupOnly: args.includes('--topup-only'),
  country: args.find(a => a.startsWith('--country='))?.split('=')[1]?.toUpperCase(),
  json: args.includes('--json'),
  save: args.includes('--save'),
  help: args.includes('--help') || args.includes('-h'),
};

if (options.help) {
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║           EXPORT PROMPTS FOR SEED SCRIPT                          ║
╚══════════════════════════════════════════════════════════════════╝

Usage: node scripts/export-prompts-for-seed.js [options]

Options:
  --base-only        Export only SupersetSection (base prompts)
  --topup-only       Export only CountrySectionPrompt (top-up prompts)
  --country=XX       Export top-ups for specific country (e.g., --country=IN)
  --json             Output as JSON instead of JavaScript
  --save             Save output to files in Countries/ folder
  --help, -h         Show this help message

Examples:
  node scripts/export-prompts-for-seed.js --base-only --save
  node scripts/export-prompts-for-seed.js --topup-only --country=IN
  node scripts/export-prompts-for-seed.js --json > prompts-backup.json
`);
  process.exit(0);
}

// Helper to escape strings for JavaScript output
function escapeForJS(str) {
  if (!str) return '';
  return str
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$/g, '\\$');
}

// Helper to format constraints array
function formatConstraints(constraints) {
  if (!constraints || !Array.isArray(constraints) || constraints.length === 0) {
    return '[]';
  }
  const items = constraints.map(c => `"${c.replace(/"/g, '\\"')}"`);
  return `[${items.join(',')}]`;
}

async function exportSupersetSections() {
  console.log('\n' + '═'.repeat(80));
  console.log('📦 EXPORTING BASE PROMPTS (SupersetSection)');
  console.log('═'.repeat(80) + '\n');

  const sections = await prisma.supersetSection.findMany({
    orderBy: { displayOrder: 'asc' }
  });

  if (sections.length === 0) {
    console.log('⚠️  No SupersetSection records found in database');
    return { sections: [], output: '' };
  }

  console.log(`Found ${sections.length} superset sections\n`);

  if (options.json) {
    return {
      sections,
      output: JSON.stringify(sections, null, 2)
    };
  }

  // Generate JavaScript code for MasterSeed.js
  let output = `// ============================================================================
// SUPERSET SECTIONS DEFINITION (EXPORTED FROM DATABASE ${new Date().toISOString()})
// ============================================================================
const SUPERSET_SECTIONS = [\n`;

  for (const section of sections) {
    console.log(`  ✓ ${section.sectionKey} (${section.label})`);
    
    output += `  {
    sectionKey: '${section.sectionKey}',
    aliases: ${JSON.stringify(section.aliases || [])},
    displayOrder: ${section.displayOrder},
    label: '${section.label}',
    description: '${escapeForJS(section.description)}',
    isRequired: ${section.isRequired},
    requiresPriorArt: ${section.requiresPriorArt ?? false},
    requiresFigures: ${section.requiresFigures ?? false},
    requiresClaims: ${section.requiresClaims ?? false},
    requiresComponents: ${section.requiresComponents ?? false},
    instruction: \`${escapeForJS(section.instruction)}\`,
    constraints: ${formatConstraints(section.constraints)}
  },\n`;
  }

  output += '];\n';

  return { sections, output };
}

async function exportCountrySectionPrompts() {
  console.log('\n' + '═'.repeat(80));
  console.log('🌍 EXPORTING TOP-UP PROMPTS (CountrySectionPrompt)');
  console.log('═'.repeat(80) + '\n');

  const whereClause = options.country 
    ? { countryCode: options.country, status: 'ACTIVE' }
    : { status: 'ACTIVE' };

  const prompts = await prisma.countrySectionPrompt.findMany({
    where: whereClause,
    orderBy: [{ countryCode: 'asc' }, { sectionKey: 'asc' }]
  });

  if (prompts.length === 0) {
    console.log('⚠️  No CountrySectionPrompt records found');
    return { prompts: [], output: '' };
  }

  // Group by country
  const byCountry = {};
  for (const prompt of prompts) {
    if (!byCountry[prompt.countryCode]) {
      byCountry[prompt.countryCode] = [];
    }
    byCountry[prompt.countryCode].push(prompt);
  }

  console.log(`Found ${prompts.length} top-up prompts across ${Object.keys(byCountry).length} countries\n`);

  if (options.json) {
    return {
      prompts,
      byCountry,
      output: JSON.stringify({ prompts, byCountry }, null, 2)
    };
  }

  // Generate JavaScript code for MasterSeed.js
  let output = `// ============================================================================
// COUNTRY SECTION PROMPTS (TOP-UP) - EXPORTED FROM DATABASE ${new Date().toISOString()}
// ============================================================================
const COUNTRY_SECTION_PROMPTS = {\n`;

  for (const [countryCode, countryPrompts] of Object.entries(byCountry)) {
    console.log(`  📍 ${countryCode}: ${countryPrompts.length} prompts`);
    
    output += `  '${countryCode}': [\n`;
    
    for (const prompt of countryPrompts) {
      console.log(`     ✓ ${prompt.sectionKey}`);
      
      output += `    {
      sectionKey: '${prompt.sectionKey}',
      instruction: \`${escapeForJS(prompt.instruction)}\`,
      constraints: ${formatConstraints(prompt.constraints)},
      additions: ${formatConstraints(prompt.additions)},
      importFiguresDirectly: ${prompt.importFiguresDirectly ?? false}
    },\n`;
    }
    
    output += `  ],\n`;
  }

  output += '};\n';

  return { prompts, byCountry, output };
}

async function exportLLMModels() {
  console.log('\n' + '═'.repeat(80));
  console.log('🤖 EXPORTING LLM MODELS');
  console.log('═'.repeat(80) + '\n');

  const models = await prisma.lLMModel.findMany({
    where: { isActive: true },
    orderBy: [{ provider: 'asc' }, { code: 'asc' }]
  });

  if (models.length === 0) {
    console.log('⚠️  No LLMModel records found');
    return { models: [], output: '' };
  }

  console.log(`Found ${models.length} active LLM models\n`);

  // Group by provider
  const byProvider = {};
  for (const model of models) {
    if (!byProvider[model.provider]) {
      byProvider[model.provider] = [];
    }
    byProvider[model.provider].push(model);
  }

  if (options.json) {
    return {
      models,
      byProvider,
      output: JSON.stringify({ models, byProvider }, null, 2)
    };
  }

  // Generate JavaScript code
  let output = `// ============================================================================
// LLM MODELS - EXPORTED FROM DATABASE ${new Date().toISOString()}
// ============================================================================
const LLM_MODELS = [\n`;

  for (const model of models) {
    console.log(`  ✓ ${model.code} (${model.provider})`);
    
    output += `  {
    code: '${model.code}',
    displayName: '${model.displayName}',
    provider: '${model.provider}',
    contextWindow: ${model.contextWindow},
    supportsVision: ${model.supportsVision},
    supportsStreaming: ${model.supportsStreaming},
    inputCostPer1M: ${model.inputCostPer1M},
    outputCostPer1M: ${model.outputCostPer1M},
    isActive: ${model.isActive},
    isDefault: ${model.isDefault}
  },\n`;
  }

  output += '];\n';

  return { models, byProvider, output };
}

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║           🔄 EXPORT PROMPTS FOR SEED SCRIPT                       ║
╚══════════════════════════════════════════════════════════════════╝
`);

  try {
    let fullOutput = '';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

    // Export base prompts (SupersetSection)
    if (!options.topupOnly) {
      const { output: baseOutput } = await exportSupersetSections();
      fullOutput += baseOutput + '\n\n';
      
      if (options.save && baseOutput) {
        const basePath = path.join(__dirname, '..', 'Countries', `exported-base-prompts-${timestamp}.js`);
        fs.writeFileSync(basePath, baseOutput);
        console.log(`\n💾 Saved base prompts to: ${basePath}`);
      }
    }

    // Export top-up prompts (CountrySectionPrompt)
    if (!options.baseOnly) {
      const { output: topupOutput } = await exportCountrySectionPrompts();
      fullOutput += topupOutput + '\n\n';
      
      if (options.save && topupOutput) {
        const topupPath = path.join(__dirname, '..', 'Countries', `exported-topup-prompts-${timestamp}.js`);
        fs.writeFileSync(topupPath, topupOutput);
        console.log(`\n💾 Saved top-up prompts to: ${topupPath}`);
      }
    }

    // Export LLM models
    if (!options.baseOnly && !options.topupOnly) {
      const { output: llmOutput } = await exportLLMModels();
      fullOutput += llmOutput;
      
      if (options.save && llmOutput) {
        const llmPath = path.join(__dirname, '..', 'Countries', `exported-llm-models-${timestamp}.js`);
        fs.writeFileSync(llmPath, llmOutput);
        console.log(`\n💾 Saved LLM models to: ${llmPath}`);
      }
    }

    // Save combined output
    if (options.save && fullOutput) {
      const combinedPath = path.join(__dirname, '..', 'Countries', `exported-all-prompts-${timestamp}.js`);
      fs.writeFileSync(combinedPath, fullOutput);
      console.log(`\n💾 Saved combined export to: ${combinedPath}`);
    }

    console.log('\n' + '═'.repeat(80));
    console.log('✅ EXPORT COMPLETE');
    console.log('═'.repeat(80));
    console.log(`
📋 Next Steps:
   1. Review the exported prompts for accuracy
   2. Compare with existing SUPERSET_SECTIONS in Countries/MasterSeed.js
   3. Copy refined prompts into MasterSeed.js to preserve them in the seed
   4. Run the seed with --force to update the database
`);

  } catch (error) {
    console.error('❌ Export failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();

