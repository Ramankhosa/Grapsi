const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function main() {
  // Export CountryName
  const countries = await prisma.countryName.findMany({
    orderBy: { code: 'asc' }
  });
  
  fs.writeFileSync(
    path.join(__dirname, '..', 'Countries', 'db-country-names.json'),
    JSON.stringify(countries, null, 2),
    'utf8'
  );
  console.log('Exported', countries.length, 'CountryName records');
  countries.forEach(c => console.log('  ', c.code, '-', c.name, '(' + c.continent + ')'));

  // Export SupersetSection (base prompts)
  const sections = await prisma.supersetSection.findMany({
    orderBy: { displayOrder: 'asc' }
  });
  
  fs.writeFileSync(
    path.join(__dirname, '..', 'Countries', 'db-superset-sections.json'),
    JSON.stringify(sections, null, 2),
    'utf8'
  );
  console.log('Exported', sections.length, 'SupersetSection records');

  // Export CountrySectionPrompt (top-up prompts)
  const topups = await prisma.countrySectionPrompt.findMany({
    where: { status: 'ACTIVE' },
    orderBy: [{ countryCode: 'asc' }, { sectionKey: 'asc' }]
  });
  
  fs.writeFileSync(
    path.join(__dirname, '..', 'Countries', 'db-country-section-prompts.json'),
    JSON.stringify(topups, null, 2),
    'utf8'
  );
  console.log('Exported', topups.length, 'CountrySectionPrompt records');

  // Export LLM Models
  const models = await prisma.lLMModel.findMany({
    where: { isActive: true },
    orderBy: [{ provider: 'asc' }, { code: 'asc' }]
  });
  
  fs.writeFileSync(
    path.join(__dirname, '..', 'Countries', 'db-llm-models.json'),
    JSON.stringify(models, null, 2),
    'utf8'
  );
  console.log('Exported', models.length, 'LLMModel records');

  await prisma.$disconnect();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});

