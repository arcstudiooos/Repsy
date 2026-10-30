import { createHash, randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { STATE_FILE, type E2EState } from './state';

export const readState = (): E2EState => JSON.parse(readFileSync(STATE_FILE, 'utf8')) as E2EState;

/** Same normalization as @kinetic/core normalizePilotCode (uppercase, no hyphens or spaces). */
const normalizeCode = (code: string) => code.replace(/[\s-]+/g, '').toUpperCase();

/** Inserts an unused pilot code (stored hashed, like production) via the admin connection. */
export async function createPilotCode(code: string): Promise<void> {
  const client = new pg.Client({ connectionString: readState().adminUrl });
  await client.connect();
  try {
    const email = `admin-${Math.random().toString(36).slice(2)}@example.test`;
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO users (id, email, name, updated_at)
       VALUES (gen_random_uuid(), $1, 'Platform Admin', now()) RETURNING id`,
      [email],
    );
    await client.query(
      `INSERT INTO pilot_codes (id, code_hash, created_by, expires_at)
       VALUES (gen_random_uuid(), $1, $2, now() + interval '1 day')`,
      [createHash('sha256').update(normalizeCode(code)).digest('hex'), rows[0]?.id],
    );
  } finally {
    await client.end();
  }
}

/** Reads a coach's org setup via the admin connection (bypasses RLS). */
export async function findOwnerOrg(email: string): Promise<{ name: string; role: string } | null> {
  const client = new pg.Client({ connectionString: readState().adminUrl });
  await client.connect();
  try {
    const { rows } = await client.query<{ name: string; role: string }>(
      `SELECT o.name, m.role FROM memberships m
       JOIN users u ON u.id = m.user_id
       JOIN organizations o ON o.id = m.organization_id
       WHERE u.email = $1`,
      [email],
    );
    return rows[0] ?? null;
  } finally {
    await client.end();
  }
}

/**
 * Turns `clientEmail` (an already signed-up user) into a `client` of the coach's
 * organization: adds a client membership there and removes the user's own
 * owner membership, so the account has only the client role. Admin connection
 * (bypasses RLS); test setup only.
 */
export async function makeClientOfCoach(coachEmail: string, clientEmail: string): Promise<void> {
  const client = new pg.Client({ connectionString: readState().adminUrl });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO memberships (id, user_id, organization_id, role, status)
       SELECT gen_random_uuid(), cu.id, m.organization_id, 'client', 'active'
       FROM users cu, users co
       JOIN memberships m ON m.user_id = co.id AND m.role = 'owner'
       WHERE cu.email = $1 AND co.email = $2`,
      [clientEmail, coachEmail],
    );
    // The portal gate also needs a linked Client row in that organization.
    await client.query(
      `INSERT INTO clients (id, organization_id, user_id, coach_user_id, name, email, status,
                            timezone, updated_at)
       SELECT gen_random_uuid(), m.organization_id, cu.id, co.id, cu.name, lower(cu.email),
              'active', 'UTC', now()
       FROM users cu, users co
       JOIN memberships m ON m.user_id = co.id AND m.role = 'owner'
       WHERE cu.email = $1 AND co.email = $2`,
      [clientEmail, coachEmail],
    );
    await client.query(
      `DELETE FROM memberships
       WHERE role = 'owner' AND user_id = (SELECT id FROM users WHERE email = $1)`,
      [clientEmail],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

/** Clears sign-up attempt counters (5 per IP per 15 min) so helpers can create several users. */
export async function resetRateLimits(): Promise<void> {
  const client = new pg.Client({ connectionString: readState().adminUrl });
  await client.connect();
  try {
    await client.query('DELETE FROM rate_limits');
  } finally {
    await client.end();
  }
}

/** Renames the organization a coach owns, so tests can tell two orgs apart. Admin connection. */
export async function renameOwnerOrg(coachEmail: string, name: string): Promise<void> {
  const client = new pg.Client({ connectionString: readState().adminUrl });
  await client.connect();
  try {
    await client.query(
      `UPDATE organizations SET name = $2 WHERE id IN (
         SELECT m.organization_id FROM memberships m JOIN users u ON u.id = m.user_id
         WHERE u.email = $1)`,
      [coachEmail, name],
    );
  } finally {
    await client.end();
  }
}

/** Audit rows with `action` for one object (admin connection; test assertions only). */
export async function countAudits(objectId: string, action: string): Promise<number> {
  const client = new pg.Client({ connectionString: readState().adminUrl });
  await client.connect();
  try {
    const { rows } = await client.query<{ n: string }>(
      'SELECT count(*) AS n FROM audit_events WHERE object_id = $1 AND action = $2',
      [objectId, action],
    );
    return Number(rows[0]?.n ?? 0);
  } finally {
    await client.end();
  }
}

/** Stored set logs of one session, as text (weight_kg exactly as Postgres keeps it). Admin connection. */
export async function storedSetLogs(
  sessionId: string,
): Promise<{ set_index: number; reps: number | null; weight_kg: string | null }[]> {
  const client = new pg.Client({ connectionString: readState().adminUrl });
  await client.connect();
  try {
    const { rows } = await client.query<{
      set_index: number;
      reps: number | null;
      weight_kg: string | null;
    }>(
      `SELECT set_index, reps, weight_kg::text AS weight_kg FROM set_logs
       WHERE session_id = $1 ORDER BY workout_version_exercise_id, set_index`,
      [sessionId],
    );
    return rows;
  } finally {
    await client.end();
  }
}

/**
 * The session's state and how its set logs relate to its locked workout version (admin connection; test
 * assertions only): `onLocked` counts rows whose exercise belongs to the locked version.
 */
export async function sessionFacts(sessionId: string): Promise<{
  state: string;
  workoutVersionId: string | null;
  rows: number;
  onLocked: number;
}> {
  const client = new pg.Client({ connectionString: readState().adminUrl });
  await client.connect();
  try {
    const { rows } = await client.query<{
      state: string;
      workout_version_id: string | null;
      rows: string;
      on_locked: string;
    }>(
      `SELECT s.state, s.workout_version_id,
              (SELECT count(*) FROM set_logs l WHERE l.session_id = s.id) AS rows,
              (SELECT count(*) FROM set_logs l
                 JOIN workout_version_exercises e ON e.id = l.workout_version_exercise_id
                WHERE l.session_id = s.id AND e.workout_version_id = s.workout_version_id) AS on_locked
         FROM workout_sessions s WHERE s.id = $1`,
      [sessionId],
    );
    const r = rows[0];
    if (!r) throw new Error(`no session ${sessionId}`);
    return {
      state: r.state,
      workoutVersionId: r.workout_version_id,
      rows: Number(r.rows),
      onLocked: Number(r.on_locked),
    };
  } finally {
    await client.end();
  }
}

/**
 * A verified coach owning an organization, and a verified, linked, active client of it, written directly (admin
 * connection) with real credential hashes, so a spec can sign both in without the sign-up flow. Used by the offline
 * spec, whose production-mode server keeps the breached-password check on (and that check needs the network).
 */
export async function seedCoachWithClient(opts: {
  coachName: string;
  clientName: string;
  password: string;
  timezone: string;
}): Promise<{ coachEmail: string; clientEmail: string; clientId: string }> {
  const tag = randomUUID().slice(0, 8);
  const coachEmail = `coach-${tag}@example.test`;
  const clientEmail = `client-${tag}@example.test`;
  const hash = await hashPassword(opts.password);
  const client = new pg.Client({ connectionString: readState().adminUrl });
  await client.connect();
  try {
    await client.query('BEGIN');
    const user = async (email: string, name: string) => {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO users (id, email, name, email_verified, updated_at)
         VALUES (gen_random_uuid(), $1, $2, true, now()) RETURNING id`,
        [email, name],
      );
      const id = rows[0]!.id;
      await client.query(
        `INSERT INTO accounts (id, account_id, provider_id, user_id, password, updated_at)
         VALUES (gen_random_uuid(), $1::text, 'credential', $1::uuid, $2, now())`,
        [id, hash],
      );
      return id;
    };
    const coachId = await user(coachEmail, opts.coachName);
    const clientUserId = await user(clientEmail, opts.clientName);
    const { rows: org } = await client.query<{ id: string }>(
      `INSERT INTO organizations (id, name, timezone, owner_user_id, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, now()) RETURNING id`,
      [`${opts.coachName} Coaching`, opts.timezone, coachId],
    );
    const orgId = org[0]!.id;
    await client.query(
      `INSERT INTO memberships (id, user_id, organization_id, role, status)
       VALUES (gen_random_uuid(), $1, $3, 'owner', 'active'),
              (gen_random_uuid(), $2, $3, 'client', 'active')`,
      [coachId, clientUserId, orgId],
    );
    const { rows: c } = await client.query<{ id: string }>(
      `INSERT INTO clients (id, organization_id, user_id, coach_user_id, name, email, status, timezone,
                            consent_version, consent_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'active', $6, '1', now(), now()) RETURNING id`,
      [orgId, clientUserId, coachId, opts.clientName, clientEmail, opts.timezone],
    );
    await client.query('COMMIT');
    return { coachEmail, clientEmail, clientId: c[0]!.id };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

/**
 * Issues today's check-in for the client with `clientName` now, as the `checkins.issue` job would (admin
 * connection; the job runs every 10 minutes, too slow for a spec). Uses the organization's template questions.
 */
export async function issueCheckinNow(clientName: string): Promise<string> {
  const client = new pg.Client({ connectionString: readState().adminUrl });
  await client.connect();
  try {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO checkins (id, organization_id, client_id, template_id, period_local_date, questions_json,
                             issued_at, due_at, updated_at)
       SELECT gen_random_uuid(), c.organization_id, c.id, t.id,
              (now() AT TIME ZONE c.timezone)::date, t.questions_json,
              now(), now() + interval '12 hours', now()
         FROM clients c JOIN checkin_templates t ON t.organization_id = c.organization_id
        WHERE c.name = $1
       RETURNING id`,
      [clientName],
    );
    const id = rows[0]?.id;
    if (!id) throw new Error(`no client ${clientName} with a check-in template`);
    return id;
  } finally {
    await client.end();
  }
}
