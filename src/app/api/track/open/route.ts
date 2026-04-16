/**
 * Email Open Tracking - Tracking Pixel Endpoint
 * Returns a 1x1 transparent GIF and records the open event
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// 1x1 transparent GIF
const TRACKING_PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
)

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const inviteId = searchParams.get('id')

  // Always return the pixel, even if tracking fails
  const response = new NextResponse(TRACKING_PIXEL, {
    headers: {
      'Content-Type': 'image/gif',
      'Content-Length': String(TRACKING_PIXEL.length),
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    }
  })

  if (!inviteId) {
    return response
  }

  try {
    // Get IP and user agent for tracking
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0] ||
               request.headers.get('x-real-ip') ||
               'unknown'
    const userAgent = request.headers.get('user-agent') || 'unknown'

    // Find the invite
    const invite = await prisma.trialInvite.findUnique({
      where: { id: inviteId }
    })

    if (invite) {
      // Don't track if invite is in a terminal state
      const terminalStates = ['SIGNED_UP', 'BOUNCED', 'UNSUBSCRIBED', 'EXPIRED']
      if (terminalStates.includes(invite.status)) {
        return response
      }

      // Update invite
      const now = new Date()
      // Only upgrade status if it's in an earlier stage (SENT/DELIVERED -> OPENED)
      // Never downgrade from CLICKED
      const shouldUpdateStatus = invite.status === 'SENT' || invite.status === 'DELIVERED'
      
      await prisma.trialInvite.update({
        where: { id: inviteId },
        data: {
          status: shouldUpdateStatus ? 'OPENED' : invite.status,
          openCount: { increment: 1 },
          lastOpenedAt: now,
          ...(invite.firstOpenedAt ? {} : { firstOpenedAt: now })
        }
      })

      // Log event
      await prisma.trialInviteEvent.create({
        data: {
          inviteId,
          eventType: 'OPENED',
          source: 'tracking_pixel',
          ipAddress: ip,
          userAgent
        }
      })

      // Update campaign stats (only for first open)
      if (!invite.firstOpenedAt) {
        await prisma.trialCampaign.update({
          where: { id: invite.campaignId },
          data: { openedCount: { increment: 1 } }
        })
      }
    }
  } catch (error) {
    console.error('Open tracking error:', error)
    // Don't fail - still return pixel
  }

  return response
}

