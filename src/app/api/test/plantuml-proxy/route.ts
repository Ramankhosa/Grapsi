import { NextRequest, NextResponse } from 'next/server'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
import crypto from 'crypto'
import plantumlEncoder from 'plantuml-encoder'

// Whitelist of allowed single-line skinparam keys (same as main route.ts)
const ALLOWED_SKINPARAM_KEYS = /^skinparam\s+(monochrome|shadowing|roundcorner|defaultFontName|defaultFontSize|ArrowColor|BorderColor|linetype)\b/i

// Allowed skinparam block types (sequence, activity)
const ALLOWED_SKINPARAM_BLOCKS = /^skinparam\s+(sequence|activity)\s*\{/i

// Cleans PlantUML code for rendering while preserving allowed skinparams
function cleanForRendering(code: string): string {
  const lines = code.split(/\r?\n/)
  const result: string[] = []
  
  let inAllowedBlock = false
  let inForbiddenBlock = false
  let braceDepth = 0
  
  for (const line of lines) {
    const trimmed = line.trim()
    
    // Remove title/caption
    if (/^\s*(title|caption)\b/i.test(trimmed)) continue
    
    // Remove forbidden directives
    if (/^\s*!\s*(theme|include|import|pragma)\b/i.test(trimmed)) continue
    
    // Drop obviously incomplete connection lines like "500 --"
    if (/^\s*\d+\s*--\s*$/.test(trimmed)) continue
    
    // Handle skinparam blocks
    if (/^\s*skinparam\s+\w+\s*\{/.test(trimmed)) {
      if (ALLOWED_SKINPARAM_BLOCKS.test(trimmed)) {
        inAllowedBlock = true
        braceDepth = 1
        result.push(line)
      } else {
        inForbiddenBlock = true
        braceDepth = 1
      }
      continue
    }
    
    // Handle block content
    if (inAllowedBlock || inForbiddenBlock) {
      for (const char of trimmed) {
        if (char === '{') braceDepth++
        else if (char === '}') braceDepth--
      }
      
      if (inAllowedBlock) {
        result.push(line)
      }
      
      if (braceDepth <= 0) {
        inAllowedBlock = false
        inForbiddenBlock = false
        braceDepth = 0
      }
      continue
    }
    
    // Handle single-line skinparam - keep only allowed ones
    if (/^\s*skinparam\b/i.test(trimmed)) {
      if (ALLOWED_SKINPARAM_KEYS.test(trimmed)) {
        result.push(line)
      }
      continue
    }
    
    // Keep all other lines
    result.push(line)
  }
  
  return result.join('\n')
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { code, format = 'svg', figureNo, patentId, sessionId } = body || {}
    if (!code || typeof code !== 'string') {
      return NextResponse.json({ error: 'code is required' }, { status: 400 })
    }
    if (format !== 'svg' && format !== 'png') {
      return NextResponse.json({ error: 'format must be svg or png' }, { status: 400 })
    }

    // Clean the PlantUML code while preserving allowed skinparams
    const cleaned = cleanForRendering(code)

    const encoded = plantumlEncoder.encode(cleaned)
    const base = process.env.PLANTUML_BASE_URL || 'https://www.plantuml.com/plantuml'
    const url = `${base}/${format}/${encoded}`

    const resp = await fetch(url, { cache: 'no-store', method: 'GET', headers: { 'Accept': format === 'svg' ? 'image/svg+xml' : 'image/png' } })
    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      const snippet = cleaned.slice(0, 400)
      console.warn('[PlantUML proxy] Upstream render failed', {
        upstreamStatus: resp.status,
        format,
        figureNo,
        patentId,
        sessionId,
        snippet
      })
      return NextResponse.json(
        { error: 'Upstream render failed', upstreamStatus: resp.status, details: text?.slice(0, 300) },
        { status: 502 }
      )
    }
    const buf = Buffer.from(await resp.arrayBuffer())
    const checksum = crypto.createHash('sha256').update(buf).digest('hex')

    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': format === 'svg' ? 'image/svg+xml' : 'image/png',
        'Cache-Control': 'private, max-age=0',
        'X-Checksum': checksum
      }
    })
  } catch (e) {
    console.warn('[PlantUML proxy] Bad request', e instanceof Error ? e.message : String(e))
    return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  }
}
