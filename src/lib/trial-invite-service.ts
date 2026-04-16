/**
 * Trial Invite Campaign Service
 * 
 * Handles:
 * - Campaign management
 * - CSV import and validation
 * - Email-locked ATI token generation
 * - Email sending via Mailjet
 * - Open/click tracking
 * - Webhook processing
 */

import { prisma } from './prisma'
import crypto from 'crypto'
import { TrialInviteStatus, TrialCampaignStatus } from '@prisma/client'

// Types
export interface CampaignCreateInput {
  name: string
  description?: string
  emailSubject?: string
  emailTemplate?: string
  senderName?: string
  replyToEmail?: string
  trialDurationDays?: number
  inviteExpiryDays?: number
  defaultSendTime?: string
  timezone?: string
  maxSignups?: number
  // Trial Plan Limits
  patentDraftLimit?: number
  noveltySearchLimit?: number
  ideationRunLimit?: number
  priorArtSearchLimit?: number
  diagramLimit?: number
  totalTokenBudget?: number
}

export interface InviteImportRow {
  email: string
  firstName?: string
  lastName?: string
  country?: string
  company?: string
  jobTitle?: string
  [key: string]: string | undefined // Allow custom fields
}

export interface ImportResult {
  total: number
  imported: number
  duplicates: number
  invalid: number
  unsubscribed: number
  errors: Array<{ row: number; email: string; reason: string }>
}

export interface SendOptions {
  inviteIds?: string[]
  sendAll?: boolean
  scheduledAt?: Date
}

// Email template variables
const DEFAULT_EMAIL_TEMPLATE = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>You're Invited!</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1a1a2e; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 0 auto; padding: 40px 20px; }
    .header { text-align: center; margin-bottom: 40px; }
    .logo { width: 60px; height: 60px; background: linear-gradient(135deg, #3b82f6, #8b5cf6); border-radius: 16px; margin: 0 auto 20px; }
    h1 { color: #1a1a2e; font-size: 28px; margin: 0 0 10px; }
    .subtitle { color: #64748b; font-size: 16px; }
    .content { background: #f8fafc; border-radius: 16px; padding: 32px; margin-bottom: 32px; }
    .greeting { font-size: 18px; color: #1a1a2e; margin-bottom: 16px; }
    .message { color: #475569; margin-bottom: 24px; }
    .cta-button { display: inline-block; background: linear-gradient(135deg, #3b82f6, #6366f1); color: white !important; text-decoration: none; padding: 16px 32px; border-radius: 12px; font-weight: 600; font-size: 16px; }
    .cta-button:hover { background: linear-gradient(135deg, #2563eb, #4f46e5); }
    .features { margin: 32px 0; }
    .feature { display: flex; align-items: flex-start; margin-bottom: 16px; }
    .feature-icon { width: 24px; height: 24px; background: #dbeafe; border-radius: 6px; margin-right: 12px; flex-shrink: 0; text-align: center; line-height: 24px; }
    .feature-text { color: #475569; font-size: 14px; }
    .expiry-note { background: #fef3c7; border-radius: 8px; padding: 12px 16px; font-size: 13px; color: #92400e; margin-top: 24px; }
    .footer { text-align: center; color: #94a3b8; font-size: 12px; }
    .footer a { color: #64748b; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo"></div>
      <h1>You're Invited! ✨</h1>
      <p class="subtitle">Experience the future of patent drafting</p>
    </div>
    
    <div class="content">
      <p class="greeting">Hi {{firstName}},</p>
      
      <p class="message">
        You've been personally invited to try our AI-powered patent drafting platform. 
        Create professional patent applications with intelligent assistance that understands 
        your technical domain.
      </p>
      
      <div style="text-align: center; margin: 32px 0;">
        <a href="{{inviteLink}}" class="cta-button">Start Your Free Trial →</a>
      </div>
      
      <div class="features">
        <div class="feature">
          <div class="feature-icon">🎯</div>
          <div class="feature-text"><strong>Novelty Search:</strong> AI-powered prior art analysis</div>
        </div>
        <div class="feature">
          <div class="feature-icon">📝</div>
          <div class="feature-text"><strong>Smart Drafting:</strong> Generate claims and specifications</div>
        </div>
        <div class="feature">
          <div class="feature-icon">🔒</div>
          <div class="feature-text"><strong>Secure:</strong> Your data stays private and protected</div>
        </div>
      </div>
      
      <div class="expiry-note">
        ⏰ This invitation expires on <strong>{{expiryDate}}</strong>. Don't miss out!
      </div>
    </div>
    
    <div class="footer">
      <p>This email was sent to {{email}}</p>
      <p>
        <a href="{{unsubscribeLink}}">Unsubscribe</a> · 
        <a href="{{privacyLink}}">Privacy Policy</a>
      </p>
    </div>
  </div>
  
  <!-- Tracking pixel -->
  <img src="{{trackingPixelUrl}}" width="1" height="1" style="display:none;" alt="" />
</body>
</html>
`

/**
 * Generate a unique, email-locked invite token
 */
export function generateInviteToken(): { token: string; hash: string } {
  // Generate a URL-safe random token
  const token = crypto.randomBytes(32).toString('base64url')
  // Hash it for storage
  const hash = crypto.createHash('sha256').update(token).digest('hex')
  return { token, hash }
}

/**
 * Create a new trial campaign
 */
export async function createCampaign(
  input: CampaignCreateInput,
  createdBy: string,
  tenantId: string
): Promise<any> {
  return prisma.trialCampaign.create({
    data: {
      tenantId,
      name: input.name,
      description: input.description,
      emailSubject: input.emailSubject || 'You\'re Invited to Try Our Patent Platform',
      emailTemplate: input.emailTemplate,
      senderName: input.senderName || 'Patent Platform Team',
      replyToEmail: input.replyToEmail,
      trialDurationDays: input.trialDurationDays ?? 14,
      inviteExpiryDays: input.inviteExpiryDays ?? 30,
      defaultSendTime: input.defaultSendTime,
      timezone: input.timezone || 'UTC',
      maxSignups: input.maxSignups,
      // Trial Plan Limits (null = use defaults)
      patentDraftLimit: input.patentDraftLimit,
      noveltySearchLimit: input.noveltySearchLimit,
      ideationRunLimit: input.ideationRunLimit,
      priorArtSearchLimit: input.priorArtSearchLimit,
      diagramLimit: input.diagramLimit,
      totalTokenBudget: input.totalTokenBudget,
      createdBy,
      status: 'DRAFT'
    }
  })
}

/**
 * Import invites from parsed CSV data
 */
export async function importInvites(
  campaignId: string,
  rows: InviteImportRow[]
): Promise<ImportResult> {
  const result: ImportResult = {
    total: rows.length,
    imported: 0,
    duplicates: 0,
    invalid: 0,
    unsubscribed: 0,
    errors: []
  }

  // Get campaign for expiry calculation
  const campaign = await prisma.trialCampaign.findUnique({
    where: { id: campaignId }
  })

  if (!campaign) {
    throw new Error('Campaign not found')
  }

  // Get existing invites for this campaign
  const existingEmails = new Set(
    (await prisma.trialInvite.findMany({
      where: { campaignId },
      select: { email: true }
    })).map(i => i.email.toLowerCase())
  )

  // Get unsubscribed emails
  const unsubscribedEmails = new Set(
    (await prisma.trialUnsubscribe.findMany({
      select: { email: true }
    })).map(u => u.email.toLowerCase())
  )

  // Process each row
  const invitesToCreate: any[] = []
  const expiryDate = new Date()
  expiryDate.setDate(expiryDate.getDate() + campaign.inviteExpiryDays)

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const email = row.email?.trim().toLowerCase()

    // Validate email
    if (!email || !isValidEmail(email)) {
      result.invalid++
      result.errors.push({ row: i + 1, email: email || 'empty', reason: 'Invalid email format' })
      continue
    }

    // Check for duplicates
    if (existingEmails.has(email)) {
      result.duplicates++
      result.errors.push({ row: i + 1, email, reason: 'Already invited in this campaign' })
      continue
    }

    // Check unsubscribe list
    if (unsubscribedEmails.has(email)) {
      result.unsubscribed++
      result.errors.push({ row: i + 1, email, reason: 'Email is unsubscribed' })
      continue
    }

    // Generate unique token for this invite
    const { token, hash } = generateInviteToken()

    // Extract standard and custom fields
    const { email: _, firstName, lastName, country, company, jobTitle, ...customFields } = row

    invitesToCreate.push({
      campaignId,
      email,
      firstName: firstName?.trim() || null,
      lastName: lastName?.trim() || null,
      country: country?.trim() || null,
      company: company?.trim() || null,
      jobTitle: jobTitle?.trim() || null,
      customData: Object.keys(customFields).length > 0 ? customFields : null,
      inviteToken: token,
      inviteTokenHash: hash,
      allowedEmail: email, // Lock token to this email
      tokenExpiresAt: expiryDate,
      status: 'PENDING'
    })

    existingEmails.add(email) // Prevent duplicates within the same import
    result.imported++
  }

  // Bulk create invites
  if (invitesToCreate.length > 0) {
    await prisma.trialInvite.createMany({
      data: invitesToCreate,
      skipDuplicates: true
    })

    // Update campaign stats
    await prisma.trialCampaign.update({
      where: { id: campaignId },
      data: {
        totalInvites: { increment: invitesToCreate.length }
      }
    })
  }

  return result
}

/**
 * Get invites for a campaign with filtering
 */
export async function getInvites(
  campaignId: string,
  options: {
    status?: TrialInviteStatus | TrialInviteStatus[]
    search?: string
    page?: number
    pageSize?: number
  } = {}
) {
  const { status, search, page = 1, pageSize = 50 } = options

  const where: any = { campaignId }

  if (status) {
    where.status = Array.isArray(status) ? { in: status } : status
  }

  if (search) {
    where.OR = [
      { email: { contains: search, mode: 'insensitive' } },
      { firstName: { contains: search, mode: 'insensitive' } },
      { lastName: { contains: search, mode: 'insensitive' } },
      { company: { contains: search, mode: 'insensitive' } }
    ]
  }

  const [invites, total] = await Promise.all([
    prisma.trialInvite.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize
    }),
    prisma.trialInvite.count({ where })
  ])

  return {
    invites,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize)
  }
}

/**
 * Convert plain text email template to styled HTML
 */
function convertTextToHTML(
  text: string,
  inviteLink: string,
  trackingPixelUrl: string,
  unsubscribeLink: string
): string {
  // Escape HTML special characters
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  
  // Convert URLs to clickable links (but not our special links)
  const withLinks = escaped.replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1" style="color: #4F46E5; text-decoration: underline;">$1</a>'
  )
  
  // Convert newlines to <br> for the body
  const withBreaks = withLinks.replace(/\n/g, '<br>\n')
  
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #1F2937; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
    <h1 style="color: white; margin: 0; font-size: 24px;">You're Invited! 🎉</h1>
  </div>
  
  <div style="background: #ffffff; padding: 30px; border: 1px solid #E5E7EB; border-top: none;">
    <div style="font-size: 16px; color: #374151;">
      ${withBreaks}
    </div>
    
    <div style="text-align: center; margin: 30px 0;">
      <a href="${inviteLink}" style="display: inline-block; background: linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%); color: white; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">
        Start Free Trial →
      </a>
    </div>
  </div>
  
  <div style="background: #F9FAFB; padding: 20px; border: 1px solid #E5E7EB; border-top: none; border-radius: 0 0 12px 12px; text-align: center;">
    <p style="font-size: 12px; color: #9CA3AF; margin: 0;">
      <a href="${unsubscribeLink}" style="color: #9CA3AF;">Unsubscribe</a>
    </p>
  </div>
  
  <img src="${trackingPixelUrl}" width="1" height="1" style="display:none;" alt="" />
</body>
</html>`
}

/**
 * Send trial invite emails
 */
export async function sendInvites(
  campaignId: string,
  options: SendOptions
): Promise<{ sent: number; failed: number; scheduled: number; errors: string[] }> {
  const campaign = await prisma.trialCampaign.findUnique({
    where: { id: campaignId }
  })

  if (!campaign) {
    throw new Error('Campaign not found')
  }

  // Build query for invites to send
  const where: any = { campaignId }

  if (options.inviteIds && options.inviteIds.length > 0) {
    where.id = { in: options.inviteIds }
  } else if (!options.sendAll) {
    throw new Error('Must specify inviteIds or sendAll')
  }

  // Only send pending or failed invites
  where.status = { in: ['PENDING', 'FAILED'] }

  const invites = await prisma.trialInvite.findMany({ where })

  const result = {
    sent: 0,
    failed: 0,
    scheduled: 0,
    errors: [] as string[]
  }

  // If scheduling for later
  if (options.scheduledAt && options.scheduledAt > new Date()) {
    await prisma.trialInvite.updateMany({
      where: { id: { in: invites.map(i => i.id) } },
      data: {
        status: 'SCHEDULED',
        scheduledSendAt: options.scheduledAt
      }
    })
    result.scheduled = invites.length
    return result
  }

  // Send immediately
  const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000'
  
  console.log('[Trial Campaign] Starting to send', invites.length, 'invites')
  console.log('[Trial Campaign] Base URL:', baseUrl)
  console.log('[Trial Campaign] MAILJET_TRIAL_EMAIL_KEY exists:', !!process.env.MAILJET_TRIAL_EMAIL_KEY)
  console.log('[Trial Campaign] MAILJET_API_KEY exists:', !!process.env.MAILJET_API_KEY)

  for (const invite of invites) {
    try {
      console.log('[Trial Campaign] Processing invite for:', invite.email)
      
      // Generate tracking URLs
      const inviteLink = `${baseUrl}/register?invite=${invite.inviteToken}&trial=true&email=${encodeURIComponent(invite.email)}`
      const trackingPixelUrl = `${baseUrl}/api/track/open?id=${invite.id}`
      const unsubscribeLink = `${baseUrl}/api/track/unsubscribe?id=${invite.id}`

      // Prepare email content
      const template = campaign.emailTemplate || DEFAULT_EMAIL_TEMPLATE
      let emailBody = template
        .replace(/\{\{firstName\}\}/g, invite.firstName || 'there')
        .replace(/\{\{lastName\}\}/g, invite.lastName || '')
        .replace(/\{\{email\}\}/g, invite.email)
        .replace(/\{\{inviteLink\}\}/g, inviteLink)
        .replace(/\{\{trackingPixelUrl\}\}/g, trackingPixelUrl)
        .replace(/\{\{unsubscribeLink\}\}/g, unsubscribeLink)
        .replace(/\{\{privacyLink\}\}/g, `${baseUrl}/privacy`)
        .replace(/\{\{expiryDate\}\}/g, invite.tokenExpiresAt?.toLocaleDateString() || 'soon')
        .replace(/\{\{company\}\}/g, invite.company || 'your organization')
      
      // Convert plain text to HTML if not already HTML
      const isHTML = /<[a-z][\s\S]*>/i.test(emailBody)
      const htmlContent = isHTML 
        ? emailBody 
        : convertTextToHTML(emailBody, inviteLink, trackingPixelUrl, unsubscribeLink)

      // Send via Mailjet
      const messageId = await sendTrialEmail({
        to: invite.email,
        toName: [invite.firstName, invite.lastName].filter(Boolean).join(' ') || undefined,
        subject: campaign.emailSubject,
        htmlContent,
        senderName: campaign.senderName,
        replyTo: campaign.replyToEmail || undefined,
        customId: invite.id // For webhook correlation
      })

      // Update invite status
      await prisma.trialInvite.update({
        where: { id: invite.id },
        data: {
          status: 'SENT',
          sentAt: new Date(),
          mailjetMessageId: messageId
        }
      })

      // Log event
      await prisma.trialInviteEvent.create({
        data: {
          inviteId: invite.id,
          eventType: 'SENT',
          source: 'system',
          eventData: { messageId }
        }
      })

      result.sent++
      console.log('[Trial Campaign] Successfully sent to:', invite.email)
    } catch (error) {
      console.error('[Trial Campaign] FAILED to send to:', invite.email, error)
      result.failed++
      result.errors.push(`Failed to send to ${invite.email}: ${error instanceof Error ? error.message : 'Unknown error'}`)

      // Update invite status
      await prisma.trialInvite.update({
        where: { id: invite.id },
        data: { status: 'FAILED' }
      })

      // Log event
      await prisma.trialInviteEvent.create({
        data: {
          inviteId: invite.id,
          eventType: 'FAILED',
          source: 'system',
          eventData: { error: error instanceof Error ? error.message : 'Unknown error' }
        }
      })
    }
  }

  // Update campaign stats
  await prisma.trialCampaign.update({
    where: { id: campaignId },
    data: {
      sentCount: { increment: result.sent }
    }
  })

  return result
}

/**
 * Send email via Mailjet - EXACT same implementation as password reset (mailer.ts)
 */
async function sendTrialEmail(params: {
  to: string
  toName?: string
  subject: string
  htmlContent: string
  senderName: string
  senderEmail?: string
  replyTo?: string
  customId?: string
}): Promise<string> {
  // Use trial-specific credentials, or fall back to main Mailjet credentials
  const MAILJET_KEY = process.env.MAILJET_TRIAL_EMAIL_KEY || process.env.MAILJET_API_KEY || ''
  const MAILJET_SECRET = process.env.MAILJET_TRIAL_EMAIL_SECRET || process.env.MAILJET_API_SECRET || ''

  if (!MAILJET_KEY || !MAILJET_SECRET) {
    console.error('[Trial Email] Mailjet keys missing!')
    throw new Error('Mailjet credentials not configured')
  }

  // Sender email: use provided, or env var, or fallback to transactional sender
  const senderEmail = params.senderEmail 
    || process.env.MAILJET_TRIAL_SENDER_EMAIL 
    || 'noreply@patentnest.ai'

  // EXACT same format as password reset mailer.ts
  const auth = Buffer.from(`${MAILJET_KEY}:${MAILJET_SECRET}`).toString('base64')
  
  const body = {
    Messages: [
      {
        From: { Email: senderEmail, Name: params.senderName || 'PatentNest' },
        To: [{ Email: params.to, ...(params.toName ? { Name: params.toName } : {}) }],
        Subject: params.subject,
        HTMLPart: params.htmlContent,
        TextPart: '' // Same as password reset
      }
    ]
  }

  console.log('[Trial Email] Sending to:', params.to, 'Subject:', params.subject)
  console.log('[Trial Email] Using sender:', senderEmail)

  const res = await fetch('https://api.mailjet.com/v3.1/send', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })

  if (!res.ok) {
    const errorText = await res.text().catch(() => '')
    console.error('[Trial Email] Mailjet send failed:', res.status, errorText)
    throw new Error(`Mailjet send failed (${res.status}): ${errorText}`)
  }

  const result = await res.json()
  // MessageID is returned as a number from Mailjet API, convert to string for database storage
  const messageId = String(result.Messages?.[0]?.To?.[0]?.MessageID || 'unknown')
  console.log('[Trial Email] Sent successfully, MessageID:', messageId)
  
  return messageId
}

/**
 * Process Mailjet webhook event
 */
export async function processWebhookEvent(event: {
  event: string
  time: number
  MessageID: number
  CustomID?: string
  email?: string
  error_related_to?: string
  error?: string
  ip?: string
  geo?: string
  agent?: string
  url?: string
}): Promise<void> {
  // Find invite by custom ID or message ID
  let invite = null
  
  if (event.CustomID) {
    invite = await prisma.trialInvite.findUnique({
      where: { id: event.CustomID }
    })
  }
  
  if (!invite && event.MessageID) {
    invite = await prisma.trialInvite.findFirst({
      where: { mailjetMessageId: String(event.MessageID) }
    })
  }

  if (!invite) {
    console.warn('Webhook event for unknown invite:', event)
    return
  }

  const eventType = mapMailjetEvent(event.event)
  const timestamp = new Date(event.time * 1000)

  // Create event log
  await prisma.trialInviteEvent.create({
    data: {
      inviteId: invite.id,
      eventType,
      source: 'mailjet_webhook',
      eventData: event as any,
      ipAddress: event.ip,
      userAgent: event.agent,
      geoCountry: event.geo,
      timestamp
    }
  })

  // Update invite status based on event
  const updateData: any = {
    mailjetStatus: event.event
  }

  switch (event.event) {
    case 'sent':
      // Already handled
      break
    case 'open':
      updateData.status = 'OPENED'
      updateData.openCount = { increment: 1 }
      updateData.lastOpenedAt = timestamp
      if (!invite.firstOpenedAt) {
        updateData.firstOpenedAt = timestamp
      }
      break
    case 'click':
      updateData.status = 'CLICKED'
      updateData.clickCount = { increment: 1 }
      updateData.lastClickedAt = timestamp
      if (!invite.firstClickedAt) {
        updateData.firstClickedAt = timestamp
      }
      break
    case 'bounce':
    case 'blocked':
      updateData.status = 'BOUNCED'
      updateData.bouncedAt = timestamp
      updateData.bounceReason = event.error_related_to || event.error
      break
    case 'unsub':
      updateData.status = 'UNSUBSCRIBED'
      updateData.unsubscribedAt = timestamp
      // Also add to global unsubscribe list
      await prisma.trialUnsubscribe.upsert({
        where: { email: invite.email },
        create: { email: invite.email, source: invite.campaignId },
        update: {}
      })
      break
  }

  await prisma.trialInvite.update({
    where: { id: invite.id },
    data: updateData
  })

  // Update campaign stats - only increment if this is genuinely the first event
  // To avoid double counting from both tracking pixel and webhook, we check
  // the actual current state of the invite after our update
  const updatedInvite = await prisma.trialInvite.findUnique({
    where: { id: invite.id }
  })
  
  const statsUpdate: any = {}
  
  // Only increment if we were the one to set firstOpenedAt (compare timestamps within 1 second tolerance)
  if (event.event === 'open' && updatedInvite?.firstOpenedAt) {
    const timeDiff = Math.abs(updatedInvite.firstOpenedAt.getTime() - timestamp.getTime())
    if (timeDiff < 2000 && !invite.firstOpenedAt) {
      statsUpdate.openedCount = { increment: 1 }
    }
  }
  
  // Same logic for clicks
  if (event.event === 'click' && updatedInvite?.firstClickedAt) {
    const timeDiff = Math.abs(updatedInvite.firstClickedAt.getTime() - timestamp.getTime())
    if (timeDiff < 2000 && !invite.firstClickedAt) {
      statsUpdate.clickedCount = { increment: 1 }
    }
  }
  
  if (event.event === 'bounce' || event.event === 'blocked') {
    // Bounces are unique events, so always increment
    statsUpdate.bouncedCount = { increment: 1 }
  }

  if (Object.keys(statsUpdate).length > 0) {
    await prisma.trialCampaign.update({
      where: { id: invite.campaignId },
      data: statsUpdate
    })
  }
}

/**
 * Record signup from trial invite
 * Uses transaction to prevent race conditions
 */
export async function recordSignup(inviteToken: string, userId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const invite = await prisma.trialInvite.findUnique({
      where: { inviteToken },
      include: { campaign: true }
    })

    if (!invite) {
      console.warn('Signup recorded for unknown invite token')
      return { success: false, error: 'Unknown invite token' }
    }

    // Check if already signed up
    if (invite.status === 'SIGNED_UP') {
      return { success: false, error: 'Invite already used' }
    }

    // Use transaction for atomicity
    await prisma.$transaction(async (tx) => {
      // Re-check campaign limits with lock
      if (invite.campaign.maxSignups) {
        const campaign = await tx.trialCampaign.findUnique({
          where: { id: invite.campaignId }
        })
        
        if (campaign && campaign.signedUpCount >= invite.campaign.maxSignups) {
          throw new Error('Campaign signup limit reached')
        }
      }

      // Update invite
      await tx.trialInvite.update({
        where: { id: invite.id },
        data: {
          status: 'SIGNED_UP',
          signedUpAt: new Date(),
          signedUpUserId: userId
        }
      })

      // Log event
      await tx.trialInviteEvent.create({
        data: {
          inviteId: invite.id,
          eventType: 'SIGNED_UP',
          source: 'signup',
          eventData: { userId }
        }
      })

      // Increment campaign stats atomically
      await tx.trialCampaign.update({
        where: { id: invite.campaignId },
        data: {
          signedUpCount: { increment: 1 }
        }
      })
    })

    return { success: true }
  } catch (error) {
    console.error('Record signup error:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

/**
 * Validate invite token for signup
 */
export async function validateInviteToken(
  token: string,
  email: string
): Promise<{ valid: boolean; error?: string; invite?: any }> {
  const invite = await prisma.trialInvite.findUnique({
    where: { inviteToken: token },
    include: { campaign: true }
  })

  if (!invite) {
    return { valid: false, error: 'Invalid invite token' }
  }

  // Check email match (case-insensitive)
  if (invite.allowedEmail.toLowerCase() !== email.toLowerCase()) {
    return { valid: false, error: 'This invite is for a different email address' }
  }

  // Check expiry
  if (invite.tokenExpiresAt && invite.tokenExpiresAt < new Date()) {
    return { valid: false, error: 'This invite has expired' }
  }

  // Check if already used
  if (invite.status === 'SIGNED_UP') {
    return { valid: false, error: 'This invite has already been used' }
  }

  // Check campaign status
  if (invite.campaign.status !== 'ACTIVE' && invite.campaign.status !== 'DRAFT') {
    return { valid: false, error: 'This campaign is no longer active' }
  }

  // Check campaign max signups (note: actual enforcement with locking happens during signup)
  // This is a soft check - the real check with atomicity happens when recording the signup
  if (invite.campaign.maxSignups && invite.campaign.signedUpCount >= invite.campaign.maxSignups) {
    return { valid: false, error: 'This campaign has reached its signup limit' }
  }

  return { valid: true, invite }
}

/**
 * Resend invite email
 */
export async function resendInvite(
  inviteId: string,
  reason?: string
): Promise<{ success: boolean; error?: string }> {
  const invite = await prisma.trialInvite.findUnique({
    where: { id: inviteId },
    include: { campaign: true }
  })

  if (!invite) {
    return { success: false, error: 'Invite not found' }
  }

  // Check if can resend (limit to 3 resends)
  if (invite.resendCount >= 3) {
    return { success: false, error: 'Maximum resend limit reached (3)' }
  }

  // Regenerate token if expired
  let tokenData = { token: invite.inviteToken, hash: invite.inviteTokenHash }
  let newExpiry = invite.tokenExpiresAt

  if (invite.tokenExpiresAt && invite.tokenExpiresAt < new Date()) {
    tokenData = generateInviteToken()
    newExpiry = new Date()
    newExpiry.setDate(newExpiry.getDate() + invite.campaign.inviteExpiryDays)
  }

  // Update invite for resend
  await prisma.trialInvite.update({
    where: { id: inviteId },
    data: {
      status: 'PENDING',
      inviteToken: tokenData.token,
      inviteTokenHash: tokenData.hash,
      tokenExpiresAt: newExpiry,
      resendCount: { increment: 1 },
      lastResendAt: new Date(),
      resendReason: reason
    }
  })

  // Send the email
  const result = await sendInvites(invite.campaignId, { inviteIds: [inviteId] })

  if (result.sent > 0) {
    return { success: true }
  } else {
    return { success: false, error: result.errors[0] || 'Failed to send' }
  }
}

/**
 * Get campaign analytics
 */
export async function getCampaignAnalytics(campaignId: string) {
  const campaign = await prisma.trialCampaign.findUnique({
    where: { id: campaignId },
    include: {
      invites: {
        select: {
          status: true,
          country: true,
          sentAt: true,
          firstOpenedAt: true,
          firstClickedAt: true,
          signedUpAt: true
        }
      }
    }
  })

  if (!campaign) {
    throw new Error('Campaign not found')
  }

  // Calculate funnel metrics
  const funnel = {
    total: campaign.totalInvites,
    sent: campaign.sentCount,
    delivered: campaign.deliveredCount,
    opened: campaign.openedCount,
    clicked: campaign.clickedCount,
    signedUp: campaign.signedUpCount,
    bounced: campaign.bouncedCount
  }

  // Calculate conversion rates
  const rates = {
    deliveryRate: funnel.sent > 0 ? ((funnel.delivered || funnel.sent - funnel.bounced) / funnel.sent * 100).toFixed(1) : '0',
    openRate: funnel.sent > 0 ? (funnel.opened / funnel.sent * 100).toFixed(1) : '0',
    clickRate: funnel.opened > 0 ? (funnel.clicked / funnel.opened * 100).toFixed(1) : '0',
    signupRate: funnel.clicked > 0 ? (funnel.signedUp / funnel.clicked * 100).toFixed(1) : '0',
    overallConversion: funnel.sent > 0 ? (funnel.signedUp / funnel.sent * 100).toFixed(1) : '0'
  }

  // Group by country
  const byCountry = campaign.invites.reduce((acc: any, inv) => {
    const country = inv.country || 'Unknown'
    if (!acc[country]) {
      acc[country] = { total: 0, signedUp: 0 }
    }
    acc[country].total++
    if (inv.signedUpAt) acc[country].signedUp++
    return acc
  }, {})

  // Status breakdown
  const statusCounts = campaign.invites.reduce((acc: any, inv) => {
    acc[inv.status] = (acc[inv.status] || 0) + 1
    return acc
  }, {})

  return {
    campaign: {
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      createdAt: campaign.createdAt
    },
    funnel,
    rates,
    byCountry,
    statusCounts
  }
}

// Helper functions
function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email)
}

function mapMailjetEvent(event: string): string {
  const mapping: Record<string, string> = {
    'sent': 'SENT',
    'open': 'OPENED',
    'click': 'CLICKED',
    'bounce': 'BOUNCED',
    'blocked': 'BLOCKED',
    'spam': 'SPAM',
    'unsub': 'UNSUBSCRIBED'
  }
  return mapping[event] || event.toUpperCase()
}

/**
 * Process scheduled invites (called by cron job)
 */
export async function processScheduledInvites(): Promise<{ processed: number; errors: number }> {
  const now = new Date()
  
  // Find all campaigns with scheduled invites due
  const scheduledInvites = await prisma.trialInvite.findMany({
    where: {
      status: 'SCHEDULED',
      scheduledSendAt: { lte: now }
    },
    include: { campaign: true }
  })

  let processed = 0
  let errors = 0

  // Group by campaign
  const byCampaign = scheduledInvites.reduce((acc: any, inv) => {
    if (!acc[inv.campaignId]) acc[inv.campaignId] = []
    acc[inv.campaignId].push(inv.id)
    return acc
  }, {})

  for (const [campaignId, inviteIds] of Object.entries(byCampaign)) {
    const result = await sendInvites(campaignId, { inviteIds: inviteIds as string[] })
    processed += result.sent
    errors += result.failed
  }

  return { processed, errors }
}

/**
 * Expire old invites (called by cron job)
 */
export async function expireOldInvites(): Promise<number> {
  const now = new Date()
  
  const result = await prisma.trialInvite.updateMany({
    where: {
      status: { in: ['PENDING', 'SENT', 'DELIVERED', 'OPENED', 'CLICKED'] },
      tokenExpiresAt: { lt: now }
    },
    data: {
      status: 'EXPIRED'
    }
  })

  return result.count
}

