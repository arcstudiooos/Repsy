import { appendAudit, type TenantTx } from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { TRAINER_ROLES } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { readQuestions, type CheckinAnswer } from '../checkins/questions';
import { DomainError } from '../errors';
import { getProgram, type ProgramDetail } from '../programs/read';
import { parseProgram, type ParsedProgram } from '../programs/text-import';
import { todayInZone, zonedTimeToUtc } from '../timezone';
import { isUuid } from '../uuid';
import { filterUnsafe, isUnsafe, redactContact, REMOVED_NOTE } from './guardrails';
import { AiUnavailableError, type AiDraftRequest, type AiPort } from './port';

/**
 * PRD I10-I12, I14 (D-013 #14): AI drafting for trainers, only when the owner has turned it on, only on request,
 * always a draft the coach reviews. Prompts carry program text, exercise names and check-in answers, never a name,
 * email or other identifier. Every answer is filtered (injury, medical and supplement lines removed and counted) and
 * checked against its source before it is shown: program drafts go through the C14 importer's review; check-in
 * highlights must cite answers that exist and are never stored.
 *
 * The provider is called outside any database transaction: `startAiRequest` reserves a slot under the daily cap,
 * the caller makes the call, and `finishAiRequest` records the outcome (sizes only).
 */
export const AI_DAILY_CAP = 50;
export const AI_INPUT_MAX = 20_000;
export const AI_REQUEST_MAX = 500;
export type AiKind = 'program_from_text' | 'program_from_template' | 'checkin_highlights';

const notFound = () => new DomainError('NOT_FOUND', 'Not found.');
const invalid = (field: string, message: string) =>
  new DomainError('VALIDATION', 'Some fields are invalid.', { [field]: [message] });

// ---------------------------------------------------------------- settings

export interface AiSettings {
  enabled: boolean;
  /** Whether this deployment has a provider at all. */
  available: boolean;
  usedToday: number;
  dailyCap: number;
}

async function usedToday(tx: TenantTx, now: Date): Promise<number> {
  const org = await tx.organization.findFirstOrThrow({ select: { timezone: true } });
  const start = zonedTimeToUtc(todayInZone(org.timezone, now), '00:00', org.timezone) ?? now;
  return tx.aiRequest.count({ where: { createdAt: { gte: start } } });
}

export async function getAiSettings(
  tx: TenantTx,
  actor: ActorContext,
  opts: { available: boolean; now?: Date },
): Promise<AiSettings> {
  assertCan(actor, 'org:read');
  const org = await tx.organization.findFirstOrThrow({ select: { aiEnabled: true } });
  return {
    enabled: org.aiEnabled,
    available: opts.available,
    usedToday: await usedToday(tx, opts.now ?? new Date()),
    dailyCap: AI_DAILY_CAP,
  };
}

/** Only the owner turns AI drafting on or off for the workspace. */
export async function setAiEnabled(
  tx: TenantTx,
  actor: ActorContext,
  enabled: boolean,
  opts: { requestId?: string } = {},
): Promise<void> {
  if (actor.role !== 'owner')
    throw new DomainError('FORBIDDEN', 'Only the workspace owner can change this.');
  await tx.organization.updateMany({ data: { aiEnabled: enabled } });
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'organization',
    objectId: actor.orgId,
    action: enabled ? 'ai.enabled' : 'ai.disabled',
    requestId: opts.requestId,
  });
}

/** Whether this actor may use AI drafting at all (trainers only, D-012 #7). */
export const aiRoleAllowed = (actor: ActorContext): boolean =>
  (TRAINER_ROLES as readonly string[]).includes(actor.role);

// ---------------------------------------------------------------- request log and cap

/** Checks the opt-in, the role and the daily cap, and reserves a request (status pending). */
export async function startAiRequest(
  tx: TenantTx,
  actor: ActorContext,
  kind: AiKind,
  inputChars: number,
  now: Date = new Date(),
): Promise<{ requestId: string }> {
  if (!aiRoleAllowed(actor)) {
    throw new DomainError('FORBIDDEN', 'Only coaches can use AI drafting.');
  }
  const org = await tx.organization.findFirstOrThrow({ select: { aiEnabled: true } });
  if (!org.aiEnabled) {
    throw new DomainError(
      'FORBIDDEN',
      'AI drafting is off for this workspace. The owner can turn it on in Settings.',
    );
  }
  // Serialise the cap check per workspace so concurrent requests can't pass it together.
  await tx.organization.updateMany({ data: { aiEnabled: true } });
  if ((await usedToday(tx, now)) >= AI_DAILY_CAP) {
    throw new DomainError(
      'RATE_LIMITED',
      `The workspace has used today's ${AI_DAILY_CAP} AI drafts. Try again tomorrow.`,
    );
  }
  const row = await tx.aiRequest.create({
    data: { userId: actor.userId, kind, inputChars },
  } as Parameters<typeof tx.aiRequest.create>[0]);
  return { requestId: row.id };
}

export async function finishAiRequest(
  tx: TenantTx,
  actor: ActorContext,
  requestId: string,
  outcome: {
    status: 'ok' | 'refused' | 'error';
    outputChars?: number;
    removedLines?: number;
    kind: AiKind;
  },
): Promise<void> {
  await tx.aiRequest.updateMany({
    where: { id: requestId },
    data: {
      status: outcome.status,
      outputChars: outcome.outputChars ?? 0,
      removedLines: outcome.removedLines ?? 0,
    },
  });
  // Content-free audit (D-013 #14).
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'ai_request',
    objectId: requestId,
    action: `ai.${outcome.kind}`,
    metadata: { status: outcome.status, removedLines: outcome.removedLines ?? 0 },
  });
}

// ---------------------------------------------------------------- program drafts (I10, I11)

const FORMAT_RULES = [
  'Write the program in exactly this plain-text format and nothing else:',
  '- A line "Week N" before each week (only when there is more than one week).',
  '- A line "Day N: Title" before each workout day.',
  '- One exercise per line: the exercise name, then sets x reps (3x8), a rep range (3x8-10),',
  '  a time (3x45s, 1x20min) or a distance (1x5km), then optionally "@ 60kg" and "RPE 8".',
  'Use the exact exercise names from the library list when one matches. Do not invent exercises.',
  'Do not write notes, explanations, warnings or advice of any kind.',
  'Never mention injuries, pain, medical conditions, medication or supplements.',
].join('\n');

export interface ProgramDraft {
  /** The draft in the C14 import format, for the import review. */
  text: string;
  parsed: ParsedProgram;
  /** Shown to the coach when the safety filter removed lines. */
  note: string | null;
  removedLines: number;
}

function finishProgramDraft(raw: string, units: 'kg' | 'lb'): ProgramDraft {
  // Drop any fenced code markers or leading chatter lines a model might add.
  const cleaned = raw
    .replace(/```[a-z]*\n?/gi, '')
    .split('\n')
    .map((l) => l.trimEnd())
    .join('\n')
    .trim();
  const filtered = filterUnsafe(cleaned);
  return {
    text: filtered.text,
    parsed: parseProgram(filtered.text, units),
    note: REMOVED_NOTE(filtered.removed),
    removedLines: filtered.removed,
  };
}

/** I10: pasted text (or sheet rows) to a draft in the import format. Contact details never leave. */
export async function draftProgramFromText(
  port: AiPort,
  input: { text: string; units: 'kg' | 'lb'; library: string[] },
): Promise<ProgramDraft & { redactions: number }> {
  if (typeof input.text !== 'string' || input.text.trim().length === 0) {
    throw invalid('text', 'Paste the program first.');
  }
  if (input.text.length > AI_INPUT_MAX)
    throw invalid('text', `Paste up to ${AI_INPUT_MAX} characters.`);
  const { text, redactions } = redactContact(input.text);
  const raw = await port.draft({
    system: `You turn a fitness coach's pasted training program into a structured draft.\n${FORMAT_RULES}`,
    prompt: [
      `Units: ${input.units}.`,
      'Library exercises:',
      input.library.slice(0, 300).join('\n'),
      '',
      'The pasted program:',
      '<input>',
      text,
      '</input>',
    ].join('\n'),
    maxTokens: 8000,
  });
  return { ...finishProgramDraft(raw, input.units), redactions };
}

const fmtNum = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));

/** A template as import-format text (exercise names and sets only: no notes, which may hold client details). */
export function programToText(p: ProgramDetail, units: 'kg' | 'lb'): string {
  const lines: string[] = [];
  p.weeks.forEach((w, wi) => {
    if (p.weeks.length > 1) lines.push(`Week ${wi + 1}`);
    w.days.forEach((d, di) => {
      lines.push(
        `Day ${di + 1}: ${d.title.replace(/[\r\n]+/g, ' ').slice(0, 60) || `Day ${di + 1}`}`,
      );
      for (const e of d.exercises) {
        const s = e.sets[0];
        const n = e.sets.length;
        let rx = `${n}x1`;
        if (s?.reps !== undefined) rx = `${n}x${s.reps}${s.repsMax ? `-${s.repsMax}` : ''}`;
        else if (s?.durationSec !== undefined) rx = `${n}x${s.durationSec}s`;
        else if (s?.distanceM !== undefined) rx = `${n}x${fmtNum(s.distanceM)}m`;
        const load =
          s?.loadKg !== undefined
            ? ` @ ${fmtNum(units === 'lb' ? s.loadKg / 0.45359237 : s.loadKg)}${units}`
            : '';
        const rpe = s?.rpe !== undefined ? ` RPE ${s.rpe}` : '';
        lines.push(`${e.exerciseName} ${rx}${load}${rpe}`);
      }
      lines.push('');
    });
  });
  return lines.join('\n').trim();
}

/**
 * I11, step 1 (in a transaction): "like my template X, 4 days, dumbbells only" as a provider request. Only the
 * template's structure, the library's exercise names and the coach's request (contact details removed) go in.
 */
export async function templateDraftRequest(
  tx: TenantTx,
  actor: ActorContext,
  input: { templateId: string; request: string; units: 'kg' | 'lb'; library: string[] },
): Promise<{ req: AiDraftRequest; redactions: number }> {
  assertCan(actor, 'program:write');
  if (!isUuid(input.templateId)) throw notFound();
  const request = typeof input.request === 'string' ? input.request.trim() : '';
  if (request.length < 3 || request.length > AI_REQUEST_MAX) {
    throw invalid('request', `Describe what you want in 3-${AI_REQUEST_MAX} characters.`);
  }
  const template = await getProgram(tx, actor, input.templateId);
  if (template.kind !== 'template' || template.versionNo === null) throw notFound();
  const redacted = redactContact(request);
  return {
    redactions: redacted.redactions,
    req: {
      system: `You adapt a fitness coach's own program template into a new draft program, as the coach asks.\n${FORMAT_RULES}\nKeep the template's style. Stay within 12 weeks and 7 days a week.`,
      prompt: [
        `Units: ${input.units}.`,
        'Library exercises (use only these):',
        input.library.slice(0, 300).join('\n'),
        '',
        "The coach's template:",
        programToText(template, input.units),
        '',
        "The coach's request:",
        '<input>',
        redacted.text,
        '</input>',
      ].join('\n'),
      maxTokens: 12000,
    },
  };
}

/** I11, step 2 (no transaction open): the provider call, then the same checks as I10. */
export async function completeProgramDraft(
  port: AiPort,
  req: AiDraftRequest,
  units: 'kg' | 'lb',
): Promise<ProgramDraft> {
  return finishProgramDraft(await port.draft(req), units);
}

// ---------------------------------------------------------------- check-in highlights (I12)

export interface CheckinHighlight {
  text: string;
  /** Question ids in this check-in (and the previous one) the point is based on. */
  sources: { questionId: string; checkin: 'current' | 'previous'; label: string }[];
}

const answerText = (a: CheckinAnswer | undefined): string =>
  a === undefined || a === ''
    ? '(no answer)'
    : Array.isArray(a)
      ? a.join(', ')
      : typeof a === 'boolean'
        ? a
          ? 'yes'
          : 'no'
        : String(a);

type HighlightSource = { questionId: string; checkin: 'current' | 'previous'; label: string };

export interface HighlightsRequest {
  req: AiDraftRequest;
  /** Answer ids as given in the prompt, to the question they belong to. */
  sources: Record<string, HighlightSource>;
  previousId: string | null;
}

/**
 * I12, step 1 (in a transaction): this check-in's and the previous one's questions and answers, contact details
 * removed, the client never named, each answer tagged with an id the model must cite.
 */
export async function highlightsRequest(
  tx: TenantTx,
  actor: ActorContext,
  checkinId: string,
): Promise<HighlightsRequest> {
  assertCan(actor, 'checkin:read');
  if (!isUuid(checkinId)) throw notFound();
  const current = await tx.checkin.findFirst({
    where: { id: checkinId, submittedAt: { not: null } },
    select: {
      id: true,
      clientId: true,
      kind: true,
      submittedAt: true,
      questionsJson: true,
      answersJson: true,
    },
  });
  if (!current) throw notFound();
  const previous = await tx.checkin.findFirst({
    where: {
      clientId: current.clientId,
      kind: current.kind,
      submittedAt: { not: null, lt: current.submittedAt! },
    },
    orderBy: { submittedAt: 'desc' },
    select: { id: true, questionsJson: true, answersJson: true },
  });
  const qs = readQuestions(current.questionsJson);
  const answers = (current.answersJson ?? {}) as Record<string, CheckinAnswer>;
  const prevQs = previous ? readQuestions(previous.questionsJson) : [];
  const prevAnswers = (previous?.answersJson ?? {}) as Record<string, CheckinAnswer>;
  const sources: Record<string, HighlightSource> = {};
  const lines: string[] = [];
  for (const q of qs.slice(0, 20)) {
    const label = redactContact(q.label).text;
    lines.push(`Question: ${label}`);
    sources[`c:${q.id}`] = { questionId: q.id, checkin: 'current', label };
    lines.push(`[c:${q.id}] ${redactContact(answerText(answers[q.id])).text.slice(0, 1500)}`);
    if (previous && prevQs.some((p) => p.id === q.id)) {
      sources[`p:${q.id}`] = { questionId: q.id, checkin: 'previous', label };
      lines.push(`[p:${q.id}] ${redactContact(answerText(prevAnswers[q.id])).text.slice(0, 1500)}`);
    }
    lines.push('');
  }
  return {
    sources,
    previousId: previous?.id ?? null,
    req: {
      system: [
        "You help a fitness coach read a client's check-in quickly.",
        'List up to 6 short points about what changed since the previous check-in, or what stands out if there is none.',
        'Each point must cite, in "sources", the ids in square brackets of every answer it is based on: [c:...] is this',
        'check-in, [p:...] the previous one. Cite only ids that appear. Each point is one plain sentence under 200 characters.',
        'Do not give advice. Never mention injuries, pain, medical conditions, medication or supplements.',
      ].join('\n'),
      prompt: [
        previous
          ? 'Answers, this check-in [c:] and the previous one [p:]:'
          : 'Answers, this check-in only:',
        '',
        ...lines,
      ].join('\n'),
      maxTokens: 2000,
    },
  };
}

/**
 * I12, step 2 (no transaction open): the provider call, then every point is checked. Points citing no answer, or an
 * answer that wasn't given, are dropped, as are points on injury, medical or supplement topics. Never stored.
 */
export async function completeHighlights(
  port: AiPort,
  prepared: HighlightsRequest,
): Promise<{
  points: CheckinHighlight[];
  previousId: string | null;
  note: string | null;
  removed: number;
}> {
  const raw = await port.highlights(prepared.req);
  let removed = 0;
  const points: CheckinHighlight[] = [];
  for (const p of raw.slice(0, 6)) {
    const text = typeof p.text === 'string' ? p.text.trim().slice(0, 300) : '';
    const cited = [...new Set(Array.isArray(p.sources) ? p.sources : [])]
      .map((s) =>
        Object.hasOwn(prepared.sources, String(s)) ? prepared.sources[String(s)] : undefined,
      )
      .filter((s): s is HighlightSource => s !== undefined);
    if (!text || cited.length === 0) continue;
    if (isUnsafe(text)) {
      removed++;
      continue;
    }
    points.push({ text, sources: cited });
  }
  return { points, previousId: prepared.previousId, note: REMOVED_NOTE(removed), removed };
}

export { AiUnavailableError };

/** The exercise names a draft may use (the workspace's own and the shared library), at most 300. */
export async function exerciseLibraryNames(tx: TenantTx, actor: ActorContext): Promise<string[]> {
  assertCan(actor, 'exercise:read');
  const rows = await tx.exercise.findMany({
    select: { name: true },
    orderBy: [{ organizationId: { sort: 'desc', nulls: 'last' } }, { name: 'asc' }],
    take: 300,
  });
  return [...new Set(rows.map((r) => r.name))];
}
