/**
 * PRD I10, I11, I12, I14: AI drafting. Pure logic plus thin database wrappers.
 *
 * Guardrails (I14), enforced here, not in the UI:
 * - Coach-only: draft creation needs `program:write` (owner, admin, coach only) and highlights need a
 *   trainer role on top of `checkin:read` (which alone would also admit clients and assistants).
 * - Per-workspace opt-in, OFF by default: `getAiSetting` returns `aiEnabled: false` when no row exists,
 *   and every create function refuses while it is off.
 * - Output is ALWAYS a draft: these functions return an `AiDraftContent` (or store an `ai_drafts` row
 *   with `status: 'draft'`). Nothing here saves a program, assigns one, or sends anything.
 * - Labelled: every draft carries `label: 'Drafted with AI'`.
 * - No client names sent: the provider only ever receives the structured `AiDraftRequest` built below
 *   from the coach's parsed paste / template days and the exercise library. Pasted source text, notes,
 *   and check-in answers never reach the provider; check-in highlights are computed locally, with no
 *   provider call at all.
 * - No medical / injury / supplement advice: paste text and template instructions matching the
 *   medical patterns below are refused outright. Highlights never generate advice; they only diff
 *   answers the client already gave.
 * - No training on customer data: the port contract in `ai.ts` forbids it, and the only shipped
 *   provider is the fake/local one, which makes no network call.
 *
 * Database functions use `tx.aiSetting` / `tx.aiDraft`. Those models do NOT exist in `schema.prisma`
 * yet: they arrive with migration `20260101000086_ai_drafts` plus `SCHEMA_SNIPPET_AI.md`. Until the
 * parent merges the snippet and runs `pnpm db:generate`, the DB functions below are typed through the
 * `AiTenantTx` cast and must not be called against a live database. Pure functions need no database.
 */

import type { TenantTx } from '@kinetic/db';
import { TRAINER_ROLES, type ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import type { CheckinAnswer, CheckinAnswers, CheckinQuestion } from '../checkins/questions';
import { DomainError } from '../errors';
import { parseProgram, type ParsedProgram, type ParsedSet } from '../programs/text-import';
import {
  AI_LABEL,
  assertProviderSafe,
  type AiDraftDay,
  type AiDraftExercise,
  type AiDraftRequest,
  type AiDraftSet,
  type AiDraftWeek,
  type AiProvider,
} from './ai';

const notFound = () => new DomainError('NOT_FOUND', 'Not found.');
const invalid = (field: string, message: string) =>
  new DomainError('VALIDATION', 'Some fields are invalid.', { [field]: [message] });
const forbidden = () => new DomainError('FORBIDDEN', 'You do not have access to this.');

/** A trainer role (owner, admin, coach) — assistants and clients are never AI-draft users. */
function assertTrainer(actor: ActorContext): void {
  if (!(TRAINER_ROLES as readonly string[]).includes(actor.role)) throw forbidden();
}

/* ------------------------------------------------------------------ redaction */

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE = /\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/g;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Strips emails and phone-like numbers, then every supplied name (full name and each part of at
 * least 3 characters, case-insensitive). Used for the stored redacted source text; the provider never
 * sees source text at all, redacted or not.
 */
export function redactText(text: string, names: readonly string[] = []): string {
  let out = text.replace(EMAIL, '[redacted email]').replace(PHONE, '[redacted phone]');
  const tokens = new Set<string>();
  for (const name of names) {
    const trimmed = name.trim();
    if (trimmed) tokens.add(trimmed);
    for (const part of trimmed.split(/\s+/)) if (part.length >= 3) tokens.add(part);
  }
  for (const token of [...tokens].sort((a, b) => b.length - a.length)) {
    out = out.replace(new RegExp(`\\b${escapeRegExp(token)}\\b`, 'gi'), '[redacted]');
  }
  return out;
}

/* ------------------------------------------------------- medical-advice guardrail */

/** Requests for medical, injury or supplement advice are refused, never drafted. */
const MEDICAL_PATTERNS = [
  /\binjur(?:y|ies|ed)\b/i,
  /\bpain\b/i,
  /\bdiagnos(?:is|ed|e)\b/i,
  /\bmedicat(?:ion|e|ed)\b/i,
  /\bprescri(?:ption|bed|be)\b/i,
  /\bsupplement\b/i,
  /\bcreatine\b/i,
  /\bdos(?:e|age)\b/i,
  /\brehab\b/i,
  /\btear\b/i,
  /\bfracture\b/i,
  /\barthritis\b/i,
  /\bdiabet(?:es|ic)\b/i,
  /\bshould i take\b/i,
  /\bis it safe to\b/i,
];

export function assertNoAdviceRequest(text: string): void {
  if (MEDICAL_PATTERNS.some((p) => p.test(text))) {
    throw new DomainError(
      'VALIDATION',
      'AI drafts never give medical, injury or supplement advice. Remove that part and try again.',
    );
  }
}

/* ------------------------------------------------------------------ draft shapes */

/** The sets a draft exercise carries: the same subset `ParsedSet` and `SetTarget` share. */
export function cleanDraftSet(set: {
  reps?: number;
  repsMax?: number;
  loadKg?: number;
  rpe?: number;
  durationSec?: number;
  distanceM?: number;
}): AiDraftSet {
  const out: AiDraftSet = {};
  if (set.reps !== undefined) out.reps = set.reps;
  if (set.repsMax !== undefined) out.repsMax = set.repsMax;
  if (set.loadKg !== undefined) out.loadKg = set.loadKg;
  if (set.rpe !== undefined) out.rpe = set.rpe;
  if (set.durationSec !== undefined) out.durationSec = set.durationSec;
  if (set.distanceM !== undefined) out.distanceM = set.distanceM;
  return out;
}

export interface UnmatchedExercise {
  dayTitle: string;
  name: string;
  reason: 'not_in_library' | 'equipment';
}

/** A draft the coach reviews in the builder and explicitly saves; never a program by itself. */
export interface AiDraftContent {
  label: typeof AI_LABEL;
  kind: 'paste' | 'template';
  title: string;
  weeks: AiDraftWeek[];
  /** Pasted / template exercises the library could not match, for the coach to fix. */
  unmatched: UnmatchedExercise[];
}

export interface LibraryExercise {
  id: string;
  name: string;
  equipment: string;
}

const normalizeName = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * Matches parsed lines to the coach's exercise library by normalized name. Lines with a read error
 * (see `ParsedLine.error`) are reported as unmatched, never silently dropped. An equipment filter
 * marks library exercises outside the kit as unmatched with reason `equipment`.
 */
export function matchToLibrary(
  parsed: ParsedProgram,
  library: readonly LibraryExercise[],
  equipmentFilter: readonly string[] = [],
): { days: AiDraftDay[]; unmatched: UnmatchedExercise[] } {
  const byName = new Map(library.map((e) => [normalizeName(e.name), e]));
  const wanted = new Set(equipmentFilter.map((e) => e.toLowerCase()));
  const days: AiDraftDay[] = [];
  const unmatched: UnmatchedExercise[] = [];
  for (const week of parsed.weeks) {
    for (const day of week.days) {
      const exercises: AiDraftExercise[] = [];
      for (const line of day.lines) {
        const found = line.name ? byName.get(normalizeName(line.name)) : undefined;
        if (!found || line.error) {
          unmatched.push({
            dayTitle: day.title,
            name: line.name || '(unnamed)',
            reason: 'not_in_library',
          });
          exercises.push({
            exerciseId: null,
            name: line.name,
            sets: line.sets.map((s) => cleanDraftSet(s as ParsedSet)),
          });
        } else if (wanted.size > 0 && !wanted.has(found.equipment.toLowerCase())) {
          unmatched.push({ dayTitle: day.title, name: found.name, reason: 'equipment' });
          exercises.push({
            exerciseId: null,
            name: found.name,
            sets: line.sets.map((s) => cleanDraftSet(s as ParsedSet)),
          });
        } else {
          exercises.push({
            exerciseId: found.id,
            name: found.name,
            sets: line.sets.map((s) => cleanDraftSet(s as ParsedSet)),
          });
        }
      }
      days.push({ title: day.title, exercises });
    }
  }
  return { days, unmatched };
}

/* ------------------------------------------------------------------ I10 paste */

export interface PasteDraftInput {
  provider: AiProvider;
  /** Raw pasted text or spreadsheet. Parsed locally; never sent to the provider. */
  sourceText: string;
  title?: string;
  units?: 'kg' | 'lb';
  library: readonly LibraryExercise[];
  equipmentFilter?: string[];
  /** Client names to redact from the stored source text (never sent anywhere). */
  clientNames?: string[];
}

/** Parses locally, matches to the library, and asks the provider for a structured draft only. */
export async function createPasteDraft(input: PasteDraftInput): Promise<{
  content: AiDraftContent;
  /** The source text with emails, phones and supplied names stripped, for storage only. */
  redactedSource: string;
}> {
  const text = input.sourceText.trim();
  if (!text) throw invalid('sourceText', 'Paste a program first.');
  if (text.length > 100_000) throw invalid('sourceText', 'That paste is too long.');
  assertNoAdviceRequest(text);
  const parsed = parseProgram(text, input.units ?? 'kg');
  if (parsed.errors.length > 0 && parsed.weeks.length === 0) {
    throw invalid('sourceText', parsed.errors[0] ?? 'Could not read that paste.');
  }
  const equipmentFilter = input.equipmentFilter ?? [];
  const { days, unmatched } = matchToLibrary(parsed, input.library, equipmentFilter);
  const request: AiDraftRequest = {
    kind: 'paste',
    title: (input.title ?? 'Pasted program').trim().slice(0, 120) || 'Pasted program',
    weeks: parsed.weeks.length,
    days,
    equipmentFilter,
  };
  assertProviderSafe(request);
  const response = await input.provider.generateDraft(request);
  return {
    content: {
      label: AI_LABEL,
      kind: 'paste',
      title: response.title,
      weeks: response.weeks,
      unmatched,
    },
    redactedSource: redactText(text, input.clientNames ?? []),
  };
}

/* ------------------------------------------------------------- I11 template draft */

/** "Like my template X, 4 days, dumbbells only, 6 weeks" — defaults: the template's own days, 4 weeks. */
export interface TemplateInstruction {
  templateTitle: string | null;
  daysPerWeek: number | null;
  weeks: number;
  equipmentFilter: string[];
}

const KNOWN_EQUIPMENT = [
  'Dumbbell',
  'Barbell',
  'Kettlebell',
  'Machine',
  'Cable',
  'Band',
  'Bodyweight',
  'Cardio machine',
] as const;

export function parseTemplateInstruction(instruction: string): TemplateInstruction {
  const text = instruction.trim();
  if (!text) throw invalid('instruction', 'Describe the draft you want.');
  assertNoAdviceRequest(text);
  const titleMatch = /template\s+["']?([^,"']+?)["']?(?:,|$)/i.exec(text);
  const templateTitle = titleMatch?.[1]?.trim() ? titleMatch[1].trim().slice(0, 120) : null;
  const daysMatch = /(\d+)\s*days?\b/i.exec(text);
  const weeksMatch = /(\d+)\s*weeks?\b/i.exec(text);
  const daysPerWeek = daysMatch ? Number(daysMatch[1]) : null;
  if (daysPerWeek !== null && (daysPerWeek < 1 || daysPerWeek > 7)) {
    throw invalid('instruction', 'Use 1-7 days per week.');
  }
  const weeks = weeksMatch ? Number(weeksMatch[1]) : 4;
  if (weeks < 1 || weeks > 104) throw invalid('instruction', 'Use 1-104 weeks.');
  const onlyMatch = /\bonly\b\s*:?\s*([^,]+)/i.exec(text) ?? /with\s+([^,]+?)\s+only/i.exec(text);
  const equipmentFilter: string[] = [];
  const haystack = onlyMatch?.[1] ?? text;
  for (const equipment of KNOWN_EQUIPMENT) {
    const stem = equipment.toLowerCase().replace(/e$/, '');
    if (new RegExp(`\\b${stem}e?s?\\b`, 'i').test(haystack)) equipmentFilter.push(equipment);
  }
  return { templateTitle, daysPerWeek, weeks, equipmentFilter };
}

export interface TemplateDayInput {
  title: string;
  exercises: {
    exerciseId: string | null;
    name: string;
    sets: AiDraftSet[];
    /** Library equipment, when known; used to enforce an equipment filter. */
    equipment?: string;
  }[];
}

export interface TemplateDraftInput {
  provider: AiProvider;
  instruction: string;
  /** The template's first week, as the coach sees it in the builder (days with exercises). */
  templateDays: readonly TemplateDayInput[];
  title?: string;
}

/** Repeats the template's days across the requested weeks; the fake provider does the repeating. */
export async function createTemplateDraft(input: TemplateDraftInput): Promise<AiDraftContent> {
  const parsed = parseTemplateInstruction(input.instruction);
  if (input.templateDays.length === 0)
    throw invalid('instruction', 'That template has no days to copy.');
  const daysPerWeek = parsed.daysPerWeek ?? input.templateDays.length;
  const wanted = new Set(parsed.equipmentFilter.map((e) => e.toLowerCase()));
  const unmatched: UnmatchedExercise[] = [];
  const days: AiDraftDay[] = [];
  for (let i = 0; i < daysPerWeek; i++) {
    const day = input.templateDays[i % input.templateDays.length]!;
    days.push({
      title: day.title,
      exercises: day.exercises.map((e) => {
        // An equipment filter drops exercises whose known equipment is outside the kit; exercises
        // with unknown equipment are kept, for the coach to judge in the builder.
        if (wanted.size > 0 && e.equipment && !wanted.has(e.equipment.toLowerCase())) {
          unmatched.push({ dayTitle: day.title, name: e.name, reason: 'equipment' });
          return { exerciseId: null, name: e.name, sets: e.sets.map((s) => cleanDraftSet(s)) };
        }
        return {
          exerciseId: e.exerciseId,
          name: e.name,
          sets: e.sets.map((s) => cleanDraftSet(s)),
        };
      }),
    });
  }
  const request: AiDraftRequest = {
    kind: 'template',
    title: (input.title ?? parsed.templateTitle ?? 'Template draft').trim().slice(0, 120),
    weeks: parsed.weeks,
    days,
    equipmentFilter: parsed.equipmentFilter,
    templateTitle: parsed.templateTitle ?? undefined,
  };
  assertProviderSafe(request);
  const response = await input.provider.generateDraft(request);
  return {
    label: AI_LABEL,
    kind: 'template',
    title: response.title,
    weeks: response.weeks,
    unmatched,
  };
}

/* ------------------------------------------------------------ I12 check-in highlights */

export interface CheckinSnapshot {
  checkinId: string;
  answers: CheckinAnswers | null;
}

export interface CheckinHighlight {
  questionId: string;
  label: string;
  previous: CheckinAnswer | null;
  current: CheckinAnswer | null;
  change: 'added' | 'removed' | 'changed';
  /** Link to the previous answer on the client's check-ins page. */
  previousSourceUrl: string | null;
  /** Link to the current answer on the client's check-ins page. */
  currentSourceUrl: string | null;
}

/** Deep link to one answer on the client's check-ins page (anchor: `<checkinId>-<questionId>`). */
export function checkinAnswerUrl(clientId: string, checkinId: string, questionId: string): string {
  return `/app/clients/${clientId}/check-ins#${checkinId}-${questionId}`;
}

function sameAnswer(
  a: CheckinAnswer | null | undefined,
  b: CheckinAnswer | null | undefined,
): boolean {
  if (a === undefined) a = null;
  if (b === undefined) b = null;
  return JSON.stringify(a) === JSON.stringify(b);
}

function hasAnswer(a: CheckinAnswer | null | undefined): boolean {
  return a !== null && a !== undefined && a !== '';
}

/**
 * Local diff only — no provider call, so client answers never leave the workspace. Only questions
 * whose answer changed are returned, each with a link to both source answers. Unchanged questions
 * and questions answered in neither check-in are left out.
 */
export function summarizeCheckinChanges(input: {
  clientId: string;
  questions: readonly CheckinQuestion[];
  previous: CheckinSnapshot;
  current: CheckinSnapshot;
}): CheckinHighlight[] {
  const out: CheckinHighlight[] = [];
  for (const question of input.questions) {
    const prev = input.previous.answers?.[question.id] ?? null;
    const curr = input.current.answers?.[question.id] ?? null;
    if (sameAnswer(prev, curr)) continue;
    const change = !hasAnswer(prev) ? 'added' : !hasAnswer(curr) ? 'removed' : 'changed';
    out.push({
      questionId: question.id,
      label: question.label,
      previous: hasAnswer(prev) ? prev : null,
      current: hasAnswer(curr) ? curr : null,
      change,
      previousSourceUrl: hasAnswer(prev)
        ? checkinAnswerUrl(input.clientId, input.previous.checkinId, question.id)
        : null,
      currentSourceUrl: hasAnswer(curr)
        ? checkinAnswerUrl(input.clientId, input.current.checkinId, question.id)
        : null,
    });
  }
  return out;
}

/* ------------------------------------------------------- database wrappers (I14) */

/**
 * Minimal shape of the not-yet-generated `aiSetting` / `aiDraft` delegates. The parent replaces this
 * cast with the generated client after merging `SCHEMA_SNIPPET_AI.md` and running `pnpm db:generate`.
 */
interface AiSettingRow {
  aiEnabled: boolean;
  provider: string;
}
interface AiDraftRow {
  id: string;
  kind: string;
  status: string;
  draftJson: unknown;
  createdAt: Date;
}
interface AiTenantTx {
  aiSetting: {
    findFirst(args: Record<string, unknown>): Promise<AiSettingRow | null>;
    upsert(args: Record<string, unknown>): Promise<AiSettingRow>;
  };
  aiDraft: {
    create(args: Record<string, unknown>): Promise<AiDraftRow>;
    findMany(args: Record<string, unknown>): Promise<AiDraftRow[]>;
  };
}

function aiTx(tx: TenantTx): AiTenantTx {
  return tx as unknown as AiTenantTx;
}

export interface AiSettingView {
  /** OFF by default: false when no row exists, and false is the column default. */
  aiEnabled: boolean;
  provider: string;
}

export async function getAiSetting(tx: TenantTx, actor: ActorContext): Promise<AiSettingView> {
  assertCan(actor, 'org:read');
  const row = await aiTx(tx).aiSetting.findFirst({
    where: { organizationId: actor.orgId },
    select: { aiEnabled: true, provider: true },
  });
  return row
    ? { aiEnabled: row.aiEnabled, provider: row.provider }
    : { aiEnabled: false, provider: 'fake' };
}

/** Workspace opt-in toggle. Managers only (`settings:org:update`), like other workspace settings. */
export async function setAiSetting(
  tx: TenantTx,
  actor: ActorContext,
  aiEnabled: boolean,
): Promise<AiSettingView> {
  assertCan(actor, 'settings:org:update');
  const row = await aiTx(tx).aiSetting.upsert({
    where: { organizationId: actor.orgId },
    create: { aiEnabled, provider: 'fake' },
    update: { aiEnabled },
  });
  return { aiEnabled: row.aiEnabled, provider: row.provider };
}

async function assertAiEnabled(tx: TenantTx, actor: ActorContext): Promise<void> {
  const setting = await getAiSetting(tx, actor);
  if (!setting.aiEnabled) {
    throw new DomainError(
      'FORBIDDEN',
      'AI drafting is off for this workspace. An owner or admin can turn it on.',
    );
  }
  if (setting.provider !== 'fake') {
    throw new DomainError('FORBIDDEN', 'Only the fake/local AI provider is available.');
  }
}

export interface AiDraftView {
  id: string;
  kind: string;
  status: 'draft';
  label: typeof AI_LABEL;
  content: AiDraftContent;
  createdAt: string;
}

function toView(row: AiDraftRow): AiDraftView {
  const content = row.draftJson as AiDraftContent;
  return {
    id: row.id,
    kind: row.kind,
    status: 'draft',
    label: AI_LABEL,
    content: { ...content, label: AI_LABEL },
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Stores a paste draft (I10). Coach-only, opt-in-gated, draft-only: the row is never a program and
 * nothing is assigned or sent. The stored source text is the redacted copy, never the raw paste.
 */
export async function savePasteAiDraft(
  tx: TenantTx,
  actor: ActorContext,
  provider: AiProvider,
  input: Omit<PasteDraftInput, 'provider'>,
): Promise<AiDraftView> {
  assertCan(actor, 'program:write');
  assertTrainer(actor);
  await assertAiEnabled(tx, actor);
  if (provider.name !== 'fake')
    throw new DomainError('FORBIDDEN', 'Only the fake/local AI provider is available.');
  const { content, redactedSource } = await createPasteDraft({ ...input, provider });
  const row = await aiTx(tx).aiDraft.create({
    data: {
      coachUserId: actor.userId,
      kind: 'paste',
      sourceText: redactedSource,
      draftJson: content,
      status: 'draft',
    },
    select: { id: true, kind: true, status: true, draftJson: true, createdAt: true },
  });
  return toView(row);
}

/** Stores a template draft (I11) under the same guardrails as paste drafts. */
export async function saveTemplateAiDraft(
  tx: TenantTx,
  actor: ActorContext,
  provider: AiProvider,
  input: Omit<TemplateDraftInput, 'provider'>,
): Promise<AiDraftView> {
  assertCan(actor, 'program:write');
  assertTrainer(actor);
  await assertAiEnabled(tx, actor);
  if (provider.name !== 'fake')
    throw new DomainError('FORBIDDEN', 'Only the fake/local AI provider is available.');
  const content = await createTemplateDraft({ ...input, provider });
  const row = await aiTx(tx).aiDraft.create({
    data: {
      coachUserId: actor.userId,
      kind: 'template',
      sourceText: null,
      draftJson: content,
      status: 'draft',
    },
    select: { id: true, kind: true, status: true, draftJson: true, createdAt: true },
  });
  return toView(row);
}

/** Coach-only list of their workspace's AI drafts, newest first. Drafts only — nothing auto-saved. */
export async function listAiDrafts(tx: TenantTx, actor: ActorContext): Promise<AiDraftView[]> {
  assertCan(actor, 'program:write');
  assertTrainer(actor);
  await assertAiEnabled(tx, actor);
  const rows = await aiTx(tx).aiDraft.findMany({
    orderBy: [{ createdAt: 'desc' }],
    take: 100,
    select: { id: true, kind: true, status: true, draftJson: true, createdAt: true },
  });
  return rows.map(toView);
}

/**
 * Check-in highlights (I12) for the coach: the two submitted check-ins are loaded by the caller
 * (e.g. the route, via `getCheckin`), and this diffs them locally. Coach-only: `checkin:read` alone
 * would also admit clients and assistants, so the trainer check is what makes it coach-only.
 */
export function highlightsForCoach(
  actor: ActorContext,
  input: {
    clientId: string;
    questions: readonly CheckinQuestion[];
    previous: CheckinSnapshot;
    current: CheckinSnapshot;
  },
): CheckinHighlight[] {
  assertCan(actor, 'checkin:read');
  assertTrainer(actor);
  if (!input.previous.answers || !input.current.answers) throw notFound();
  return summarizeCheckinChanges(input);
}
