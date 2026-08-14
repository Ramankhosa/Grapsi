import { NextResponse } from 'next/server'

const MAILJET_API_URL = 'https://api.mailjet.com/v3.1/send'

function getEnv(name: string, fallback?: string) {
  return process.env[name] || process.env[name.toUpperCase()] || fallback || ''
}

const MAILJET_KEY = getEnv('MAILJET_API_KEY', getEnv('Mailjet_Key'))
const MAILJET_SECRET = getEnv('MAILJET_API_SECRET', getEnv('Secret_Key'))
const SITE_URL = getEnv('SITE_URL', getEnv('NEXTAUTH_URL', 'http://localhost:3000'))

// The verified sender every outbound email is sent as. Must be an address (or
// domain) verified in the Mailjet account, or Mailjet rejects the send — see
// the deploy note in this file's callers. Overridable per environment so the
// same build can send as a different brand without a code change.
const MAIL_FROM_EMAIL = getEnv('MAIL_FROM_EMAIL', 'admin@aigrantmentor.com')
const MAIL_FROM_NAME = getEnv('MAIL_FROM_NAME', 'AIGrantMentor')

export interface EmailMessage {
  to: string
  toName?: string
  subject: string
  html: string
  text?: string
}

export async function sendEmail(msg: EmailMessage) {
  if (!MAILJET_KEY || !MAILJET_SECRET) {
    console.warn('Mailjet keys missing; logging email instead of sending:', msg.subject, '->', msg.to)
    return { sent: false }
  }
  const auth = Buffer.from(`${MAILJET_KEY}:${MAILJET_SECRET}`).toString('base64')
  const body = {
    Messages: [
      {
        From: { Email: MAIL_FROM_EMAIL, Name: MAIL_FROM_NAME },
        To: [{ Email: msg.to, ...(msg.toName ? { Name: msg.toName } : {}) }],
        Subject: msg.subject,
        HTMLPart: msg.html,
        TextPart: msg.text || ''
      }
    ]
  }
  const res = await fetch(MAILJET_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`Mailjet send failed (${res.status}): ${t}`)
  }
  return { sent: true }
}

export { SITE_URL, MAIL_FROM_EMAIL, MAIL_FROM_NAME }
