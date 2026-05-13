import { describe, expect, it } from 'vitest';

import {
  groupResearchAreaTaxonomyAreas,
  parseResearchAreaTaxonomyCsv,
} from '@/lib/services/researchAreaTaxonomyService';
import { buildResearchAreaNormalizedText } from '@/lib/services/researcherProfileService';

describe('research area taxonomy CSV parsing', () => {
  it('parses OECD FORD-style two-level rows and inactive flags', () => {
    const parsed = parseResearchAreaTaxonomyCsv([
      'level1_code,level1_name,level2_code,level2_name,description,aliases,sort_order,is_active',
      '1,Natural sciences,1.1,Mathematics,"Math, statistics and computation","math; stats",10,true',
      '2,Engineering and technology,2.1,Civil engineering,,civil|infrastructure,20,inactive',
    ].join('\n'));

    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]).toMatchObject({
      level1Code: '1',
      level1Name: 'Natural sciences',
      level2Code: '1.1',
      level2Name: 'Mathematics',
      description: 'Math, statistics and computation',
      aliases: ['math', 'stats'],
      sortOrder: 10,
      isActive: true,
    });
    expect(parsed.rows[1].isActive).toBe(false);
    expect(parsed.warnings[0]).toContain('inactive taxonomy row');
  });

  it('rejects missing required headers', () => {
    expect(() => parseResearchAreaTaxonomyCsv('level1_code,level1_name\n1,Natural sciences')).toThrow(
      /missing required columns/
    );
  });

  it('rejects duplicate level code pairs', () => {
    const csv = [
      'level1_code,level1_name,level2_code,level2_name',
      '1,Natural sciences,1.1,Mathematics',
      '1,Natural sciences,1.1,Mathematics and statistics',
    ].join('\n');

    expect(() => parseResearchAreaTaxonomyCsv(csv)).toThrow(/duplicate level code pair/);
  });

  it('rejects malformed quoted CSV', () => {
    const csv = [
      'level1_code,level1_name,level2_code,level2_name',
      '1,"Natural sciences,1.1,Mathematics',
    ].join('\n');

    expect(() => parseResearchAreaTaxonomyCsv(csv)).toThrow(/unterminated quoted field/);
  });
});

describe('research area taxonomy grouping and embedding text', () => {
  it('groups active taxonomy rows by level 1', () => {
    const groups = groupResearchAreaTaxonomyAreas([
      {
        id: 'a',
        uploadId: 'u',
        level1Code: '1',
        level1Name: 'Natural sciences',
        level2Code: '1.2',
        level2Name: 'Computer and information sciences',
        description: '',
        aliases: [],
        sortOrder: 2,
        isActive: true,
      },
      {
        id: 'b',
        uploadId: 'u',
        level1Code: '1',
        level1Name: 'Natural sciences',
        level2Code: '1.1',
        level2Name: 'Mathematics',
        description: '',
        aliases: [],
        sortOrder: 1,
        isActive: true,
      },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].areas.map((area) => area.level2Code)).toEqual(['1.1', '1.2']);
  });

  it('includes taxonomy levels in saved research area normalized text', () => {
    const normalized = buildResearchAreaNormalizedText({
      taxonomy: {
        areaId: 'tax-1',
        level1Code: '1',
        level1Name: 'Natural sciences',
        level2Code: '1.2',
        level2Name: 'Computer and information sciences',
      },
      label: 'Medical Imaging AI',
      researchArea: 'AI models for radiology decision support',
      keywords: ['medical imaging', 'radiology'],
      disciplines: ['AI'],
    });

    expect(normalized).toContain('research field level 1: Natural sciences (1)');
    expect(normalized).toContain('research field level 2: Computer and information sciences (1.2)');
    expect(normalized).toContain('AI models for radiology decision support');
  });
});
