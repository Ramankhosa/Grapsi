import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function check() {
  console.log('Checking jurisdiction style data in database...\n')
  
  const diagramConfigs = await prisma.countryDiagramConfig.findMany()
  console.log('DiagramConfigs:', diagramConfigs.length)
  diagramConfigs.forEach(x => console.log('  -', x.countryCode, 'status:', x.status))
  
  const exportConfigs = await prisma.countryExportConfig.findMany()
  console.log('\nExportConfigs:', exportConfigs.length)
  exportConfigs.forEach(x => console.log('  -', x.countryCode, x.documentTypeId, 'status:', x.status))
  
  const validations = await prisma.countrySectionValidation.findMany()
  console.log('\nSectionValidations:', validations.length)
  validations.forEach(x => console.log('  -', x.countryCode, x.sectionKey, 'status:', x.status))
  
  const crossValidations = await prisma.countryCrossValidation.findMany()
  console.log('\nCrossValidations:', crossValidations.length)
  crossValidations.forEach(x => console.log('  -', x.countryCode, x.checkId))
  
  await prisma.$disconnect()
}

check().catch(console.error)

