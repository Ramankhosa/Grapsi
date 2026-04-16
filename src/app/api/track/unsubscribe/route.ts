/**
 * Unsubscribe Endpoint
 * Handles email unsubscribe requests
 * 
 * Security: Uses inviteId (CUID) which is unguessable.
 * The unsubscribe link is only sent in emails to the recipient.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const inviteId = searchParams.get('id')
  const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000'

  if (!inviteId || inviteId.length < 20) {
    // CUIDs are 25+ chars, reject obvious invalid attempts
    return NextResponse.redirect(`${baseUrl}/unsubscribed?error=invalid`)
  }

  try {
    // Find the invite
    const invite = await prisma.trialInvite.findUnique({
      where: { id: inviteId }
    })

    if (!invite) {
      // Don't reveal whether ID exists - always show generic message
      return NextResponse.redirect(`${baseUrl}/unsubscribed?success=true`)
    }
    
    // Don't process if already unsubscribed
    if (invite.status === 'UNSUBSCRIBED') {
      return NextResponse.redirect(`${baseUrl}/unsubscribed?success=true`)
    }

    // Add to global unsubscribe list
    await prisma.trialUnsubscribe.upsert({
      where: { email: invite.email },
      create: {
        email: invite.email,
        source: invite.campaignId,
        reason: 'user_request'
      },
      update: {
        reason: 'user_request'
      }
    })

    // Update invite status
    await prisma.trialInvite.update({
      where: { id: inviteId },
      data: {
        status: 'UNSUBSCRIBED',
        unsubscribedAt: new Date()
      }
    })

    // Log event
    await prisma.trialInviteEvent.create({
      data: {
        inviteId,
        eventType: 'UNSUBSCRIBED',
        source: 'user_request'
      }
    })

    return NextResponse.redirect(`${baseUrl}/unsubscribed?success=true`)
  } catch (error) {
    console.error('Unsubscribe error:', error)
    return NextResponse.redirect(`${baseUrl}/unsubscribed?error=failed`)
  }
}

