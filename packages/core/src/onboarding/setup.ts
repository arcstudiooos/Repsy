import type { TenantTx } from '@repsy/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';

export type SetupStepId =
  'program' | 'client' | 'invite' | 'assign' | 'checkin' | 'workout' | 'replies';

export interface SetupStep {
  id: SetupStepId;
  title: string;
  body: string;
  /** Where the coach goes to do it. */
  href: string;
  done: boolean;
}

export interface SetupChecklist {
  steps: SetupStep[];
  doneCount: number;
  /** Every step done, or the coach hid the checklist: the dashboard leaves it out. */
  hidden: boolean;
  /** The coach hid it (they can show it again while steps remain). */
  dismissed: boolean;
}

/**
 * The first-week setup checklist on the coach dashboard (PRD A5). Each step is worked out from what exists in the
 * organization, never ticked by hand, so it stays right as the coach works. Hiding it is per coach.
 */
export async function getSetupChecklist(
  tx: TenantTx,
  actor: ActorContext,
): Promise<SetupChecklist> {
  assertCan(actor, 'org:read');
  // One transaction is one connection: run the counts one after another.
  const programs = await tx.program.count({ where: { kind: 'template' } });
  const clients = await tx.client.count();
  const invites = await tx.clientInvite.count();
  const assignments = await tx.programAssignment.count();
  const checkins = await tx.client.count({ where: { checkinWeekday: { not: null } } });
  const workouts = await tx.workoutSession.count({ where: { state: 'completed' } });
  const org = await tx.organization.findUniqueOrThrow({
    where: { id: actor.orgId },
    select: { replyTargetHours: true, officeHours: true },
  });
  const profile = await tx.coachProfile.findUnique({
    where: { userId: actor.userId },
    select: { setupDismissedAt: true },
  });
  const steps: SetupStep[] = [
    {
      id: 'program',
      title: 'Build your first program',
      body: 'Start from a blank program or duplicate one you like.',
      href: '/app/programs',
      done: programs > 0,
    },
    {
      id: 'client',
      title: 'Add a client',
      body: 'Add them one at a time, or import your roster from a CSV file.',
      href: '/app/clients',
      done: clients > 0,
    },
    {
      id: 'invite',
      title: 'Invite a client',
      body: 'Tip: invite yourself with a second email to see what clients see.',
      href: '/app/clients',
      done: invites > 0,
    },
    {
      id: 'assign',
      title: 'Assign a program',
      body: 'Open a client and assign a program with a start date.',
      href: '/app/clients',
      done: assignments > 0,
    },
    {
      id: 'checkin',
      title: 'Pick a weekly check-in day',
      body: "Set it on a client's Check-ins tab.",
      href: '/app/clients',
      done: checkins > 0,
    },
    {
      id: 'replies',
      title: 'Set reply expectations',
      body: 'Tell clients how soon you usually reply and when you are available.',
      href: '/app/settings',
      done: org.replyTargetHours !== null || org.officeHours !== null,
    },
    {
      id: 'workout',
      title: 'See a first workout logged',
      body: 'When a client finishes a workout it shows up on this dashboard.',
      href: '/app/review',
      done: workouts > 0,
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const dismissed = Boolean(profile?.setupDismissedAt);
  return { steps, doneCount, hidden: doneCount === steps.length || dismissed, dismissed };
}

/** Hide (or show again) the setup checklist for this coach. */
export async function setSetupChecklistHidden(
  tx: TenantTx,
  actor: ActorContext,
  hidden: boolean,
): Promise<{ hidden: boolean }> {
  assertCan(actor, 'org:read');
  const setupDismissedAt = hidden ? new Date() : null;
  await tx.coachProfile.upsert({
    where: { userId: actor.userId },
    create: { userId: actor.userId, setupDismissedAt },
    update: { setupDismissedAt },
  });
  return { hidden };
}
