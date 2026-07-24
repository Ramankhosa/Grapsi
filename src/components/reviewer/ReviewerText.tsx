import React from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { extractMeaningfulText } from '@/lib/reviewer/content'

const EMPTY_EDITOR_TEXT = new Set(['', '{}', '[]', 'null', 'undefined'])

/**
 * Reduce HTML to text while keeping line structure.
 *
 * `extractMeaningfulText` collapses all whitespace, which is right for a single
 * label but destroys the paragraph and list breaks that markdown needs — a
 * bulleted executive summary would render as one run-on line.
 */
function stripHtmlPreservingBreaks(value: string): string {
  // Removing a tag leaves a space behind, which lands at the start of the next
  // line. Only tidy that when the input really was HTML — in authored markdown
  // leading spaces are meaningful (nested lists, indented code).
  const hadHtml = /<[a-z!/][^>]*>/i.test(value)

  const text = value
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    // The opening <li> already starts the line; closing it too would insert a
    // blank line between every bullet.
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/(p|div|h[1-6]|tr|ul|ol)>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  const tidied = hadHtml ? text.replace(/[ \t]*\n[ \t]*/g, '\n') : text

  return EMPTY_EDITOR_TEXT.has(tidied.toLowerCase()) ? '' : tidied
}

/**
 * Flatten whatever the reviewer model returned into displayable text.
 *
 * Review fields are declared as string arrays, but models intermittently return
 * objects ({point, detail}, {text}, {issue, recommendation}) or nest a level
 * deeper. Those used to reach the page as `[object Object]` or a raw JSON blob.
 * Any embedded HTML is reduced to text — reviewer content is never trusted
 * markup, since URL-sourced calls carry text lifted off third-party pages.
 */
export function coerceReviewerText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return stripHtmlPreservingBreaks(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)

  if (Array.isArray(value)) {
    return value.map(coerceReviewerText).filter(Boolean).join('; ')
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>

    const point = extractMeaningfulText(record.point ?? record.label ?? record.title ?? record.criterion)
    const detail = extractMeaningfulText(record.detail ?? record.description ?? record.evidence)
    if (point) return detail ? `**${point}**: ${detail}` : point

    for (const key of ['text', 'issue', 'recommendation', 'action', 'summary', 'value']) {
      const candidate = extractMeaningfulText(record[key])
      if (candidate) return candidate
    }

    return extractMeaningfulText(value)
  }

  return String(value)
}

const INLINE_COMPONENTS = {
  // Inline contexts (list items, table cells) must not gain block wrappers.
  p: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  a: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  code: ({ children }: { children?: React.ReactNode }) => (
    <code className="rounded bg-gray-100 px-1 py-0.5 text-[0.9em]">{children}</code>
  ),
}

const BLOCK_COMPONENTS = {
  p: ({ children }: { children?: React.ReactNode }) => <p className="mb-2 last:mb-0">{children}</p>,
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="mb-2 list-inside list-disc space-y-1 last:mb-0">{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="mb-2 list-inside list-decimal space-y-1 last:mb-0">{children}</ol>
  ),
  a: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  h1: ({ children }: { children?: React.ReactNode }) => <p className="mb-2 font-semibold">{children}</p>,
  h2: ({ children }: { children?: React.ReactNode }) => <p className="mb-2 font-semibold">{children}</p>,
  h3: ({ children }: { children?: React.ReactNode }) => <p className="mb-2 font-semibold">{children}</p>,
  code: ({ children }: { children?: React.ReactNode }) => (
    <code className="rounded bg-gray-100 px-1 py-0.5 text-[0.9em]">{children}</code>
  ),
}

/**
 * One line of reviewer output — a strength, a weakness, a recommendation.
 * Renders the model's markdown (`**bold**`, `` `code` ``) instead of showing
 * the asterisks, and stays inline so it can sit inside `<li>` or a table cell.
 * react-markdown does not render raw HTML unless rehype-raw is added, so this
 * is safe for model- and web-sourced text.
 */
export function ReviewerText({ value, fallback = '' }: { value: unknown; fallback?: string }) {
  const text = coerceReviewerText(value)
  if (!text) return <>{fallback}</>

  return (
    <Markdown remarkPlugins={[remarkGfm]} components={INLINE_COMPONENTS as never} skipHtml>
      {text}
    </Markdown>
  )
}

/**
 * Multi-paragraph reviewer output — an executive summary, a section narrative.
 * Same guarantees as `ReviewerText`, but keeps paragraph and list structure.
 */
export function ReviewerProse({
  value,
  fallback = '',
  className = '',
}: {
  value: unknown
  fallback?: string
  className?: string
}) {
  const text = coerceReviewerText(value)
  if (!text) return <span className={className}>{fallback}</span>

  return (
    <div className={className}>
      <Markdown remarkPlugins={[remarkGfm]} components={BLOCK_COMPONENTS as never} skipHtml>
        {text}
      </Markdown>
    </div>
  )
}

export default ReviewerText
