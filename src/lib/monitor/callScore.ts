import type { Db } from './queue'

/**
 * Call score v1 (29 Oct 2026): a deterministic reading of how much a page
 * looks like an open funding call, with the signals that produced it.
 *
 * Built from production data: 10,370 catalogue calls and 1,787 crawled pages
 * the laptop had judged. Curated signal groups (an invitation, eligibility,
 * a deadline, an amount, application terms) separated calls from other pages
 * on sites they were not built from (AUC 0.95 against GENERAL, 0.77 against
 * RELATED); words learned straight from page text did not (0.64), because
 * they learn each site's vocabulary. So the groups are curated, and new words
 * join a group only when they help on several sites.
 *
 * Shadow mode by default: the score is stored and shown, never used to close
 * a page. MONITOR_CALL_SCORE_ROUTING=true moves likely calls up the laptop queue.
 */
export const CALL_SCORE_VERSION = 'call-score-1'
export type CallBand = 'LIKELY' | 'POSSIBLE' | 'WEAK' | 'UNLIKELY'
export interface CallScore { score: number; band: CallBand; signals: string[]; version: string }

interface Signal { id: string; label: string; weight: number; rx: RegExp }
const I = 'iu'
const rx = (source: string) => new RegExp(source, I)

// What makes a call: an invitation, conditions, a deadline, an amount, terms.
const CALL_SIGNALS: Signal[] = [
  { id: 'invite', label: 'Invites applications', weight: 3, rx: rx(String.raw`\bcall for (proposals|applications|nominations|projects|expressions? of interest|submissions)\b|\bopen call\b|\bcalls? (is|are) (now )?open\b|\bapplications? (are|is) (now )?(invited|open|welcome)\b|\binvites? applications\b|\bnow accepting applications\b|\bapply (now|online|here|by|before|via|through)\b|\bhow to apply\b|\bsubmit (your|an?) (application|proposal|nomination)s?\b|ausschreibung|antrag(stellung)? (ist|sind) (möglich|offen)|bewerbungen? (sind|ist) (möglich|willkommen)|appel (à|a) (projets|candidatures|propositions)|convocatoria (abierta)?|\bedital\b|\bbando\b|\butlysning|\bansök (nu|senast)|ansøg nu|søk (nå|innen)|आवेदन आमंत्रित|प्रस्ताव आमंत्रित`) },
  { id: 'eligibility', label: 'Eligibility rules', weight: 2, rx: rx(String.raw`\beligib(le|ility)\b|\bwho can apply\b|\bapplicants? (must|should|need)\b|\bhost institution\b|antragsberechtigt|voraussetzungen|éligib|conditions d.admissibilité|requisitos|\belegib|\bbehörig|sökande (måste|ska)|पात्रता|पात्र आवेदक`) },
  { id: 'amount', label: 'Amount on offer', weight: 2, rx: rx(String.raw`\bup to\s*(\p{Sc}|usd|eur|gbp|inr|chf|sek|nok|dkk|aud|cad|rs\.?)?\s*\d|\bmaximum (award|amount|grant|funding|budget|of)\b|\bper (annum|year|month)\b|\bfunding of up to\b|\bbis zu\s*\d|\bjusqu.(à|a)\s*\d|\bhasta\s*\d|\baté\s*\d|\b(upp till|op til|inntil)\s*\d|\d[\d,.]*\s*(lakh|crore)\b`) },
  { id: 'terms', label: 'Application terms', weight: 1, rx: rx(String.raw`\bduration\b|\bguidelines\b|\bapplicants?\b|\bapplication (form|portal|process|guidelines?)\b|\bonline application\b|\bletter of intent\b|\bpre-?proposals?\b|\bconcept note\b|\bexpressions? of interest\b|förderrichtlinie|richtlinien|antragsformular|formulaire de candidature|bases de la convocatoria|ansökningsformulär|आवेदन पत्र`) },
  { id: 'selection', label: 'Selection criteria', weight: 1, rx: rx(String.raw`\bselection (criteria|process|committee)\b|\bevaluation criteria\b|\breview process\b|\bpeer review\b|\bassessment criteria\b|auswahlverfahren|critères de sélection|criterios de (evaluación|selección)|bedömningskriterier|चयन प्रक्रिया`) },
  { id: 'type-specific', label: 'Specific funding type', weight: 2, rx: rx(String.raw`\b(seed|pilot|small|catalyst|starter|bridge|innovation) (grants?|funds?|awards?|funding)\b|\btravel (grants?|awards?|funds?|bursar(y|ies))\b|\bconference (grants?|support|funding)\b|\bmobility (grants?|programme|program)\b|\b(career development|young investigator|early career) (award|grant|fellowship)s?\b`) },
  { id: 'type', label: 'Funding type', weight: 1, rx: rx(String.raw`\bfellowships?\b|\bstudentships?\b|\bpostdoc(toral)?\b|\bscholarships?\b|\bbursar(y|ies)\b|\bstipends?\b|\bprizes?\b|\bawards? for\b|\b(chair|professorship|residenc(y|ies))\b|\b(rfp|rfa|nofo|foa|baa)\b|\brequest for (proposals|applications)\b|\bsolicitation\b|\bgrants?\b|\bfunding\b|förder|stipendi|bourse|subvention|\bbeca\b|anslag|\bbidrag\b|अनुदान|छात्रवृत्ति|अध्येतावृत्ति`) },
]
// What makes a page "about" funding rather than a call: info sessions and listings.
const RELATED_SIGNALS: Signal[] = [
  { id: 'info-session', label: 'Info session or webinar', weight: -1, rx: rx(String.raw`\bwebinars?\b|\binfo(rmation)? sessions?\b|\boffice hours\b|\bq\s?&\s?a\b|\bquestions and answers\b|\bregister (now|here|for)\b|\bjoin us\b|\battend\b|informationsveranstaltung|séance d.information`) },
]
// What makes a page not about funding at all.
const NOT_SIGNALS: Signal[] = [
  { id: 'news', label: 'News or construction story', weight: -2, rx: rx(String.raw`\bannounced today\b|\bsaid (in a|on)\b|\baccording to\b|\bunder construction\b|\bgroundbreaking\b|\btops? out\b|\bnears? completion\b|\brenderings?\b|\bstorey\b|\b\d+-story\b`) },
  { id: 'past-winners', label: 'Past winners', weight: -2, rx: rx(String.raw`\bcongratulat|\b(has|have|was|were) been awarded\b|\bwinners? (of|announced)\b|\brecipients? (of|announced)\b|\bgrantees\b`) },
  { id: 'event', label: 'Event page', weight: -1, rx: rx(String.raw`\bkeynote\b|\bspeakers?\b|\bagenda\b|\bvenue\b|\blivestream\b`) },
]

const DEADLINE = String.raw`deadline|closing date|last date|due date|applications? close|submission (deadline|date)|closes on|einreichungsfrist|antragsfrist|bewerbungsfrist|date limite|fecha l[ií]mite|plazo|prazo|sista ansökningsdag|ansøgningsfrist|søknadsfrist|अंतिम तिथि`
const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }
const DATE = /\b(\d{4})-(\d{2})-(\d{2})\b|\b(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b|\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+(\d{4})\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/i

function parseDate(m: RegExpMatchArray): Date | null {
  const y = Number(m[1] ?? m[6] ?? m[9] ?? m[12])
  const mon = m[1] ? Number(m[2]) : m[6] ? Number(m[5]) : MONTHS[(m[8] ?? m[10] ?? '').toLowerCase().slice(0, 3)]
  const day = Number(m[1] ? m[3] : m[6] ? m[4] : m[7] ?? m[11])
  if (!y || !mon || !day || mon > 12 || day > 31) return null
  return new Date(Date.UTC(y, mon - 1, day))
}

/** A deadline word, and whether a date sits near it (and is still ahead). */
function deadline(text: string, now: Date): { word: boolean; dated: boolean; future: boolean } {
  const re = new RegExp(`(?:${DEADLINE})(?<near>[^\\n]{0,80})`, 'giu')
  let word = false, dated = false, future = false
  for (const hit of text.matchAll(re)) {
    word = true
    const m = (hit.groups?.near ?? '').match(DATE)
    if (!m) continue
    dated = true
    const when = parseDate(m)
    if (when && when.getTime() >= now.getTime() - 86_400_000) future = true
  }
  return { word, dated, future }
}

export interface PageLink { url: string; title: string }

/** Score one page. `links` are the page's own links (from the reader), used for shape signals. */
export function scoreCall(input: { title: string; text: string; links?: PageLink[]; now?: Date }): CallScore {
  const now = input.now ?? new Date()
  const text = `${input.title}\n${input.text}`
  const signals: string[] = []
  let score = 0
  for (const s of [...CALL_SIGNALS, ...RELATED_SIGNALS, ...NOT_SIGNALS]) {
    if (s.rx.test(text)) { score += s.weight; signals.push(s.label) }
  }
  const d = deadline(text, now)
  if (d.dated) { score += 2; signals.push(d.future ? 'Deadline date ahead' : 'Deadline date') }
  else if (d.word) { score += 1; signals.push('Deadline mentioned') }
  if (d.future) score += 1
  const links = input.links ?? []
  if (links.some(l => /\.pdf([?#]|$)/i.test(l.url) && /guideline|call|application|richtlinie|ausschreibung|appel|convocatoria|utlysning|announcement|notice/i.test(`${l.url} ${l.title}`))) {
    score += 1; signals.push('Guidelines document linked')
  }
  if (links.some(l => /^\s*(apply( now| online| here)?|submit( an)? application|start (your )?application|antrag stellen|postuler|solicitar|ansök)\s*$/i.test(l.title))) {
    score += 1; signals.push('Apply link')
  }
  // Many links to other funding pages: a listing that leads to calls, not a call itself.
  const fundingLinks = links.filter(l => /fund|grant|fellow|scholar|call|opportunit|award|prize|förder|ausschreib|appel|convocatori|utlys/i.test(`${l.url} ${l.title}`)).length
  if (fundingLinks >= 8) { score -= 2; signals.push(`Listing (${fundingLinks} funding links)`) }
  const band: CallBand = score >= 7 ? 'LIKELY' : score >= 4 ? 'POSSIBLE' : score >= 1 ? 'WEAK' : 'UNLIKELY'
  return { score, band, signals, version: CALL_SCORE_VERSION }
}

export const CALL_BAND_LABELS: Record<CallBand, string> = { LIKELY: 'Likely call', POSSIBLE: 'Possible call', WEAK: 'Weak signals', UNLIKELY: 'Unlikely' }

// Share widgets and one-word menu items carry no meaning for the score.
const WIDGET = /^(share|tweet|twitter|linkedin|facebook|instagram|youtube|email|e-mail|print|copy link|send|whatsapp|follow us|back to top|menu|search|skip to (main )?content)\b.{0,40}$/i

/** Remove a site's repeated chrome (menus, footers) and share widgets before scoring. */
export function stripChrome(text: string, chrome: Set<string>): string {
  return text.split('\n').filter(line => {
    const t = line.trim()
    return t && !chrome.has(t.toLowerCase()) && !WIDGET.test(t)
  }).join('\n')
}

const chromeCache = new Map<string, { at: number; lines: Set<string> }>()
/**
 * Lines that recur across a site's pages (menus, footers, cookie notices): seen
 * on at least a quarter of up to 120 recent pages, and on at least four.
 * Cached per site for an hour.
 */
export async function siteChrome(db: Db, siteId: string): Promise<Set<string>> {
  const cached = chromeCache.get(siteId)
  if (cached && Date.now() - cached.at < 3_600_000) return cached.lines
  const rows = await db.$queryRaw<Array<{ text: string | null }>>`
    SELECT left(v.text, 30000) AS text FROM monitor_resources r JOIN monitor_resource_versions v ON v.id = r.current_version_id
    WHERE r.site_id = ${siteId} AND v.text IS NOT NULL ORDER BY r.last_observed_at DESC LIMIT 120`
  const counts = new Map<string, number>()
  for (const row of rows) for (const line of new Set((row.text ?? '').split('\n').map(l => l.trim().toLowerCase()).filter(Boolean))) counts.set(line, (counts.get(line) ?? 0) + 1)
  const min = Math.max(4, Math.ceil(rows.length * 0.25))
  const lines = new Set([...counts].filter(([, n]) => n >= min).map(([line]) => line))
  chromeCache.set(siteId, { at: Date.now(), lines })
  return lines
}
