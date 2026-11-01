import type { CheckinAnswers, CheckinQuestion } from '@kinetic/core';
import type { Units } from '@kinetic/core/units';
import { formatAnswer } from '@/lib/checkin-answer';

/** A submitted check-in's answers, question by question (unanswered ones say so). */
export function CheckinAnswersList({
  questions,
  answers,
  units = 'kg',
}: {
  questions: CheckinQuestion[];
  answers: CheckinAnswers;
  /** For body measurement answers (PRD F3). */
  units?: Units;
}) {
  return (
    <dl className="flex flex-col gap-3">
      {questions.map((q) => (
        <div key={q.id}>
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
