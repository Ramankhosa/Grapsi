import { describe, expect, it } from 'vitest';

import {
  mergeLookupResults,
  normalizeDoi,
  parseCrossrefWork,
  parseOpenAlexWork,
  reconstructOpenAlexAbstract,
  stripJatsMarkup,
} from '@/lib/researcherProfile/publication-lookup';

describe('normalizeDoi', () => {
  it('accepts bare DOIs', () => {
    expect(normalizeDoi('10.1038/s41586-020-2649-2')).toBe('10.1038/s41586-020-2649-2');
  });

  it('accepts doi.org and dx.doi.org URLs', () => {
    expect(normalizeDoi('https://doi.org/10.1038/s41586-020-2649-2')).toBe('10.1038/s41586-020-2649-2');
    expect(normalizeDoi('http://dx.doi.org/10.1000/xyz123')).toBe('10.1000/xyz123');
  });

  it('accepts a doi: prefix and trims trailing punctuation', () => {
    expect(normalizeDoi('doi: 10.1000/xyz123')).toBe('10.1000/xyz123');
    expect(normalizeDoi('10.1000/xyz123.')).toBe('10.1000/xyz123');
  });

  it('rejects values that are not DOIs', () => {
    expect(normalizeDoi('')).toBeNull();
    expect(normalizeDoi('not a doi')).toBeNull();
    expect(normalizeDoi('https://example.com/10.1000/xyz')).toBeNull();
    expect(normalizeDoi('10.12/short-prefix')).toBeNull();
  });
});

describe('stripJatsMarkup', () => {
  it('removes JATS tags, titles, and entities', () => {
    const jats =
      '<jats:sec><jats:title>Abstract</jats:title><jats:p>Deep learning &amp; imaging improve <jats:italic>in vivo</jats:italic> diagnosis.</jats:p></jats:sec>';
    expect(stripJatsMarkup(jats)).toBe('Deep learning & imaging improve in vivo diagnosis.');
  });

  it('drops a leading Abstract heading in plain text', () => {
    expect(stripJatsMarkup('Abstract: We study grant matching.')).toBe('We study grant matching.');
  });
});

describe('parseCrossrefWork', () => {
  const message = {
    title: ['A Study of Funding Matching'],
    'container-title': ['Journal of Research Intelligence'],
    abstract: '<jats:p>We match researchers to calls.</jats:p>',
    issued: { 'date-parts': [[2024, 5, 1]] },
  };

  it('parses title, venue, year, and cleaned abstract', () => {
    const result = parseCrossrefWork(message, '10.1000/xyz123');
    expect(result).toEqual({
      doi: '10.1000/xyz123',
      title: 'A Study of Funding Matching',
      abstract: 'We match researchers to calls.',
      year: 2024,
      venue: 'Journal of Research Intelligence',
      source: 'crossref',
    });
  });

  it('returns null without a title', () => {
    expect(parseCrossrefWork({ abstract: 'text' }, '10.1000/x')).toBeNull();
    expect(parseCrossrefWork(null, '10.1000/x')).toBeNull();
  });

  it('falls back through publication date fields', () => {
    const result = parseCrossrefWork(
      { title: ['T'], 'published-online': { 'date-parts': [[2021]] } },
      '10.1000/x'
    );
    expect(result?.year).toBe(2021);
  });
});

describe('reconstructOpenAlexAbstract', () => {
  it('rebuilds text from an inverted index', () => {
    const index = { matching: [2], improves: [3], Semantic: [0], funding: [1], outcomes: [4] };
    expect(reconstructOpenAlexAbstract(index)).toBe('Semantic funding matching improves outcomes');
  });

  it('handles repeated words and bad input', () => {
    expect(reconstructOpenAlexAbstract({ the: [0, 2], cat: [1], sat: [3] })).toBe('the cat the sat');
    expect(reconstructOpenAlexAbstract(null)).toBe('');
    expect(reconstructOpenAlexAbstract('nope')).toBe('');
  });
});

describe('parseOpenAlexWork', () => {
  it('parses title, year, venue, and reconstructed abstract', () => {
    const work = {
      title: 'OpenAlex Title',
      publication_year: 2023,
      primary_location: { source: { display_name: 'Open Venue' } },
      abstract_inverted_index: { Hello: [0], world: [1] },
    };
    expect(parseOpenAlexWork(work, '10.1000/x')).toEqual({
      doi: '10.1000/x',
      title: 'OpenAlex Title',
      abstract: 'Hello world',
      year: 2023,
      venue: 'Open Venue',
      source: 'openalex',
    });
  });

  it('returns null without a title', () => {
    expect(parseOpenAlexWork({}, '10.1000/x')).toBeNull();
  });
});

describe('mergeLookupResults', () => {
  const crossref = {
    doi: '10.1000/x',
    title: 'Crossref Title',
    abstract: '',
    year: null,
    venue: null,
    source: 'crossref' as const,
  };
  const openAlex = {
    doi: '10.1000/x',
    title: 'OpenAlex Title',
    abstract: 'Recovered abstract',
    year: 2022,
    venue: 'Open Venue',
    source: 'openalex' as const,
  };

  it('prefers the primary record but backfills missing fields', () => {
    expect(mergeLookupResults(crossref, openAlex)).toEqual({
      ...crossref,
      abstract: 'Recovered abstract',
      year: 2022,
      venue: 'Open Venue',
    });
  });

  it('falls back to whichever record exists', () => {
    expect(mergeLookupResults(null, openAlex)).toEqual(openAlex);
    expect(mergeLookupResults(crossref, null)).toEqual(crossref);
    expect(mergeLookupResults(null, null)).toBeNull();
  });
});
