import { appendAudit, type TenantTx } from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';
import { escapeLike } from '../clients/clients';
import { isUuid } from '../uuid';
import { TRACKING_TYPES, type TrackingType } from './options';

export {
  TRACKING_TYPES,
  MUSCLE_GROUPS,
  EQUIPMENT,
  MOVEMENT_TYPES,
  type TrackingType,
} from './options';

export const EXERCISE_PAGE_SIZE = 50;
const NAME_MAX = 80;
const LABEL_MAX = 40;
const INSTRUCTIONS_MAX = 2000;
const MEDIA_URL_MAX = 500;
const QUERY_MAX = 100;

export interface ExerciseView {
  id: string;
  name: string;
  equipment: string;
  muscleGroup: string;
  movementType: string;
  trackingType: TrackingType;
  instructions: string;
  mediaUrl: string | null;
  /** True for the shared catalog; false for this organization's custom exercises. */
  isGlobal: boolean;
  createdAt: string;
}

interface ExerciseRow {
  id: string;
  organizationId: string | null;
  name: string;
  equipment: string;
  muscleGroup: string;
  movementType: string;
  trackingType: TrackingType;
  instructions: string;
  mediaUrl: string | null;
  createdAt: Date;
}

const toView = (row: ExerciseRow): ExerciseView => ({
  id: row.id,
  name: row.name,
  equipment: row.equipment,
  muscleGroup: row.muscleGroup,
  movementType: row.movementType,
  trackingType: row.trackingType,
  instructions: row.instructions,
  mediaUrl: row.mediaUrl,
  isGlobal: row.organizationId === null,
  createdAt: row.createdAt.toISOString(),
});

const invalid = (field: string, message: string) =>
  new DomainError('VALIDATION', 'Some fields are invalid.', { [field]: [message] });

function label(field: string, value: string, max: number): string {
  const v = value.trim();
  if (v.length < 1 || v.length > max) throw invalid(field, `Use 1-${max} characters.`);
  return v;
}

function cleanMediaUrl(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const v = value.trim();
  if (v === '') return null;
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    throw invalid('mediaUrl', 'Enter a valid https link.');
  }
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    v.length > MEDIA_URL_MAX
  ) {
    throw invalid('mediaUrl', `Use an https link of at most ${MEDIA_URL_MAX} characters.`);
  }
  return v;
}

function cleanTrackingType(value: string): TrackingType {
  if (!(TRACKING_TYPES as readonly string[]).includes(value)) {
    throw invalid('trackingType', 'Choose reps and load, duration or distance.');
  }
  return value as TrackingType;
}

export interface CreateExerciseInput {
  name: string;
  equipment: string;
  muscleGroup: string;
  movementType: string;
  trackingType: TrackingType;
  instructions?: string;
  mediaUrl?: string | null;
}

/** Postgres unique violation, as surfaced through Prisma's driver adapter. */
function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const e = error as { code?: unknown; meta?: { driverAdapterError?: { cause?: unknown } } };
  if (e.code === 'P2002') return true;
  const cause = e.meta?.driverAdapterError?.cause as { originalCode?: unknown } | undefined;
  return cause?.originalCode === '23505';
}

export async function createExercise(
  tx: TenantTx,
  actor: ActorContext,
  input: CreateExerciseInput,
  options: { requestId?: string } = {},
): Promise<ExerciseView> {
  assertCan(actor, 'exercise:create');
  const instructions = (input.instructions ?? '').trim();
  if (instructions.length > INSTRUCTIONS_MAX) {
    throw invalid('instructions', `Use at most ${INSTRUCTIONS_MAX} characters.`);
  }
  const data = {
    name: label('name', input.name, NAME_MAX),
    equipment: label('equipment', input.equipment, LABEL_MAX),
    muscleGroup: label('muscleGroup', input.muscleGroup, LABEL_MAX),
    movementType: label('movementType', input.movementType, LABEL_MAX),
    trackingType: cleanTrackingType(input.trackingType),
    instructions,
    mediaUrl: cleanMediaUrl(input.mediaUrl),
  };

  let row: ExerciseRow;
  try {
    // Scalar FKs only: the tenant extension injects the scalar organizationId.
    row = await tx.exercise.create({ data } as Parameters<typeof tx.exercise.create>[0]);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new DomainError('CONFLICT', 'You already have an exercise with this name.', {
        name: ['You already have an exercise with this name.'],
      });
    }
    throw error;
  }
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'exercise',
    objectId: row.id,
    action: 'exercise.created',
    requestId: options.requestId,
  });
  return toView(row);
}

export interface SearchExercisesQuery {
  q?: string;
  muscleGroup?: string;
  equipment?: string;
  trackingType?: TrackingType;
  cursor?: string;
}

interface NameCursor {
  name: string;
  id: string;
}

const encodeNameCursor = (row: NameCursor): string =>
  Buffer.from(JSON.stringify({ n: row.name, i: row.id })).toString('base64url');

function decodeNameCursor(cursor: string): NameCursor {
  const fail = () => invalid('cursor', 'Invalid.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw fail();
  }
  const { n, i } = (parsed ?? {}) as { n?: unknown; i?: unknown };
  if (typeof n !== 'string' || typeof i !== 'string' || !isUuid(i)) throw fail();
  return { name: n, id: i };
}

/** Catalog + this organization's custom exercises, sorted by name then id, 50 per page. */
export async function searchExercises(
  tx: TenantTx,
  actor: ActorContext,
  query: SearchExercisesQuery,
): Promise<{ items: ExerciseView[]; nextCursor: string | null }> {
  assertCan(actor, 'exercise:read');
  const and: Record<string, unknown>[] = [];
  if (query.q !== undefined) {
    const q = query.q.trim();
    if (q.length < 1 || q.length > QUERY_MAX) throw invalid('q', `Use 1-${QUERY_MAX} characters.`);
    and.push({ name: { contains: escapeLike(q), mode: 'insensitive' } });
  }
  if (query.muscleGroup !== undefined) {
    and.push({
      muscleGroup: {
        equals: label('muscleGroup', query.muscleGroup, LABEL_MAX),
        mode: 'insensitive',
      },
    });
  }
  if (query.equipment !== undefined) {
    and.push({
      equipment: { equals: label('equipment', query.equipment, LABEL_MAX), mode: 'insensitive' },
    });
  }
  if (query.trackingType !== undefined) {
    and.push({ trackingType: cleanTrackingType(query.trackingType) });
  }
  if (query.cursor !== undefined) {
    const c = decodeNameCursor(query.cursor);
    and.push({ OR: [{ name: { gt: c.name } }, { name: c.name, id: { gt: c.id } }] });
  }
  const rows = await tx.exercise.findMany({
    where: and.length ? { AND: and } : {},
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: EXERCISE_PAGE_SIZE + 1,
  });
  const page = rows.slice(0, EXERCISE_PAGE_SIZE);
  const last = page[page.length - 1];
  return {
    items: page.map(toView),
    nextCursor: rows.length > EXERCISE_PAGE_SIZE && last ? encodeNameCursor(last) : null,
  };
}
