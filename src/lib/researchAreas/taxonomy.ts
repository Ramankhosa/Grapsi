import type { ResearchAreaTaxonomyAreaRecord, ResearchAreaTaxonomyPayload } from '@/lib/researcherProfile/types'
import type { Area } from './core'
import { loadStandardAreas } from './store'

/** A flat picker section, not a claim that imported subjects are parents. */
export function standardAreaRecord(area:Area):ResearchAreaTaxonomyAreaRecord {
 return {id:area.id,uploadId:'canonical:scientify:source-v1',level1Code:'AREAS',level1Name:'Research areas',level2Code:area.id,level2Name:area.label,description:'',aliases:[],sortOrder:null,isActive:true}
}
export async function standardTaxonomyPayload():Promise<ResearchAreaTaxonomyPayload> {
 const areas=(await loadStandardAreas()).map(standardAreaRecord)
 return {vocabulary:'canonical',upload:{id:'canonical:scientify:source-v1',sourceName:'Grapsi research areas',originalFilename:null,rowCount:areas.length,activeRowCount:areas.length,status:'ACTIVE',createdAt:new Date(0).toISOString(),activatedAt:new Date(0).toISOString(),archivedAt:null},areas,groups:areas.length?[{level1Code:'AREAS',level1Name:'Research areas',areas}]:[],hasActiveTaxonomy:areas.length>0}
}
