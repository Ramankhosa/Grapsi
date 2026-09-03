import { describe, expect, it } from 'vitest';

import { Prisma } from '@/lib/prisma-generated';
import { QUEUE_STATES, queueStateFor, queueStateSql } from '@/lib/fundingDept/queueState';

const TRIAGE_STATUSES = ['NEW', 'IN_REVIEW', 'SHORTLISTED', 'NOT_RELEVANT', null] as const;
const LIVE_COUNTS = [0, 1, 3] as const;

/**
 * Evaluate one rendered SQL predicate against concrete values.
 *
 * The fragments only reference COALESCE(tri.status, 'NEW'), the bound
 * live-count scalar, and =, <>, NOT IN, AND, OR. Substituting literals and
 * translating that tiny subset to JS is a faithful check of the ladder's logic
 * without a database. Anything outside the subset fails loudly rather than
 * passing by accident.
 */
function evaluate(fragment: Prisma.Sql, triage: string | null, live: number): boolean {
  const status = triage ?? 'NEW';
  let expr = fragment
    .inspect()
    .sql.replace(/\?/g, String(live))
    .replace(/COALESCE\(tri\.status, 'NEW'\)/g, `'${status}'`);

  expr = expr
    // 'X' NOT IN ('A', 'B')  →  !['A', 'B'].includes('X')
    .replace(/'([A-Z_]+)' NOT IN \(([^)]+)\)/g, (_m, lhs, list) => `!([${list}].includes('${lhs}'))`)
    .replace(/<>/g, '!==')
    // any remaining single "=" is equality (string or numeric)
    .replace(/(^|[^!<>=])=(?!=)/g, '$1===')
    .replace(/\bAND\b/g, '&&')
    .replace(/\bOR\b/g, '||');

  const residue = expr.replace(/'[A-Z_]*'|\d+|includes|[\s()!<>=&|[\],.]/g, '');
  if (residue.length > 0) {
    throw new Error(`Fragment contains SQL this test cannot evaluate: ${fragment.inspect().sql}`);
  }
  // eslint-disable-next-line no-new-func
  return Boolean(new Function(`return (${expr});`)());
}

describe('queue state ladder', () => {
  it('places every (triage, live) combination in exactly one state', () => {
    // The live-count placeholder is bound once; evaluate() substitutes per case.
    const sql = queueStateSql(Prisma.sql`${0}`, 'tri');

    for (const triage of TRIAGE_STATUSES) {
      for (const count of LIVE_COUNTS) {
        const hits = QUEUE_STATES.filter((state) => evaluate(sql[state], triage, count));
        expect(hits, `triage=${triage} live=${count}`).toHaveLength(1);
        // And the SQL agrees with the TypeScript evaluation of the same ladder.
        expect(hits[0]).toBe(queueStateFor(triage, count));
      }
    }
  });

  it('lets an assignment outrank a shortlist without any triage write', () => {
    expect(queueStateFor('SHORTLISTED', 0)).toBe('shortlisted');
    expect(queueStateFor('SHORTLISTED', 1)).toBe('assigned');
  });

  it('keeps a dismissed call dismissed even if someone is assigned', () => {
    // The school said "not ours"; a stray assignment does not silently
    // reopen it in the queue. Restoring is an explicit action.
    expect(queueStateFor('NOT_RELEVANT', 2)).toBe('dismissed');
  });

  it('treats a missing triage row as NEW', () => {
    expect(queueStateFor(null, 0)).toBe('pending');
    expect(queueStateFor(undefined, 0)).toBe('pending');
    expect(queueStateFor('IN_REVIEW', 0)).toBe('pending');
  });
});
