/**
 * PRD F11: a question shown only when an earlier answer matches ("If energy is 2 or lower, what got in the way?").
 * Pure: the check-in form and the server use the same rule. A question whose condition refers to a hidden question is
 * hidden too, so a chain of conditions collapses as one.
 */
export const CONDITION_OPS = ['lte', 'gte', 'eq', 'includes'] as const;
export type ConditionOp = (typeof CONDITION_OPS)[number];

export interface QuestionCondition {
  /** An earlier question's id. */
  questionId: string;
  op: ConditionOp;
  value: number | string | boolean;
}

interface Conditional {
  id: string;
  type: string;
  showIf?: QuestionCondition;
}

/** The comparisons each question type can be the subject of. */
export const OPS_FOR: Record<string, ConditionOp[]> = {
  scale_1_5: ['lte', 'gte', 'eq'],
  number: ['lte', 'gte', 'eq'],
  metric: ['lte', 'gte', 'eq'],
  yes_no: ['eq'],
  single_choice: ['eq'],
  multi_choice: ['includes'],
};

function matches(c: QuestionCondition, answer: unknown): boolean {
  if (answer === undefined || answer === null || answer === '') return false;
  switch (c.op) {
    case 'lte':
      return typeof answer === 'number' && typeof c.value === 'number' && answer <= c.value;
    case 'gte':
      return typeof answer === 'number' && typeof c.value === 'number' && answer >= c.value;
    case 'eq':
      return answer === c.value;
    case 'includes':
      return Array.isArray(answer) && answer.includes(c.value);
  }
}

/** The ids of the questions shown for these answers, in order. */
export function shownQuestionIds(
  questions: Conditional[],
  answers: Record<string, unknown>,
): Set<string> {
  const shown = new Set<string>();
  for (const q of questions) {
    const c = q.showIf;
    if (!c || (shown.has(c.questionId) && matches(c, answers[c.questionId]))) shown.add(q.id);
  }
  return shown;
}

const OP_TEXT: Record<ConditionOp, string> = {
  lte: 'is at most',
  gte: 'is at least',
  eq: 'is',
  includes: 'includes',
};

/** "Shown if “Energy this week” is at most 2", for the coach's editor and the review view. */
export function describeCondition(c: QuestionCondition, label: string): string {
  const v = typeof c.value === 'boolean' ? (c.value ? 'yes' : 'no') : String(c.value);
  return `Shown if “${label}” ${OP_TEXT[c.op]} ${v}`;
}
