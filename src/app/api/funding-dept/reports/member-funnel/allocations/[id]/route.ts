import { NextRequest } from 'next/server'
import { GET as canonicalDetail } from '../../../applications/[id]/route'
export const dynamic='force-dynamic'
export function GET(request:NextRequest,{params}:{params:{id:string}}){return canonicalDetail(request,{params:{id:`assignment:${params.id}`}})}
