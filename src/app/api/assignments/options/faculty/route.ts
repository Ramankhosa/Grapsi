import { NextRequest } from 'next/server'
import { allocationOptionsHandler } from '@/lib/assignments/allocationOptions'
export const dynamic = 'force-dynamic'
export function GET(request: NextRequest) { return allocationOptionsHandler(request, 'faculty') }
