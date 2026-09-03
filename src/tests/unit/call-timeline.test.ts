import { describe, expect, it } from 'vitest';

import {
  RE_REQUEST_NOTE_PREFIX,
  buildTimeline,
  type TimelineSources,
} from '@/lib/fundingDept/callTimeline';

const t = (day: number, hour = 9, minute = 0) =>
  new Date(Date.UTC(2026, 8, day, hour, minute)).toISOString();

const officer = { name: 'Priya Menon', email: 'priya@example.edu' };
const arun = { name: 'Arun Sharma', email: 'arun@example.edu' };
const bela = { name: 'Bela Rao', email: 'bela@example.edu' };

const empty: TimelineSources = {
  followUps: [],
  candidates: [],
  assignments: [],
  documents: [],
  milestones: [],
  notifications: [],
};

function assignment(overrides: Partial<TimelineSources['assignments'][number]>) {
  return {
    id: 'a1',
    status: 'ASSIGNED',
    created_at: t(3),
    updated_at: t(3),
    responded_at: null,
    declined_reason: null,
    submitted_at: null,
    completed_at: null,
    decision_at: null,
    outcome: 'PENDING',
    award_amount: null,
    award_currency: null,
    assignee: arun,
    assigned_by: officer,
    previous_assignment: null,
    ...overrides,
  };
}

describe('call timeline', () => {
  it('orders newest first and puts a pre-assignment note before the assignment', () => {
    const { events } = buildTimeline({
      ...empty,
      followUps: [
        {
          id: 'f1',
          kind: 'CALL',
          note: 'Rang the HoD, nobody free yet',
          happened_at: t(1),
          reminder_sent_at: null,
          remind_faculty: false,
          assignment_id: null,
          created_by: officer,
        },
      ],
      assignments: [assignment({ created_at: t(3), updated_at: t(3) })],
    });

    expect(events.map((event) => event.kind)).toEqual(['ASSIGNED', 'FOLLOW_UP']);
    // Chronologically the call-level note comes first — the point of allowing it.
    expect(events[1].title).toContain('Rang the HoD');
    expect(events[1].assignmentId).toBeNull();
  });

  it('tells a declined-then-passed-on chain as three events', () => {
    const { events } = buildTimeline({
      ...empty,
      assignments: [
        assignment({
          id: 'a1',
          status: 'DECLINED',
          created_at: t(3),
          responded_at: t(5),
          declined_reason: 'Sabbatical',
        }),
        assignment({
          id: 'a2',
          assignee: bela,
          created_at: t(7),
          updated_at: t(7),
          previous_assignment: { id: 'a1', declined_reason: 'Sabbatical', assignee: arun },
        }),
      ],
    });

    const kinds = events.map((event) => event.kind);
    expect(kinds).toEqual(['PASSED_ON', 'DECLINED', 'ASSIGNED']);
    expect(events[0].title).toBe('Passed on to Bela Rao from Arun Sharma');
    expect(events[0].detail).toContain('Sabbatical');
    expect(events[1].detail).toBe('Sabbatical');
  });

  it('collapses a nudge sent to two recipients into one event', () => {
    const { events } = buildTimeline({
      ...empty,
      notifications: [
        { id: 'n1', title: 'Deadline a week: Grant X', body: null, created_at: t(10, 9, 0), assignment_id: 'a1' },
        { id: 'n2', title: 'Deadline a week: Grant X', body: null, created_at: t(10, 9, 0), assignment_id: 'a1' },
        // Same title a day later is a genuinely separate nudge.
        { id: 'n3', title: 'Deadline a week: Grant X', body: null, created_at: t(11, 9, 0), assignment_id: 'a1' },
      ],
    });

    expect(events.filter((event) => event.kind === 'NUDGE')).toHaveLength(2);
  });

  it('recovers a decline that the re-request erased from the assignment', () => {
    const { events } = buildTimeline({
      ...empty,
      followUps: [
        {
          id: 'f1',
          kind: 'NOTE',
          note: `${RE_REQUEST_NOTE_PREFIX}. Original reason: Too close to term end`,
          happened_at: t(6),
          reminder_sent_at: null,
          remind_faculty: false,
          assignment_id: 'a1',
          created_by: officer,
        },
      ],
      // responded_at and declined_reason are gone, as the route clears them.
      assignments: [assignment({ status: 'ASSIGNED', responded_at: null })],
    });

    const declined = events.find((event) => event.kind === 'DECLINED');
    expect(declined).toBeDefined();
    expect(declined?.detail).toContain('Too close to term end');
    expect(declined?.approximate).toBe(true);
  });

  it('keys submission on submitted_at, not completed_at', () => {
    const { events } = buildTimeline({
      ...empty,
      // Re-opened after submission: completed_at cleared, submitted_at kept.
      assignments: [
        assignment({ status: 'IN_PROGRESS', submitted_at: t(12), completed_at: null }),
      ],
    });

    expect(events.map((event) => event.kind)).toContain('SUBMITTED');
    expect(events.map((event) => event.kind)).not.toContain('COMPLETED');
  });

  it('emits a triage decision and a reminder as their own events', () => {
    const { events } = buildTimeline({
      ...empty,
      followUps: [
        {
          id: 'f1',
          kind: 'TRIAGE',
          note: 'Marked not relevant for School of Pharmacy — no drug work here',
          happened_at: t(2),
          reminder_sent_at: null,
          remind_faculty: false,
          assignment_id: null,
          created_by: officer,
        },
        {
          id: 'f2',
          kind: 'REMINDER',
          note: 'Chase again after the board meets',
          happened_at: t(4),
          reminder_sent_at: t(8),
          remind_faculty: false,
          assignment_id: null,
          created_by: officer,
        },
      ],
    });

    expect(events.map((event) => event.kind)).toEqual(['REMINDER_SENT', 'FOLLOW_UP', 'TRIAGE']);
    expect(events[2].title).toContain('not relevant');
  });

  it('cuts every source at the horizon when one source was truncated', () => {
    const { events, truncatedBefore } = buildTimeline(
      {
        ...empty,
        // Follow-ups were capped; the oldest one we got is day 5.
        followUps: [5, 6, 7].map((day) => ({
          id: `f${day}`,
          kind: 'NOTE',
          note: `note ${day}`,
          happened_at: t(day),
          reminder_sent_at: null,
          remind_faculty: false,
          assignment_id: 'a1',
          created_by: officer,
        })),
        // Assignments were not capped and go back to day 1.
        assignments: [assignment({ created_at: t(1), updated_at: t(1) })],
      },
      { followUps: true }
    );

    expect(truncatedBefore).toBe(t(5));
    // The day-1 assignment is dropped: showing it with no follow-ups beside it
    // would read as "assigned and then nobody did anything".
    expect(events.every((event) => event.at >= t(5))).toBe(true);
    expect(events.map((event) => event.kind)).not.toContain('ASSIGNED');
  });

  it('returns no horizon when nothing was truncated', () => {
    const { truncatedBefore } = buildTimeline({
      ...empty,
      assignments: [assignment({})],
    });
    expect(truncatedBefore).toBeNull();
  });
});
