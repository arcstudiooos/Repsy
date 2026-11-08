import type { TenantTx } from '@repsy/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';
import { canonicalTimezone } from '../timezone';
import {
  cleanGoals,
  cleanName,
  countActiveClients,
  EMAIL,
  lockOrganization,
  NAME_MAX,
  GOALS_MAX,
} from './clients';

/** Most rows one import may carry (PRD B17): a whole roster from another platform, in one request. */
export const IMPORT_MAX_ROWS = 500;

export interface ImportRowInput {
  name: string;
  email: string;
  goals?: string | null;
  timezone?: string | null;
  units?: string | null;
}

export interface ImportRowResult {
  /** 1-based position in the submitted rows. */
  row: number;
  name: string;
  email: string;
  ok: boolean;
  /** Why the row cannot be imported; null when it can (or was). */
  error: string | null;
  /** The new client's id; set only on a real (not dry-run) import. */
  clientId: string | null;
}

export interface ImportResult {
  dryRun: boolean;
  /** Rows that were (or, on a dry run, would be) created. */
  created: number;
  skipped: number;
  rows: ImportRowResult[];
}

type Clean = {
  name: string;
  email: string;
  goals: string | null;
  timezone: string | null;
  units: 'kg' | 'lb';
};

function clean(input: ImportRowInput): Clean | string {
  let name: string;
  try {
    name = cleanName(String(input.name ?? ''));
  } catch {
    return `Name must be 1-${NAME_MAX} characters.`;
  }
  const email = String(input.email ?? '')
    .trim()
    .toLowerCase();
  if (!EMAIL.test(email) || email.length > 254) return 'Email is not valid.';
  let goals: string | null;
  try {
    goals = cleanGoals(input.goals ?? null);
  } catch {
    return `Goals must be at most ${GOALS_MAX} characters.`;
  }
  let timezone: string | null = null;
  const tzRaw = (input.timezone ?? '').trim();
  if (tzRaw !== '') {
    timezone = canonicalTimezone(tzRaw);
    if (!timezone) return `Unknown time zone "${tzRaw.slice(0, 60)}".`;
  }
  const unitsRaw = (input.units ?? '').trim().toLowerCase();
  let units: 'kg' | 'lb' = 'kg';
  if (unitsRaw === 'lb' || unitsRaw === 'lbs') units = 'lb';
  else if (unitsRaw !== '' && unitsRaw !== 'kg' && unitsRaw !== 'kgs')
    return 'Units must be kg or lb.';
  return { name, email, goals, timezone, units };
}

/**
 * Bulk-creates clients from a roster another platform exported (PRD B17, migration toolkit). Every row is checked
 * the way `createClient` checks one: name, email, emails already used in the org or earlier in the file, and the
 * active-client limit. A dry run reports what would happen without writing. A real run creates the rows that pass
 * and skips the rest, so the coach can fix the file and re-import only the leftovers. Imported clients get no
 * invite: the coach sends invites when they are ready (no message reaches a client without the coach's say-so).
 */
export async function importClients(
  tx: TenantTx,
  actor: ActorContext,
  input: { rows: ImportRowInput[]; dryRun?: boolean },
): Promise<ImportResult> {
  assertCan(actor, 'client:create');
  const dryRun = input.dryRun ?? false;
  if (!Array.isArray(input.rows) || input.rows.length === 0) {
    throw new DomainError('VALIDATION', 'Some fields are invalid.', {
      rows: ['Add at least one row.'],
    });
  }
  if (input.rows.length > IMPORT_MAX_ROWS) {
    throw new DomainError('VALIDATION', 'Some fields are invalid.', {
      rows: [`Import at most ${IMPORT_MAX_ROWS} rows at a time.`],
    });
  }

  const org = await lockOrganization(tx, actor);
  const orgZone = canonicalTimezone(org.timezone) ?? org.timezone;
  let slots = org.activeClientLimit - (await countActiveClients(tx));

  const cleaned = input.rows.map(clean);
  const emails = cleaned.flatMap((c) => (typeof c === 'string' ? [] : [c.email]));
  const taken = new Set(
    (
      await tx.client.findMany({
        where: { email: { in: [...new Set(emails)] } },
        select: { email: true },
      })
    ).map((c) => c.email),
  );
  const seen = new Set<string>();

  const rows: ImportRowResult[] = [];
  for (const [i, c] of cleaned.entries()) {
    const raw = input.rows[i]!;
    const base = {
      row: i + 1,
      name: typeof c === 'string' ? String(raw.name ?? '').trim() : c.name,
      email: typeof c === 'string' ? String(raw.email ?? '').trim() : c.email,
    };
    const skip = (error: string) => rows.push({ ...base, ok: false, error, clientId: null });
    if (typeof c === 'string') {
      skip(c);
      continue;
    }
    if (taken.has(c.email)) {
      skip('A client with this email already exists.');
      continue;
    }
    if (seen.has(c.email)) {
      skip('This email appears earlier in the file.');
      continue;
    }
    if (slots <= 0) {
      skip(`Over your limit of ${org.activeClientLimit} active clients.`);
      continue;
    }
    seen.add(c.email);
    slots -= 1;
    let clientId: string | null = null;
    if (!dryRun) {
      const created = await tx.client.create({
        data: {
          coachUserId: actor.userId,
          name: c.name,
          email: c.email,
          goals: c.goals,
          timezone: c.timezone ?? orgZone,
          preferredUnits: c.units,
        },
        select: { id: true },
      } as Parameters<typeof tx.client.create>[0]);
      clientId = (created as { id: string }).id;
    }
    rows.push({ ...base, ok: true, error: null, clientId });
  }
  const created = rows.filter((r) => r.ok).length;
  return { dryRun, created, skipped: rows.length - created, rows };
}
