import type { TenantTx } from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';
import { commitProgramVersion, type WeekInput } from './commit';
import { createProgram } from './read';

export const MATCH_NAMES_MAX = 300;

export interface ExerciseMatch {
  /** The name as written in the import. */
  name: string;
  /** The best library match, or null when nothing is close. */
  exerciseId: string | null;
  /** Up to 5 likely exercises, best first, for the coach to pick from. */
  candidates: { id: string; name: string; trackingType: string }[];
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const tokens = (s: string) =>
  new Set(
    norm(s)
      .split(' ')
      .filter((t) => t.length > 1),
  );

/** 0-1: exact name 1, one name containing the other 0.8, else shared words over all words. */
export function nameScore(written: string, library: string): number {
  const a = norm(written);
  const b = norm(library);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (b.includes(a) || a.includes(b)) return 0.8;
  const ta = tokens(a);
  const tb = tokens(b);
  const shared = [...ta].filter((t) => tb.has(t) || tb.has(t.replace(/s$/, ''))).length;
  return shared / new Set([...ta, ...tb]).size;
}

/**
 * Matches written exercise names to the library (catalog plus this organization's exercises) for an import's
 * review step (PRD C14). Nothing is saved; the coach confirms or changes every match before the program is made.
 */
export async function matchExercises(
  tx: TenantTx,
  actor: ActorContext,
  names: string[],
): Promise<ExerciseMatch[]> {
  assertCan(actor, 'exercise:read');
  if (!Array.isArray(names) || names.length > MATCH_NAMES_MAX) {
    throw new DomainError('VALIDATION', 'Some fields are invalid.', {
      names: [`Send at most ${MATCH_NAMES_MAX} names.`],
    });
  }
  const library = await tx.exercise.findMany({
    select: { id: true, name: true, trackingType: true },
  });
  return [...new Set(names.map((n) => String(n).trim().slice(0, 200)))].map((name) => {
    const ranked = library
      .map((e) => ({ e, score: nameScore(name, e.name) }))
      .filter((x) => x.score >= 0.34)
      .sort((x, y) => y.score - x.score || x.e.name.length - y.e.name.length)
      .slice(0, 5);
    const best = ranked[0];
    return {
      name,
      exerciseId: best && best.score >= 0.5 ? best.e.id : null,
      candidates: ranked.map((x) => ({
        id: x.e.id,
        name: x.e.name,
        trackingType: x.e.trackingType,
      })),
    };
  });
}

/** Creates a template from a reviewed import as version 1 (the same checks as saving in the builder). */
export async function createProgramFromImport(
  tx: TenantTx,
  actor: ActorContext,
  input: { title: string; weeks: WeekInput[] },
  opts: { requestId?: string } = {},
): Promise<{ id: string }> {
  assertCan(actor, 'program:write');
  const program = await createProgram(tx, actor, { title: input.title }, opts);
  await commitProgramVersion(
    tx,
    actor,
    { programId: program.id, expectedVersionNo: null, weeks: input.weeks },
    opts,
  );
  return { id: program.id };
}
