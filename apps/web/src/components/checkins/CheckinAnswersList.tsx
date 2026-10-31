import type { CheckinAnswers, CheckinQuestion } from '@kinetic/core';

const show = (q: CheckinQuestion, v: CheckinAnswers[string] | undefined): string => {
  if (v === undefined) return 'Not answered';
  if (q.type === 'yes_no') return v ? 'Yes' : 'No';
  if (q.type === 'scale_1_5') return `${v} of 5`;
  return String(v);
};

/** A submitted check-in's answers, question by question (unanswered ones say so). */
export function CheckinAnswersList({
  questions,
  answers,
}: {
  questions: CheckinQuestion[];
  answers: CheckinAnswers;
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
            {show(q, answers[q.id])}
          </dd>
        </div>
      ))}
    </dl>
  );
}
