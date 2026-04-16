import { NextRequest, NextResponse } from 'next/server'
import { sendEmail } from '@/lib/mailer'

export const runtime = 'nodejs'

interface ContactPayload {
  name?: string
  email?: string
  phone?: string
  topic?: string
  message?: string
  recaptchaToken?: string
}

interface RecaptchaResponse {
  success: boolean
  score?: number
  action?: string
  'error-codes'?: string[]
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ContactPayload
    const name = (body.name || '').trim()
    const email = (body.email || '').trim()
    const phone = (body.phone || '').trim()
    const topic = (body.topic || 'Other').trim() || 'Other'
    const message = (body.message || '').trim()
    const recaptchaToken = body.recaptchaToken

    if (!name || !email) {
      return NextResponse.json({ error: 'Name and email are required.' }, { status: 400 })
    }

    if (!recaptchaToken) {
      return NextResponse.json({ error: 'CAPTCHA verification is required.' }, { status: 400 })
    }

    const recaptchaSecret = process.env.RECAPTCHA_SECRET_KEY
    if (!recaptchaSecret) {
      console.error('RECAPTCHA_SECRET_KEY is not configured')
      return NextResponse.json({ error: 'CAPTCHA is not configured on the server.' }, { status: 500 })
    }

    const verificationResponse = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `secret=${encodeURIComponent(recaptchaSecret)}&response=${encodeURIComponent(recaptchaToken)}`,
    })

    if (!verificationResponse.ok) {
      const text = await verificationResponse.text().catch(() => '')
      console.error('reCAPTCHA verification HTTP error:', verificationResponse.status, text)
      return NextResponse.json({ error: 'Failed to verify CAPTCHA.' }, { status: 502 })
    }

    const recaptchaJson = (await verificationResponse.json()) as RecaptchaResponse
    if (!recaptchaJson.success) {
      console.warn('reCAPTCHA verification failed:', recaptchaJson['error-codes'])
      return NextResponse.json({ error: 'CAPTCHA verification failed.' }, { status: 400 })
    }

    const safeTopic = topic || 'Other'
    const subject = `New contact request: ${safeTopic} — PatentNest.ai`

    const htmlParts = [
      `<p><strong>Topic:</strong> ${escapeHtml(safeTopic)}</p>`,
      `<p><strong>Name:</strong> ${escapeHtml(name)}</p>`,
      `<p><strong>Email:</strong> ${escapeHtml(email)}</p>`,
      `<p><strong>Phone:</strong> ${phone ? escapeHtml(phone) : '<em>Not provided</em>'}</p>`,
      `<p><strong>Message:</strong><br/>${message ? escapeHtml(message).replace(/\n/g, '<br/>') : '<em>No message provided</em>'}</p>`,
    ]

    const textParts = [
      `Topic: ${safeTopic}`,
      `Name: ${name}`,
      `Email: ${email}`,
      `Phone: ${phone || 'Not provided'}`,
      '',
      'Message:',
      message || 'No message provided',
    ]

    await sendEmail({
      to: 'ramankhosa@gmail.com',
      subject,
      html: `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; line-height: 1.6; color: #111827;">${htmlParts.join(
        '',
      )}</div>`,
      text: textParts.join('\n'),
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Contact API error:', error)
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 })
  }
}

function escapeHtml(input: string) {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

