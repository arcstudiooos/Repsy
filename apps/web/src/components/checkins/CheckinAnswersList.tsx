import type { CheckinAnswers, CheckinQuestion } from '@kinetic/core';
import type { Units } from '@kinetic/core/units';
import { formatAnswer } from '@/lib/checkin-answer';
import { Sparkline } from '@/components/charts/Sparkline';
import { cn } from '@/lib/utils';

/** A submitted check-in's answers, question by question (unanswered ones say so). */

export function CheckinAnswersList({
  questions,
  answers,
  units = 'kg',
  previous,
  history,
}: {
  questions: CheckinQuestion[];
  answers: CheckinAnswers;
  /** The check-in before this one, for the change shown on 1-5 answers. */
  previous?: CheckinAnswers | null;
  /** 1-5 answers per question id, oldest first, ending with this check-in (trend line). */
  history?: Record<string, Array<number | null>>;
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
            {q.type === 'scale_1_5' && typeof answers[q.id] === 'number' ? (
              <ScaleAnswer
                value={answers[q.id] as number}
                previous={typeof previous?.[q.id] === 'number' ? (previous[q.id] as number) : null}
                trend={history?.[q.id]}
                text={formatAnswer(q, answers[q.id], units, 'Not answered')}
              />
            ) : (
              formatAnswer(q, answers[q.id], units, 'Not answered')
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** A 1-5 answer: five segments, the answer in words, the change since the previous check-in and a trend line. */
function ScaleAnswer({
  value,
  previous,
  trend,
  text,
}: {
  value: number;
  previous: number | null;
  trend?: Array<number | null>;
  text: string;
}) {
  const delta = previous === null ? null : value - previous;
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span aria-hidden className="flex gap-0.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <span
            key={n}
            className={cn('h-2.5 w-5 rounded-sm', n <= value ? 'bg-ember' : 'bg-surface-2')}
          />
        ))}
      </span>
      <span className="font-medium">{text}</span>
      {delta !== null && (
        <span
          className={cn(
            'text-caption',
            delta > 0 ? 'text-success' : delta < 0 ? 'text-danger' : 'text-secondary',
          )}
        >
          {delta === 0
            ? 'Same as last time'
            : `${delta > 0 ? 'Up' : 'Down'} ${Math.abs(delta)} since last time`}
        </span>
      )}
      {trend && trend.filter((v) => v !== null).length > 2 && (
        <Sparkline values={trend} className="h-6 w-16" tone="cyan" />
      )}
    </span>
  );
}
