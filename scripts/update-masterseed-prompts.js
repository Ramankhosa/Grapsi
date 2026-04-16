#!/usr/bin/env node

/**
 * Update MasterSeed.js with current database prompts
 * 
 * This script reads the exported JSON files and generates 
 * JavaScript code to replace in MasterSeed.js
 */

const fs = require('fs');
const path = require('path');

const countriesDir = path.join(__dirname, '..', 'Countries');
const masterSeedPath = path.join(countriesDir, 'MasterSeed.js');

// Read the exported JSON files
const sections = JSON.parse(
  fs.readFileSync(path.join(countriesDir, 'db-superset-sections.json'), 'utf8')
);

console.log(`\n${'═'.repeat(70)}`);
console.log('📦 GENERATING SUPERSET_SECTIONS CODE FROM DATABASE');
console.log(`${'═'.repeat(70)}\n`);

// Helper to escape strings for JS template literals
function escapeForTemplate(str) {
  if (!str) return '';
  return str
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${');
}

// Generate the JavaScript code
let jsCode = `// ============================================================================
// SUPERSET SECTIONS DEFINITION (UPDATED FROM DATABASE)
// ============================================================================
const SUPERSET_SECTIONS = [\n`;

for (const section of sections) {
  console.log(`  ✓ ${section.sectionKey} (${section.label})`);
  
  // Format aliases array
  const aliasesStr = JSON.stringify(section.aliases || []);
  
  // Format constraints array
  const constraintsStr = JSON.stringify(section.constraints || []);
  
  jsCode += `  {
    sectionKey: '${section.sectionKey}',
    aliases: ${aliasesStr},
    displayOrder: ${section.displayOrder},
    label: '${escapeForTemplate(section.label)}',
    description: '${escapeForTemplate(section.description)}',
    isRequired: ${section.isRequired},
    requiresPriorArt: ${section.requiresPriorArt ?? false},
    requiresFigures: ${section.requiresFigures ?? false},
    requiresClaims: ${section.requiresClaims ?? false},
    requiresComponents: ${section.requiresComponents ?? false},
    instruction: \`${escapeForTemplate(section.instruction)}\`,
    constraints: ${constraintsStr}
  },\n`;
}

jsCode += `];\n`;

// Write to a temporary file for review
const outputPath = path.join(countriesDir, 'SUPERSET_SECTIONS_UPDATED.js');
fs.writeFileSync(outputPath, jsCode, 'utf8');

console.log(`\n✅ Generated code saved to: ${outputPath}`);
console.log(`\n📋 Next: Copy this into MasterSeed.js to replace the existing SUPERSET_SECTIONS array`);

// Now let's also read MasterSeed.js and replace the SUPERSET_SECTIONS
console.log(`\n${'═'.repeat(70)}`);
console.log('🔄 UPDATING MasterSeed.js');
console.log(`${'═'.repeat(70)}\n`);

let masterSeedContent = fs.readFileSync(masterSeedPath, 'utf8');

// Find the start and end of SUPERSET_SECTIONS array
const startMarker = '// ============================================================================\n// SUPERSET SECTIONS DEFINITION';
const endMarker = '\n// ============================================================================\n// COUNTRY SECTION MAPPINGS';

const startIdx = masterSeedContent.indexOf(startMarker);
let endIdx = masterSeedContent.indexOf(endMarker);

if (startIdx === -1) {
  console.log('❌ Could not find start marker for SUPERSET_SECTIONS');
  console.log('   Looking for:', startMarker.substring(0, 50) + '...');
  process.exit(1);
}

if (endIdx === -1) {
  console.log('❌ Could not find end marker for SUPERSET_SECTIONS');
  process.exit(1);
}

console.log(`  Found SUPERSET_SECTIONS at position ${startIdx}`);
console.log(`  Found end marker at position ${endIdx}`);

// Replace the section
const beforeSection = masterSeedContent.substring(0, startIdx);
const afterSection = masterSeedContent.substring(endIdx);

const newContent = beforeSection + jsCode + afterSection;

// Backup original
const backupPath = masterSeedPath + '.backup-' + Date.now();
fs.writeFileSync(backupPath, masterSeedContent, 'utf8');
console.log(`\n  📁 Backup saved to: ${backupPath}`);

// Write updated content
fs.writeFileSync(masterSeedPath, newContent, 'utf8');
console.log(`  ✅ MasterSeed.js updated successfully!`);

console.log(`\n${'═'.repeat(70)}`);
console.log('✅ UPDATE COMPLETE');
console.log(`${'═'.repeat(70)}\n`);

