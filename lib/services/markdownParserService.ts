// @ts-nocheck
/**
 * Minimal reviewer markdown/html helpers used by the imported GrantGenie
 * reviewer pages. The parent service had optional markdown parsing
 * dependencies that Grapsi does not otherwise need for this v1 import.
 */

export function extractTextFromHTML(htmlContent: string): string {
  if (!htmlContent) return ''

  return htmlContent
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/td>/gi, ' ')
    .replace(/<\/th>/gi, ' ')
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

export function htmlToMarkdown(htmlContent: string): string {
  return extractTextFromHTML(htmlContent)
}

export class MarkdownParserService {
  async parseMarkdown(markdown: string) {
    return {
      agencyName: '',
      schemeTitle: '',
      description: String(markdown || '').trim(),
      countryAvailability: [],
      eligibleApplicantCountries: [],
      applicantTypes: [],
      grantTypes: [],
      researchAreas: [],
      urls: [],
    }
  }
}
