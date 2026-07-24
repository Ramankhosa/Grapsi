import prisma from '../prisma'
import { normalizeHeader, parseTabularUpload } from '../spreadsheet/parseTabularUpload'
import { generateToken, hashToken } from '../token-utils'
import { sendEmail } from '../mailer'
import { activationTemplate } from '../email-templates'
import { createAuditLog } from '../auth'
import {
  createTenantInvite,
  INVITABLE_ROLES,
  type InvitableRole,
} from '../tenant-invite-service'

/**
 * Bulk user provisioning for a tenant admin.
 *
 * Each row resolves to exactly one of three outcomes, and the admin never sets
 * or sees a password:
 *
 *  - New email          -> a named, email-locked TenantMemberInvite is minted
 *                          and an "Accept invitation / create account" email is
 *                          sent (delegated to createTenantInvite). The person
 *                          sets their own password on signup.
 *  - Seeded account      -> an existing user in THIS tenant with no passwordHash
 *    (no password yet)     (e.g. a prior faculty-roster import). A one-hour
 *                          password-reset token is issued and an activation
 *                          email is sent so they can set a password and log in.
 *  - Already active      -> an existing user in THIS tenant WITH a password is
 *                          left untouched (skipped).
 *
 * An email already owned by a different organization is reported as an error.
 * Send `dryRun: true` first to classify every row without side effects, then
 * repeat without it to commit.
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const ACTIVATION_TOKEN_TTL_MS = 60 * 60 * 1000 // 1 hour, matches forgot-password

const COLUMN_ALIASES: Record<string, string[]> = {
  name: ['name', 'fullname', 'employeename', 'staffname', 'membername'],
  email: ['email', 'emailaddress', 'officialemail', 'emailid'],
  role: ['role', 'accessrole', 'permission', 'permissionlevel'],
}

export const BULK_INVITE_TEMPLATE_HEADERS = ['Name', 'Email', 'Role']

/** Roles accepted in the sheet, upper-cased, plus friendly aliases. */
const ROLE_LOOKUP: Record<string, InvitableRole> = {
  ADMIN: 'ADMIN',
  MANAGER: 'MANAGER',
  ANALYST: 'ANALYST',
  MEMBER: 'ANALYST',
  USER: 'ANALYST',
}

export type BulkInviteOutcome =
  | 'invited' // new user, invite email sent
  | 'activation_sent' // existing seeded (password-less) user, activation email sent
  | 'skipped' // existing active user, nothing to do
  | 'error'

export interface BulkInviteRowResult {
  rowNumber: number
  name: string
  email: string
  role: InvitableRole
  outcome: BulkInviteOutcome
  message?: string
}

export interface BulkInviteSummary {
  dryRun: boolean
  totalRows: number
  invited: number
  activationSent: number
  skipped: number
  errors: number
  results: BulkInviteRowResult[]
}

export interface BulkInviteOptions {
  tenantId: string
  uploadedByUserId: string
  filename: string
  buffer: Buffer
  /** Default role when the sheet omits a Role column or leaves it blank. */
  defaultRole?: InvitableRole
  dryRun: boolean
  ip?: string
}

function buildColumnMap(headers: string[]) {
  const present = new Set(headers.map(normalizeHeader).filter(Boolean))
  const map: Record<string, string> = {}
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    const match = aliases.find((alias) => present.has(alias))
    if (match) map[field] = match
  }
  return map
}

function resolveRole(raw: string, fallback: InvitableRole): InvitableRole | null {
  const value = raw.trim().toUpperCase()
  if (!value) return fallback
  return ROLE_LOOKUP[value] ?? null
}

/** Issue a fresh activation (password-reset) token and email the set-password link. */
async function sendActivation(
  user: { id: string; email: string; name: string | null },
  tenantName: string
): Promise<void> {
  // Invalidate any live tokens so only the newest link works.
  await prisma.passwordResetToken.updateMany({
    where: { userId: user.id, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  })

  const raw = generateToken()
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(raw),
      expiresAt: new Date(Date.now() + ACTIVATION_TOKEN_TTL_MS),
    },
  })

  const tpl = activationTemplate({
    email: user.email,
    name: user.name,
    tenantName,
    token: raw,
  })
  await sendEmail({
    to: user.email,
    toName: user.name || undefined,
    subject: tpl.subject,
    html: tpl.html,
    text: tpl.text,
  })
}

export async function importBulkInvites(options: BulkInviteOptions): Promise<BulkInviteSummary> {
  const { tenantId, uploadedByUserId, filename, buffer, dryRun } = options
  const defaultRole: InvitableRole = options.defaultRole ?? 'ANALYST'
  const ip = options.ip || 'unknown'

  const sheet = parseTabularUpload(buffer, filename)
  const columns = buildColumnMap(sheet.headers)
  if (!columns.email) {
    throw new Error(
      `The file must include an "Email" column. Columns found: ${
        sheet.headers.filter(Boolean).join(', ') || 'none'
      }.`
    )
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { name: true, status: true },
  })
  if (!tenant) throw new Error('Tenant not found.')

  const inviter = await prisma.user.findUnique({
    where: { id: uploadedByUserId },
    select: { name: true, email: true, signupAtiToken: { select: { planTier: true } } },
  })
  const inviterName = inviter?.name || inviter?.email || 'Your administrator'
  const planTier = inviter?.signupAtiToken?.planTier ?? null

  const read = (row: Record<string, string>, field: string) =>
    columns[field] ? (row[columns[field]] || '').trim() : ''

  const results: BulkInviteRowResult[] = []
  const seen = new Set<string>()
  let invited = 0
  let activationSent = 0
  let skipped = 0
  let errors = 0

  for (let index = 0; index < sheet.rows.length; index += 1) {
    const row = sheet.rows[index]
    // +2: one for the header row, one to make it 1-based like a spreadsheet.
    const rowNumber = index + 2

    const name = read(row, 'name')
    const email = read(row, 'email').toLowerCase()
    const roleRaw = read(row, 'role')

    if (!name && !email && !roleRaw) continue // blank row

    const role = resolveRole(roleRaw, defaultRole) ?? defaultRole
    const base = { rowNumber, name, email, role }
    const fail = (message: string) => {
      results.push({ ...base, outcome: 'error' as const, message })
      errors += 1
    }

    if (!email || !EMAIL_PATTERN.test(email)) {
      fail('A valid email address is required.')
      continue
    }
    if (roleRaw && resolveRole(roleRaw, defaultRole) === null) {
      fail(`Unknown role "${roleRaw}". Use one of: ${INVITABLE_ROLES.join(', ')}.`)
      continue
    }
    if (seen.has(email)) {
      fail('Duplicate email in this file.')
      continue
    }
    seen.add(email)

    try {
      const existing = await prisma.user.findUnique({
        where: { email },
        select: { id: true, name: true, tenantId: true, passwordHash: true },
      })

      // Case 1: already active in this tenant -> nothing to do.
      if (existing) {
        if (existing.tenantId && existing.tenantId !== tenantId) {
          fail('This email already belongs to a different organization.')
          continue
        }
        if (existing.passwordHash) {
          results.push({ ...base, outcome: 'skipped', message: 'User already has an active account.' })
          skipped += 1
          continue
        }

        // Case 2: seeded account with no password -> send activation email.
        if (dryRun) {
          results.push({ ...base, outcome: 'activation_sent', message: 'Would send an activation email.' })
          activationSent += 1
          continue
        }

        // Adopt an untenanted seeded account into this tenant if needed.
        if (!existing.tenantId) {
          await prisma.user.update({ where: { id: existing.id }, data: { tenantId } })
        }
        await sendActivation({ id: existing.id, email, name: existing.name }, tenant.name)
        await createAuditLog({
          actorUserId: uploadedByUserId,
          tenantId,
          action: 'MEMBER_ACTIVATION_SENT',
          resource: `user:${existing.id}`,
          ip,
          meta: { email, role },
        })
        results.push({ ...base, outcome: 'activation_sent' })
        activationSent += 1
        continue
      }

      // Case 3: brand-new email -> mint an email-locked invite.
      if (dryRun) {
        results.push({ ...base, outcome: 'invited', message: 'Would send an invitation email.' })
        invited += 1
        continue
      }

      const result = await createTenantInvite({
        tenantId,
        tenantName: tenant.name,
        invitedByUserId: uploadedByUserId,
        inviterName,
        planTier,
        email,
        role,
      })
      if (!result.ok) {
        fail(result.error || 'Could not create an invitation.')
        continue
      }
      await createAuditLog({
        actorUserId: uploadedByUserId,
        tenantId,
        action: 'MEMBER_INVITE_SENT',
        resource: `tenant_invite:${result.inviteId}`,
        ip,
        meta: { email, role, source: 'bulk_import' },
      })
      results.push({ ...base, outcome: 'invited' })
      invited += 1
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error))
    }
  }

  return {
    dryRun,
    totalRows: results.length,
    invited,
    activationSent,
    skipped,
    errors,
    results,
  }
}
