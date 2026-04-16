import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({
    error: 'Export functionality has been replaced with client-side download. Use the Download HTML button on the patent page.'
  }, { status: 410 }) // 410 Gone
}
