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
