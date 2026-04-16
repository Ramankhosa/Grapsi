/**
 * Mailjet Webhook Endpoint
 * Handles email delivery events from Mailjet
 * 
 * Configure in Mailjet Dashboard:
 * https://app.mailjet.com/account/triggers
 * 
 * Events to enable: sent, open, click, bounce, blocked, spam, unsub
 */

import { NextRequest, NextResponse } from 'next/server'
import { processWebhookEvent } from '@/lib/trial-invite-service'

export async function POST(request: NextRequest) {
  try {
    // Mailjet sends events as an array
    const events = await request.json()

    // Process each event
    const results = await Promise.allSettled(
      (Array.isArray(events) ? events : [events]).map(event => 
        processWebhookEvent(event)
      )
    )

    // Log any failures
    const failures = results.filter(r => r.status === 'rejected')
    if (failures.length > 0) {
      console.error('Webhook processing failures:', failures)
    }

    // Always return 200 to acknowledge receipt
    return NextResponse.json({
      received: results.length,
      processed: results.filter(r => r.status === 'fulfilled').length,
      failed: failures.length
    })
  } catch (error) {
    console.error('Mailjet webhook error:', error)
    // Return 200 anyway to prevent Mailjet from retrying
    return NextResponse.json({ error: 'Processing failed but acknowledged' })
  }
}

// Mailjet may also send GET requests for webhook verification
export async function GET(request: NextRequest) {
  return NextResponse.json({ status: 'ok', service: 'mailjet-webhook' })
}

