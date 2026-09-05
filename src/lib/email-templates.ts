import { SITE_URL, MAIL_FROM_NAME } from './mailer'

// The name shown inside every email — the header chip, subject lines, "Welcome
// to …" copy. Tracks the sender identity (MAIL_FROM_NAME) so the From line and
// the body never disagree about who sent it.
const brand = {
  name: MAIL_FROM_NAME,
  primary: '#4C5EFF',
  gray700: '#334155',
  gray500: '#64748B',
}

function friendlyName(email: string, name?: string | null): string {
  if (name && name.trim().length > 0) return name.trim()
  const local = email.split('@')[0] || 'there'
  // Capitalize first letter of local-part when possible
  return local.charAt(0).toUpperCase() + local.slice(1)
}

export function verificationTemplate(email: string, name: string | null | undefined, token: string) {
  const displayName = friendlyName(email, name)
  const url = `${SITE_URL}/verify-email?token=${encodeURIComponent(token)}`
  const html = `
  <div style="font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; max-width: 640px; margin: 0 auto; padding: 24px; background: #ffffff">
    <div style="text-align:center; margin-bottom: 16px">
      <div style="display:inline-block; background:${brand.primary}; color:#fff; padding:8px 12px; border-radius:12px; font-weight:600;">${brand.name}</div>
    </div>
    <h2 style="color:${brand.gray700}; margin: 12px 0 8px">Verify your email</h2>
    <p style="color:${brand.gray500}; line-height:1.6">Hi ${displayName},</p>
    <p style="color:${brand.gray500}; line-height:1.6">Welcome to ${brand.name}! Click the button below to verify <strong>${email}</strong> and activate your account.</p>
    <div style="margin:24px 0">
      <a href="${url}" style="background:${brand.primary}; color:#fff; text-decoration:none; padding:12px 20px; border-radius:10px; display:inline-block; font-weight:600">Verify Email</a>
    </div>
    <p style="color:${brand.gray500}; font-size:13px">If the button doesn't work, copy this link:<br/>
      <a href="${url}" style="color:${brand.primary}">${url}</a>
    </p>
    <p style="color:${brand.gray500}; font-size:12px">This link expires in 24 hours.</p>
  </div>`
  const text = `Hi ${displayName}, Verify your ${brand.name} email: ${url}`
  return { subject: `Verify your ${brand.name} email`, html, text }
}

export function tenantInviteTemplate(params: {
  email: string
  inviterName: string
  tenantName: string
  role: string
  inviteLink: string
  expiresAt: Date
  /** Platform-issued invite for the org's first administrator. */
  isFoundingAdmin?: boolean
}) {
  const displayName = friendlyName(params.email)
  const roleLabel = params.role.charAt(0) + params.role.slice(1).toLowerCase()
  const expiryDate = params.expiresAt.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })

  const heading = params.isFoundingAdmin
    ? `Set up ${params.tenantName} on ${brand.name}`
    : `You're invited to join ${params.tenantName}`
  const lead = params.isFoundingAdmin
    ? `<strong>${params.tenantName}</strong> has been set up on ${brand.name}, and you've been named its administrator. Create your account below — you'll be the workspace owner, and you can invite your colleagues from the admin dashboard straight afterwards.`
    : `<strong>${params.inviterName}</strong> invited you to join <strong>${params.tenantName}</strong> on ${brand.name} as a <strong>${roleLabel}</strong>. Click the button below to create your account — your access is already set up.`
  const cta = params.isFoundingAdmin ? 'Create your admin account' : 'Accept Invitation'
  const subject = params.isFoundingAdmin
    ? `You're the administrator for ${params.tenantName} on ${brand.name}`
    : `${params.inviterName} invited you to ${params.tenantName} on ${brand.name}`

  const html = `
  <div style="font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; max-width: 640px; margin: 0 auto; padding: 24px; background: #ffffff">
    <div style="text-align:center; margin-bottom: 16px">
      <div style="display:inline-block; background:${brand.primary}; color:#fff; padding:8px 12px; border-radius:12px; font-weight:600;">${brand.name}</div>
    </div>
    <h2 style="color:${brand.gray700}; margin: 12px 0 8px">${heading}</h2>
    <p style="color:${brand.gray500}; line-height:1.6">Hi ${displayName},</p>
    <p style="color:${brand.gray500}; line-height:1.6">${lead}</p>
    <div style="margin:24px 0">
      <a href="${params.inviteLink}" style="background:${brand.primary}; color:#fff; text-decoration:none; padding:12px 20px; border-radius:10px; display:inline-block; font-weight:600">${cta}</a>
    </div>
    <p style="color:${brand.gray500}; font-size:13px">If the button doesn't work, copy this link:<br/>
      <a href="${params.inviteLink}" style="color:${brand.primary}">${params.inviteLink}</a>
    </p>
    <p style="color:${brand.gray500}; font-size:12px">This invitation is for ${params.email} and expires on ${expiryDate}. If you weren't expecting it, you can safely ignore this email.</p>
  </div>`
  const text = params.isFoundingAdmin
    ? `Hi ${displayName}, ${params.tenantName} has been set up on ${brand.name} and you've been named its administrator. Create your account: ${params.inviteLink} (expires ${expiryDate})`
    : `Hi ${displayName}, ${params.inviterName} invited you to join ${params.tenantName} on ${brand.name} as ${roleLabel}. Accept: ${params.inviteLink} (expires ${expiryDate})`
  return { subject, html, text }
}

/**
 * Sent to a seeded account (created by a roster/bulk import with no password)
 * so the person can set a password and log in. Backed by a password-reset token.
 */
export function activationTemplate(params: {
  email: string
  name?: string | null
  tenantName: string
  token: string
  /**
   * Lifetime of the link, in hours. Bulk/roster activations reuse the
   * forgot-password default of 1 hour; an admin provisioning a single account
   * passes a longer window because nobody is standing by to click it.
   */
  expiresInHours?: number
}) {
  const displayName = friendlyName(params.email, params.name)
  const url = `${SITE_URL}/reset-password?token=${encodeURIComponent(params.token)}`
  const hours = params.expiresInHours ?? 1
  const expiryPhrase = hours >= 48 ? `${Math.round(hours / 24)} days` : hours === 1 ? '1 hour' : `${hours} hours`
  const html = `
  <div style="font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; max-width: 640px; margin: 0 auto; padding: 24px; background: #ffffff">
    <div style="text-align:center; margin-bottom: 16px">
      <div style="display:inline-block; background:${brand.primary}; color:#fff; padding:8px 12px; border-radius:12px; font-weight:600;">${brand.name}</div>
    </div>
    <h2 style="color:${brand.gray700}; margin: 12px 0 8px">Activate your ${params.tenantName} account</h2>
    <p style="color:${brand.gray500}; line-height:1.6">Hi ${displayName},</p>
    <p style="color:${brand.gray500}; line-height:1.6">An account has been created for you at <strong>${params.tenantName}</strong> on ${brand.name}. Set your password below to activate <strong>${params.email}</strong> and sign in.</p>
    <div style="margin:24px 0">
      <a href="${url}" style="background:${brand.primary}; color:#fff; text-decoration:none; padding:12px 20px; border-radius:10px; display:inline-block; font-weight:600">Set Password</a>
    </div>
    <p style="color:${brand.gray500}; font-size:13px">If the button doesn't work, copy this link:<br/>
      <a href="${url}" style="color:${brand.primary}">${url}</a>
    </p>
    <p style="color:${brand.gray500}; font-size:12px">This link expires in ${expiryPhrase}. You can request a fresh one any time from the sign-in page via "Forgot password".</p>
  </div>`
  const text = `Hi ${displayName}, an account was created for you at ${params.tenantName} on ${brand.name}. Set your password to activate ${params.email}: ${url} (expires in ${expiryPhrase})`
  return { subject: `Activate your ${params.tenantName} account on ${brand.name}`, html, text }
}

export function resetTemplate(email: string, name: string | null | undefined, token: string) {
  const displayName = friendlyName(email, name)
  const url = `${SITE_URL}/reset-password?token=${encodeURIComponent(token)}`
  const html = `
  <div style="font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; max-width: 640px; margin: 0 auto; padding: 24px; background: #ffffff">
    <div style="text-align:center; margin-bottom: 16px">
      <div style="display:inline-block; background:${brand.primary}; color:#fff; padding:8px 12px; border-radius:12px; font-weight:600;">${brand.name}</div>
    </div>
    <h2 style="color:${brand.gray700}; margin: 12px 0 8px">Reset your password</h2>
    <p style="color:${brand.gray500}; line-height:1.6">Hi ${displayName},</p>
    <p style="color:${brand.gray500}; line-height:1.6">We received a request to reset the password for <strong>${email}</strong>. If you made this request, click the button below to set a new password.</p>
    <div style="margin:24px 0">
      <a href="${url}" style="background:${brand.primary}; color:#fff; text-decoration:none; padding:12px 20px; border-radius:10px; display:inline-block; font-weight:600">Reset Password</a>
    </div>
    <p style="color:${brand.gray500}; font-size:13px">If the button doesn't work, copy this link:<br/>
      <a href="${url}" style="color:${brand.primary}">${url}</a>
    </p>
    <p style="color:${brand.gray500}; font-size:12px">This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
  </div>`
  const text = `Hi ${displayName}, reset your ${brand.name} password: ${url}`
  return { subject: `Reset your ${brand.name} password`, html, text }
}

// Funding call titles and agencies come from ingested source documents, so
// they are escaped before being interpolated into alert HTML.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const MANAGE_ALERTS_URL = `${SITE_URL}/profile/researcher`

/**
 * Instant alert: one funding call matched this researcher's profile, saved
 * research areas, or publications.
 */
export function fundingOpportunityTemplate(params: {
  email: string
  name?: string | null
  callTitle: string
  agency: string | null
  deadline: string | null
  amount: string | null
  matchReason: string | null
  matchTier: string
  callUrl: string
}) {
  const displayName = friendlyName(params.email, params.name)
  const title = escapeHtml(params.callTitle)
  const detailRows = [
    params.agency ? `<strong>Funder:</strong> ${escapeHtml(params.agency)}` : '',
    params.deadline ? `<strong>Deadline:</strong> ${escapeHtml(params.deadline)}` : '',
    params.amount ? `<strong>Funding:</strong> ${escapeHtml(params.amount)}` : '',
  ].filter(Boolean)
  const tierLabel = params.matchTier === 'strong' ? 'Strong match' : 'Possible match'
  const html = `
  <div style="font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; max-width: 640px; margin: 0 auto; padding: 24px; background: #ffffff">
    <div style="text-align:center; margin-bottom: 16px">
      <div style="display:inline-block; background:${brand.primary}; color:#fff; padding:8px 12px; border-radius:12px; font-weight:600;">${brand.name}</div>
    </div>
    <h2 style="color:${brand.gray700}; margin: 12px 0 8px">A funding opportunity matches your research</h2>
    <p style="color:${brand.gray500}; line-height:1.6">Hi ${displayName},</p>
    <p style="color:${brand.gray500}; line-height:1.6">A new funding call was just published that looks relevant to your work:</p>
    <div style="border:1px solid #E2E8F0; border-radius:12px; padding:16px 18px; margin:16px 0">
      <div style="color:${brand.gray700}; font-weight:600; font-size:16px; margin-bottom:6px">${title}</div>
      <div style="display:inline-block; background:#EEF2FF; color:${brand.primary}; padding:2px 10px; border-radius:999px; font-size:12px; font-weight:600; margin-bottom:10px">${tierLabel}</div>
      ${detailRows.map((row) => `<p style="color:${brand.gray500}; font-size:14px; margin:4px 0">${row}</p>`).join('')}
      ${params.matchReason ? `<p style="color:${brand.gray500}; font-size:13px; margin:10px 0 0; font-style:italic">${escapeHtml(params.matchReason)}</p>` : ''}
    </div>
    <div style="margin:24px 0">
      <a href="${params.callUrl}" style="background:${brand.primary}; color:#fff; text-decoration:none; padding:12px 20px; border-radius:10px; display:inline-block; font-weight:600">View Opportunity</a>
    </div>
    <p style="color:${brand.gray500}; font-size:13px">If the button doesn't work, copy this link:<br/>
      <a href="${params.callUrl}" style="color:${brand.primary}">${params.callUrl}</a>
    </p>
    <p style="color:${brand.gray500}; font-size:12px">You're receiving this because the call matches your researcher profile on ${brand.name}. <a href="${MANAGE_ALERTS_URL}" style="color:${brand.primary}">Manage alert preferences</a></p>
  </div>`
  const textDetails = [
    params.agency ? `Funder: ${params.agency}` : '',
    params.deadline ? `Deadline: ${params.deadline}` : '',
    params.amount ? `Funding: ${params.amount}` : '',
  ].filter(Boolean).join(' | ')
  const text = `Hi ${displayName}, a new funding call matches your research: ${params.callTitle}. ${textDetails} View: ${params.callUrl}`
  return { subject: `Funding match: ${params.callTitle.slice(0, 80)}`, html, text }
}

/**
 * Daily/weekly digest bundling every funding alert queued since the last run.
 */
export function fundingAlertDigestTemplate(params: {
  email: string
  name?: string | null
  frequency: 'daily' | 'weekly'
  items: Array<{
    title: string
    agency: string | null
    deadline: string | null
    amount: string | null
    matchReason: string | null
    callUrl: string
  }>
}) {
  const displayName = friendlyName(params.email, params.name)
  const count = params.items.length
  const periodLabel = params.frequency === 'daily' ? 'today' : 'this week'
  const cards = params.items.map((item) => {
    const detailRows = [
      item.agency ? escapeHtml(item.agency) : '',
      item.deadline ? `Deadline ${escapeHtml(item.deadline)}` : '',
      item.amount ? escapeHtml(item.amount) : '',
    ].filter(Boolean).join(' · ')
    return `
    <div style="border:1px solid #E2E8F0; border-radius:12px; padding:14px 16px; margin:10px 0">
      <a href="${item.callUrl}" style="color:${brand.gray700}; font-weight:600; font-size:15px; text-decoration:none">${escapeHtml(item.title)}</a>
      ${detailRows ? `<p style="color:${brand.gray500}; font-size:13px; margin:6px 0 0">${detailRows}</p>` : ''}
      ${item.matchReason ? `<p style="color:${brand.gray500}; font-size:12px; margin:6px 0 0; font-style:italic">${escapeHtml(item.matchReason)}</p>` : ''}
      <p style="margin:8px 0 0"><a href="${item.callUrl}" style="color:${brand.primary}; font-size:13px; font-weight:600">View opportunity →</a></p>
    </div>`
  }).join('')
  const html = `
  <div style="font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; max-width: 640px; margin: 0 auto; padding: 24px; background: #ffffff">
    <div style="text-align:center; margin-bottom: 16px">
      <div style="display:inline-block; background:${brand.primary}; color:#fff; padding:8px 12px; border-radius:12px; font-weight:600;">${brand.name}</div>
    </div>
    <h2 style="color:${brand.gray700}; margin: 12px 0 8px">${count} funding ${count === 1 ? 'opportunity' : 'opportunities'} for you ${periodLabel}</h2>
    <p style="color:${brand.gray500}; line-height:1.6">Hi ${displayName},</p>
    <p style="color:${brand.gray500}; line-height:1.6">These recently published funding calls match your research profile:</p>
    ${cards}
    <p style="color:${brand.gray500}; font-size:12px; margin-top:20px">You're receiving this ${params.frequency} digest because these calls match your researcher profile on ${brand.name}. <a href="${MANAGE_ALERTS_URL}" style="color:${brand.primary}">Manage alert preferences</a></p>
  </div>`
  const text = `Hi ${displayName}, ${count} funding ${count === 1 ? 'opportunity matches' : 'opportunities match'} your research ${periodLabel}:\n` +
    params.items.map((item) => `- ${item.title}${item.deadline ? ` (deadline ${item.deadline})` : ''}: ${item.callUrl}`).join('\n')
  return {
    subject: `${count} new funding ${count === 1 ? 'match' : 'matches'} for your research`,
    html,
    text,
  }
}

// --- Funding department -----------------------------------------------------
// Assignment mail used to be hand-rolled SendGrid HTML inside the route. It
// lives here now so the department's four emails share one look and one sender
// with the rest of the product.

const ASSIGNMENTS_URL = `${SITE_URL}/assignments`

function shell(heading: string, body: string) {
  return `
  <div style="font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; max-width: 640px; margin: 0 auto; padding: 24px; background: #ffffff">
    <div style="text-align:center; margin-bottom: 16px">
      <div style="display:inline-block; background:${brand.primary}; color:#fff; padding:8px 12px; border-radius:12px; font-weight:600;">${brand.name}</div>
    </div>
    <h2 style="color:${brand.gray700}; margin: 12px 0 8px">${heading}</h2>
    ${body}
  </div>`
}

function primaryButton(url: string, label: string) {
  return `
    <div style="margin:24px 0">
      <a href="${url}" style="background:${brand.primary}; color:#fff; text-decoration:none; padding:12px 20px; border-radius:10px; display:inline-block; font-weight:600">${label}</a>
    </div>`
}

function statLine(label: string, value: number) {
  return `<p style="color:${brand.gray500}; font-size:14px; margin:4px 0"><strong style="color:${brand.gray700}">${value}</strong> ${escapeHtml(label)}</p>`
}

/** A funding call has been handed to this faculty member. */
export function assignmentNotificationTemplate(params: {
  email: string
  name?: string | null
  assignerName: string
  callTitle: string
  agency: string | null
  deadline: string | null
  message: string | null
}) {
  const displayName = friendlyName(params.email, params.name)
  const title = escapeHtml(params.callTitle)
  const body = `
    <p style="color:${brand.gray500}; line-height:1.6">Hi ${displayName},</p>
    <p style="color:${brand.gray500}; line-height:1.6">${escapeHtml(params.assignerName)} has asked you to consider this funding call.</p>
    <div style="border:1px solid #E2E8F0; border-radius:12px; padding:16px 18px; margin:16px 0">
      <div style="color:${brand.gray700}; font-weight:600; font-size:16px; margin-bottom:6px">${title}</div>
      ${params.agency ? `<p style="color:${brand.gray500}; font-size:14px; margin:4px 0">${escapeHtml(params.agency)}</p>` : ''}
      ${params.deadline ? `<p style="color:${brand.gray500}; font-size:14px; margin:4px 0"><strong>Internal deadline:</strong> ${escapeHtml(params.deadline)}</p>` : ''}
      ${params.message ? `<p style="border-left:3px solid #E2E8F0; margin:12px 0 0; padding-left:12px; color:${brand.gray500}; font-size:14px">${escapeHtml(params.message)}</p>` : ''}
    </div>
    <p style="color:${brand.gray500}; line-height:1.6">Please let the funding department know whether you will take it up — you can accept or decline in one click.</p>
    ${primaryButton(ASSIGNMENTS_URL, 'Respond to this assignment')}
    <p style="color:${brand.gray500}; font-size:13px">If the button doesn't work, copy this link:<br/>
      <a href="${ASSIGNMENTS_URL}" style="color:${brand.primary}">${ASSIGNMENTS_URL}</a>
    </p>`
  const text =
    `Hi ${displayName}, ${params.assignerName} assigned you a funding call: ${params.callTitle}.` +
    `${params.deadline ? ` Internal deadline ${params.deadline}.` : ''}` +
    `${params.message ? ` Note: ${params.message}` : ''}` +
    ` Accept or decline: ${ASSIGNMENTS_URL}`
  return {
    subject: `You have been assigned: ${params.callTitle.slice(0, 80)}`,
    html: shell('New funding call assignment', body),
    text,
  }
}

/** A scheduled nudge from the funding department about an open assignment. */
export function assignmentReminderTemplate(params: {
  email: string
  name?: string | null
  callTitle: string
  deadline: string | null
  note: string | null
  fromName: string | null
}) {
  const displayName = friendlyName(params.email, params.name)
  const body = `
    <p style="color:${brand.gray500}; line-height:1.6">Hi ${displayName},</p>
    <p style="color:${brand.gray500}; line-height:1.6">A reminder about the funding call you were assigned:</p>
    <div style="border:1px solid #E2E8F0; border-radius:12px; padding:16px 18px; margin:16px 0">
      <div style="color:${brand.gray700}; font-weight:600; font-size:16px; margin-bottom:6px">${escapeHtml(params.callTitle)}</div>
      ${params.deadline ? `<p style="color:${brand.gray500}; font-size:14px; margin:4px 0"><strong>Internal deadline:</strong> ${escapeHtml(params.deadline)}</p>` : ''}
      ${params.note ? `<p style="border-left:3px solid #E2E8F0; margin:12px 0 0; padding-left:12px; color:${brand.gray500}; font-size:14px">${escapeHtml(params.note)}</p>` : ''}
    </div>
    ${primaryButton(ASSIGNMENTS_URL, 'Open my assignments')}
    <p style="color:${brand.gray500}; font-size:12px">Sent by ${escapeHtml(params.fromName || 'the funding department')} at your institution.</p>`
  const text =
    `Hi ${displayName}, a reminder about ${params.callTitle}.` +
    `${params.deadline ? ` Internal deadline ${params.deadline}.` : ''}` +
    `${params.note ? ` ${params.note}` : ''} ${ASSIGNMENTS_URL}`
  return {
    subject: `Reminder: ${params.callTitle.slice(0, 80)}`,
    html: shell('A reminder from the funding department', body),
    text,
  }
}

/** Weekly worklist for one department member. */
export function fundingDeptWeeklyMemberTemplate(params: {
  email: string
  name?: string | null
  active: number
  missed: number
  declined: number
  dueSoon: Array<{ callTitle: string; facultyName: string | null; deadline: string | null }>
  overdueReminders: Array<{ note: string; facultyName: string | null }>
  openCalls: Array<{ title: string; closesAt: string | null }>
  dashboardUrl: string
}) {
  const displayName = friendlyName(params.email, params.name)
  const listBlock = (heading: string, items: string[]) =>
    items.length === 0
      ? ''
      : `<h3 style="color:${brand.gray700}; font-size:15px; margin:20px 0 6px">${escapeHtml(heading)}</h3>
         <ul style="color:${brand.gray500}; font-size:14px; line-height:1.7; padding-left:18px; margin:0">${items
           .map((item) => `<li>${item}</li>`)
           .join('')}</ul>`

  const body = `
    <p style="color:${brand.gray500}; line-height:1.6">Hi ${displayName}, here is where your funding calls stand this week.</p>
    <div style="border:1px solid #E2E8F0; border-radius:12px; padding:16px 18px; margin:16px 0">
      ${statLine('active assignments', params.active)}
      ${statLine('past their internal deadline', params.missed)}
      ${statLine('declined and needing a new home', params.declined)}
    </div>
    ${listBlock(
      'Deadlines in the next 30 days',
      params.dueSoon.map(
        (item) =>
          `${escapeHtml(item.callTitle)}${item.facultyName ? ` — ${escapeHtml(item.facultyName)}` : ''}${item.deadline ? ` (${escapeHtml(item.deadline)})` : ''}`
      )
    )}
    ${listBlock(
      'Follow-ups you scheduled that are now due',
      params.overdueReminders.map(
        (item) =>
          `${escapeHtml(item.note.slice(0, 120))}${item.facultyName ? ` — ${escapeHtml(item.facultyName)}` : ''}`
      )
    )}
    ${listBlock(
      'Closing soon with nobody from your schools on them',
      params.openCalls.map(
        (item) => `${escapeHtml(item.title)}${item.closesAt ? ` (closes ${escapeHtml(item.closesAt)})` : ''}`
      )
    )}
    ${primaryButton(params.dashboardUrl, 'Open my department dashboard')}`

  const text =
    `Hi ${displayName}. Active: ${params.active}. Overdue: ${params.missed}. Declined: ${params.declined}. ` +
    `${params.dueSoon.length} deadline(s) in the next 30 days, ${params.overdueReminders.length} follow-up(s) due, ` +
    `${params.openCalls.length} call(s) closing soon with nobody assigned. ${params.dashboardUrl}`

  return {
    subject: `Your funding calls this week: ${params.active} active, ${params.missed} overdue`,
    html: shell('Your week in the funding department', body),
    text,
  }
}

/** Weekly department rollup for the head. */
export function fundingDeptWeeklyHeadTemplate(params: {
  email: string
  name?: string | null
  memberRows: Array<{
    name: string
    schoolCount: number
    active: number
    submitted: number
    missed: number
    declined: number
    followUps: number
  }>
  uncoveredSchools: string[]
  overviewUrl: string
}) {
  const displayName = friendlyName(params.email, params.name)
  const cell = (value: string | number, bold = false) =>
    `<td style="padding:8px 10px; border-bottom:1px solid #E2E8F0; color:${bold ? brand.gray700 : brand.gray500}; font-size:14px; ${bold ? 'font-weight:600;' : ''}">${escapeHtml(String(value))}</td>`

  const table = `
    <table style="width:100%; border-collapse:collapse; margin:16px 0">
      <thead>
        <tr>
          ${['Member', 'Schools', 'Active', 'Submitted', 'Overdue', 'Declined', 'Follow-ups']
            .map(
              (heading) =>
                `<th style="text-align:left; padding:8px 10px; border-bottom:2px solid #E2E8F0; color:${brand.gray700}; font-size:12px; text-transform:uppercase; letter-spacing:0.04em">${heading}</th>`
            )
            .join('')}
        </tr>
      </thead>
      <tbody>
        ${params.memberRows
          .map(
            (row) => `<tr>
              ${cell(row.name, true)}${cell(row.schoolCount)}${cell(row.active)}${cell(row.submitted)}${cell(row.missed)}${cell(row.declined)}${cell(row.followUps)}
            </tr>`
          )
          .join('')}
      </tbody>
    </table>`

  const uncovered =
    params.uncoveredSchools.length === 0
      ? `<p style="color:${brand.gray500}; font-size:14px">Every school has a member looking after it.</p>`
      : `<div style="border:1px solid #FCA5A5; background:#FEF2F2; border-radius:12px; padding:14px 16px; margin:16px 0">
           <div style="color:#B91C1C; font-weight:600; font-size:14px; margin-bottom:4px">${params.uncoveredSchools.length} school${params.uncoveredSchools.length === 1 ? '' : 's'} with nobody assigned</div>
           <p style="color:${brand.gray500}; font-size:13px; margin:0">${params.uncoveredSchools.map(escapeHtml).join(', ')}</p>
         </div>`

  const body = `
    <p style="color:${brand.gray500}; line-height:1.6">Hi ${displayName}, here is how the department is tracking this week.</p>
    ${table}
    ${uncovered}
    ${primaryButton(params.overviewUrl, 'Open the department overview')}`

  const text =
    `Hi ${displayName}. Department this week:\n` +
    params.memberRows
      .map(
        (row) =>
          `- ${row.name}: ${row.active} active, ${row.submitted} submitted, ${row.missed} overdue, ${row.declined} declined, ${row.followUps} follow-ups`
      )
      .join('\n') +
    (params.uncoveredSchools.length > 0
      ? `\nUncovered schools: ${params.uncoveredSchools.join(', ')}`
      : '') +
    `\n${params.overviewUrl}`

  return {
    subject: `Funding department weekly review${params.uncoveredSchools.length > 0 ? ` — ${params.uncoveredSchools.length} school(s) uncovered` : ''}`,
    html: shell('Funding department: weekly review', body),
    text,
  }
}

// ---------------------------------------------------------------------------
// The proposal desk
//
// Three moments where an in-app notice is not enough, because the recipient is
// being asked to act by a date: a review has come back, a cut-off is upon them,
// and — for the office rather than the applicant — a draft has been sitting
// unread past the service level the department set itself.
// ---------------------------------------------------------------------------

/** A review the funding department has just sent back to the applicant. */
export function proposalReviewSharedTemplate(params: {
  email: string
  name?: string | null
  proposalTitle: string
  agency: string | null
  score: number | null
  recommendation: string | null
  officerNote: string | null
  officerName: string | null
  priorityActions?: string[]
  proposalId: string
}) {
  const displayName = friendlyName(params.email, params.name)
  const url = `${SITE_URL}/proposals/${params.proposalId}`
  const actions = (params.priorityActions || []).slice(0, 3)

  const body = `
    <p style="color:${brand.gray500}; line-height:1.6">Hi ${displayName},</p>
    <p style="color:${brand.gray500}; line-height:1.6">${
      params.officerName ? `${escapeHtml(params.officerName)} at the` : 'The'
    } funding department has reviewed your draft and sent the report back.</p>
    <div style="border:1px solid #E2E8F0; border-radius:12px; padding:16px 18px; margin:16px 0">
      <div style="color:${brand.gray700}; font-weight:600; font-size:16px; margin-bottom:6px">${escapeHtml(params.proposalTitle)}</div>
      ${params.agency ? `<p style="color:${brand.gray500}; font-size:14px; margin:4px 0">${escapeHtml(params.agency)}</p>` : ''}
      ${
        params.score != null
          ? `<p style="color:${brand.gray500}; font-size:14px; margin:8px 0 0"><strong>Overall score:</strong> ${params.score.toFixed(1)} out of 10${params.recommendation ? ` · ${escapeHtml(String(params.recommendation).replace(/_/g, ' '))}` : ''}</p>`
          : ''
      }
      ${
        params.officerNote
          ? `<p style="border-left:3px solid #E2E8F0; margin:12px 0 0; padding-left:12px; color:${brand.gray500}; font-size:14px">${escapeHtml(params.officerNote)}</p>`
          : ''
      }
    </div>
    ${
      actions.length
        ? `<p style="color:${brand.gray700}; font-weight:600; font-size:14px; margin:16px 0 6px">What to fix first</p>
           <ul style="color:${brand.gray500}; font-size:14px; line-height:1.6; padding-left:18px; margin:0">
             ${actions.map((action) => `<li>${escapeHtml(action)}</li>`).join('')}
           </ul>`
        : ''
    }
    <p style="color:${brand.gray500}; line-height:1.6">Read the full remarks, then upload your revised draft on the same page.</p>
    ${primaryButton(url, 'Read the review')}
    <p style="color:${brand.gray500}; font-size:13px">If the button doesn't work, copy this link:<br/>
      <a href="${url}" style="color:${brand.primary}">${url}</a>
    </p>`

  const text =
    `Hi ${displayName}, the funding department has reviewed your draft of "${params.proposalTitle}".` +
    `${params.score != null ? ` Overall score ${params.score.toFixed(1)}/10.` : ''}` +
    `${params.officerNote ? ` Note: ${params.officerNote}` : ''}` +
    `${actions.length ? ` Fix first: ${actions.join('; ')}.` : ''}` +
    ` Read it and upload your revision: ${url}`

  return {
    subject: `Your proposal review is ready: ${params.proposalTitle.slice(0, 70)}`,
    html: shell('Your proposal review is ready', body),
    text,
  }
}

/** The department's cut-off for a revised draft is close. */
export function proposalCutoffTemplate(params: {
  email: string
  name?: string | null
  proposalTitle: string
  cutoffDate: string
  daysLeft: number
  proposalId: string
}) {
  const displayName = friendlyName(params.email, params.name)
  const url = `${SITE_URL}/proposals/${params.proposalId}`
  const urgent = params.daysLeft <= 1

  const body = `
    <p style="color:${brand.gray500}; line-height:1.6">Hi ${displayName},</p>
    <p style="color:${brand.gray500}; line-height:1.6">${
      urgent
        ? 'Your funding department stops accepting revised drafts tomorrow.'
        : `Your funding department stops accepting revised drafts in ${params.daysLeft} days.`
    }</p>
    <div style="border:1px solid #E2E8F0; border-radius:12px; padding:16px 18px; margin:16px 0">
      <div style="color:${brand.gray700}; font-weight:600; font-size:16px; margin-bottom:6px">${escapeHtml(params.proposalTitle)}</div>
      <p style="color:${brand.gray500}; font-size:14px; margin:4px 0"><strong>Cut-off:</strong> ${escapeHtml(params.cutoffDate)}</p>
    </div>
    <p style="color:${brand.gray500}; line-height:1.6">They need the remaining days to read and clear it before the agency deadline. If you need longer, speak to your funding officer.</p>
    ${primaryButton(url, 'Upload your revision')}
    <p style="color:${brand.gray500}; font-size:13px">If the button doesn't work, copy this link:<br/>
      <a href="${url}" style="color:${brand.primary}">${url}</a>
    </p>`

  const text =
    `Hi ${displayName}, the funding department's cut-off for revised drafts of "${params.proposalTitle}" is ${params.cutoffDate}` +
    `${urgent ? ' — tomorrow.' : ` (${params.daysLeft} days).`}` +
    ` Upload your revision: ${url}`

  return {
    subject: urgent
      ? `Due tomorrow: revised draft for ${params.proposalTitle.slice(0, 60)}`
      : `${params.daysLeft} days left: revised draft for ${params.proposalTitle.slice(0, 55)}`,
    html: shell(urgent ? 'Your revision is due tomorrow' : 'Your revision is due soon', body),
    text,
  }
}

/** A draft the office has left unread, or a finished review it has not sent. */
export function proposalReviewSlaTemplate(params: {
  email: string
  name?: string | null
  proposalTitle: string
  researcherName: string
  versionNo: number
  waitingDays: number
  state: 'unreviewed' | 'unsent'
  proposalId: string
}) {
  const displayName = friendlyName(params.email, params.name)
  const url = `${SITE_URL}/funding-dept/proposals/${params.proposalId}`
  const what =
    params.state === 'unsent'
      ? 'has been reviewed but the report has not been sent back'
      : 'has not been reviewed yet'

  const body = `
    <p style="color:${brand.gray500}; line-height:1.6">Hi ${displayName},</p>
    <p style="color:${brand.gray500}; line-height:1.6">A draft in one of your schools ${what}.</p>
    <div style="border:1px solid #E2E8F0; border-radius:12px; padding:16px 18px; margin:16px 0">
      <div style="color:${brand.gray700}; font-weight:600; font-size:16px; margin-bottom:6px">${escapeHtml(params.proposalTitle)}</div>
      <p style="color:${brand.gray500}; font-size:14px; margin:4px 0">${escapeHtml(params.researcherName)} · version ${params.versionNo}</p>
      <p style="color:${brand.gray500}; font-size:14px; margin:4px 0"><strong>Waiting:</strong> ${params.waitingDays} days</p>
    </div>
    ${primaryButton(url, 'Open the proposal')}
    <p style="color:${brand.gray500}; font-size:13px">If the button doesn't work, copy this link:<br/>
      <a href="${url}" style="color:${brand.primary}">${url}</a>
    </p>`

  const text =
    `Hi ${displayName}, "${params.proposalTitle}" (${params.researcherName}, v${params.versionNo}) ${what}` +
    ` after ${params.waitingDays} days. Open it: ${url}`

  return {
    subject: `Waiting ${params.waitingDays} days: ${params.proposalTitle.slice(0, 60)}`,
    html: shell('A proposal draft is waiting', body),
    text,
  }
}

/** A fresh draft has arrived for the officer who covers that school. */
export function proposalVersionUploadedTemplate(params: {
  email: string
  name?: string | null
  proposalTitle: string
  researcherName: string
  versionNo: number
  note: string | null
  proposalId: string
}) {
  const displayName = friendlyName(params.email, params.name)
  const url = `${SITE_URL}/funding-dept/proposals/${params.proposalId}`

  const body = `
    <p style="color:${brand.gray500}; line-height:1.6">Hi ${displayName},</p>
    <p style="color:${brand.gray500}; line-height:1.6">${escapeHtml(params.researcherName)} has uploaded ${params.versionNo === 1 ? 'a draft' : `version ${params.versionNo}`} for review.</p>
    <div style="border:1px solid #E2E8F0; border-radius:12px; padding:16px 18px; margin:16px 0">
      <div style="color:${brand.gray700}; font-weight:600; font-size:16px; margin-bottom:6px">${escapeHtml(params.proposalTitle)}</div>
      ${
        params.note
          ? `<p style="border-left:3px solid #E2E8F0; margin:12px 0 0; padding-left:12px; color:${brand.gray500}; font-size:14px">${escapeHtml(params.note)}</p>`
          : ''
      }
    </div>
    ${primaryButton(url, 'Open the proposal')}
    <p style="color:${brand.gray500}; font-size:13px">If the button doesn't work, copy this link:<br/>
      <a href="${url}" style="color:${brand.primary}">${url}</a>
    </p>`

  const text =
    `Hi ${displayName}, ${params.researcherName} uploaded version ${params.versionNo} of "${params.proposalTitle}".` +
    `${params.note ? ` Note: ${params.note}` : ''} Open it: ${url}`

  return {
    subject: `New draft from ${params.researcherName}: ${params.proposalTitle.slice(0, 55)}`,
    html: shell('A new proposal draft', body),
    text,
  }
}

/**
 * A letter the institution has issued and the applicant needs in hand.
 *
 * This one earns an email without question: an endorsement letter usually has
 * to be attached to a submission with a deadline, and an in-app badge is not
 * where somebody will find it at nine in the evening.
 */
export function proposalDocumentIssuedTemplate(params: {
  email: string
  name?: string | null
  proposalTitle: string
  documentTitle: string
  referenceNo: string | null
  issuedOn: string | null
  signedBy: string | null
  proposalId: string
}) {
  const displayName = friendlyName(params.email, params.name)
  const url = `${SITE_URL}/proposals/${params.proposalId}`

  const body = `
    <p style="color:${brand.gray500}; line-height:1.6">Hi ${displayName},</p>
    <p style="color:${brand.gray500}; line-height:1.6">Your funding department has issued the ${escapeHtml(
      params.documentTitle.toLowerCase()
    )} for your proposal. Download it and attach it to your submission.</p>
    <div style="border:1px solid #E2E8F0; border-radius:12px; padding:16px 18px; margin:16px 0">
      <div style="color:${brand.gray700}; font-weight:600; font-size:16px; margin-bottom:6px">${escapeHtml(params.documentTitle)}</div>
      <p style="color:${brand.gray500}; font-size:14px; margin:4px 0">${escapeHtml(params.proposalTitle)}</p>
      ${params.referenceNo ? `<p style="color:${brand.gray500}; font-size:14px; margin:4px 0"><strong>Reference:</strong> ${escapeHtml(params.referenceNo)}</p>` : ''}
      ${params.issuedOn ? `<p style="color:${brand.gray500}; font-size:14px; margin:4px 0"><strong>Issued:</strong> ${escapeHtml(params.issuedOn)}</p>` : ''}
      ${params.signedBy ? `<p style="color:${brand.gray500}; font-size:14px; margin:4px 0"><strong>Signed by:</strong> ${escapeHtml(params.signedBy)}</p>` : ''}
    </div>
    <p style="color:${brand.gray500}; line-height:1.6">The signed copy is on your proposal page, under Letters.</p>
    ${primaryButton(url, 'Download the letter')}
    <p style="color:${brand.gray500}; font-size:13px">If the button doesn't work, copy this link:<br/>
      <a href="${url}" style="color:${brand.primary}">${url}</a>
    </p>`

  const text =
    `Hi ${displayName}, your funding department has issued the ${params.documentTitle} for "${params.proposalTitle}"` +
    `${params.referenceNo ? ` (${params.referenceNo})` : ''}.` +
    ` Download it: ${url}`

  return {
    subject: `${params.documentTitle} issued: ${params.proposalTitle.slice(0, 55)}`,
    html: shell(`${params.documentTitle} issued`, body),
    text,
  }
}

/** A tickler the officer set on themselves has come due. */
export function proposalFollowUpDueTemplate(params: {
  email: string
  name?: string | null
  proposalTitle: string
  note: string
  proposalId: string
}) {
  const displayName = friendlyName(params.email, params.name)
  const url = `${SITE_URL}/funding-dept/proposals/${params.proposalId}`

  const body = `
    <p style="color:${brand.gray500}; line-height:1.6">Hi ${displayName},</p>
    <p style="color:${brand.gray500}; line-height:1.6">You asked to be reminded about this one.</p>
    <div style="border:1px solid #E2E8F0; border-radius:12px; padding:16px 18px; margin:16px 0">
      <div style="color:${brand.gray700}; font-weight:600; font-size:16px; margin-bottom:6px">${escapeHtml(params.proposalTitle)}</div>
      <p style="border-left:3px solid #E2E8F0; margin:12px 0 0; padding-left:12px; color:${brand.gray500}; font-size:14px">${escapeHtml(params.note)}</p>
    </div>
    ${primaryButton(url, 'Open the proposal')}
    <p style="color:${brand.gray500}; font-size:13px">If the button doesn't work, copy this link:<br/>
      <a href="${url}" style="color:${brand.primary}">${url}</a>
    </p>`

  const text = `Hi ${displayName}, your reminder on "${params.proposalTitle}": ${params.note}. Open it: ${url}`

  return {
    subject: `Reminder: ${params.proposalTitle.slice(0, 60)}`,
    html: shell('Your reminder', body),
    text,
  }
}

/** A post-award obligation the agency expects by a date. */
export function proposalObligationDueTemplate(params: {
  email: string
  name?: string | null
  proposalTitle: string
  obligation: string
  dueDate: string
  daysLeft: number
  proposalId: string
  forOfficer: boolean
}) {
  const displayName = friendlyName(params.email, params.name)
  const url = params.forOfficer
    ? `${SITE_URL}/funding-dept/proposals/${params.proposalId}`
    : `${SITE_URL}/proposals/${params.proposalId}`
  const overdue = params.daysLeft < 0

  const body = `
    <p style="color:${brand.gray500}; line-height:1.6">Hi ${displayName},</p>
    <p style="color:${brand.gray500}; line-height:1.6">${
      overdue
        ? `This is now ${Math.abs(params.daysLeft)} days overdue with the agency.`
        : params.daysLeft === 0
          ? 'This is due today.'
          : `This is due in ${params.daysLeft} days.`
    }</p>
    <div style="border:1px solid #E2E8F0; border-radius:12px; padding:16px 18px; margin:16px 0">
      <div style="color:${brand.gray700}; font-weight:600; font-size:16px; margin-bottom:6px">${escapeHtml(params.obligation)}</div>
      <p style="color:${brand.gray500}; font-size:14px; margin:4px 0">${escapeHtml(params.proposalTitle)}</p>
      <p style="color:${brand.gray500}; font-size:14px; margin:4px 0"><strong>Due:</strong> ${escapeHtml(params.dueDate)}</p>
    </div>
    <p style="color:${brand.gray500}; line-height:1.6">A missed utilisation certificate is the usual reason a next instalment is held.</p>
    ${primaryButton(url, 'Open the project')}
    <p style="color:${brand.gray500}; font-size:13px">If the button doesn't work, copy this link:<br/>
      <a href="${url}" style="color:${brand.primary}">${url}</a>
    </p>`

  const text =
    `Hi ${displayName}, ${params.obligation} for "${params.proposalTitle}" is due ${params.dueDate}` +
    `${overdue ? ` — ${Math.abs(params.daysLeft)} days overdue.` : '.'} Open it: ${url}`

  return {
    subject: overdue
      ? `Overdue: ${params.obligation} for ${params.proposalTitle.slice(0, 45)}`
      : `Due ${params.dueDate}: ${params.obligation}`,
    html: shell(overdue ? 'An agency obligation is overdue' : 'An agency obligation is due', body),
    text,
  }
}
