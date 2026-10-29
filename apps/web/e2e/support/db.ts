import { createHash } from 'node:crypto';
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
