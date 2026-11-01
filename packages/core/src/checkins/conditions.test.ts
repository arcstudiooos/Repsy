import { describe, expect, it } from 'vitest';
import { describeCondition, shownQuestionIds } from './conditions';
import { parseAnswers, parseQuestions, type CheckinQuestion } from './questions';

const qs = (): unknown[] => [
  { id: 'energy', type: 'scale_1_5', label: 'Energy' },
  {
    id: 'why',
    type: 'short_text',
    label: 'What got in the way?',
    showIf: { questionId: 'energy', op: 'lte', value: 2 },
  },
  { id: 'injured', type: 'yes_no', label: 'Any pain?' },
  {
    id: 'where',
    type: 'multi_choice',
    label: 'Where?',
    options: ['Knee', 'Back'],
    showIf: { questionId: 'injured', op: 'eq', value: true },
  },
  {
    id: 'back',
    type: 'long_text',
    label: 'Tell me about your back',
    showIf: { questionId: 'where', op: 'includes', value: 'Back' },
  },
];

describe('conditional questions (PRD F11)', () => {
  it('shows a question only when the earlier answer matches, chains included', () => {
    const questions = parseQuestions(qs());
    const ids = (a: Record<string, unknown>) => [...shownQuestionIds(questions, a)];
    expect(ids({})).toEqual(['energy', 'injured']);
    expect(ids({ energy: 2, injured: true })).toEqual(['energy', 'why', 'injured', 'where']);
    expect(ids({ energy: 3, injured: true, where: ['Back'] })).toEqual([
      'energy',
      'injured',
      'where',
      'back',
    ]);
    // Hiding the middle of a chain hides the rest.
    expect(ids({ injured: false, where: ['Back'] })).toEqual(['energy', 'injured']);
  });

  it('drops answers to hidden questions', () => {
    const questions = parseQuestions(qs()) as CheckinQuestion[];
    expect(
      parseAnswers(
        questions,
        { energy: 4, why: 'busy', injured: false, back: 'sore' },
        { strict: true },
      ),
    ).toEqual({ energy: 4, injured: false });
  });

  it('refuses a condition on a later question, a wrong comparison or an unknown option', () => {
    const bad = (showIf: unknown, at = 1) => {
      const list = qs().slice(0, 3);
      (list[at] as { showIf?: unknown }).showIf = showIf;
      try {
        parseQuestions(list);
        return null;
      } catch (e) {
        return (e as { fieldErrors?: Record<string, string[]> }).fieldErrors;
      }
    };
    expect(bad({ questionId: 'injured', op: 'eq', value: true })).toEqual({
      'questions.1.showIf': ['Pick an earlier question.'],
    });
    expect(bad({ questionId: 'energy', op: 'includes', value: 2 })).toMatchObject({
      'questions.1.showIf': [expect.stringContaining('compared')],
    });
    expect(bad({ questionId: 'energy', op: 'lte', value: 'low' })).toMatchObject({
      'questions.1.showIf': ['Enter a number.'],
    });
    expect(bad({ questionId: 'energy', op: 'lte', value: 2 })).toBeNull();
  });

  it('describes a condition for the coach', () => {
    expect(describeCondition({ questionId: 'energy', op: 'lte', value: 2 }, 'Energy')).toBe(
      'Shown if “Energy” is at most 2',
    );
  });
});
