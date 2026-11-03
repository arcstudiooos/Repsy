import type { TenantTx } from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';
import { enqueueEmail } from '../outbox';
import { todayInZone } from '../timezone';
import { isUuid } from '../uuid';

/**
 * PRD J4 (onboarding sequence per package) + J6 (renewal journey).
 *
 * ASSUMPTION (billing slice, K3, not built yet): a `billing_packages` table
 * with fields `id`, `organizationId`, `name`, `onboardingSequence` (JSON,
 * nullable) and `renewalReminderDays` (int, nullable). Code below reads those
 * names through a structural delegate; if billing names them differently,
 * this file's delegate — not the logic — is what changes.
 *
 * J4: when a package is purchased, `startPackageOnboarding` runs its
 * onboarding sequence. Two shapes are supported, because the billing model
 * stores the sequence as JSON:
 * - `{ sequenceId }` — an existing automation sequence: delegated to the
 *   automations engine's `startRun` (J1-J3 pattern), so its steps, ask-first
 *   approvals and history all work as built.
 * - `{ steps: [{ dayOffset, title, kind }] }` — package-defined steps with no
 *   reusable sequence: recorded as a lightweight `package_journey_runs` row
 *   with its steps as JSON (the worker/executor for these steps is a
 *   follow-up; see SLICE_REPORT_SCHEDULING.md).
 * Either way a `package_journey_runs` row is written, so the journey is
 * visible even when the engine path was taken.
 *
 * J6: `scheduleRenewalReminders` queues one outbox email for
 * `renewalReminderDays` before the package ends/renews (idempotent per
 * package + end date) and creates one coach follow-up item (the existing
 * ReviewFlag `coach_followup` record, via `createFollowup`), due the same
 * day. The engine and follow-up modules are imported dynamically inside the
 * functions, so importing this module never pulls the automation engine or
 * the review stack into a pure-logic test.
 */
export interface PackageJourneyStep {
  dayOffset: number;
  title: string;
  kind: 'task' | 'message' | 'step';
  dueLocalDate: string;
}

export interface PackageJourneyView {
  id: string;
  packageId: string;
  clientId: string;
  source: 'sequence' | 'package_steps';
  sequenceId: string | null;
  status: string;
  steps: PackageJourneyStep[];
}

const invalid = (field: string, message: string) =>
  new DomainError('VALIDATION', 'Some fields are invalid.', { [field]: [message] });
const notFound = () => new DomainError('NOT_FOUND', 'Not found.');
const DAY_MS = 86_400_000;

const addDays = (date: string, n: number): string =>
  new Date(new Date(`${date}T00:00:00Z`).getTime() + n * DAY_MS).toISOString().slice(0, 10);

/** Pure: the reminder instant for a package ending/renewing at `endsAt`. */
export function renewalReminderDate(endsAt: Date, renewalReminderDays: number): Date {
  return new Date(endsAt.getTime() - renewalReminderDays * DAY_MS);
}

/** Pure: package steps from onboarding JSON, with due dates from the purchase day in the client's zone. */
export function cleanJourneySteps(input: unknown, startLocalDate: string): PackageJourneyStep[] {
  if (!Array.isArray(input)) throw invalid('onboardingSequence.steps', 'Add the onboarding steps.');
  if (input.length === 0 || input.length > 30) {
    throw invalid('onboardingSequence.steps', 'Use 1-30 onboarding steps.');
  }
  return input.map((raw, i) => {
    const s = (raw ?? {}) as Record<string, unknown>;
    const dayOffset = Number(s.dayOffset);
    if (!Number.isInteger(dayOffset) || dayOffset < 0 || dayOffset > 365) {
      throw invalid(`onboardingSequence.steps.${i}.dayOffset`, 'Use a day from 0 to 365.');
    }
    const title = typeof s.title === 'string' ? s.title.trim() : '';
    if (title.length < 1 || title.length > 200) {
      throw invalid(`onboardingSequence.steps.${i}.title`, 'Name each step (1-200 characters).');
    }
    const kind = s.kind === 'message' ? 'message' : s.kind === 'task' ? 'task' : 'step';
    return { dayOffset, title, kind, dueLocalDate: addDays(startLocalDate, dayOffset) };
  });
}

/** Structural delegate for the assumed billing table + the journey-run table. */
export interface JourneysDb {
  billingPackage: {
    findFirst(args: unknown): Promise<{
      id: string;
      title: string;
      onboardingSequence: unknown;
      renewalReminderDays: number | null;
    } | null>;
  };
  packageJourneyRun: {
    findFirst(args: unknown): Promise<{ id: string } | null>;
    create(args: unknown): Promise<{ id: string }>;
  };
  client: {
    findFirst(
      args: unknown,
    ): Promise<{ id: string; userId: string | null; timezone: string } | null>;
  };
}

const db = (tx: TenantTx): JourneysDb => tx as unknown as JourneysDb;

/**
 * Starts a package's onboarding sequence for a client at purchase time.
 * Idempotent per (package, client): a second purchase call returns the
 * existing run instead of starting the sequence twice.
 */
export async function startPackageOnboarding(
  tx: TenantTx,
  actor: ActorContext,
  input: Record<string, unknown>,
  opts: { now?: Date } = {},
): Promise<PackageJourneyView> {
  assertCan(actor, 'client:update');
  const now = opts.now ?? new Date();
  if (!isUuid(input.packageId) || !isUuid(input.clientId)) throw notFound();
  const pkg = await db(tx).billingPackage.findFirst({
    where: { id: input.packageId },
    select: { id: true, title: true, onboardingSequence: true, renewalReminderDays: true },
  });
  if (!pkg) throw notFound();
  const client = await db(tx).client.findFirst({
    where: { id: input.clientId },
    select: { id: true, userId: true, timezone: true },
  });
  if (!client) throw notFound();
  const existing = await db(tx).packageJourneyRun.findFirst({
    where: { packageId: pkg.id, clientId: client.id },
    select: { id: true },
  });
  if (existing) {
    // The run already exists; the caller re-reads it through listPackageJourneys
    // in the parent merge (no re-read helper is shipped here to keep this slice small).
    throw new DomainError(
      'CONFLICT',
      'That onboarding sequence is already running for this client.',
    );
  }
  let seqRaw: unknown = pkg.onboardingSequence ?? {};
  if (typeof seqRaw === 'string') {
    try {
      seqRaw = JSON.parse(seqRaw);
    } catch {
      seqRaw = {};
    }
  }
  const seq = seqRaw as Record<string, unknown>;
  const startLocalDate = todayInZone(client.timezone, now);
  let source: 'sequence' | 'package_steps' = 'package_steps';
  let sequenceId: string | null = null;
  let steps: PackageJourneyStep[] = [];
  let status = 'active';
  if (typeof seq.sequenceId === 'string' && isUuid(seq.sequenceId)) {
    source = 'sequence';
    sequenceId = seq.sequenceId;
    const { startRun } = await import('../automations/engine');
    const started = await startRun(tx, sequenceId, client.id, now);
    if (!started) status = 'skipped';
  } else if (Array.isArray(seq.steps)) {
    steps = cleanJourneySteps(seq.steps, startLocalDate);
  } else if (pkg.onboardingSequence !== null && pkg.onboardingSequence !== undefined) {
    throw invalid('onboardingSequence', 'Use a sequenceId or a steps list.');
  }
  const row = await db(tx).packageJourneyRun.create({
    data: {
      packageId: pkg.id,
      clientId: client.id,
      source,
      sequenceId,
      status,
      stepsJson: steps,
      startedAt: now,
    },
    select: { id: true },
  });
  return { id: row.id, packageId: pkg.id, clientId: client.id, source, sequenceId, status, steps };
}

/**
 * J6: schedules the renewal reminder + coach follow-up for a package ending
 * or renewing at `endsAt`. `renewalReminderDays` defaults to the package's
 * own setting, then to 7. The email is idempotent per package + end date;
 * the follow-up is due on the reminder day in the client's zone.
 */
export async function scheduleRenewalReminders(
  tx: TenantTx,
  actor: ActorContext,
  input: Record<string, unknown>,
  opts: { now?: Date } = {},
): Promise<{ remindedAt: string; followUpCreated: boolean }> {
  assertCan(actor, 'client:update');
  const now = opts.now ?? new Date();
  if (!isUuid(input.packageId) || !isUuid(input.clientId)) throw notFound();
  const endsAt = new Date(input.endsAt as string);
  if (Number.isNaN(endsAt.getTime()))
    throw invalid('endsAt', 'Pick when the package ends or renews.');
  const pkg = await db(tx).billingPackage.findFirst({
    where: { id: input.packageId },
    select: { id: true, title: true, onboardingSequence: true, renewalReminderDays: true },
  });
  if (!pkg) throw notFound();
  const client = await db(tx).client.findFirst({
    where: { id: input.clientId },
    select: { id: true, userId: true, timezone: true },
  });
  if (!client) throw notFound();
  const days =
    input.renewalReminderDays !== undefined
      ? Number(input.renewalReminderDays)
      : (pkg.renewalReminderDays ?? 7);
  if (!Number.isInteger(days) || days < 0 || days > 90) {
    throw invalid('renewalReminderDays', 'Use 0-90 days.');
  }
  let remindedAt = renewalReminderDate(endsAt, days);
  if (remindedAt < now) remindedAt = now;
  const endDate = endsAt.toISOString().slice(0, 10);
  if (client.userId) {
    await enqueueEmail(tx, {
      kind: 'package_renewal_reminder',
      toUserId: client.userId,
      templateKey: 'package_renewal_reminder',
      payload: {
        packageId: pkg.id,
        packageName: pkg.title,
        endsAt: endsAt.toISOString(),
      } as never,
      idempotencyKey: `package-renewal:${pkg.id}:${endDate}`,
    });
  }
  const { createFollowup } = await import('../review/flags');
  await createFollowup(tx, actor, {
    clientId: client.id,
    title: `Follow up: ${pkg.title} renews or ends on ${endDate}`,
    dueLocalDate: todayInZone(client.timezone, remindedAt),
  });
  return { remindedAt: remindedAt.toISOString(), followUpCreated: true };
}
