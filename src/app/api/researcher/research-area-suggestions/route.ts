import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { withCatalogueProtection } from '@/lib/catalogueProtection/guard'
import { canonicalAreasEnabled, AREA_EMBEDDING_MODEL, cosineSimilarity } from '@/lib/researchAreas/core'
import { loadAreaVectors } from '@/lib/researchAreas/store'
import { EmbeddingService } from '@/lib/services/embeddingService'
export const runtime='nodejs'
export const dynamic = 'force-dynamic'
export const POST=withCatalogueProtection(async(request:NextRequest)=>{
 if(!canonicalAreasEnabled())return NextResponse.json({error:'Standard area suggestions are not enabled.'},{status:409})
 const parsed=z.object({text:z.string().trim().min(20).max(5000)}).safeParse(await request.json())
 if(!parsed.success)return NextResponse.json({error:'Describe your research focus in 20–5,000 characters.'},{status:400})
 const service=new EmbeddingService()
 if(service.getHealth().provider!=='voyage')return NextResponse.json({error:'Research-area suggestions are temporarily unavailable.'},{status:503})
 const areas=await loadAreaVectors(),query=await service.generateEmbedding(parsed.data.text,undefined,{modelName:AREA_EMBEDDING_MODEL,outputDimensionality:1024,taskType:'RETRIEVAL_QUERY'})
 if(query.error||query.provider!=='voyage'||query.embedding.length!==1024)return NextResponse.json({error:'Research-area suggestions are temporarily unavailable.'},{status:503})
 const suggestions=areas.filter(a=>!['All disciplines','Interdisciplinary'].includes(a.label)).map(a=>({id:a.id,label:a.label,similarity:cosineSimilarity(query.embedding,a.embedding)})).sort((a,b)=>b.similarity-a.similarity).slice(0,10)
 return NextResponse.json({suggestions,requiresConfirmation:true})
},'metadata')
