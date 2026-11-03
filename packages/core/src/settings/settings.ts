import type { TenantTx } from '@kinetic/db';
import { isCoachRole } from '../authz/actor';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { countActiveClients } from '../clients/clients';
import { DomainError } from '../errors';
import { canonicalTimezone } from '../timezone';

type Units = 'kg' | 'lb';

export const BIO_MAX = 1000;
export const SPECIALTIES_MAX = 10;
export const SPECIALTY_MAX = 40;
export const NAME_MAX = 120;
export const GRACE_HOURS_MAX = 72;

export interface SettingsView {
  /** Coaches and owners only; null for clients. */
  profile: { bio: string | null; specialties: string[]; units: Units } | null;
  /** Coaches and owners only. */
  org?: {
    name: string;
    timezone: string;
    graceHours: number;
    activeClientLimit: number;
    activeClientCount: number;
  };
  notifications: {
    messageEmailOptIn: boolean;
    marketingOptIn: boolean;
    digestEmailOptIn: boolean;
    /** PRD I9 (coaches). */
    weeklyBriefOptIn: boolean;
    workoutReminderOptIn: boolean;
    checkinReminderOptIn: boolean;
    habitReminderOptIn: boolean;
  };
  /** Clients only. */
  client?: { timezone: string; preferredUnits: Units };
}

export interface SettingsPatch {
  profile?: { bio?: string | null; specialties?: string[]; units?: Units };
  org?: { name?: string; timezone?: string; graceHours?: number | null };
  notifications?: {
    messageEmailOptIn?: boolean;
    marketingOptIn?: boolean;
    digestEmailOptIn?: boolean;
    weeklyBriefOptIn?: boolean;
    workoutReminderOptIn?: boolean;
    checkinReminderOptIn?: boolean;
    habitReminderOptIn?: boolean;
  };
  client?: { timezone?: string; preferredUnits?: Units };
}

const isCoach = (actor: ActorContext) => isCoachRole(actor.role);

/** Creates the user's rows on first sight (no-op when present, safe under races). */
async function ensureRows(tx: TenantTx, actor: ActorContext) {
  await tx.notificationPreference.createMany({
    data: [{ userId: actor.userId }],
    skipDuplicates: true,
  });
  if (isCoach(actor)) {
    await tx.coachProfile.createMany({ data: [{ userId: actor.userId }], skipDuplicates: true });
  }
}

export async function getSettings(tx: TenantTx, actor: ActorContext): Promise<SettingsView> {
  await ensureRows(tx, actor);
  const notifications = await tx.notificationPreference.findUniqueOrThrow({
    where: { userId: actor.userId },
    select: {
      messageEmailOptIn: true,
      marketingOptIn: true,
      digestEmailOptIn: true,
      weeklyBriefOptIn: true,
      workoutReminderOptIn: true,
      checkinReminderOptIn: true,
      habitReminderOptIn: true,
    },
  });

  if (!isCoach(actor)) {
    const own = await tx.client.findFirst({
      where: { userId: actor.userId },
      select: { timezone: true, preferredUnits: true },
    });
    if (!own) throw new DomainError('NOT_FOUND', 'Not found.');
    return { profile: null, notifications, client: own };
  }

  // Sequential: a transaction is one connection (pg deprecates overlapping queries on it).
  const profile = await tx.coachProfile.findUniqueOrThrow({
    where: { userId: actor.userId },
    select: { bio: true, specialties: true, units: true },
  });
  const org = await tx.organization.findFirst({
    where: { id: actor.orgId },
    select: { name: true, timezone: true, graceHours: true, activeClientLimit: true },
  });
  const activeClientCount = await countActiveClients(tx);
  if (!org) throw new DomainError('NOT_FOUND', 'Not found.');
  return { profile, org: { ...org, activeClientCount }, notifications };
}

const add = (errors: Record<string, string[]>, field: string, message: string) => {
  (errors[field] ??= []).push(message);
};

interface Cleaned {
  profile?: { bio?: string | null; specialties?: string[]; units?: Units };
  org?: { name?: string; timezone?: string; graceHours?: number };
  notifications?: {
    messageEmailOptIn?: boolean;
    marketingOptIn?: boolean;
    digestEmailOptIn?: boolean;
    weeklyBriefOptIn?: boolean;
    workoutReminderOptIn?: boolean;
    checkinReminderOptIn?: boolean;
    habitReminderOptIn?: boolean;
  };
  client?: { timezone?: string; preferredUnits?: Units };
}

const isUnits = (v: unknown): v is Units => v === 'kg' || v === 'lb';

function validate(patch: SettingsPatch): Cleaned {
  const errors: Record<string, string[]> = {};
  const out: Cleaned = {};

  if (patch.profile) {
    const p: NonNullable<Cleaned['profile']> = {};
    const { bio, specialties, units } = patch.profile;
    if (bio !== undefined) {
      const v = bio === null ? '' : bio.trim();
      if (v.length > BIO_MAX) add(errors, 'profile.bio', `Use at most ${BIO_MAX} characters.`);
      else p.bio = v === '' ? null : v;
    }
    if (specialties !== undefined) {
      const items = specialties.map((s) => s.trim());
      if (items.length > SPECIALTIES_MAX) {
        add(errors, 'profile.specialties', `Add at most ${SPECIALTIES_MAX} specialties.`);
      } else if (items.some((s) => s === '' || s.length > SPECIALTY_MAX)) {
        add(errors, 'profile.specialties', `Use 1-${SPECIALTY_MAX} characters for each specialty.`);
      } else {
        p.specialties = [...new Set(items)];
      }
    }
    if (units !== undefined) {
      if (isUnits(units)) p.units = units;
      else add(errors, 'profile.units', 'Choose kg or lb.');
    }
    out.profile = p;
  }

  if (patch.org) {
    const o: NonNullable<Cleaned['org']> = {};
    const { name, timezone, graceHours } = patch.org;
    if (name !== undefined) {
      const v = name.trim();
      if (v.length < 1 || v.length > NAME_MAX) {
        add(errors, 'org.name', `Use 1-${NAME_MAX} characters.`);
      } else o.name = v;
    }
    if (timezone !== undefined) {
      const zone = canonicalTimezone(timezone);
      if (zone) o.timezone = zone;
      else add(errors, 'org.timezone', 'Choose a valid time zone.');
    }
    if (graceHours !== undefined) {
      if (
        typeof graceHours === 'number' &&
        Number.isInteger(graceHours) &&
        graceHours >= 0 &&
        graceHours <= GRACE_HOURS_MAX
      ) {
        o.graceHours = graceHours;
      } else add(errors, 'org.graceHours', `Use a whole number from 0 to ${GRACE_HOURS_MAX}.`);
    }
    out.org = o;
  }

  if (patch.notifications) out.notifications = { ...patch.notifications };

  if (patch.client) {
    const c: NonNullable<Cleaned['client']> = {};
    const { timezone, preferredUnits } = patch.client;
    if (timezone !== undefined) {
      const zone = canonicalTimezone(timezone);
      if (zone) c.timezone = zone;
      else add(errors, 'client.timezone', 'Choose a valid time zone.');
    }
    if (preferredUnits !== undefined) {
      if (isUnits(preferredUnits)) c.preferredUnits = preferredUnits;
      else add(errors, 'client.preferredUnits', 'Choose kg or lb.');
    }
    out.client = c;
  }

  if (Object.keys(errors).length > 0) {
    throw new DomainError('VALIDATION', 'Some fields are invalid.', errors);
  }
  return out;
}

const names = <K extends string>(block: K, obj: object | undefined): string[] =>
  Object.entries(obj ?? {})
    .filter(([, v]) => v !== undefined)
    .map(([k]) => `${block}.${k}`);

/**
 * Applies a settings patch for the acting user. Returns the dotted names of the
 * fields written (never values), for the audit trail.
 */
export async function updateSettings(
  tx: TenantTx,
  actor: ActorContext,
  patch: SettingsPatch,
): Promise<string[]> {
  // Authorize before validating, so a forbidden block never leaks validation detail.
  const forbid = () => new DomainError('FORBIDDEN', 'You do not have access to this.');
  if (patch.org) assertCan(actor, 'settings:org:update');
  if (isCoach(actor) ? patch.client : patch.profile) throw forbid();

  const clean = validate(patch);
  await ensureRows(tx, actor);
  const changed: string[] = [];

  if (clean.profile && Object.keys(clean.profile).length > 0) {
    await tx.coachProfile.update({ where: { userId: actor.userId }, data: clean.profile });
    changed.push(...names('profile', clean.profile));
  }
  if (clean.org && Object.keys(clean.org).length > 0) {
    await tx.organization.update({ where: { id: actor.orgId }, data: clean.org });
    changed.push(...names('org', clean.org));
  }
  // The digest (PRD H14) is a coach email; a client's setting is ignored.
  if (clean.notifications && !isCoach(actor)) {
    delete clean.notifications.digestEmailOptIn;
    delete clean.notifications.weeklyBriefOptIn;
  }
  // Reminders (PRD H13) are client emails; a coach's setting is ignored.
  if (clean.notifications && isCoach(actor)) {
    delete clean.notifications.workoutReminderOptIn;
    delete clean.notifications.checkinReminderOptIn;
    delete clean.notifications.habitReminderOptIn;
  }
  if (clean.notifications && Object.keys(clean.notifications).length > 0) {
    await tx.notificationPreference.update({
      where: { userId: actor.userId },
      data: clean.notifications,
    });
    changed.push(...names('notifications', clean.notifications));
  }
  if (clean.client && Object.keys(clean.client).length > 0) {
    const own = await tx.client.findFirst({
      where: { userId: actor.userId },
      select: { id: true },
    });
    if (!own) throw new DomainError('NOT_FOUND', 'Not found.');
    await tx.client.update({ where: { id: own.id }, data: clean.client });
    changed.push(...names('client', clean.client));
  }
  return changed;
}
