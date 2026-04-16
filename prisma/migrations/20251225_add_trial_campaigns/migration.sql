-- ============================================================================
-- ADD TRIAL CAMPAIGN SYSTEM
-- Tables for managing trial invite campaigns, email tracking, and quotas
-- ============================================================================

-- Create enums for trial campaign status
CREATE TYPE "TrialCampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED');
CREATE TYPE "TrialInviteStatus" AS ENUM ('PENDING', 'SCHEDULED', 'SENDING', 'SENT', 'DELIVERED', 'OPENED', 'CLICKED', 'SIGNED_UP', 'BOUNCED', 'FAILED', 'EXPIRED', 'UNSUBSCRIBED');

-- Create TrialCampaign table
CREATE TABLE "trial_campaigns" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "TrialCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    
    -- Email template settings
    "emailSubject" TEXT NOT NULL DEFAULT 'You''re Invited to Try Our Patent Platform',
    "emailTemplate" TEXT,
    "senderName" TEXT NOT NULL DEFAULT 'Patent Platform Team',
    "replyToEmail" TEXT,
    
    -- Campaign settings
    "trialDurationDays" INTEGER NOT NULL DEFAULT 14,
    "inviteExpiryDays" INTEGER NOT NULL DEFAULT 30,
    "autoExpireInvites" BOOLEAN NOT NULL DEFAULT true,
    
    -- ATI Token settings
    "trialAtiTokenId" TEXT,
    "maxSignups" INTEGER,
    
    -- Trial Plan Limits (per-user limits for this campaign's trial users)
    "patentDraftLimit" INTEGER,
    "noveltySearchLimit" INTEGER,
    "ideationRunLimit" INTEGER,
    "priorArtSearchLimit" INTEGER,
    "diagramLimit" INTEGER,
    "totalTokenBudget" INTEGER,
    
    -- Scheduling
    "defaultSendTime" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    
    -- Stats (denormalized for quick access)
    "totalInvites" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "deliveredCount" INTEGER NOT NULL DEFAULT 0,
    "openedCount" INTEGER NOT NULL DEFAULT 0,
    "clickedCount" INTEGER NOT NULL DEFAULT 0,
    "signedUpCount" INTEGER NOT NULL DEFAULT 0,
    "bouncedCount" INTEGER NOT NULL DEFAULT 0,
    
    -- Metadata
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trial_campaigns_pkey" PRIMARY KEY ("id")
);

-- Create TrialInvite table
CREATE TABLE "trial_invites" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    
    -- Recipient info
    "email" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "country" TEXT,
    "company" TEXT,
    "jobTitle" TEXT,
    "customData" JSONB,
    
    -- Invite status
    "status" "TrialInviteStatus" NOT NULL DEFAULT 'PENDING',
    
    -- Email-locked ATI token
    "inviteToken" TEXT NOT NULL,
    "inviteTokenHash" TEXT NOT NULL,
    "allowedEmail" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3),
    
    -- Scheduling
    "scheduledSendAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    
    -- Tracking
    "deliveredAt" TIMESTAMP(3),
    "firstOpenedAt" TIMESTAMP(3),
    "lastOpenedAt" TIMESTAMP(3),
    "openCount" INTEGER NOT NULL DEFAULT 0,
    "firstClickedAt" TIMESTAMP(3),
    "lastClickedAt" TIMESTAMP(3),
    "clickCount" INTEGER NOT NULL DEFAULT 0,
    "signedUpAt" TIMESTAMP(3),
    "signedUpUserId" TEXT,
    "bouncedAt" TIMESTAMP(3),
    "bounceReason" TEXT,
    "unsubscribedAt" TIMESTAMP(3),
    
    -- Email provider tracking
    "mailjetMessageId" TEXT,
    "mailjetStatus" TEXT,
    
    -- Resend tracking
    "resendCount" INTEGER NOT NULL DEFAULT 0,
    "lastResendAt" TIMESTAMP(3),
    "resendReason" TEXT,
    
    -- Metadata
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trial_invites_pkey" PRIMARY KEY ("id")
);

-- Create TrialInviteEvent table (detailed event log)
CREATE TABLE "trial_invite_events" (
    "id" TEXT NOT NULL,
    "inviteId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "eventData" JSONB,
    "source" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "geoCountry" TEXT,
    "geoCity" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trial_invite_events_pkey" PRIMARY KEY ("id")
);

-- Create TrialUnsubscribe table (global unsubscribe list)
CREATE TABLE "trial_unsubscribes" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "unsubscribedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT,

    CONSTRAINT "trial_unsubscribes_pkey" PRIMARY KEY ("id")
);

-- Create TrialEmailTemplate table
CREATE TABLE "trial_email_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "subject" TEXT NOT NULL,
    "htmlContent" TEXT NOT NULL,
    "textContent" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trial_email_templates_pkey" PRIMARY KEY ("id")
);

-- Create unique constraints
ALTER TABLE "trial_invites" ADD CONSTRAINT "trial_invites_inviteToken_key" UNIQUE ("inviteToken");
ALTER TABLE "trial_invites" ADD CONSTRAINT "trial_invites_inviteTokenHash_key" UNIQUE ("inviteTokenHash");
ALTER TABLE "trial_invites" ADD CONSTRAINT "trial_invites_campaignId_email_key" UNIQUE ("campaignId", "email");
ALTER TABLE "trial_unsubscribes" ADD CONSTRAINT "trial_unsubscribes_email_key" UNIQUE ("email");

-- Create indexes for performance
CREATE INDEX "trial_campaigns_tenantId_idx" ON "trial_campaigns"("tenantId");
CREATE INDEX "trial_campaigns_status_idx" ON "trial_campaigns"("status");
CREATE INDEX "trial_campaigns_createdAt_idx" ON "trial_campaigns"("createdAt");

CREATE INDEX "trial_invites_campaignId_idx" ON "trial_invites"("campaignId");
CREATE INDEX "trial_invites_email_idx" ON "trial_invites"("email");
CREATE INDEX "trial_invites_status_idx" ON "trial_invites"("status");
CREATE INDEX "trial_invites_scheduledSendAt_idx" ON "trial_invites"("scheduledSendAt");
CREATE INDEX "trial_invites_inviteToken_idx" ON "trial_invites"("inviteToken");
CREATE INDEX "trial_invites_mailjetMessageId_idx" ON "trial_invites"("mailjetMessageId");
CREATE INDEX "trial_invites_tokenExpiresAt_idx" ON "trial_invites"("tokenExpiresAt");
CREATE INDEX "trial_invites_signedUpUserId_idx" ON "trial_invites"("signedUpUserId");

CREATE INDEX "trial_invite_events_inviteId_idx" ON "trial_invite_events"("inviteId");
CREATE INDEX "trial_invite_events_eventType_idx" ON "trial_invite_events"("eventType");
CREATE INDEX "trial_invite_events_timestamp_idx" ON "trial_invite_events"("timestamp");

-- Add foreign key constraints
ALTER TABLE "trial_campaigns" ADD CONSTRAINT "trial_campaigns_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "trial_invites" ADD CONSTRAINT "trial_invites_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "trial_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "trial_invite_events" ADD CONSTRAINT "trial_invite_events_inviteId_fkey" FOREIGN KEY ("inviteId") REFERENCES "trial_invites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
