import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/middleware'
import { ExpiryNotificationService } from '@/lib/notification-service'

export async function POST(request: NextRequest) {
  try {
    // Only full super admins can trigger expiry notifications
    const roleCheck = await requireRole(['SUPER_ADMIN'])(request)
    if (roleCheck) return roleCheck

    console.log('[API] Starting expiry notification check...')

    const service = new ExpiryNotificationService()
    await service.checkAndNotifyExpiringTokens()

    return NextResponse.json({
      success: true,
      message: 'Expiry notification check completed'
    })

  } catch (error) {
    console.error('[API] Error in expiry notification check:', error)
    return NextResponse.json(
      {
        success: false,
        message: 'Failed to check expiry notifications',
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  try {
    // Allow SUPER_ADMIN and SUPER_ADMIN_VIEWER to view notification status
    const roleCheck = await requireRole(['SUPER_ADMIN', 'SUPER_ADMIN_VIEWER'])(request)
    if (roleCheck) return roleCheck

    const { searchParams } = new URL(request.url)
    const days = parseInt(searchParams.get('days') || '7')

    const service = new ExpiryNotificationService()
    const expiringTokens = await service.findTokensExpiringSoon()

    return NextResponse.json({
      success: true,
      expiringTokensCount: expiringTokens.length,
      tokens: expiringTokens.map(token => ({
        id: token.id,
        fingerprint: token.fingerprint,
        expiresAt: token.expiresAt,
        tenantName: token.tenant?.name,
        daysUntilExpiry: Math.ceil(
          (token.expiresAt!.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
        )
      }))
    })

  } catch (error) {
    console.error('[API] Error getting expiry status:', error)
    return NextResponse.json(
      {
        success: false,
        message: 'Failed to get expiry status',
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
