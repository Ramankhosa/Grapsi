import { NextRequest } from 'next/server'
import { managementReportHandler } from '@/lib/fundingDept/managementHandler'
export const dynamic='force-dynamic'
export async function GET(request:NextRequest){return managementReportHandler(request)}
