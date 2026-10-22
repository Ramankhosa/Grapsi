import { describe,it,expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// Direct reads are confined to explicit compatibility, import and history
// boundaries. Adding a live reader must use researchAreas/queries instead.
const historicalReaders=new Set([
 'src/lib/researchAreas/store.ts','src/lib/researchAreas/queries.ts',
 'src/lib/catalogueProtection/areas.ts','src/lib/funding/disciplineClassifier.ts',
 'src/lib/services/fundingCallResearchAreaTaxonomyService.ts',
 'src/app/api/admin/funding/research-area-review/route.ts',
])
function files(root:string):string[]{return fs.readdirSync(root,{withFileTypes:true}).flatMap(e=>{
 const name=path.join(root,e.name);return e.isDirectory()&&!['prisma-generated','tests','__tests__'].includes(e.name)?files(name):e.isFile()&&/\.tsx?$/.test(name)?[name]:[]
})}
describe('shared research area consumer coverage',()=>{
 it('prevents live SQL and Prisma readers from selecting stale call classifications',()=>{
  const violations=files('src').filter(file=>{
   const name=file.replace(/\\/g,'/');if(historicalReaders.has(name)||name.startsWith('src/lib/fundingCatalogImport/'))return false
   const source=fs.readFileSync(file,'utf8')
   return /\b(?:FROM|JOIN)\s+funding_call_research_area_taxonomies\b|research_area_taxonomies\s*:\s*\{\s*some\s*:/i.test(source)
  })
  expect(violations).toEqual([])
 })
})
