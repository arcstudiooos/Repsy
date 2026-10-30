import { z } from 'zod';
import { DomainError } from '../errors';

/** D-008 #9: the three question types of R1. Every question is optional (S4-1). */
export const QUESTION_TYPES = ['scale_1_5', 'short_text', 'yes_no'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export interface CheckinQuestion {
  id: string;
  type: QuestionType;
  label: string;
  optional: true;
}

export type CheckinAnswer = number | string | boolean;
export type CheckinAnswers = Record<string, CheckinAnswer>;

export const MAX_QUESTIONS = 20;
export const LABEL_MAX = 200;
export const SHORT_TEXT_MAX = 2000;
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

const question = z.object({
  id: z.string().regex(/^[a-z0-9_-]{1,40}$/, 'Use 1-40 lowercase letters, digits, - or _.'),
  type: z.enum(QUESTION_TYPES),
  label: z.string().trim().min(1, 'Add the question text.').max(LABEL_MAX),
  optional: z.literal(true).default(true),
});

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

export function parseQuestions(input: unknown): CheckinQuestion[] {
  const res = questionsSchema.safeParse(input);
  if (!res.success) {
    throw new DomainError(
      'VALIDATION',
      'Some fields are invalid.',
      fieldErrorsOf(res.error, 'questions'),
    );
  }
  return res.data as CheckinQuestion[];
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
    let ok = false;
    if (q.type === 'scale_1_5')
      ok = Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 5;
    else if (q.type === 'yes_no') ok = typeof v === 'boolean';
    else ok = typeof v === 'string' && v.trim().length <= SHORT_TEXT_MAX;
    if (ok) {
      out[q.id] = typeof v === 'string' ? v.trim() : (v as CheckinAnswer);
      if (out[q.id] === '') delete out[q.id];
    } else if (opts.strict) {
      errors[`answers.${q.id}`] = [
        q.type === 'scale_1_5'
          ? 'Pick 1 to 5.'
          : q.type === 'yes_no'
            ? 'Pick yes or no.'
            : `Use at most ${SHORT_TEXT_MAX} characters.`,
      ];
    }
  }
  if (Object.keys(errors).length > 0)
    throw new DomainError('VALIDATION', 'Some fields are invalid.', errors);
  return out;
}
