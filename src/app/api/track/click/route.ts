/**
 * Link Click Tracking Endpoint
 * Records click event and redirects to actual destination
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const inviteId = searchParams.get('id')
  const url = searchParams.get('url')

  // Default redirect if something goes wrong
  const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000'
  const defaultRedirect = `${baseUrl}/register`

  if (!inviteId) {
    return NextResponse.redirect(url || defaultRedirect)
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
        // Still redirect, just don't track
        const inviteUrl = `${baseUrl}/register?invite=${invite.inviteToken}&trial=true&email=${encodeURIComponent(invite.email)}`
        return NextResponse.redirect(inviteUrl)
      }

      // Update invite
      const now = new Date()
      // Only upgrade status from earlier stages, never downgrade
      const upgradableStates = ['SENT', 'DELIVERED', 'OPENED']
      const shouldUpdateStatus = upgradableStates.includes(invite.status)
      
      await prisma.trialInvite.update({
        where: { id: inviteId },
        data: {
          status: shouldUpdateStatus ? 'CLICKED' : invite.status,
          clickCount: { increment: 1 },
          lastClickedAt: now,
          ...(invite.firstClickedAt ? {} : { firstClickedAt: now })
        }
      })

      // Log event
      await prisma.trialInviteEvent.create({
        data: {
          inviteId,
          eventType: 'CLICKED',
          source: 'link_click',
          ipAddress: ip,
          userAgent,
          eventData: { url }
        }
      })

      // Update campaign stats (only for first click)
      if (!invite.firstClickedAt) {
        await prisma.trialCampaign.update({
          where: { id: invite.campaignId },
          data: { clickedCount: { increment: 1 } }
        })
      }

      // Build the actual invite URL
      const inviteUrl = `${baseUrl}/register?invite=${invite.inviteToken}&trial=true&email=${encodeURIComponent(invite.email)}`
      return NextResponse.redirect(inviteUrl)
    }
  } catch (error) {
    console.error('Click tracking error:', error)
  }

  return NextResponse.redirect(url || defaultRedirect)
}

