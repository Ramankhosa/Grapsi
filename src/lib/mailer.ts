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

/**
 * Why a send failed, for callers that retry.
 *  - retryable: Mailjet definitely did not take the message (rate limit, 5xx,
 *    or the connection never opened) — sending again cannot duplicate it.
 *  - rejected:  Mailjet refused this message; sending it again will not help.
 *  - uncertain: the request went out but no clear answer came back (timeout,
 *    unreadable 200). Mailjet may have accepted it, so do not resend blindly.
 */
export type EmailFailureKind = 'retryable' | 'rejected' | 'uncertain'

export class EmailDeliveryError extends Error {
  constructor(message: string, readonly kind: EmailFailureKind) {
    super(message)
    this.name = 'EmailDeliveryError'
  }
}

const NOT_SENT_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH'])

function transportFailure(error: unknown): EmailDeliveryError {
  const message = error instanceof Error ? error.message : String(error)
  const code = (error as { cause?: { code?: string } })?.cause?.code
  return new EmailDeliveryError(`Mailjet request failed: ${message}`,
    code && NOT_SENT_CODES.has(code) ? 'retryable' : 'uncertain')
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
  let res: Response
  try {
    res = await fetch(MAILJET_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    })
  } catch (error) {
    throw transportFailure(error)
  }
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new EmailDeliveryError(`Mailjet send failed (${res.status}): ${t}`,
      res.status === 429 || res.status >= 500 ? 'retryable' : 'rejected')
  }
  const result = await res.json().catch(() => null)
  // Mailjet can return HTTP 200 while rejecting an individual message.
  if (!Array.isArray(result?.Messages) || result.Messages.length !== 1 || result.Messages[0]?.Status !== 'success') {
    const refused = Array.isArray(result?.Messages) && result.Messages[0]?.Status === 'error'
    throw new EmailDeliveryError('Mailjet did not confirm message acceptance', refused ? 'rejected' : 'uncertain')
  }
  return { sent: true }
}

export { SITE_URL, MAIL_FROM_EMAIL, MAIL_FROM_NAME }
