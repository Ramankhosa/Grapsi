import { NextRequest, NextResponse } from 'next/server'

import { requireFundingImporterRequest } from '@/lib/fundingIntake/routeAuth'

const GRADIO_APP_URL =
  process.env.FUNDING_CHATBOT_GRADIO_URL ||
  'https://genai-app-fundingchatbot-1-1750422556520-434532774441.us-central1.run.app/'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const auth = await requireFundingImporterRequest(request)
  if ('response' in auth) {
    return auth.response
  }

  try {
    const body = await request.json()
    const { message } = body as { message?: string }
    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: 'Message is required and must be a string' }, { status: 400 })
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30000)

    try {
      const response = await fetch(`${GRADIO_APP_URL.replace(/\/$/, '')}/api/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fn_index: 0,
          data: [{ text: message, files: [] }],
        }),
        signal: controller.signal,
      })

      const data = await response.json()
      if (data?.data) {
        return NextResponse.json({ reply: data.data[0] })
      }

      return NextResponse.json({ error: 'Failed to extract chatbot response from Gradio app' }, { status: 500 })
    } finally {
      clearTimeout(timeout)
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return NextResponse.json({ error: 'Chatbot service timed out. Please try again.' }, { status: 504 })
    }

    return NextResponse.json(
      {
        error: 'Failed to communicate with the chatbot',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}
