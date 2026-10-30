import { describe, expect, it } from 'vitest'

import { checkAgainst, discoveryTwins, titleWords, type DuplicateSubject } from '@/lib/monitor/reviewDuplicates'

type Call = { id: string; title: string; funder: string | null; url: string; origin?: 'Imported' | 'Curated' }
function index(calls: Call[]) {
  const idx = { calls: new Map(), byUrl: new Map<string, string[]>(), byWord: new Map<string, string[]>(), byTitle: new Map<string, string[]>() }
  const add = (m: Map<string, string[]>, k: string, id: string) => m.set(k, [...(m.get(k) ?? []), id])
  for (const c of calls) {
    const words = titleWords(c.title)
    idx.calls.set(c.id, { id: c.id, title: c.title, words, funder: c.funder, status: 'PUBLISHED', origin: c.origin ?? 'Imported' })
    add(idx.byUrl, c.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''), c.id)
    for (const w of words) add(idx.byWord, w, c.id)
    add(idx.byTitle, c.title.toLowerCase().match(/[\p{L}\p{N}]+/gu)!.join(' '), c.id)
  }
  return idx
}
const subject = (s: Partial<DuplicateSubject> & { title: string }): DuplicateSubject => ({ id: 'd1', funder: null, urls: [], deadline: null, ownCallId: null, host: 'example.org', ...s })

describe('Review duplicate check (30 Oct 2026)', () => {
  const catalogue = index([
    { id: 'mrc', title: 'Professional doctorate: clinical research training fellowship (UK)', funder: 'Medical Research Council (MRC)', url: 'https://www.ukri.org/opportunity/professional-doctorate' },
    { id: 'div', title: 'Request for Proposals', funder: 'DIV Fund', url: 'https://www.div.fund/apply/rfp', origin: 'Curated' },
    { id: 'other', title: 'Request for Proposals', funder: 'Melanoma Research Alliance', url: 'https://mra.org/rfp' },
    { id: 'ktp1', title: 'Knowledge Transfer Partnership 2025 round 1', funder: 'Innovate UK', url: 'https://iuk.example/ktp-2025' },
  ])
  it('finds the catalogue twin of a call found under another URL', () => {
    expect(checkAgainst(catalogue, subject({ title: 'Professional doctorate: clinical research training fellowship', funder: 'Medical Research Council' })).map(t => t.id)).toEqual(['mrc'])
  })
  it('matches a title of generic words only when the funder is the same', () => {
    expect(checkAgainst(catalogue, subject({ title: 'Request for Proposals', funder: 'DIV Fund' })).map(t => t.id)).toEqual(['div'])
    expect(checkAgainst(catalogue, subject({ title: 'Request for Proposals', funder: null }))).toEqual([])
  })
  it('does not call a different year a duplicate, nor a call its own draft', () => {
    expect(checkAgainst(catalogue, subject({ title: 'Knowledge Transfer Partnership 2026 round 4', funder: 'Innovate UK' }))).toEqual([])
    expect(checkAgainst(catalogue, subject({ title: 'Professional doctorate: clinical research training fellowship', ownCallId: 'mrc' }))).toEqual([])
  })
  it('flags one call found twice, but not two calls sharing one word', () => {
    const twins = discoveryTwins([
      subject({ id: 'a', title: 'EPS Carers Fund', urls: ['https://eps.ac.uk/form.pdf'] }),
      subject({ id: 'b', title: 'EPS Carers Fund', urls: ['https://eps.ac.uk/form.docx'] }),
      subject({ id: 'c', title: 'EPS Study Visits Fund', urls: ['https://eps.ac.uk/visits'] }),
      subject({ id: 'd', title: 'Veni 2026', deadline: '2026-01-10' }),
      subject({ id: 'e', title: 'Veni 2026', deadline: '2026-09-01' }),
    ])
    expect(twins.get('a')?.map(t => t.id)).toEqual(['b'])
    expect(twins.get('c')).toBeUndefined()
    expect(twins.get('d')).toBeUndefined()
  })
  it('ignores site-chrome titles, one-word titles and different call codes', () => {
    const chrome = ['p1', 'p2', 'p3', 'p4'].map(id => subject({ id, title: 'Skip to main content', urls: [`https://x.org/${id}`] }))
    const twins = discoveryTwins([
      ...chrome,
      subject({ id: 'm1', title: 'More', urls: ['https://a.org/more'] }),
      subject({ id: 'm2', title: 'More calls', urls: ['https://b.org/more'] }),
      subject({ id: 'a', title: '2210/A National MSc/MA Scholarship Program', urls: ['https://t.gov.tr/2210a'] }),
      subject({ id: 'b', title: '2210/D National Industrial MSc/MA Scholarship Program', urls: ['https://t.gov.tr/2210d'] }),
      subject({ id: 'e1', title: 'Early Career Travel Grant', urls: ['https://tp.org/ecg'] }),
      subject({ id: 'e2', title: 'Early Career Travel Grant', urls: ['https://tp.org/grants/ecg'] }),
    ])
    expect([...twins.keys()].sort()).toEqual(['e1', 'e2'])
  })
})
