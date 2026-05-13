import crypto from 'crypto';
import { Prisma } from '@prisma/client';

import prisma from '../prisma';
import type { FundingCallResearchAreaTaxonomyRecord } from '../researcherProfile/types';
import { normalizeWhitespace } from '../recommendations/utils';

const MAX_MAPPINGS_PER_CALL = 50;

type MappingRow = {
  id: string;
  funding_call_id: string;
  taxonomy_area_id: string;
  taxonomy_level1_code: string | null;
  taxonomy_level1_name: string | null;
  taxonomy_level2_code: string | null;
  taxonomy_level2_name: string | null;
  source: string;
  confidence: number | null;
  created_at: Date;
};

type TaxonomyAreaSnapshotRow = {
  id: string;
  level1_code: string;
  level1_name: string;
  level2_code: string;
  level2_name: string;
};

function createId() {
  return `fcrat_${crypto.randomUUID().replace(/-/g, '')}`;
}

function serializeMapping(row: MappingRow): FundingCallResearchAreaTaxonomyRecord {
  return {
    id: row.id,
    fundingCallId: row.funding_call_id,
    taxonomyAreaId: row.taxonomy_area_id,
    level1Code: row.taxonomy_level1_code || '',
    level1Name: row.taxonomy_level1_name || '',
    level2Code: row.taxonomy_level2_code || '',
    level2Name: row.taxonomy_level2_name || '',
    source: row.source || 'manual',
    confidence: typeof row.confidence === 'number' ? row.confidence : null,
    createdAt: row.created_at.toISOString(),
  };
}

function normalizeAreaIds(taxonomyAreaIds: string[]) {
  return Array.from(
    new Set(
      taxonomyAreaIds
        .map((value) => normalizeWhitespace(String(value || '')))
        .filter(Boolean)
    )
  );
}

export class FundingCallResearchAreaTaxonomyService {
  async listMappings(fundingCallId: string): Promise<FundingCallResearchAreaTaxonomyRecord[]> {
    const rows = await prisma.$queryRaw<MappingRow[]>(Prisma.sql`
      SELECT id, funding_call_id, taxonomy_area_id, taxonomy_level1_code, taxonomy_level1_name,
             taxonomy_level2_code, taxonomy_level2_name, source, confidence, created_at
      FROM funding_call_research_area_taxonomies
      WHERE funding_call_id = ${fundingCallId}
      ORDER BY taxonomy_level1_name ASC NULLS LAST, taxonomy_level2_name ASC NULLS LAST, created_at ASC
    `);

    return rows.map(serializeMapping);
  }

  async replaceMappings(input: {
    fundingCallId: string;
    taxonomyAreaIds: string[];
  }): Promise<FundingCallResearchAreaTaxonomyRecord[]> {
    const fundingCallId = normalizeWhitespace(input.fundingCallId);
    const areaIds = normalizeAreaIds(input.taxonomyAreaIds);

    if (!fundingCallId) {
      throw new Error('Funding call id is required');
    }

    if (areaIds.length > MAX_MAPPINGS_PER_CALL) {
      throw new Error(`A funding call can be mapped to at most ${MAX_MAPPINGS_PER_CALL} research areas`);
    }

    const fundingCall = await prisma.fundingCall.findUnique({
      where: { id: fundingCallId },
      select: { id: true },
    });

    if (!fundingCall) {
      throw new Error('Funding call not found');
    }

    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`
        DELETE FROM funding_call_research_area_taxonomies
        WHERE funding_call_id = ${fundingCallId}
      `);

      if (areaIds.length === 0) {
        return;
      }

      const areaRows = await tx.$queryRaw<TaxonomyAreaSnapshotRow[]>(Prisma.sql`
        SELECT area.id, area.level1_code, area.level1_name, area.level2_code, area.level2_name
        FROM research_area_taxonomy_areas area
        WHERE area.id IN (${Prisma.join(areaIds.map((areaId) => Prisma.sql`${areaId}`))})
      `);

      if (areaRows.length !== areaIds.length) {
        throw new Error('One or more selected research taxonomy areas were not found');
      }

      const areaById = new Map(areaRows.map((row) => [row.id, row]));

      for (const areaId of areaIds) {
        const area = areaById.get(areaId);
        if (!area) {
          throw new Error('One or more selected research taxonomy areas were not found');
        }

        await tx.$executeRaw(Prisma.sql`
          INSERT INTO funding_call_research_area_taxonomies (
            id, funding_call_id, taxonomy_area_id, taxonomy_level1_code, taxonomy_level1_name,
            taxonomy_level2_code, taxonomy_level2_name, source, confidence, created_at
          )
          VALUES (
            ${createId()},
            ${fundingCallId},
            ${area.id},
            ${area.level1_code},
            ${area.level1_name},
            ${area.level2_code},
            ${area.level2_name},
            'manual',
            NULL,
            ${new Date()}
          )
        `);
      }
    });

    return this.listMappings(fundingCallId);
  }
}

export const fundingCallResearchAreaTaxonomyService = new FundingCallResearchAreaTaxonomyService();
