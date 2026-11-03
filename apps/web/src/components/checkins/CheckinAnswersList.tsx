import type { CheckinAnswers, CheckinQuestion } from '@kinetic/core';
import type { Units } from '@kinetic/core/units';
import { formatAnswer } from '@/lib/checkin-answer';

/** A submitted check-in's answers, question by question (unanswered ones say so). */
export function CheckinAnswersList({
  questions,
  answers,
  units = 'kg',
  anchorPrefix,
}: {
  questions: CheckinQuestion[];
  answers: CheckinAnswers;
  /** For body measurement answers (PRD F3). */
  units?: Units;
  /** PRD I12: gives each answer an id (`<prefix>-<questionId>`) that highlights link to. */
  anchorPrefix?: string;
}) {
  return (
    <dl className="flex flex-col gap-3">
      {questions.map((q) => (
        <div
          key={q.id}
          id={anchorPrefix ? `${anchorPrefix}-${q.id}` : undefined}
          className="scroll-mt-24 target:rounded-control target:outline-2 target:outline-offset-4 target:outline-accent"
        >
          <dt className="text-sm text-secondary">{q.label}</dt>
          <dd
            className={
              answers[q.id] === undefined ? 'text-secondary' : 'break-words whitespace-pre-line'
            }
          >
            {formatAnswer(q, answers[q.id], units, 'Not answered')}
          </dd>
        </div>
      ))}
    </dl>
  );
}
