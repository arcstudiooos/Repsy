import { z } from 'zod';
import { DomainError } from '../errors';
import { isBodyMetric, metricDef, type BodyMetric } from '../progress/metric-catalog';

/**
 * D-008 #9: the three question types of R1, plus PRD F3 (R2): long text, a number with a unit, single and multiple
 * choice, a date, and a body metric (written to E1 on submit). Photo and video wait for uploads. Every question is
 * optional (S4-1).
 */
export const QUESTION_TYPES = [
  'scale_1_5',
  'short_text',
  'yes_no',
  'long_text',
  'number',
  'single_choice',
  'multi_choice',
  'date',
  'metric',
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export interface CheckinQuestion {
  id: string;
  type: QuestionType;
  label: string;
  optional: true;
  /** `number`: the unit shown after the box ("hours", "steps"). */
  unit?: string;
  /** `single_choice`, `multi_choice`: 2-10 options. */
  options?: string[];
  /** `metric`: the E1 body metric the answer records (weight, waist...). */
  metric?: BodyMetric;
  /** Intake forms (PRD B12), text answers: the context card field the answer fills. */
  contextField?: ContextField;
}

/** The client context card fields an intake answer can fill (PRD B12). */
export const CONTEXT_FIELDS = [
  'goals',
  'motivation',
  'scheduleNotes',
  'equipmentNotes',
  'preferences',
] as const;
export type ContextField = (typeof CONTEXT_FIELDS)[number];

/** `multi_choice` answers are the chosen options; `metric` answers are in canonical units (kg, cm...). */
export type CheckinAnswer = number | string | boolean | string[];
export type CheckinAnswers = Record<string, CheckinAnswer>;

export const MAX_QUESTIONS = 20;
export const LABEL_MAX = 200;
export const SHORT_TEXT_MAX = 2000;
export const LONG_TEXT_MAX = 5000;
export const OPTION_MAX = 80;
export const OPTIONS_MIN = 2;
export const OPTIONS_MAX = 10;
export const UNIT_MAX = 20;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const TITLE_MAX = 120;

/** The seeded template every organization starts from (S4-1); the coach can edit it. */
export const SEEDED_TITLE = 'Weekly check-in';
export const SEEDED_QUESTIONS: CheckinQuestion[] = [
  { id: 'energy', type: 'scale_1_5', label: 'Energy this week', optional: true },
  { id: 'sleep', type: 'scale_1_5', label: 'Sleep this week', optional: true },
  { id: 'stress', type: 'scale_1_5', label: 'Stress this week', optional: true },
  {
    id: 'satisfaction',
    type: 'scale_1_5',
    label: 'How satisfied are you with your training this week?',
    optional: true,
  },
  { id: 'obstacles', type: 'short_text', label: 'What got in the way this week?', optional: true },
  {
    id: 'notes',
    type: 'short_text',
    label: 'Anything else you want your coach to know?',
    optional: true,
  },
];

const question = z
  .object({
    id: z.string().regex(/^[a-z0-9_-]{1,40}$/, 'Use 1-40 lowercase letters, digits, - or _.'),
    type: z.enum(QUESTION_TYPES),
    label: z.string().trim().min(1, 'Add the question text.').max(LABEL_MAX),
    optional: z.literal(true).default(true),
    unit: z.string().trim().max(UNIT_MAX).optional(),
    options: z
      .array(z.string().trim().min(1, 'Add the option text.').max(OPTION_MAX))
      .max(OPTIONS_MAX, `Use at most ${OPTIONS_MAX} options.`)
      .optional(),
    metric: z.string().optional(),
    contextField: z.enum(CONTEXT_FIELDS).optional(),
  })
  .superRefine((q, ctx) => {
    if (q.type === 'single_choice' || q.type === 'multi_choice') {
      const opts = q.options ?? [];
      if (opts.length < OPTIONS_MIN) {
        ctx.addIssue({ code: 'custom', path: ['options'], message: 'Add at least 2 options.' });
      } else if (new Set(opts.map((o) => o.toLowerCase())).size !== opts.length) {
        ctx.addIssue({ code: 'custom', path: ['options'], message: 'Options must differ.' });
      }
    }
    if (q.type === 'metric' && !isBodyMetric(q.metric)) {
      ctx.addIssue({ code: 'custom', path: ['metric'], message: 'Pick a measurement.' });
    }
  })
  // Only the fields the type uses are kept.
  .transform((q) => ({
    id: q.id,
    type: q.type,
    label: q.label,
    optional: q.optional,
    ...(q.type === 'number' && q.unit ? { unit: q.unit } : {}),
    ...(q.type === 'single_choice' || q.type === 'multi_choice' ? { options: q.options } : {}),
    ...(q.type === 'metric' ? { metric: q.metric as BodyMetric } : {}),
    ...((q.type === 'short_text' || q.type === 'long_text') && q.contextField
      ? { contextField: q.contextField }
      : {}),
  }));

export const questionsSchema = z
  .array(question)
  .min(1, 'Add at least one question.')
  .max(MAX_QUESTIONS, `Use at most ${MAX_QUESTIONS} questions.`)
  .refine((qs) => new Set(qs.map((q) => q.id)).size === qs.length, 'Question ids must be unique.');

const fieldErrorsOf = (error: z.ZodError, prefix: string): Record<string, string[]> => {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = [prefix, ...issue.path.map(String)].join('.');
    (out[key] ??= []).push(issue.message);
  }
  return out;
};

/** `kind` other than intake drops context fields (only intake answers fill the context card). */
export function parseQuestions(input: unknown, kind: string = 'checkin'): CheckinQuestion[] {
  const res = questionsSchema.safeParse(input);
  if (!res.success) {
    throw new DomainError(
      'VALIDATION',
      'Some fields are invalid.',
      fieldErrorsOf(res.error, 'questions'),
    );
  }
  const qs = res.data as CheckinQuestion[];
  if (kind === 'intake') return qs;
  return qs.map((q) => {
    const rest = { ...q };
    delete rest.contextField;
    return rest;
  });
}

/** Reads a stored question list leniently (a malformed row yields no questions rather than a crash). */
export function readQuestions(json: unknown): CheckinQuestion[] {
  const res = questionsSchema.safeParse(json);
  return res.success ? (res.data as CheckinQuestion[]) : [];
}

/**
 * Validates answers against the questions asked. Unknown ids and empty answers are dropped (every question is
 * optional); a wrong type is a 422 on `answers.{id}`. `strict` (submission) also refuses a malformed value that a
 * draft would just drop.
 */
export function parseAnswers(
  questions: CheckinQuestion[],
  input: unknown,
  opts: { strict: boolean },
): CheckinAnswers {
  if (input === undefined || input === null) return {};
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new DomainError('VALIDATION', 'Some fields are invalid.', {
      answers: ['Invalid answers.'],
    });
  }
  const raw = input as Record<string, unknown>;
  const out: CheckinAnswers = {};
  const errors: Record<string, string[]> = {};
  for (const q of questions) {
    const v = raw[q.id];
    if (v === undefined || v === null || v === '') continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    if (Array.isArray(v) && v.length === 0) continue;
    const answer = readAnswer(q, v);
    if (answer !== undefined) out[q.id] = answer;
    else if (opts.strict) errors[`answers.${q.id}`] = [ANSWER_ERROR[q.type]];
  }
  if (Object.keys(errors).length > 0)
    throw new DomainError('VALIDATION', 'Some fields are invalid.', errors);
  return out;
}

const ANSWER_ERROR: Record<QuestionType, string> = {
  scale_1_5: 'Pick 1 to 5.',
  yes_no: 'Pick yes or no.',
  short_text: `Use at most ${SHORT_TEXT_MAX} characters.`,
  long_text: `Use at most ${LONG_TEXT_MAX} characters.`,
  number: 'Enter a number.',
  single_choice: 'Pick one of the options.',
  multi_choice: 'Pick from the options.',
  date: 'Use a date like 2026-11-04.',
  metric: 'Enter a number in range.',
};

/** A valid answer to `q` (trimmed; choices in option order), or undefined. */
function readAnswer(q: CheckinQuestion, v: unknown): CheckinAnswer | undefined {
  switch (q.type) {
    case 'scale_1_5':
      return Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 5
        ? (v as number)
        : undefined;
    case 'yes_no':
      return typeof v === 'boolean' ? v : undefined;
    case 'short_text':
    case 'long_text': {
      if (typeof v !== 'string') return undefined;
      const t = v.trim();
      return t.length <= (q.type === 'short_text' ? SHORT_TEXT_MAX : LONG_TEXT_MAX) ? t : undefined;
    }
    case 'number':
      return typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e9 ? v : undefined;
    case 'single_choice':
      return typeof v === 'string' && (q.options ?? []).includes(v) ? v : undefined;
    case 'multi_choice': {
      const opts = q.options ?? [];
      if (!Array.isArray(v) || !v.every((x) => typeof x === 'string' && opts.includes(x))) {
        return undefined;
      }
      return opts.filter((o) => (v as string[]).includes(o));
    }
    case 'date':
      return typeof v === 'string' && DATE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))
        ? v
        : undefined;
    case 'metric': {
      if (typeof v !== 'number' || !q.metric || !Number.isFinite(v)) return undefined;
      const def = metricDef(q.metric);
      return v >= def.min && v <= def.max ? v : undefined;
    }
  }
}
