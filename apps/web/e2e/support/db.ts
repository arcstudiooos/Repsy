import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { STATE_FILE, type E2EState } from './state';

export const readState = (): E2EState => JSON.parse(readFileSync(STATE_FILE, 'utf8')) as E2EState;

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
      [createHash('sha256').update(code).digest('hex'), rows[0].id],
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
