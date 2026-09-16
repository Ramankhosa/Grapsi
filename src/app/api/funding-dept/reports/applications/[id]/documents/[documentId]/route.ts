import { NextRequest, NextResponse } from 'next/server'
import fs from 'node:fs/promises'
import prisma from '@/lib/prisma'
import { Prisma } from '@/lib/prisma-generated'
import { managementAccess, schoolIsAccessible } from '@/lib/fundingDept/managementAccess'
import { readVersionFile } from '@/lib/proposals/versionService'
import { readProposalDocument } from '@/lib/proposals/documentService'
import type { ApplicationRow } from '@/lib/fundingDept/managementRules'
export const dynamic='force-dynamic'
export async function GET(request:NextRequest,{params}:{params:{id:string;documentId:string}}){
  const access=await managementAccess(request);if('response' in access)return access.response
  const tenantId=access.context.tenantId
  const row=(await prisma.$queryRaw<ApplicationRow[]>(Prisma.sql`SELECT * FROM dsr_applications WHERE tenant_id=${tenantId} AND id=${params.id}`))[0]
  if(!row?.school_id || !await schoolIsAccessible(access,row.school_id))return NextResponse.json({error:'File not found.'},{status:404})
  try {
    const kind=new URL(request.url).searchParams.get('kind')
    let file:{buffer:Buffer;fileName:string;mimeType:string}
    if(kind==='version'&&row.proposal_id)file=await readVersionFile(row.proposal_id,params.documentId)
    else if(kind==='proposal'&&row.proposal_id)file=await readProposalDocument(row.proposal_id,params.documentId,true)
    else if(kind==='assignment'&&row.assignment_id){
      const doc=await prisma.assignmentDocument.findFirst({where:{id:params.documentId,assignment_id:row.assignment_id,tenant_id:tenantId}})
      if(!doc)return NextResponse.json({error:'File not found.'},{status:404})
      file={buffer:await fs.readFile(doc.storage_path),fileName:doc.file_name,mimeType:doc.mime_type||'application/octet-stream'}
    } else return NextResponse.json({error:'File not found.'},{status:404})
    return new NextResponse(new Uint8Array(file.buffer),{headers:{'Content-Type':file.mimeType,'Content-Disposition':`attachment; filename="${encodeURIComponent(file.fileName)}"`,'Cache-Control':'private, no-store'}})
  }catch{return NextResponse.json({error:'File unavailable.'},{status:404})}
}
