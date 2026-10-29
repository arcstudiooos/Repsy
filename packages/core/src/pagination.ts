import { DomainError } from './errors';

export const PAGE_SIZE = 25;

export interface CursorRow {
  createdAt: Date;
  id: string;
}

/** Opaque keyset cursor over `(createdAt, id)`. */
export function encodeCursor(row: CursorRow): string {
  return Buffer.from(JSON.stringify({ c: row.createdAt.toISOString(), i: row.id })).toString(
    'base64url',
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function decodeCursor(cursor: string): CursorRow {
  const invalid = () => new DomainError('VALIDATION', 'Invalid cursor.', { cursor: ['Invalid.'] });
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw invalid();
  }
  if (parsed === null || typeof parsed !== 'object') throw invalid();
  const { c, i } = parsed as { c?: unknown; i?: unknown };
  if (typeof c !== 'string' || typeof i !== 'string' || !UUID.test(i)) throw invalid();
  const createdAt = new Date(c);
  if (Number.isNaN(createdAt.getTime()) || createdAt.toISOString() !== c) throw invalid();
  return { createdAt, id: i };
}
