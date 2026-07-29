import { SITE_URL } from './mailer'

const brand = {
  name: 'PatentNest',
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
}) {
  const displayName = friendlyName(params.email)
  const roleLabel = params.role.charAt(0) + params.role.slice(1).toLowerCase()
  const expiryDate = params.expiresAt.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })
  const html = `
  <div style="font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; max-width: 640px; margin: 0 auto; padding: 24px; background: #ffffff">
    <div style="text-align:center; margin-bottom: 16px">
      <div style="display:inline-block; background:${brand.primary}; color:#fff; padding:8px 12px; border-radius:12px; font-weight:600;">${brand.name}</div>
    </div>
    <h2 style="color:${brand.gray700}; margin: 12px 0 8px">You're invited to join ${params.tenantName}</h2>
    <p style="color:${brand.gray500}; line-height:1.6">Hi ${displayName},</p>
    <p style="color:${brand.gray500}; line-height:1.6"><strong>${params.inviterName}</strong> invited you to join <strong>${params.tenantName}</strong> on ${brand.name} as a <strong>${roleLabel}</strong>. Click the button below to create your account — your access is already set up.</p>
    <div style="margin:24px 0">
      <a href="${params.inviteLink}" style="background:${brand.primary}; color:#fff; text-decoration:none; padding:12px 20px; border-radius:10px; display:inline-block; font-weight:600">Accept Invitation</a>
    </div>
    <p style="color:${brand.gray500}; font-size:13px">If the button doesn't work, copy this link:<br/>
      <a href="${params.inviteLink}" style="color:${brand.primary}">${params.inviteLink}</a>
    </p>
    <p style="color:${brand.gray500}; font-size:12px">This invitation is for ${params.email} and expires on ${expiryDate}. If you weren't expecting it, you can safely ignore this email.</p>
  </div>`
  const text = `Hi ${displayName}, ${params.inviterName} invited you to join ${params.tenantName} on ${brand.name} as ${roleLabel}. Accept: ${params.inviteLink} (expires ${expiryDate})`
  return { subject: `${params.inviterName} invited you to ${params.tenantName} on ${brand.name}`, html, text }
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
}) {
  const displayName = friendlyName(params.email, params.name)
  const url = `${SITE_URL}/reset-password?token=${encodeURIComponent(params.token)}`
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
    <p style="color:${brand.gray500}; font-size:12px">This link expires in 1 hour. You can request a fresh one any time from the sign-in page via "Forgot password".</p>
  </div>`
  const text = `Hi ${displayName}, an account was created for you at ${params.tenantName} on ${brand.name}. Set your password to activate ${params.email}: ${url} (expires in 1 hour)`
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
