import prisma from '../src/lib/prisma'
import { syncCatalogueAreaIndex } from '../src/lib/catalogueProtection/areas'
async function main(){
  const database=(await prisma.$queryRawUnsafe<Array<{name:string}>>('SELECT current_database() AS name'))[0].name
  const index=process.argv.indexOf('--confirm-target')
  if(index<0||process.argv[index+1]!==database)throw new Error('Supply --confirm-target with the exact database name.')
  console.log(await syncCatalogueAreaIndex())
}
main().catch(e=>{console.error(e instanceof Error?e.message:'Area indexing failed');process.exitCode=1}).finally(()=>prisma.$disconnect())
