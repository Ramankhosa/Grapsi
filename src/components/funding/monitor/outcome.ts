/**
 * One colour per page result, shared by the page tree, its legend and the
 * filter chips. Green always means "a funding opportunity was found here";
 * the deeper green means it reached the catalog.
 */
export type { PageOutcome } from '@/lib/monitor/outcomes'
import type { PageOutcome } from '@/lib/monitor/outcomes'

export interface OutcomeStyle {
  label: string
  hint: string
  dot: string
  chip: string
  row: string
}

export const OUTCOME_STYLES: Record<PageOutcome, OutcomeStyle> = {
  PUBLISHED: {
    label: 'Published',
    hint: 'A funding call from this page is in the catalog',
    dot: 'bg-emerald-700',
    chip: 'border-emerald-300 bg-emerald-100 text-emerald-900',
    row: 'border-l-emerald-700 bg-emerald-50/70',
  },
  FUNDING_FOUND: {
    label: 'Funding found',
    hint: 'Screening judged this a funding opportunity and sent it for review',
    dot: 'bg-green-500',
    chip: 'border-green-300 bg-green-50 text-green-800',
    row: 'border-l-green-500 bg-green-50/60',
  },
  UNSURE: {
    label: 'Unsure',
    hint: 'Screening could not decide; a person should look',
    dot: 'bg-fuchsia-500',
    chip: 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-800',
    row: 'border-l-fuchsia-400',
  },
  INCOMPLETE: {
    label: 'Details incomplete',
    hint: 'Read, but the invitation, dates, round or host approval are missing',
    dot: 'bg-yellow-500',
    chip: 'border-yellow-200 bg-yellow-50 text-yellow-800',
    row: 'border-l-yellow-400',
  },
  WAITING_LOCAL: {
    label: 'Waiting for laptop',
    hint: 'Queued for the laptop’s first-pass analysis',
    dot: 'bg-teal-500',
    chip: 'border-teal-200 bg-teal-50 text-teal-800',
    row: 'border-l-teal-400',
  },
  SCREENING: {
    label: 'Being screened',
    hint: 'Seen recently; the AI is still deciding',
    dot: 'bg-violet-500',
    chip: 'border-violet-200 bg-violet-50 text-violet-800',
    row: 'border-l-violet-400',
  },
  NOT_FUNDING: {
    label: 'Not funding',
    hint: 'Screened out or rejected: not a funding call',
    dot: 'bg-slate-400',
    chip: 'border-slate-200 bg-slate-50 text-slate-700',
    row: 'border-l-slate-300',
  },
  UNREADABLE: {
    label: "Couldn't read",
    hint: 'The page or its documents could not be read',
    dot: 'bg-orange-500',
    chip: 'border-orange-200 bg-orange-50 text-orange-800',
    row: 'border-l-orange-400',
  },
  LISTING: {
    label: 'Listing page',
    hint: 'A page that lists other pages; it is where new calls appear',
    dot: 'bg-cobalt-600',
    chip: 'border-cobalt-200 bg-cobalt-50 text-cobalt-800',
    row: 'border-l-cobalt-500',
  },
  NO_RESULT: {
    label: 'No result',
    hint: 'Visited; nothing about funding came from it',
    dot: 'bg-nickel-300',
    chip: 'border-nickel-200 bg-nickel-50 text-nickel-700',
    row: 'border-l-nickel-200',
  },
  QUEUED: {
    label: 'Queued',
    hint: 'Found, waiting for its first visit',
    dot: 'bg-sky-400',
    chip: 'border-sky-200 bg-sky-50 text-sky-800',
    row: 'border-l-sky-300',
  },
  FAILED: {
    label: 'Visit failed',
    hint: 'The last visit failed (error, timeout or blocked)',
    dot: 'bg-red-600',
    chip: 'border-red-200 bg-red-50 text-red-800',
    row: 'border-l-red-500 bg-red-50/40',
  },
  SKIPPED: {
    label: "Don't visit",
    hint: 'Marked "don\'t visit", paused, or stopped by a crawl limit',
    dot: 'bg-nickel-400',
    chip: 'border-dashed border-nickel-300 bg-white text-nickel-600',
    row: 'border-l-nickel-300 opacity-70',
  },
}

/** Legend order: results first, then the crawl states. */
export const OUTCOME_ORDER: PageOutcome[] = ['PUBLISHED', 'FUNDING_FOUND', 'UNSURE', 'INCOMPLETE', 'WAITING_LOCAL', 'SCREENING', 'NOT_FUNDING', 'UNREADABLE', 'LISTING', 'NO_RESULT', 'QUEUED', 'FAILED', 'SKIPPED']
