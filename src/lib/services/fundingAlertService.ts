import prisma from '../prisma';
import { Prisma } from '../prisma-generated';
import { EmailDeliveryError, sendEmail, SITE_URL } from '../mailer';
import { CALL_ENTRY_DEADLINE_SELECT, callEntryClosed, callEntryDeadline, type CallEntryDates } from '../funding/callDeadline';
import { openCallSql } from '../fundingDept/callSql';
import { DEFAULT_TIMEZONE } from '../i18n/format';
import { fundingOpportunityTemplate, fundingAlertDigestTemplate } from '../email-templates';
import { filterTenantsWithFeature } from '../entitlement-service';
import { matchedAlertKeywords } from '../funding/alertKeywordBoost';
import {
  ELIGIBILITY_DIMENSIONS,
  applicantGeographyFromProfile,
  dimensionFromRow,
  eligibilityVerdictForRow,
} from '../funding/eligibility';
import { snapshotFundingOpportunity } from '../fundingDept/opportunitySnapshot';
import type { ResearcherSearchResult } from './researcherSearchService';
import { researcherSearchService } from './researcherSearchService';
import { formatDeadlineDate } from '../i18n/format';
import { getTenantLocale } from '../tenant/locale';

/**
 * Funding opportunity alerts.
 *
 * When a funding call is published, this service matches it against every
 * researcher's profile, saved research areas (use_for_alerts) and tagged
 * publications using the same embedding search the admin matching screen
 * uses, then notifies the matched researchers in-app and by email.
 *
 * Alerts are a separately sold service: delivery is plan-gated on the
 * FUNDING_ALERTS feature code. A matched user only receives an alert when
 * their tenant's active plan includes FUNDING_ALERTS — institutional tenants
 * get it through their plan, individual paying customers through the plan on
 * their INDIVIDUAL tenant (customer-subscription-service). Unentitled matches
 * are skipped entirely (no alert row), and queued digest alerts whose tenant
 * has since lost the feature are closed out at digest time.
 *
 * Delivery is preference-aware (ResearcherNotificationPreference):
 *  - in_app_enabled  -> Notification row (bell + /notifications)
 *  - email_enabled + frequency 'instant' -> one email per matched call
 *  - email_enabled + 'daily'/'weekly'    -> alert queued; the digest job
 *    bundles queued alerts into a single email per user.
 * A user with no preference row gets in-app + instant email (opt-out model).
 *
 * Idempotency: one FundingCallAlert row per (call, user) with a unique key,
 * so the publish hook and the healing sweep can both run without
 * double-alerting. The call itself is stamped with metadata
 * alerts_dispatched_at so the sweep does not rescan calls with no matches.
 */

export type FundingAlertTier = 'strong' | 'moderate' | 'weak';

const TIER_RANK: Record<FundingAlertTier, number> = { strong: 3, moderate: 2, weak: 1 };

/**
 * Recipients per tenant per call (the search clamps to 50, and with the
 * reranker on only its 40-person window clears the relevance gate).
 */
const MAX_ALERT_RECIPIENTS_PER_TENANT = 50;
/** Pause between instant emails so the mail provider is not burst-hit. */
const EMAIL_DELAY_MS = 250;
/** Instant and digest emails give up after this many definite failures. */
const EMAIL_MAX_ATTEMPTS = 5;
/** First retry delay for a definite failure; doubles each attempt. */
const EMAIL_RETRY_BASE_MS = 5 * 60_000;
/** A row still "sending" after this died mid-send; it becomes "uncertain". */
const EMAIL_SENDING_LEASE_MS = 10 * 60_000;
/** A row still "pending" after this was interrupted before delivery; resume it. */
const ALERT_RESUME_AFTER_MS = 10 * 60_000;
const NOTIFICATION_CATEGORY = 'FUNDING_MATCH';
/** Plan feature that sells alert delivery (see access/modules.ts FUNDING_ALERTS). */
const ALERTS_FEATURE_CODE = 'FUNDING_ALERTS';

export interface FundingAlertDispatchResult {
  fundingCallId: string;
  dispatched: boolean;
  reason?: string;
  matched: number;
  alerted: number;
  inAppCreated: number;
  emailsSent: number;
  emailsQueued: number;
  emailsFailed: number;
  skippedExisting: number;
  /** Matches dropped because the user's tenant plan lacks FUNDING_ALERTS. */
  skippedUnentitled: number;
  /** Matches dropped because the call's stated eligibility rules out the researcher's countries. */
  skippedIneligible: number;
  /** Tenants searched for this call (each entitled tenant separately for a global call). */
  tenantsSearched: number;
}

export interface FundingAlertDigestResult {
  frequency: 'daily' | 'weekly';
  usersConsidered: number;
  emailsSent: number;
  emailsFailed: number;
  alertsCovered: number;
}

interface AlertPreferences {
  inAppEnabled: boolean;
  emailEnabled: boolean;
  emailAddress: string | null;
  frequency: 'instant' | 'daily' | 'weekly';
}

const DEFAULT_PREFERENCES: AlertPreferences = {
  inAppEnabled: true,
  emailEnabled: true,
  emailAddress: null,
  frequency: 'instant',
};

function minAlertTier(): FundingAlertTier {
  const configured = String(process.env.FUNDING_ALERT_MIN_TIER || '').toLowerCase();
  return configured === 'strong' || configured === 'weak' ? configured : 'moderate';
}

function meetsTier(tier: string): boolean {
  const rank = TIER_RANK[tier as FundingAlertTier] || 0;
  return rank >= TIER_RANK[minAlertTier()];
}

function toPreferences(record: {
  in_app_enabled: boolean;
  email_enabled: boolean;
  email_address: string | null;
  notification_frequency: string;
  /**
   * Required in the type (though unused here) so every select feeding this
   * function is forced to fetch it — the dispatch path reads it for the
   * keyword boost, and a select that forgets it would otherwise fail silently.
   */
  alert_keywords: string[];
} | undefined): AlertPreferences {
  if (!record) {
    return DEFAULT_PREFERENCES;
  }
  const frequency =
    record.notification_frequency === 'daily' || record.notification_frequency === 'weekly'
      ? record.notification_frequency
      : 'instant';
  return {
    inAppEnabled: record.in_app_enabled !== false,
    emailEnabled: record.email_enabled !== false,
    emailAddress: (record.email_address || '').trim() || null,
    frequency,
  };
}

type AlertableCall = {
  /** SUPPRESSED (e.g. bulk-imported calls) is never alertable, not even with force. */
  notification_policy?: string | null;
  id: string;
  tenantId: string | null;
  visibility: string;
  status: string;
  catalog_status: string | null;
  is_active: boolean | null;
  title: string;
  scheme_title: string | null;
  summary: string | null;
  description: string | null;
  disciplines: string[];
  agency_name: string | null;
  agencyName: string | null;
  close_date: Date | null;
  deadlineAt: Date | null;
  expiration_date: Date | null;
  amount_min: number | null;
  amount_max: number | null;
  currency: string | null;
  metadata: unknown;
} & CallEntryDates;

const CALL_SELECT = {
  ...CALL_ENTRY_DEADLINE_SELECT,
  id: true,
  tenantId: true,
  visibility: true,
  status: true,
  catalog_status: true,
  is_active: true,
  title: true,
  scheme_title: true,
  summary: true,
  description: true,
  disciplines: true,
  agency_name: true,
  agencyName: true,
  close_date: true,
  deadlineAt: true,
  expiration_date: true,
  amount_min: true,
  amount_max: true,
  currency: true,
  metadata: true,
  notification_policy: true,
  applicant_scope: true,
  applicant_country_codes: true,
  applicant_excluded_codes: true,
  applicant_region_codes: true,
  residence_scope: true,
  residence_country_codes: true,
  residence_excluded_codes: true,
  residence_region_codes: true,
  citizenship_scope: true,
  citizenship_country_codes: true,
  citizenship_excluded_codes: true,
  citizenship_region_codes: true,
  host_scope: true,
  host_country_codes: true,
  host_excluded_codes: true,
  host_region_codes: true,
} as const;

function callTitle(call: AlertableCall): string {
  return (call.scheme_title || call.title || 'Funding opportunity').trim();
}

function callAgency(call: AlertableCall): string | null {
  return (call.agency_name || call.agencyName || '').trim() || null;
}

/** The entry deadline every department report uses (entry date, source closure, funder zone). */
function callDeadline(call: AlertableCall): Date | null {
  return callEntryDeadline(call) || call.expiration_date || null;
}

function callAmountLabel(call: AlertableCall): string | null {
  const format = (value: number) => {
    try {
      return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
    } catch {
      return String(value);
    }
  };
  const currency = call.currency ? `${call.currency} ` : '';
  if (call.amount_min && call.amount_max && call.amount_max !== call.amount_min) {
    return `${currency}${format(call.amount_min)} – ${format(call.amount_max)}`;
  }
  const single = call.amount_max || call.amount_min;
  return single ? `${currency}${format(single)}` : null;
}

function isAlertable(call: AlertableCall): { ok: boolean; reason?: string } {
  const published = call.catalog_status === 'PUBLISHED' || call.status === 'PUBLISHED';
  if (!published) {
    return { ok: false, reason: 'not_published' };
  }
  if (call.is_active === false) {
    return { ok: false, reason: 'inactive' };
  }
  // The shared entry-deadline rule, so an imported call closed by its entry
  // date or its source is not alerted while reports already call it closed.
  if (callEntryClosed(call, new Date()) || (call.expiration_date && call.expiration_date.getTime() < Date.now())) {
    return { ok: false, reason: 'expired' };
  }
  return { ok: true };
}

/**
 * "October 16, 2026". A date-only deadline keeps its date whatever zone the
 * server runs in; an instant is read in the recipient's organization zone.
 */
function formatDeadline(value: Date | null, timeZone?: string): string | null {
  return formatDeadlineDate(value, { timeZone, locale: 'en-US', month: 'long' });
}

function notificationBody(call: AlertableCall, matchReason: string | null, timeZone?: string): string {
  const parts: string[] = [];
  const agency = callAgency(call);
  if (agency) {
    parts.push(agency);
  }
  const deadline = formatDeadline(callDeadline(call), timeZone);
  if (deadline) {
    parts.push(`Deadline ${deadline}`);
  }
  if (matchReason) {
    parts.push(matchReason);
  }
  return parts.join(' · ');
}

type AlertRecipient = { id: string; email: string; name: string | null; tenantId: string | null };

/** One claimed alert and everything needed to deliver its channels. */
type AlertDelivery = {
  alertId: string;
  call: AlertableCall;
  user: AlertRecipient;
  preferences: AlertPreferences;
  matchReason: string | null;
  matchTier: string | null;
  recipientZone: string;
};

/**
 * The bell entry. The conditional claim and the notification commit together,
 * so a resumed or concurrent delivery can never create a second one.
 */
async function deliverInApp(delivery: AlertDelivery): Promise<boolean> {
  const { alertId, call, user } = delivery;
  if (!user.tenantId) {
    return false;
  }
  try {
    return await prisma.$transaction(async (tx) => {
      const claimed = await tx.fundingCallAlert.updateMany({
        where: { id: alertId, in_app_status: 'pending' },
        data: { in_app_status: 'created' },
      });
      if (claimed.count === 0) {
        return false;
      }
      await tx.notification.create({
        data: {
          tenant_id: user.tenantId!,
          user_id: user.id,
          title: `New funding match: ${callTitle(call).slice(0, 120)}`,
          body: notificationBody(call, delivery.matchReason, delivery.recipientZone) || null,
          category: NOTIFICATION_CATEGORY,
          link_url: `/finder/calls/${encodeURIComponent(call.id)}`,
        },
      });
      return true;
    });
  } catch (error) {
    await prisma.fundingCallAlert
      .updateMany({ where: { id: alertId, in_app_status: 'pending' }, data: { in_app_status: 'failed' } })
      .catch(() => undefined);
    console.warn(
      `[FUNDING-ALERT] In-app notification failed for user ${user.id}:`,
      error instanceof Error ? error.message : String(error)
    );
    return false;
  }
}

type EmailOutcome = 'sent' | 'skipped' | 'failed' | 'uncertain' | 'not_claimed';

/**
 * One instant email, claimed before sending. While a row is "sending",
 * email_retry_at is its lease: a row still sending after it died mid-send and
 * becomes "uncertain" rather than being sent twice. A definite failure is
 * retried with a doubling delay; a rejection or an uncertain outcome is not.
 */
async function deliverInstantEmail(delivery: AlertDelivery, priorAttempts = 0): Promise<EmailOutcome> {
  const { alertId, call, user, preferences } = delivery;
  const now = new Date();
  const claimed = await prisma.fundingCallAlert.updateMany({
    where: {
      id: alertId,
      OR: [
        { email_status: 'pending' },
        { email_status: 'failed', email_retry_at: { lte: now }, email_attempts: { lt: EMAIL_MAX_ATTEMPTS } },
      ],
    },
    data: {
      email_status: 'sending',
      email_attempts: { increment: 1 },
      email_retry_at: new Date(now.getTime() + EMAIL_SENDING_LEASE_MS),
    },
  });
  if (claimed.count === 0) {
    return 'not_claimed';
  }

  const attempt = priorAttempts + 1;
  const to = preferences.emailAddress || user.email;
  const template = fundingOpportunityTemplate({
    email: to,
    name: user.name,
    callTitle: callTitle(call),
    agency: callAgency(call),
    deadline: formatDeadline(callDeadline(call), delivery.recipientZone),
    amount: callAmountLabel(call),
    matchReason: delivery.matchReason,
    matchTier: delivery.matchTier || 'moderate',
    callUrl: `${SITE_URL}/finder/calls/${encodeURIComponent(call.id)}`,
  });
  try {
    const sent = await sendEmail({ to, toName: user.name || undefined, ...template });
    if (sent && (sent as { sent?: boolean }).sent === false) {
      // No mail provider configured: nothing left the building, so do not
      // record it as delivered.
      await prisma.fundingCallAlert.update({
        where: { id: alertId },
        data: { email_status: 'skipped', email_error: 'Email delivery is not configured', email_retry_at: null },
      });
      return 'skipped';
    }
    await prisma.fundingCallAlert.update({
      where: { id: alertId },
      data: { email_status: 'sent', emailed_at: new Date(), email_error: null, email_retry_at: null },
    });
    return 'sent';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const kind = error instanceof EmailDeliveryError ? error.kind : 'retryable';
    console.warn(`[FUNDING-ALERT] Email failed for ${to} (${kind}):`, message);
    if (kind === 'uncertain') {
      await prisma.fundingCallAlert.update({
        where: { id: alertId },
        data: { email_status: 'uncertain', email_error: message, email_retry_at: null },
      });
      return 'uncertain';
    }
    const retryAt = kind === 'retryable' && attempt < EMAIL_MAX_ATTEMPTS
      ? new Date(Date.now() + EMAIL_RETRY_BASE_MS * 2 ** (attempt - 1))
      : null;
    await prisma.fundingCallAlert.update({
      where: { id: alertId },
      data: { email_status: 'failed', email_error: message, email_retry_at: retryAt },
    });
    return 'failed';
  }
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: string }).code === 'P2002');
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asMetadataObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

type AlertCandidate = ResearcherSearchResult & { scoreBasis: string };

/**
 * Who could be alerted about a call.
 *
 * A tenant-private call searches its own tenant. A global call searches each
 * tenant that has researchers and the FUNDING_ALERTS feature separately: one
 * platform-wide search keeps only the reranker's window (40 people) across
 * ALL tenants, so one large tenant could take every slot and the rest would
 * never hear of the call. These per-tenant searches are not recorded as DSR
 * matching runs.
 */
async function findAlertCandidates(
  call: AlertableCall
): Promise<{ candidates: AlertCandidate[]; tenantsSearched: number; entitledTenants: number }> {
  if (call.visibility === 'TENANT_PRIVATE' && call.tenantId) {
    const search = await researcherSearchService.search({
      fundingCallId: call.id,
      limit: MAX_ALERT_RECIPIENTS_PER_TENANT,
      requesterTenantId: call.tenantId,
      filters: { includeSelf: true, tenantOnly: true },
    });
    return {
      candidates: search.results.map((match) => ({ ...match, scoreBasis: search.scoreBasis })),
      tenantsSearched: 1,
      entitledTenants: 1,
    };
  }

  const tenantRows = await prisma.$queryRaw<Array<{ tenantId: string }>>`
    SELECT DISTINCT u."tenantId" AS "tenantId"
    FROM researcher_profiles rp
    JOIN users u ON u.id = rp.user_id
    WHERE u."tenantId" IS NOT NULL AND u.status = 'ACTIVE'
    ORDER BY u."tenantId"
  `;
  const tenantIds = tenantRows.map((row) => row.tenantId);
  const entitled = tenantIds.length > 0 ? await filterTenantsWithFeature(tenantIds, ALERTS_FEATURE_CODE) : new Set<string>();
  const candidates: AlertCandidate[] = [];
  const seen = new Set<string>();
  let tenantsSearched = 0;
  for (const tenantId of tenantIds.filter((id) => entitled.has(id))) {
    tenantsSearched += 1;
    const search = await researcherSearchService.search({
      fundingCallId: call.id,
      limit: MAX_ALERT_RECIPIENTS_PER_TENANT,
      requesterTenantId: tenantId,
      recordRun: false,
      filters: { includeSelf: true, tenantOnly: true },
    });
    for (const match of search.results) {
      if (seen.has(match.userId)) continue;
      seen.add(match.userId);
      candidates.push({ ...match, scoreBasis: search.scoreBasis });
    }
  }
  return { candidates, tenantsSearched, entitledTenants: entitled.size };
}

/**
 * Researchers a call's stated eligibility rules out.
 *
 * Only an explicit INELIGIBLE verdict drops someone. A call with no evaluated
 * dimension (every curated call until the backfill links them) and a
 * researcher with no country on their profile are treated exactly as before.
 * Profiles hold country names; they are resolved to ISO codes here.
 */
async function ineligibleUserIds(call: AlertableCall, userIds: string[]): Promise<Set<string>> {
  const ruledOut = new Set<string>();
  const row = call as unknown as Record<string, unknown>;
  if (userIds.length === 0 || ELIGIBILITY_DIMENSIONS.every((key) => !dimensionFromRow(row, key).scope)) {
    return ruledOut;
  }
  const profiles = await prisma.researcherProfile.findMany({
    where: { user_id: { in: userIds } },
    select: { user_id: true, country_of_residence: true, citizenship_countries: true },
  });
  for (const profile of profiles) {
    const applicant = applicantGeographyFromProfile({
      countryOfResidence: profile.country_of_residence,
      citizenshipCountries: profile.citizenship_countries,
    });
    if (eligibilityVerdictForRow(row, applicant) === 'INELIGIBLE') {
      ruledOut.add(profile.user_id);
    }
  }
  return ruledOut;
}

async function stampDispatched(call: AlertableCall, summary: FundingAlertDispatchResult) {
  const metadata: Record<string, unknown> = {};
  metadata.alerts_dispatched_at = new Date().toISOString();
  metadata.alerts_summary = {
    matched: summary.matched,
    alerted: summary.alerted,
    emails_sent: summary.emailsSent,
    emails_queued: summary.emailsQueued,
    // Matches withheld for lack of the FUNDING_ALERTS plan feature. The stamp
    // stops the sweep re-scanning this call, so if a tenant subscribes later
    // these matches are not retried — re-dispatch with { force: true } to
    // deliver them.
    unentitled: summary.skippedUnentitled,
    ineligible: summary.skippedIneligible,
    tenants_searched: summary.tenantsSearched,
  };
  // Merged in the database, not read-modify-written from the snapshot loaded
  // at the start of dispatch: anything else written to the call's metadata
  // while alerts were going out must survive the stamp.
  await prisma.$executeRaw(Prisma.sql`
    UPDATE funding_calls SET metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify(metadata)}::jsonb
     WHERE id = ${call.id}`);
}

export class FundingAlertService {
  /**
   * Match a published call against researcher embeddings and alert everyone
   * above the tier gate who has not already been alerted for this call.
   */
  async dispatchAlertsForFundingCall(
    fundingCallId: string,
    options: { force?: boolean } = {}
  ): Promise<FundingAlertDispatchResult> {
    const result: FundingAlertDispatchResult = {
      fundingCallId,
      dispatched: false,
      matched: 0,
      alerted: 0,
      inAppCreated: 0,
      emailsSent: 0,
      emailsQueued: 0,
      emailsFailed: 0,
      skippedExisting: 0,
      skippedUnentitled: 0,
      skippedIneligible: 0,
      tenantsSearched: 0,
    };

    const call = (await prisma.fundingCall.findUnique({
      where: { id: fundingCallId },
      select: CALL_SELECT,
    })) as AlertableCall | null;

    if (!call) {
      result.reason = 'not_found';
      return result;
    }

    // A suppressed call (bulk catalogue import) never alerts, whatever the
    // caller asked: the policy lives on the call so every path honours it.
    // OFFICERS_ONLY (a catalogue call promoted to the funding department
    // without researcher alerts) tells officers, never researchers.
    if (call.notification_policy === 'SUPPRESSED' || call.notification_policy === 'OFFICERS_ONLY') {
      result.reason = 'notifications_suppressed';
      return result;
    }

    const alertable = isAlertable(call);
    if (!alertable.ok && !options.force) {
      result.reason = alertable.reason;
      return result;
    }

    // Same embedding search the researcher-matching screen uses: profile,
    // saved research areas flagged for alerts, and tagged publications.
    const { candidates, tenantsSearched, entitledTenants: entitledTenantCount } = await findAlertCandidates(call);
    result.tenantsSearched = tenantsSearched;
    if (entitledTenantCount === 0) {
      // No tenant with researchers buys alerts: nothing to search or send.
      result.dispatched = true;
      result.reason = 'no_entitled_tenants';
      await stampDispatched(call, result);
      return result;
    }

    // Preferences are fetched before the tier filter (not after, with the
    // other batch loads) because a user's saved alert keywords can rescue a
    // weak match: a call whose text hits one of them is promoted to moderate.
    const preferenceRows = await prisma.researcherNotificationPreference.findMany({
      where: { user_id: { in: candidates.map((match) => match.userId) } },
      select: {
        user_id: true,
        in_app_enabled: true,
        email_enabled: true,
        email_address: true,
        notification_frequency: true,
        alert_keywords: true,
      },
    });
    const preferenceRowByUser = new Map(preferenceRows.map((row) => [row.user_id, row]));

    const callText = {
      title: call.title,
      schemeTitle: call.scheme_title,
      summary: call.summary,
      description: call.description,
      disciplines: call.disciplines,
    };
    const tiered = candidates
      .map((match) => {
        if (match.matchTier !== 'weak') {
          return match;
        }
        const keywords = preferenceRowByUser.get(match.userId)?.alert_keywords ?? [];
        const hits = matchedAlertKeywords(callText, keywords);
        if (hits.length === 0) {
          return match;
        }
        // Boosted tier and augmented reason are stored on the alert row, so
        // "why did I get this?" stays honest about the keyword rescue.
        return {
          ...match,
          matchTier: 'moderate' as const,
          matchReason: [
            match.matchReason,
            `Matches your alert keyword${hits.length > 1 ? 's' : ''}: ${hits.slice(0, 3).join(', ')}`,
          ]
            .filter(Boolean)
            .join(' · '),
        };
      })
      .filter((match) => meetsTier(match.matchTier));
    result.matched = tiered.length;

    const ineligible = await ineligibleUserIds(call, tiered.map((match) => match.userId));
    const matches = tiered.filter((match) => !ineligible.has(match.userId));
    result.skippedIneligible = tiered.length - matches.length;

    if (matches.length === 0) {
      result.dispatched = true;
      result.reason = 'no_matches';
      await stampDispatched(call, result);
      return result;
    }

    const matchedIds = matches.map((match) => match.userId);
    const [existingAlerts, users] = await Promise.all([
      prisma.fundingCallAlert.findMany({
        where: { funding_call_id: fundingCallId, user_id: { in: matchedIds } },
        select: { user_id: true },
      }),
      prisma.user.findMany({
        where: { id: { in: matchedIds }, status: 'ACTIVE' },
        select: { id: true, email: true, name: true, tenantId: true },
      }),
    ]);

    const alreadyAlerted = new Set(existingAlerts.map((alert) => alert.user_id));
    const userById = new Map(users.map((user) => [user.id, user]));
    const preferencesByUser = new Map(preferenceRows.map((row) => [row.user_id, toPreferences(row)]));

    // Alert delivery is a paid service: only tenants whose active plan includes
    // FUNDING_ALERTS receive anything. Tenantless accounts have no plan and are
    // therefore never alerted.
    const entitledTenants = await filterTenantsWithFeature(
      users.map((user) => user.tenantId),
      ALERTS_FEATURE_CODE
    );

    for (const match of matches) {
      if (alreadyAlerted.has(match.userId)) {
        result.skippedExisting += 1;
        continue;
      }
      const user = userById.get(match.userId);
      if (!user) {
        continue;
      }
      if (!user.tenantId || !entitledTenants.has(user.tenantId)) {
        result.skippedUnentitled += 1;
        continue;
      }
      const preferences = preferencesByUser.get(match.userId) || DEFAULT_PREFERENCES;
      // Notification rows require a tenant, so tenantless accounts are email-only.
      const inAppWanted = preferences.inAppEnabled && Boolean(user.tenantId);
      const instantEmail = preferences.emailEnabled && preferences.frequency === 'instant';

      // Claim the (call, user) pair first — the unique key makes concurrent
      // dispatches collapse into one alert. Channels still to deliver start
      // "pending", so a crash before delivery is resumed by the healing sweep
      // instead of reading as a deliberate skip.
      let alertId: string;
      try {
        const alert = await prisma.fundingCallAlert.create({
          data: {
            funding_call_id: call.id,
            user_id: user.id,
            tenant_id: user.tenantId,
            match_score: match.score,
            match_tier: match.matchTier,
            score_basis: match.scoreBasis,
            matched_sources: match.matchedSources,
            match_reason: match.matchReason || null,
            in_app_status: inAppWanted ? 'pending' : 'skipped',
            email_status: !preferences.emailEnabled ? 'skipped' : instantEmail ? 'pending' : 'queued',
          },
          select: { id: true },
        });
        alertId = alert.id;
        // Alert delivery remains available if the reporting projection is
        // temporarily unavailable; the alert row itself is dated evidence and
        // the reporting backfill can reconstruct it without inventing history.
        await snapshotFundingOpportunity({
          tenantId: user.tenantId,
          fundingCallId: call.id,
          userId: user.id,
          score: match.score,
          tier: match.matchTier,
          reason: match.matchReason || null,
          source: 'alert',
          sourceVersion: 'funding-alert-v1',
        }).catch((snapshotError) => {
          console.warn('Could not persist the funding opportunity snapshot.', snapshotError);
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          result.skippedExisting += 1;
          continue;
        }
        throw error;
      }

      result.alerted += 1;
      const delivery: AlertDelivery = {
        alertId,
        call,
        user,
        preferences,
        matchReason: match.matchReason || null,
        matchTier: match.matchTier,
        recipientZone: (await getTenantLocale(user.tenantId)).timezone,
      };
      if (inAppWanted && await deliverInApp(delivery)) {
        result.inAppCreated += 1;
      }
      if (preferences.emailEnabled && !instantEmail) {
        result.emailsQueued += 1;
      }
      if (instantEmail) {
        const outcome = await deliverInstantEmail(delivery);
        if (outcome === 'sent') result.emailsSent += 1;
        if (outcome === 'failed' || outcome === 'uncertain') result.emailsFailed += 1;
        await sleep(EMAIL_DELAY_MS);
      }
    }

    result.dispatched = true;
    if (result.alerted === 0 && result.skippedUnentitled > 0 && result.skippedExisting === 0) {
      result.reason = 'no_entitled_matches';
    }
    await stampDispatched(call, result);
    return result;
  }

  /**
   * Healing sweep: dispatch alerts for published, active, unexpired calls
   * that have never been through dispatch (no metadata stamp). Covers any
   * publish path that lacks the inline hook, and calls published while the
   * app was down.
   */
  async sweepPendingFundingCallAlerts(options: { limit?: number } = {}) {
    const limit = Math.max(1, Math.min(Number(options.limit || 25), 100));
    // Open by the shared entry-deadline rule (entry date, source closure,
    // funder zone), the same one every department report uses.
    const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT fc.id
      FROM funding_calls fc
      WHERE (fc.catalog_status::text = 'PUBLISHED' OR fc.status::text = 'PUBLISHED')
        AND COALESCE(fc.is_active, true) = true
        AND COALESCE(fc.metadata ->> 'alerts_dispatched_at', '') = ''
        AND COALESCE(fc.notification_policy, 'NORMAL') NOT IN ('SUPPRESSED', 'OFFICERS_ONLY')
        AND ${openCallSql('fc', DEFAULT_TIMEZONE)}
        AND (fc.expiration_date IS NULL OR fc.expiration_date > (now() AT TIME ZONE 'UTC'))
      ORDER BY fc."updatedAt" DESC
      LIMIT ${limit}`);

    const results: FundingAlertDispatchResult[] = [];
    for (const row of rows) {
      try {
        results.push(await this.dispatchAlertsForFundingCall(row.id));
      } catch (error) {
        console.warn(
          `[FUNDING-ALERT] Sweep dispatch failed for call ${row.id}:`,
          error instanceof Error ? error.message : String(error)
        );
        results.push({
          fundingCallId: row.id,
          dispatched: false,
          reason: error instanceof Error ? error.message : String(error),
          matched: 0,
          alerted: 0,
          inAppCreated: 0,
          emailsSent: 0,
          emailsQueued: 0,
          emailsFailed: 0,
          skippedExisting: 0,
          skippedUnentitled: 0,
          skippedIneligible: 0,
          tenantsSearched: 0,
        });
      }
    }
    const resumed = await this.resumeInterruptedAlerts();
    return { scanned: rows.length, results, resumed };
  }

  /**
   * Finish deliveries a crash or deploy interrupted, and retry definite email
   * failures that have waited out their backoff. Rides the hourly healing sweep.
   *
   *  - "sending" past its lease: the process died mid-send and the provider may
   *    already have the mail, so it becomes "uncertain" and is never resent.
   *  - "pending" for longer than a dispatch takes: delivered now, after the
   *    same entitlement, account and call checks dispatch makes.
   *  - "failed" with a due retry: sent again, up to EMAIL_MAX_ATTEMPTS.
   */
  async resumeInterruptedAlerts(options: { limit?: number } = {}) {
    const limit = Math.max(1, Math.min(Number(options.limit || 100), 500));
    const now = new Date();
    const summary = { uncertain: 0, considered: 0, inAppCreated: 0, emailsSent: 0, emailsFailed: 0, closedOut: 0 };

    const abandoned = await prisma.fundingCallAlert.updateMany({
      where: { email_status: 'sending', email_retry_at: { lte: now } },
      data: {
        email_status: 'uncertain',
        email_error: 'Interrupted while sending. The provider may have accepted it, so it is not sent again.',
        email_retry_at: null,
      },
    });
    summary.uncertain = abandoned.count;

    const interruptedBefore = new Date(now.getTime() - ALERT_RESUME_AFTER_MS);
    const rows = await prisma.fundingCallAlert.findMany({
      where: {
        OR: [
          { in_app_status: 'pending', created_at: { lte: interruptedBefore } },
          { email_status: 'pending', created_at: { lte: interruptedBefore } },
          { email_status: 'failed', email_retry_at: { lte: now }, email_attempts: { lt: EMAIL_MAX_ATTEMPTS } },
        ],
      },
      orderBy: { created_at: 'asc' },
      take: limit,
      select: {
        id: true,
        user_id: true,
        match_reason: true,
        match_tier: true,
        in_app_status: true,
        email_status: true,
        email_attempts: true,
        funding_call: { select: CALL_SELECT },
        user: { select: { id: true, email: true, name: true, status: true, tenantId: true } },
      },
    });
    summary.considered = rows.length;
    if (rows.length === 0) {
      return summary;
    }

    const preferenceRows = await prisma.researcherNotificationPreference.findMany({
      where: { user_id: { in: Array.from(new Set(rows.map((row) => row.user_id))) } },
      select: {
        user_id: true,
        in_app_enabled: true,
        email_enabled: true,
        email_address: true,
        notification_frequency: true,
        alert_keywords: true,
      },
    });
    const preferencesByUser = new Map(preferenceRows.map((row) => [row.user_id, toPreferences(row)]));
    const entitledTenants = await filterTenantsWithFeature(rows.map((row) => row.user?.tenantId), ALERTS_FEATURE_CODE);

    for (const row of rows) {
      const call = row.funding_call as AlertableCall;
      const user = row.user;
      const closeOutReason =
        !user || user.status !== 'ACTIVE' ? 'Recipient is no longer active'
          : !user.tenantId || !entitledTenants.has(user.tenantId) ? 'Plan no longer includes funding alerts'
            : call.notification_policy === 'SUPPRESSED' || call.notification_policy === 'OFFICERS_ONLY' ? 'Call notifications are suppressed'
              : !isAlertable(call).ok ? 'Call closed before delivery'
                : null;
      if (closeOutReason) {
        await prisma.fundingCallAlert.update({
          where: { id: row.id },
          data: {
            ...(row.in_app_status === 'pending' ? { in_app_status: 'skipped' } : {}),
            ...(['pending', 'failed'].includes(row.email_status) ? { email_status: 'skipped', email_retry_at: null } : {}),
            email_error: closeOutReason,
          },
        });
        summary.closedOut += 1;
        continue;
      }

      const preferences = preferencesByUser.get(row.user_id) || DEFAULT_PREFERENCES;
      const delivery: AlertDelivery = {
        alertId: row.id,
        call,
        user: user!,
        preferences,
        matchReason: row.match_reason,
        matchTier: row.match_tier,
        recipientZone: (await getTenantLocale(user!.tenantId)).timezone,
      };
      if (row.in_app_status === 'pending' && await deliverInApp(delivery)) {
        summary.inAppCreated += 1;
      }
      if (row.email_status === 'pending' || row.email_status === 'failed') {
        if (!preferences.emailEnabled) {
          await prisma.fundingCallAlert.update({
            where: { id: row.id },
            data: { email_status: 'skipped', email_error: 'Email alerts turned off', email_retry_at: null },
          });
          continue;
        }
        const outcome = await deliverInstantEmail(delivery, row.email_attempts);
        if (outcome === 'sent') summary.emailsSent += 1;
        if (outcome === 'failed' || outcome === 'uncertain') summary.emailsFailed += 1;
        await sleep(EMAIL_DELAY_MS);
      }
    }
    return summary;
  }

  /**
   * Bundle queued alerts into one digest email per user. Run from a daily and
   * a weekly scheduler; only users whose preference matches `frequency` are
   * included, so the two schedules never overlap.
   */
  async sendFundingAlertDigests(frequency: 'daily' | 'weekly'): Promise<FundingAlertDigestResult> {
    const result: FundingAlertDigestResult = {
      frequency,
      usersConsidered: 0,
      emailsSent: 0,
      emailsFailed: 0,
      alertsCovered: 0,
    };

    // Only this run's users are read, so rows waiting for the other schedule
    // cannot fill the window and starve this one. Weekly means a weekly
    // preference; everyone else (daily, no preference row, or switched to
    // instant since queueing) goes out on the daily run rather than never.
    const weeklyUser = { user: { researcher_notification_preference: { is: { notification_frequency: 'weekly' } } } };
    const queued = await prisma.fundingCallAlert.findMany({
      where: {
        email_status: 'queued',
        email_attempts: { lt: EMAIL_MAX_ATTEMPTS },
        ...(frequency === 'weekly' ? weeklyUser : { NOT: weeklyUser }),
      },
      orderBy: { created_at: 'asc' },
      take: 500,
      select: {
        id: true,
        user_id: true,
        match_reason: true,
        match_tier: true,
        funding_call: { select: CALL_SELECT },
        user: { select: { id: true, email: true, name: true, status: true, tenantId: true } },
      },
    });

    if (queued.length === 0) {
      return result;
    }

    const userIds = Array.from(new Set(queued.map((alert) => alert.user_id)));
    const preferenceRows = await prisma.researcherNotificationPreference.findMany({
      where: { user_id: { in: userIds } },
      select: {
        user_id: true,
        in_app_enabled: true,
        email_enabled: true,
        email_address: true,
        notification_frequency: true,
        alert_keywords: true,
      },
    });
    const preferencesByUser = new Map(preferenceRows.map((row) => [row.user_id, toPreferences(row)]));

    const byUser = new Map<string, typeof queued>();
    const emailOff: string[] = [];
    for (const alert of queued) {
      const preferences = preferencesByUser.get(alert.user_id);
      const effective = preferences?.frequency === 'weekly' ? 'weekly' : 'daily';
      if (effective !== frequency) {
        continue;
      }
      if (preferences && !preferences.emailEnabled) {
        emailOff.push(alert.id);
        continue;
      }
      const list = byUser.get(alert.user_id) || [];
      list.push(alert);
      byUser.set(alert.user_id, list);
    }
    // Email turned off after queueing: close these out rather than leaving
    // them queued for ever.
    if (emailOff.length > 0) {
      await prisma.fundingCallAlert.updateMany({
        where: { id: { in: emailOff } },
        data: { email_status: 'skipped', email_error: 'Email alerts turned off' },
      });
    }

    result.usersConsidered = byUser.size;

    // Entitlement can lapse between queueing and the digest run. Re-check the
    // tenant plans here so a churned tenant's queued alerts are closed out
    // instead of clogging the head of the queue forever.
    const entitledTenants = await filterTenantsWithFeature(
      Array.from(byUser.values(), (alerts) => alerts[0]?.user?.tenantId),
      ALERTS_FEATURE_CODE
    );

    for (const [userId, alerts] of byUser) {
      const user = alerts[0].user;
      if (!user || user.status !== 'ACTIVE') {
        continue;
      }

      if (!user.tenantId || !entitledTenants.has(user.tenantId)) {
        await prisma.fundingCallAlert.updateMany({
          where: { id: { in: alerts.map((alert) => alert.id) } },
          data: { email_status: 'skipped', email_error: 'Plan no longer includes funding alerts' },
        });
        continue;
      }

      // Calls that closed while sitting in the queue are dropped from the
      // digest and closed out so they stop matching the queued filter.
      const live = alerts.filter((alert) => {
        const call = alert.funding_call as AlertableCall;
        return isAlertable(call).ok;
      });
      const stale = alerts.filter((alert) => !live.includes(alert));
      if (stale.length > 0) {
        await prisma.fundingCallAlert.updateMany({
          where: { id: { in: stale.map((alert) => alert.id) } },
          data: { email_status: 'skipped', email_error: 'Call closed before digest was sent' },
        });
      }
      if (live.length === 0) {
        continue;
      }

      const preferences = preferencesByUser.get(userId) || DEFAULT_PREFERENCES;
      const to = preferences.emailAddress || user.email;
      const recipientZone = (await getTenantLocale(user.tenantId)).timezone;
      const template = fundingAlertDigestTemplate({
        email: to,
        name: user.name,
        frequency,
        items: live.map((alert) => {
          const call = alert.funding_call as AlertableCall;
          return {
            title: callTitle(call),
            agency: callAgency(call),
            deadline: formatDeadline(callDeadline(call), recipientZone),
            amount: callAmountLabel(call),
            matchReason: alert.match_reason,
            callUrl: `${SITE_URL}/finder/calls/${encodeURIComponent(call.id)}`,
          };
        }),
      });

      const liveIds = live.map((alert) => alert.id);
      try {
        const sent = await sendEmail({ to, toName: user.name || undefined, ...template });
        if (sent && (sent as { sent?: boolean }).sent === false) {
          // No mail provider configured: leave the rows queued for when it is.
          result.emailsFailed += 1;
          continue;
        }
        await prisma.fundingCallAlert.updateMany({
          where: { id: { in: liveIds } },
          data: { email_status: 'sent', emailed_at: new Date(), email_error: null },
        });
        result.emailsSent += 1;
        result.alertsCovered += live.length;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const kind = error instanceof EmailDeliveryError ? error.kind : 'retryable';
        if (kind === 'uncertain') {
          // The digest may have arrived; sending it again would duplicate it.
          await prisma.fundingCallAlert.updateMany({
            where: { id: { in: liveIds } },
            data: { email_status: 'uncertain', email_error: message },
          });
        } else {
          // Stays queued for the next run, until it has failed too often or
          // was refused outright.
          await prisma.fundingCallAlert.updateMany({
            where: { id: { in: liveIds } },
            data: { email_error: message, email_attempts: { increment: kind === 'rejected' ? EMAIL_MAX_ATTEMPTS : 1 } },
          });
          await prisma.fundingCallAlert.updateMany({
            where: { id: { in: liveIds }, email_attempts: { gte: EMAIL_MAX_ATTEMPTS } },
            data: { email_status: 'failed' },
          });
        }
        result.emailsFailed += 1;
        console.warn(`[FUNDING-ALERT] Digest email failed for ${to} (${kind}):`, message);
      }
      await sleep(EMAIL_DELAY_MS);
    }

    return result;
  }
}

export const fundingAlertService = new FundingAlertService();

/**
 * Fire-and-forget wrapper for publish hooks: alert dispatch must never fail
 * or slow down the publish that triggered it.
 */
export function dispatchFundingAlertsQuietly(fundingCallId: string): void {
  fundingAlertService
    .dispatchAlertsForFundingCall(fundingCallId)
    .then((summary) => {
      console.log(
        `[FUNDING-ALERT] Call ${fundingCallId}: matched ${summary.matched}, alerted ${summary.alerted} ` +
          `(in-app ${summary.inAppCreated}, emails sent ${summary.emailsSent}, queued ${summary.emailsQueued}, ` +
          `unentitled ${summary.skippedUnentitled})`
      );
    })
    .catch((error) => {
      console.warn(
        `[FUNDING-ALERT] Dispatch failed for call ${fundingCallId}:`,
        error instanceof Error ? error.message : String(error)
      );
    });
}
