import prisma from '../prisma';
import { sendEmail, SITE_URL } from '../mailer';
import { fundingOpportunityTemplate, fundingAlertDigestTemplate } from '../email-templates';
import { filterTenantsWithFeature } from '../entitlement-service';
import { matchedAlertKeywords } from '../funding/alertKeywordBoost';
import type { ResearcherSearchResult } from './researcherSearchService';
import { researcherSearchService } from './researcherSearchService';

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

/** Search clamps to 50; more than that per call is noise anyway. */
const MAX_ALERT_RECIPIENTS = 50;
/** Pause between instant emails so the mail provider is not burst-hit. */
const EMAIL_DELAY_MS = 250;
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
};

const CALL_SELECT = {
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
} as const;

function callTitle(call: AlertableCall): string {
  return (call.scheme_title || call.title || 'Funding opportunity').trim();
}

function callAgency(call: AlertableCall): string | null {
  return (call.agency_name || call.agencyName || '').trim() || null;
}

function callDeadline(call: AlertableCall): Date | null {
  return call.close_date || call.deadlineAt || call.expiration_date || null;
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
  const now = Date.now();
  const closes = call.close_date || call.expiration_date;
  if (closes && closes.getTime() < now) {
    return { ok: false, reason: 'expired' };
  }
  return { ok: true };
}

function formatDeadline(value: Date | null): string | null {
  if (!value) {
    return null;
  }
  return value.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function notificationBody(call: AlertableCall, match: ResearcherSearchResult): string {
  const parts: string[] = [];
  const agency = callAgency(call);
  if (agency) {
    parts.push(agency);
  }
  const deadline = formatDeadline(callDeadline(call));
  if (deadline) {
    parts.push(`Deadline ${deadline}`);
  }
  if (match.matchReason) {
    parts.push(match.matchReason);
  }
  return parts.join(' · ');
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

async function stampDispatched(call: AlertableCall, summary: FundingAlertDispatchResult) {
  const metadata = asMetadataObject(call.metadata);
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
  };
  await prisma.fundingCall.update({
    where: { id: call.id },
    data: { metadata: metadata as any },
  });
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
    };

    const call = (await prisma.fundingCall.findUnique({
      where: { id: fundingCallId },
      select: CALL_SELECT,
    })) as AlertableCall | null;

    if (!call) {
      result.reason = 'not_found';
      return result;
    }

    const alertable = isAlertable(call);
    if (!alertable.ok && !options.force) {
      result.reason = alertable.reason;
      return result;
    }

    // Same embedding search the researcher-matching screen uses: profile,
    // saved research areas flagged for alerts, and tagged publications.
    const tenantPrivate = call.visibility === 'TENANT_PRIVATE' && call.tenantId;
    const search = await researcherSearchService.search({
      fundingCallId,
      limit: MAX_ALERT_RECIPIENTS,
      requesterTenantId: tenantPrivate ? call.tenantId : null,
      filters: {
        includeSelf: true,
        ...(tenantPrivate ? { tenantOnly: true } : {}),
      },
    });

    // Preferences are fetched before the tier filter (not after, with the
    // other batch loads) because a user's saved alert keywords can rescue a
    // weak match: a call whose text hits one of them is promoted to moderate.
    const preferenceRows = await prisma.researcherNotificationPreference.findMany({
      where: { user_id: { in: search.results.map((match) => match.userId) } },
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
    const matches = search.results
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
    result.matched = matches.length;

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

    const title = callTitle(call);
    const linkUrl = `/finder/calls/${encodeURIComponent(call.id)}`;
    const callUrl = `${SITE_URL}${linkUrl}`;
    const deadlineLabel = formatDeadline(callDeadline(call));
    const amountLabel = callAmountLabel(call);
    const agency = callAgency(call);

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

      // Claim the (call, user) pair first — the unique key makes concurrent
      // dispatches collapse into one alert.
      let alertId: string;
      try {
        const alert = await prisma.fundingCallAlert.create({
          data: {
            funding_call_id: call.id,
            user_id: user.id,
            tenant_id: user.tenantId,
            match_score: match.score,
            match_tier: match.matchTier,
            score_basis: search.scoreBasis,
            matched_sources: match.matchedSources,
            match_reason: match.matchReason || null,
          },
          select: { id: true },
        });
        alertId = alert.id;
      } catch (error) {
        if (isUniqueViolation(error)) {
          result.skippedExisting += 1;
          continue;
        }
        throw error;
      }

      result.alerted += 1;
      let inAppStatus = 'skipped';
      let emailStatus = 'skipped';
      let emailError: string | null = null;
      let emailedAt: Date | null = null;

      // In-app notification. Notification rows require a tenant, so tenantless
      // accounts fall back to email-only.
      if (preferences.inAppEnabled && user.tenantId) {
        try {
          await prisma.notification.create({
            data: {
              tenant_id: user.tenantId,
              user_id: user.id,
              title: `New funding match: ${title.slice(0, 120)}`,
              body: notificationBody(call, match) || null,
              category: NOTIFICATION_CATEGORY,
              link_url: linkUrl,
            },
          });
          inAppStatus = 'created';
          result.inAppCreated += 1;
        } catch (error) {
          inAppStatus = 'failed';
          console.warn(
            `[FUNDING-ALERT] In-app notification failed for user ${user.id}:`,
            error instanceof Error ? error.message : String(error)
          );
        }
      }

      if (preferences.emailEnabled) {
        if (preferences.frequency === 'instant') {
          const to = preferences.emailAddress || user.email;
          const template = fundingOpportunityTemplate({
            email: to,
            name: user.name,
            callTitle: title,
            agency,
            deadline: deadlineLabel,
            amount: amountLabel,
            matchReason: match.matchReason || null,
            matchTier: match.matchTier,
            callUrl,
          });
          try {
            await sendEmail({ to, toName: user.name || undefined, ...template });
            emailStatus = 'sent';
            emailedAt = new Date();
            result.emailsSent += 1;
          } catch (error) {
            emailStatus = 'failed';
            emailError = error instanceof Error ? error.message : String(error);
            result.emailsFailed += 1;
            console.warn(`[FUNDING-ALERT] Email failed for ${to}:`, emailError);
          }
          await sleep(EMAIL_DELAY_MS);
        } else {
          emailStatus = 'queued';
          result.emailsQueued += 1;
        }
      }

      await prisma.fundingCallAlert.update({
        where: { id: alertId },
        data: {
          in_app_status: inAppStatus,
          email_status: emailStatus,
          email_error: emailError,
          emailed_at: emailedAt,
        },
      });
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
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `
      SELECT id
      FROM funding_calls
      WHERE (catalog_status::text = 'PUBLISHED' OR status::text = 'PUBLISHED')
        AND COALESCE(is_active, true) = true
        AND COALESCE(metadata ->> 'alerts_dispatched_at', '') = ''
        AND (close_date IS NULL OR close_date > NOW())
        AND (expiration_date IS NULL OR expiration_date > NOW())
      ORDER BY "updatedAt" DESC
      LIMIT $1
      `,
      limit
    );

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
        });
      }
    }
    return { scanned: rows.length, results };
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

    const queued = await prisma.fundingCallAlert.findMany({
      where: { email_status: 'queued' },
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
    for (const alert of queued) {
      const preferences = preferencesByUser.get(alert.user_id);
      // Queued alerts always came from an explicit daily/weekly preference; if
      // the row disappeared, deliver on the daily run rather than never.
      const effective = preferences?.frequency || 'daily';
      if (effective !== frequency) {
        continue;
      }
      if (preferences && !preferences.emailEnabled) {
        continue;
      }
      const list = byUser.get(alert.user_id) || [];
      list.push(alert);
      byUser.set(alert.user_id, list);
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
      const template = fundingAlertDigestTemplate({
        email: to,
        name: user.name,
        frequency,
        items: live.map((alert) => {
          const call = alert.funding_call as AlertableCall;
          return {
            title: callTitle(call),
            agency: callAgency(call),
            deadline: formatDeadline(callDeadline(call)),
            amount: callAmountLabel(call),
            matchReason: alert.match_reason,
            callUrl: `${SITE_URL}/finder/calls/${encodeURIComponent(call.id)}`,
          };
        }),
      });

      try {
        await sendEmail({ to, toName: user.name || undefined, ...template });
        await prisma.fundingCallAlert.updateMany({
          where: { id: { in: live.map((alert) => alert.id) } },
          data: { email_status: 'sent', emailed_at: new Date(), email_error: null },
        });
        result.emailsSent += 1;
        result.alertsCovered += live.length;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await prisma.fundingCallAlert.updateMany({
          where: { id: { in: live.map((alert) => alert.id) } },
          data: { email_error: message },
        });
        result.emailsFailed += 1;
        console.warn(`[FUNDING-ALERT] Digest email failed for ${to}:`, message);
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
