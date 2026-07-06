import axios, { type AxiosInstance, type AxiosResponse } from 'axios'

import type {
  JsonRecord,
  PublicProjectContactInput,
  PublicProjectParticipantInput,
} from '@/lib/publicProjects/types'
import { PublicProjectSourceBlockedError } from '@/lib/publicProjects/types'

export const FUNDED_SOURCE_USER_AGENT =
  'GrapsiPublicProjectCrawler/1.0 (+https://grapsi.ai; public funded-project indexing; contact: support@grapsi.ai)'

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function cleanText(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const text = String(value)
    .replace(/\u00a0/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (!text || text === '-' || /^null$/i.test(text)) return null
  return text
}

export function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {}
}

export function asArray(value: unknown): unknown[] {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

export function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    const text = cleanText(value)
    if (text) return text
  }
  return null
}

export function parseYear(value: unknown): number | null {
  const text = cleanText(value)
  const match = text?.match(/\b(19|20)\d{2}\b/)
  return match ? Number(match[0]) : null
}

export function parseDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
  }
  const text = cleanText(value)
  if (!text) return null

  const slash = text.match(/\b(\d{1,2})\/(\d{1,2})\/((?:19|20)\d{2})\b/)
  if (slash) {
    const [, mm, dd, yyyy] = slash
    const date = new Date(Number(yyyy), Number(mm) - 1, Number(dd))
    return Number.isNaN(date.getTime()) ? null : date
  }

  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? null : date
}

export function dateYear(value: unknown): number | null {
  return parseDate(value)?.getFullYear() || parseYear(value)
}

export function numberText(value: unknown): string | null {
  const text = cleanText(value)
  if (!text) return null
  const match = text.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/)
  return match ? match[0] : null
}

export function splitKeywords(value: unknown): string[] {
  const text = cleanText(value)
  if (!text) return []
  return Array.from(
    new Set(
      text
        .split(/[,;|<>]/)
        .map((item) => cleanText(item))
        .filter((item): item is string => Boolean(item))
    )
  )
}

export function emailContacts(text: unknown, label: string): PublicProjectContactInput[] {
  const source = cleanText(text)
  if (!source) return []
  const emails = source.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []
  return Array.from(new Set(emails.map((email) => email.toLowerCase()))).map((email) => ({
    contactType: 'email',
    label,
    value: email,
  }))
}

export function participant(
  role: PublicProjectParticipantInput['role'],
  name: unknown,
  fields: Omit<PublicProjectParticipantInput, 'role' | 'name'> = {}
): PublicProjectParticipantInput | null {
  const cleanName = cleanText(name)
  if (!cleanName) return null
  return {
    role,
    name: cleanName,
    institutionName: cleanText(fields.institutionName),
    departmentName: cleanText(fields.departmentName),
    city: cleanText(fields.city),
    state: cleanText(fields.state),
    country: cleanText(fields.country),
    sourcePayload: fields.sourcePayload || null,
  }
}

export function createJsonClient(baseURL: string, timeoutMs: number): AxiosInstance {
  return axios.create({
    baseURL,
    timeout: timeoutMs,
    maxRedirects: 5,
    validateStatus: () => true,
    headers: {
      'User-Agent': FUNDED_SOURCE_USER_AGENT,
      Accept: 'application/json, text/plain, */*',
    },
  })
}

export function assertUsableResponse(sourceName: string, response: AxiosResponse<unknown>, path: string) {
  if (response.status === 403 || response.status === 429) {
    throw new PublicProjectSourceBlockedError(`${sourceName} blocked or rate-limited ${path} (${response.status})`)
  }
  if ([500, 502, 503, 504].includes(response.status)) {
    throw new Error(`${sourceName} temporary HTTP ${response.status} for ${path}`)
  }
  if (response.status >= 400) {
    throw new Error(`${sourceName} HTTP ${response.status} for ${path}`)
  }
}

export async function getJson<T>(
  client: AxiosInstance,
  sourceName: string,
  path: string,
  requestSpacingMs: number,
  lastRequestAt: { value: number },
  config: Record<string, unknown> = {}
): Promise<T> {
  const delay = Math.max(0, lastRequestAt.value + requestSpacingMs - Date.now())
  if (delay > 0) await sleep(delay)
  lastRequestAt.value = Date.now()

  const response = await client.get(path, config as any)
  assertUsableResponse(sourceName, response, path)
  return response.data as T
}

export async function postJson<T>(
  client: AxiosInstance,
  sourceName: string,
  path: string,
  body: unknown,
  requestSpacingMs: number,
  lastRequestAt: { value: number }
): Promise<T> {
  const delay = Math.max(0, lastRequestAt.value + requestSpacingMs - Date.now())
  if (delay > 0) await sleep(delay)
  lastRequestAt.value = Date.now()

  const response = await client.post(path, body, { headers: { 'Content-Type': 'application/json' } })
  assertUsableResponse(sourceName, response, path)
  return response.data as T
}
