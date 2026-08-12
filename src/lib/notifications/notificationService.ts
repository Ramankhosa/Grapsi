import prisma from '../prisma';
import { listSubtreeUnitIds, listUnitUserIds } from '../orgUnits/tree';

/**
 * In-app notifications.
 *
 * This is the only inbox the app has, so it is the primary delivery channel for
 * admin -> faculty messages and for automatic assignment events. Recipients are
 * always resolved server-side against the calling tenant: a caller may name
 * users or org units, but never reaches a user outside their own tenant.
 */

export type NotificationCategory =
  | 'ASSIGNMENT'
  | 'DEADLINE'
  | 'OUTCOME'
  | 'ANNOUNCEMENT'
  | 'FUNDING_MATCH';

export interface CreateNotificationsInput {
  tenantId: string;
  /** Explicit recipients. Filtered to members of `tenantId`. */
  userIds?: string[];
  /** Department/school org units — expands to the faculty inside them. */
  orgUnitIds?: string[];
  /** Send to every active user in the tenant. */
  allTenantUsers?: boolean;
  title: string;
  body?: string | null;
  category?: NotificationCategory;
  linkUrl?: string | null;
  assignmentId?: string | null;
  createdByUserId?: string | null;
  /** Skip this user (e.g. don't notify the admin about their own action). */
  excludeUserIds?: string[];
}

/**
 * Resolves the recipient set, constrained to the tenant.
 *
 * Any org unit may be named: selecting one reaches every faculty member at or
 * beneath it, to any depth, so callers never have to pre-expand a hierarchy.
 */
async function resolveRecipients(input: CreateNotificationsInput): Promise<string[]> {
  const recipients = new Set<string>();

  if (input.allTenantUsers) {
    const users = await prisma.user.findMany({
      where: { tenantId: input.tenantId, status: 'ACTIVE' },
      select: { id: true },
    });
    users.forEach((user) => recipients.add(user.id));
  }

  const explicitIds = (input.userIds || []).filter(Boolean);
  if (explicitIds.length > 0) {
    const users = await prisma.user.findMany({
      where: { id: { in: explicitIds }, tenantId: input.tenantId },
      select: { id: true },
    });
    users.forEach((user) => recipients.add(user.id));
  }

  const orgUnitIds = (input.orgUnitIds || []).filter(Boolean);
  if (orgUnitIds.length > 0) {
    // Selecting a unit reaches its entire subtree at any depth, AND the unit
    // itself. The previous implementation walked exactly one level down and
    // silently dropped members attached directly to the selected unit, so a
    // school-wide announcement missed anyone sitting at the school.
    const requested = await prisma.tenantOrgUnit.findMany({
      where: { id: { in: orgUnitIds }, tenant_id: input.tenantId },
      select: { id: true },
    });
    const subtreeUnitIds = await listSubtreeUnitIds(
      input.tenantId,
      requested.map((unit) => unit.id)
    );
    const userIds = await listUnitUserIds(input.tenantId, subtreeUnitIds);
    userIds.forEach((userId) => recipients.add(userId));
  }

  for (const excluded of input.excludeUserIds || []) {
    recipients.delete(excluded);
  }

  return Array.from(recipients);
}

/**
 * Creates one notification per resolved recipient. Returns how many were
 * written (0 when nobody matched, which callers may surface as a warning).
 */
export async function createNotifications(input: CreateNotificationsInput): Promise<number> {
  const title = (input.title || '').trim();
  if (!title) {
    throw new Error('A notification title is required.');
  }

  const recipients = await resolveRecipients(input);
  if (recipients.length === 0) {
    return 0;
  }

  const result = await prisma.notification.createMany({
    data: recipients.map((userId) => ({
      tenant_id: input.tenantId,
      user_id: userId,
      title,
      body: input.body?.trim() || null,
      category: input.category || 'ANNOUNCEMENT',
      link_url: input.linkUrl || null,
      assignment_id: input.assignmentId || null,
      created_by_user_id: input.createdByUserId || null,
    })),
  });

  return result.count;
}

/**
 * Fire-and-forget wrapper for automatic events. A notification must never fail
 * the write that triggered it (assigning a call, recording a submission), so
 * failures are logged and swallowed — mirroring how the SendGrid email in the
 * assignment routes is handled.
 */
export async function notifyQuietly(input: CreateNotificationsInput): Promise<void> {
  try {
    await createNotifications(input);
  } catch (error) {
    console.warn(
      'Notification dispatch failed:',
      error instanceof Error ? error.message : String(error)
    );
  }
}

export function serializeNotification(record: any) {
  return {
    id: record.id,
    title: record.title,
    body: record.body,
    category: record.category,
    linkUrl: record.link_url,
    assignmentId: record.assignment_id,
    readAt: record.read_at,
    createdAt: record.created_at,
    createdBy: record.created_by
      ? {
          id: record.created_by.id,
          name: record.created_by.name,
          email: record.created_by.email,
        }
      : null,
  };
}
