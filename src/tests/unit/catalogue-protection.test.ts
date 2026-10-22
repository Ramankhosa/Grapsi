import { describe,it,expect } from 'vitest'
import { readFileSync,readdirSync } from 'node:fs'
import path from 'node:path'
import { sanitizeCatalogueResponse } from '@/lib/catalogueProtection/response'
import { assertBoundedIds,EXPOSURE_LIMITS } from '@/lib/catalogueProtection/policy'
import manifest from '@/lib/catalogueProtection/routes.json'
import { directoryFilterSchema } from '@/lib/recommendations/directorySchema'

describe('catalogue output and extraction controls',()=>{
  const call={id:'call',schemeTitle:'A real call',description:'x'.repeat(1000),shortDescription:'y'.repeat(500),fullDescription:'PRIVATE FULL TEXT',eligibilityText:'full eligibility',raw_payload:{secret:true},metadata:{hidden:true},embedding:[1,2],agencyName:'Funder',officialUrls:['https://example.org'],fundingKinds:['Research Grant']}
  it('list responses contain bounded summaries with no hidden full text or metadata',()=>{
    const safe=sanitizeCatalogueResponse({results:[call]},'summary')
    expect(safe.callIds).toEqual(['call']);expect(safe.value.results[0].description).toHaveLength(320)
    expect(safe.value.results[0].shortDescription).toHaveLength(320)
    for(const name of ['fullDescription','eligibilityText','raw_payload','metadata','embedding'])expect(safe.value.results[0]).not.toHaveProperty(name)
  })
  it('authorised detail responses retain descriptions without exposing import internals',()=>{
    const safe=sanitizeCatalogueResponse({call},'detail')
    expect(safe.value.call.fullDescription).toBe('PRIVATE FULL TEXT')
    expect(safe.value.call.eligibilityText).toBe('full eligibility')
    expect(safe.value.call).not.toHaveProperty('metadata')
  })
  it('stored conversation snapshots cannot bypass list projections',()=>{
    const safe=sanitizeCatalogueResponse({runs:[{result_snapshot_json:[call]}]},'summary')
    expect(JSON.stringify(safe.value)).not.toContain('PRIVATE FULL TEXT');expect(safe.callIds).toContain('call')
  })
  it('protects root DTOs, conflict records and document chunks without titles',()=>{
    expect(sanitizeCatalogueResponse(call,'summary').value.description).toHaveLength(320)
    expect(sanitizeCatalogueResponse({subject_call:call,candidate_call:{...call,id:'other'}},'detail').callIds).toEqual(['call','other'])
    const chunk={fundingCallId:'call',chunkText:'FULL DOCUMENT',chunkId:'chunk',embedding:[1]}
    const safe=sanitizeCatalogueResponse({results:[chunk]},'summary')
    expect(safe.callIds).toEqual(['call']);expect(safe.value.results[0]).not.toHaveProperty('chunkText')
    expect(sanitizeCatalogueResponse({results:[chunk]},'detail').value.results[0].chunkText).toBe('FULL DOCUMENT')
  })
  it('preserves user workspace metadata while continuing to remove catalogue internals',()=>{
    const safe=sanitizeCatalogueResponse({session:{metadata:{userSetting:'keep',embedding:[1]},call}},'detail',true)
    expect(safe.value.session.metadata.userSetting).toBe('keep');expect(safe.value.session.metadata).not.toHaveProperty('embedding');expect(safe.value.session.call).not.toHaveProperty('metadata')
  })
  it('bounds citations and refuses oversized call lists',()=>{
    expect(sanitizeCatalogueResponse({citations:{resultIds:Array.from({length:20},(_,n)=>String(n))}},'ai').callIds).toHaveLength(10)
    expect(()=>sanitizeCatalogueResponse({results:Array(51).fill(call)},'summary')).toThrow()
    expect(()=>assertBoundedIds(Array(51).fill('call'))).toThrow()
  })
  it('accepts imported area and lifecycle filters but rejects invalid lifecycle values',()=>{
    expect(directoryFilterSchema.safeParse({importedAreaIds:['scientify:discipline:123'],lifecycleStatuses:['OPEN','ROLLING']}).success).toBe(true)
    expect(directoryFilterSchema.safeParse({lifecycleStatuses:['ACTIVE']}).success).toBe(false)
    expect(EXPOSURE_LIMITS.detail).toEqual([[1,200],[7,600],[30,1200]])
  })
})
describe('catalogue route coverage',()=>{
  it('keeps registered catalogue reads behind the shared guard',()=>{
    expect(Object.keys(manifest).length).toBeGreaterThanOrEqual(75)
    for(const [file,rule]of Object.entries(manifest)){
      const code=readFileSync(path.resolve(file),'utf8')
      const guard=rule.guard||'withCatalogueProtection'
      expect(code,file).toContain(guard)
      expect(code,file).toContain("export const dynamic = 'force-dynamic'")
      for(const method of rule.methods)expect(code,file).toMatch(new RegExp(`export const ${method}\\s*=\\s*${guard}`))
      for(const match of code.matchAll(/export\s+(?:async\s+function|const)\s+(GET|POST|PATCH|PUT|DELETE)\b/g)){
        // This existing, typed publisher action returns deletion counts only.
        if(file==='src/app/api/admin/funding/calls/delete-all/route.ts'&&match[1]==='POST')continue
        expect(rule.methods,file+':'+match[1]).toContain(match[1])
      }
    }
  })
  it('new discovery routes require a guard rather than silently escaping the manifest',()=>{
    const walk=(root:string):string[]=>readdirSync(root,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(root,e.name)):[path.join(root,e.name)])
    for(const file of ['src/app/api/recommendations','src/app/api/admin/funding/calls','src/app/api/funding/calls','src/app/api/idea-intelligence','src/app/api/grant-prep/sessions'].flatMap(walk).filter(p=>p.endsWith('route.ts'))){
      if(file===path.normalize('src/app/api/recommendations/sessions/route.ts'))continue
      if(file.endsWith(path.join('template','assets','[assetId]','route.ts')))continue // DELETE receipt; no funding content.
      expect(readFileSync(file,'utf8'),file).toMatch(/withCatalogue(?:Source)?Protection/)
    }
    expect(readFileSync('pages/api/reviewer/funding-calls.ts','utf8')).toContain('withCataloguePagesProtection')
  })
})
