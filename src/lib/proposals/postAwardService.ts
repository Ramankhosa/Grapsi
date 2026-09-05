/**
 * What the office owes the agency after the money arrives.
 *
 * `SANCTIONED` used to be where the record stopped, which is precisely where
 * the department's obligations begin: instalments to claim, utilisation
 * certificates and statements of expenditure to file, progress reports to
 * submit, and an end date that moves when an extension is granted. Missing a
 * UC is how an institution loses its next instalment.
 *
 * These rows live in `assignment_milestones` alongside the assignment-owned
 * ones rather than in a table of their own — the same table took a nullable
 * owner when call-level follow-ups arrived. One definition of "a post-award
 * obligation" means the two can never disagree about what is due.
 */
import prisma from "@/lib/prisma";

import { recordProposalEvent } from "./events";
import { ProposalError } from "./proposalService";
import { getProposalSettings } from "./settings";
import {
  MILESTONE_LABELS,
  serializeMilestone,
  type MilestoneKind,
  type MilestoneStatus,
} from "./shared";

export interface AddMilestoneInput {
  tenantId: string;
  proposalId: string;
  actorUserId: string;
  kind: MilestoneKind;
  title?: string | null;
  dueAt?: Date | null;
  amount?: number | null;
  currency?: string | null;
  note?: string | null;
  /**
   * Skip the history entry. Only the schedule seeder passes this: fifteen rows
   * all reading "an obligation was added" bury the story the history exists to
   * tell, so it writes one entry describing the whole schedule instead.
   */
  silent?: boolean;
}

export async function addProposalMilestone(input: AddMilestoneInput) {
  const proposal = await prisma.grantProposal.findUnique({
    where: { id: input.proposalId },
    select: { id: true, tenant_id: true, currency: true, status: true },
  });
  if (!proposal)
    throw new ProposalError("Proposal not found.", 404, "NOT_FOUND");

  const settings = await getProposalSettings(input.tenantId);
  if (!settings.postAwardEnabled) {
    throw new ProposalError(
      "Post-award tracking is switched off for this institution.",
      403,
      "FEATURE_DISABLED",
    );
  }

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.assignmentMilestone.create({
      data: {
        tenant_id: proposal.tenant_id,
        // Proposal-owned: assignment_id stays null and the CHECK is satisfied.
        proposal_id: proposal.id,
        kind: input.kind,
        title: (input.title?.trim() || MILESTONE_LABELS[input.kind]).slice(
          0,
          300,
        ),
        due_at: input.dueAt || null,
        amount: input.amount ?? null,
        currency: input.currency || proposal.currency,
        note: input.note?.trim().slice(0, 1000) || null,
        status: "PENDING",
        created_by_user_id: input.actorUserId,
      },
    });

    if (!input.silent) {
      await recordProposalEvent(tx, {
        tenantId: proposal.tenant_id,
        proposalId: proposal.id,
        actorUserId: input.actorUserId,
        kind: "MILESTONE_CHANGED",
        payload: {
          added: true,
          kind: input.kind,
          title: row.title,
          dueAt: row.due_at?.toISOString() ?? null,
        },
      });
    }

    return row;
  });

  return serializeMilestone(created);
}

export async function listProposalMilestones(proposalId: string) {
  const rows = await prisma.assignmentMilestone.findMany({
    where: { proposal_id: proposalId },
    orderBy: [{ due_at: "asc" }, { created_at: "asc" }],
  });
  return rows.map(serializeMilestone);
}

export async function updateProposalMilestone(input: {
  tenantId: string;
  proposalId: string;
  milestoneId: string;
  actorUserId: string;
  status?: MilestoneStatus;
  dueAt?: Date | null;
  amount?: number | null;
  note?: string | null;
}) {
  const milestone = await prisma.assignmentMilestone.findFirst({
    where: { id: input.milestoneId, proposal_id: input.proposalId },
    select: { id: true, title: true, status: true, kind: true },
  });
  if (!milestone)
    throw new ProposalError("That obligation was not found.", 404, "NOT_FOUND");

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.assignmentMilestone.update({
      where: { id: milestone.id },
      data: {
        ...(input.status ? { status: input.status } : {}),
        ...(input.dueAt !== undefined ? { due_at: input.dueAt } : {}),
        ...(input.amount !== undefined ? { amount: input.amount } : {}),
        ...(input.note !== undefined
          ? { note: input.note?.trim().slice(0, 1000) || null }
          : {}),
        // Only a cleared obligation is finished; "submitted" means it is with
        // the agency and may still come back.
        ...(input.status
          ? input.status === "CLEARED" || input.status === "WAIVED"
            ? { completed_at: new Date() }
            : { completed_at: null }
          : {}),
        // A reopened obligation gets its nudge ladder back, or an extension
        // would silently skip every warning.
        ...(input.status && input.status === "PENDING"
          ? { auto_nudge_stages: [] }
          : {}),
        ...(input.dueAt !== undefined ? { auto_nudge_stages: [] } : {}),
      },
    });

    if (input.status && input.status !== milestone.status) {
      await recordProposalEvent(tx, {
        tenantId: input.tenantId,
        proposalId: input.proposalId,
        actorUserId: input.actorUserId,
        kind: "MILESTONE_CHANGED",
        payload: {
          title: milestone.title,
          from: milestone.status,
          to: input.status,
        },
      });
    }

    return row;
  });

  return serializeMilestone(updated);
}

export async function removeProposalMilestone(input: {
  proposalId: string;
  milestoneId: string;
}) {
  const milestone = await prisma.assignmentMilestone.findFirst({
    where: { id: input.milestoneId, proposal_id: input.proposalId },
    select: { id: true },
  });
  if (!milestone)
    throw new ProposalError("That obligation was not found.", 404, "NOT_FOUND");
  await prisma.assignmentMilestone.delete({ where: { id: milestone.id } });
}

/**
 * The project's own dates. Set when the sanction lands, and moved when an
 * agency grants an extension — which is recorded as an event so the original
 * end date is not simply overwritten out of the history.
 */
export async function setProjectDates(input: {
  tenantId: string;
  proposalId: string;
  actorUserId: string;
  startAt?: Date | null;
  endAt?: Date | null;
  reason?: string | null;
  /** See addProposalMilestone: the seeder folds this into its own entry. */
  silent?: boolean;
}) {
  const proposal = await prisma.grantProposal.findUnique({
    where: { id: input.proposalId },
    select: { id: true, project_start_at: true, project_end_at: true },
  });
  if (!proposal)
    throw new ProposalError("Proposal not found.", 404, "NOT_FOUND");

  if (input.startAt && input.endAt && input.endAt < input.startAt) {
    throw new ProposalError(
      "The project cannot end before it starts.",
      400,
      "BAD_DATES",
    );
  }

  const extending =
    input.endAt !== undefined &&
    proposal.project_end_at != null &&
    input.endAt != null &&
    input.endAt.getTime() !== proposal.project_end_at.getTime();

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.grantProposal.update({
      where: { id: proposal.id },
      data: {
        ...(input.startAt !== undefined
          ? { project_start_at: input.startAt }
          : {}),
        ...(input.endAt !== undefined ? { project_end_at: input.endAt } : {}),
      },
      select: { id: true, project_start_at: true, project_end_at: true },
    });

    if (!input.silent) {
      await recordProposalEvent(tx, {
        tenantId: input.tenantId,
        proposalId: input.proposalId,
        actorUserId: input.actorUserId,
        kind: "MILESTONE_CHANGED",
        payload: {
          projectDates: true,
          extension: extending,
          previousEnd: proposal.project_end_at?.toISOString() ?? null,
          startAt: row.project_start_at?.toISOString() ?? null,
          endAt: row.project_end_at?.toISOString() ?? null,
          reason: input.reason?.trim().slice(0, 500) || null,
        },
      });
    }

    return row;
  });

  return {
    projectStartAt: updated.project_start_at,
    projectEndAt: updated.project_end_at,
  };
}

/**
 * A default schedule for a freshly sanctioned project, so the office starts
 * from a plan rather than a blank page: an instalment now, then a utilisation
 * certificate and a progress report at each year end.
 */
export async function seedPostAwardSchedule(input: {
  tenantId: string;
  proposalId: string;
  actorUserId: string;
  startAt: Date;
  years: number;
}) {
  const existing = await prisma.assignmentMilestone.count({
    where: { proposal_id: input.proposalId },
  });
  if (existing > 0) {
    throw new ProposalError(
      "This project already has obligations recorded.",
      409,
      "ALREADY_SCHEDULED",
    );
  }

  const years = Math.min(Math.max(Math.round(input.years) || 1, 1), 10);
  const created: string[] = [];

  // The window is part of the schedule, not a separate step a caller might
  // forget: this function is given the start and the length, so it records
  // them rather than leaving the project undated.
  const projectEnd = new Date(input.startAt);
  projectEnd.setFullYear(projectEnd.getFullYear() + years);
  await setProjectDates({
    tenantId: input.tenantId,
    proposalId: input.proposalId,
    actorUserId: input.actorUserId,
    startAt: input.startAt,
    endAt: projectEnd,
    silent: true,
  });

  for (let year = 1; year <= years; year += 1) {
    const yearEnd = new Date(input.startAt);
    yearEnd.setFullYear(yearEnd.getFullYear() + year);

    await addProposalMilestone({
      tenantId: input.tenantId,
      proposalId: input.proposalId,
      actorUserId: input.actorUserId,
      kind: "UC",
      title: `Utilisation certificate — year ${year}`,
      dueAt: yearEnd,
      silent: true,
    });
    await addProposalMilestone({
      tenantId: input.tenantId,
      proposalId: input.proposalId,
      actorUserId: input.actorUserId,
      kind: "REPORT",
      title: `Progress report — year ${year}`,
      dueAt: yearEnd,
      silent: true,
    });
    created.push(`year ${year}`);
  }

  // One entry for the whole schedule, written after the rows exist so a failure
  // halfway through never leaves a history claiming work that is not there.
  await recordProposalEvent(prisma, {
    tenantId: input.tenantId,
    proposalId: input.proposalId,
    actorUserId: input.actorUserId,
    kind: "MILESTONE_CHANGED",
    payload: {
      scheduled: true,
      years,
      count: years * 2,
      startAt: input.startAt.toISOString(),
      endAt: projectEnd.toISOString(),
    },
  });

  return {
    years,
    created,
    projectStartAt: input.startAt,
    projectEndAt: projectEnd,
  };
}
