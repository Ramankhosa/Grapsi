import { describe, expect, it } from 'vitest';

import { Prisma } from '@/lib/prisma-generated';
import {
  QUEUE_STATES,
  isCallUntouched,
  queueStateFor,
  queueStateSql,
  untouchedSql,
} from '@/lib/fundingDept/queueState';

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

/**
 * Untouched: pending, old enough, and nobody has looked at it.
 *
 * The SQL half carries a correlated NOT EXISTS and date arithmetic, which the
 * evaluator above cannot reduce. So the TS ladder is exercised exhaustively and
 * the SQL is checked for the four clauses it must carry — in particular that it
 * tests a triage DECISION rather than the existence of a triage row.
 */
describe('untouched calls', () => {
  const base = {
    queueState: 'pending' as const,
    triageDecidedAt: null,
    lastActionAt: null,
    daysSinceEntered: 30,
    untouchedDays: 7,
  };

  it('names a pending call nobody has looked at for long enough', () => {
    expect(isCallUntouched(base)).toBe(true);
  });

  it('says nothing about a call that arrived this morning', () => {
    expect(isCallUntouched({ ...base, daysSinceEntered: 0 })).toBe(false);
    expect(isCallUntouched({ ...base, daysSinceEntered: 6 })).toBe(false);
    expect(isCallUntouched({ ...base, daysSinceEntered: 7 })).toBe(true);
  });

  it('honours a tenant that counts pendency differently', () => {
    expect(isCallUntouched({ ...base, daysSinceEntered: 20, untouchedDays: 30 })).toBe(false);
    expect(isCallUntouched({ ...base, daysSinceEntered: 30, untouchedDays: 30 })).toBe(true);
  });

  it('clears once anybody has decided or logged anything', () => {
    expect(isCallUntouched({ ...base, triageDecidedAt: new Date() })).toBe(false);
    expect(isCallUntouched({ ...base, lastActionAt: new Date() })).toBe(false);
  });

  it('only ever describes a pending call', () => {
    for (const state of ['shortlisted', 'assigned', 'dismissed'] as const) {
      expect(isCallUntouched({ ...base, queueState: state })).toBe(false);
    }
  });

  it('tests a triage decision, not the existence of a triage row', () => {
    // The pendency sweep creates rows to hold its escalation stamp. Under a
    // row-existence rule the sweep would have silently cleared the very backlog
    // it exists to report, so this is the clause that makes the sweep safe.
    const sql = untouchedSql({
      pending: Prisma.sql`TRUE`,
      triageAlias: 'tri',
      enteredAt: Prisma.sql`fc."createdAt"`,
      contactExists: Prisma.sql`EXISTS (SELECT 1 FROM assignment_follow_ups f WHERE f.id = 'x')`,
      untouchedDays: 7,
    }).inspect().sql;

    expect(sql).toContain('tri.decided_at IS NULL');
    expect(sql).toContain("INTERVAL '7 days'");
    expect(sql).toContain('NOT EXISTS');
    expect(sql).not.toContain('tri.id IS NULL');
  });

  it('refuses to interpolate a threshold it cannot vouch for', () => {
    // The number reaches this from tenant settings and lands in a raw interval
    // literal, so it is forced to a bounded integer rather than trusted.
    const render = (days: any) =>
      untouchedSql({
        pending: Prisma.sql`TRUE`,
        enteredAt: Prisma.sql`fc."createdAt"`,
        contactExists: Prisma.sql`EXISTS (SELECT 1)`,
        untouchedDays: days,
      }).inspect().sql;

    expect(render("7' OR 1=1 --")).toContain("INTERVAL '0 days'");
    expect(render(7.6)).toContain("INTERVAL '8 days'");
    expect(render(-5)).toContain("INTERVAL '0 days'");
    expect(render(999999)).toContain("INTERVAL '3650 days'");
  });
});
