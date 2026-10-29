import { describe, expect, it } from 'vitest'

import { scoreCall, stripChrome } from '@/lib/monitor/callScore'

const NOW = new Date('2026-10-29T00:00:00Z')
const score = (title: string, text: string, links: Array<{ url: string; title: string }> = []) => scoreCall({ title, text, links, now: NOW })

// Shapes taken from pages the laptop and the paid model judged on production (29 Oct 2026).
describe('call score v1', () => {
  it('reads a fellowship call (invitation, eligibility, amount, deadline ahead) as a likely call', () => {
    const s = score('Humboldt Research Fellowship', `Applications are invited from postdoctoral researchers.
Eligibility: applicants must hold a doctorate obtained less than four years ago and agree a host institution in Germany.
Duration: 6 to 24 months. The fellowship provides up to €3,170 per month.
Selection criteria: academic achievement and the proposed research.
Application deadline: 31 March 2027. Submit your application online via the application portal.`)
    expect(s.band).toBe('LIKELY')
    expect(s.signals).toEqual(expect.arrayContaining(['Invites applications', 'Eligibility rules', 'Amount on offer', 'Deadline date ahead']))
  })

  it('reads an Indian call for proposals the same way', () => {
    const s = score('ANRF Prime Minister Early Career Research Grant', `Call for proposals. Eligible applicants: Indian nationals holding a PhD.
Funding of up to Rs. 60 lakh for three years. Last date for submission: 15/12/2026. How to apply: through the online portal.`)
    expect(s.band).toBe('LIKELY')
  })

  it('reads building news and staff paperwork as unlikely', () => {
    expect(score('Houston condo hotel nears completion', 'The 40-story tower, announced today, is under construction and nears completion. Renderings show a glass crown.').band).toBe('UNLIKELY')
    expect(score('Office Order 445/2025-26', 'In the absence of the Administrative Officer, the following arrangement is made with immediate effect.').band).toBe('UNLIKELY')
  })

  it('scores a webinar about funding below the call it is about', () => {
    const webinar = score('Info session: Early Career Research Grant', 'Join us for a webinar and Q&A about the grant. Register now for the information session on 12 November.')
    const call = score('Early Career Research Grant', 'Applications are invited. Applicants must be within five years of their PhD. Funding of up to $50,000. Deadline: 1 February 2027.')
    expect(webinar.signals).toContain('Info session or webinar')
    expect(webinar.score).toBeLessThan(call.score)
  })

  it('marks a page that mostly lists other funding pages as a listing', () => {
    const links = Array.from({ length: 10 }, (_, i) => ({ url: `https://funder.example/funding/call-${i}`, title: `Grant call ${i}` }))
    const s = score('Funding opportunities', 'Browse our current grants and fellowships.', links)
    expect(s.signals.some(x => x.startsWith('Listing'))).toBe(true)
  })

  it('credits a guidelines PDF and an apply button', () => {
    const s = score('Seed grant', 'Seed grants support new collaborations.', [
      { url: 'https://funder.example/files/seed-grant-guidelines-2027.pdf', title: 'Guidelines' },
      { url: 'https://portal.funder.example/start', title: 'Apply now' },
    ])
    expect(s.signals).toEqual(expect.arrayContaining(['Guidelines document linked', 'Apply link', 'Specific funding type']))
  })

  it('understands other languages', () => {
    const dfg = score('ifw 25 101', 'Ausschreibung: Antragsberechtigt sind promovierte Forschende. Förderung bis zu 150.000 Euro. Einreichungsfrist: 15.01.2027.')
    expect(['LIKELY', 'POSSIBLE']).toContain(dfg.band)
    const hindi = score('अनुदान योजना', 'प्रस्ताव आमंत्रित किए जाते हैं। पात्रता: भारतीय नागरिक। अंतिम तिथि: 30/11/2026')
    expect(hindi.signals).toEqual(expect.arrayContaining(['Invites applications', 'Eligibility rules']))
  })

  it('tells a passed deadline from one still ahead', () => {
    expect(score('Grant', 'Deadline: 15 January 2025').signals).toContain('Deadline date')
    expect(score('Grant', 'Deadline: 15 January 2027').signals).toContain('Deadline date ahead')
  })

  it('removes site chrome and share widgets before scoring', () => {
    const chrome = new Set(['home', 'about us', 'apply now for our newsletter'])
    const text = stripChrome('Home\nAbout us\nApply now for our newsletter\nShare on LinkedIn\nTweet\nThe annual report is out.', chrome)
    expect(text).toBe('The annual report is out.')
    expect(score('Report', text).signals).not.toContain('Invites applications')
  })
})
