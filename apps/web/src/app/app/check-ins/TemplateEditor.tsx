'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import type { CheckinQuestion, CheckinTemplateView, QuestionType } from '@repsy/core';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { call } from '@/lib/checkin-api';
import { ConditionEditor } from './ConditionEditor';
import type { ContextField } from '@repsy/core';
import { BODY_METRICS, type BodyMetric } from '@repsy/core/metric-catalog';

const TYPE_LABEL: Record<QuestionType, string> = {
  scale_1_5: 'Scale 1 to 5',
  short_text: 'Short text',
  long_text: 'Long text',
  yes_no: 'Yes or no',
  number: 'Number',
  single_choice: 'Pick one',
  multi_choice: 'Pick any',
  date: 'Date',
  metric: 'Body measurement',
};
const MAX = 20;

const newId = () => `q-${crypto.randomUUID().slice(0, 8)}`;

/** Edits the organization's check-in template (S4-1). Issued check-ins keep the questions they were sent with. */
export function TemplateEditor({ template }: { template: CheckinTemplateView }) {
  const router = useRouter();
  const uid = useId();
  const [title, setTitle] = useState(template.title);
  const [questions, setQuestions] = useState<CheckinQuestion[]>(template.questions);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const update = (i: number, patch: Partial<CheckinQuestion>) =>
    setQuestions((qs) => qs.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  const move = (i: number, by: -1 | 1) =>
    setQuestions((qs) => {
      const next = [...qs];
      const [q] = next.splice(i, 1);
      next.splice(i + by, 0, q as CheckinQuestion);
      return next;
    });

  async function save() {
    setBusy(true);
    setErrors({});
    setFormError(null);
    // Blank option lines are only there while typing.
    const res = await call<CheckinTemplateView>(
      'PATCH',
      `/api/v1/checkin-templates/${template.id}`,
      {
        title,
        questions: questions.map((q) =>
          q.options ? { ...q, options: q.options.map((o) => o.trim()).filter(Boolean) } : q,
        ),
      },
    );
    setBusy(false);
    if (res.ok) {
      toast.success('Check-in questions saved');
      router.refresh();
      return;
    }
    const fe = res.fieldErrors ?? {};
    setErrors(Object.fromEntries(Object.entries(fe).map(([k, v]) => [k, v[0] ?? ''])));
    setFormError(Object.keys(fe).length ? 'Check the highlighted fields.' : res.message);
  }

  const err = (key: string) =>
    errors[key] ? (
      <p id={`${uid}-${key}`} className="text-sm text-danger">
        {errors[key]}
      </p>
    ) : null;

  return (
    <form
      className="flex flex-col gap-6"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="flex flex-col gap-1">
        <label htmlFor={`${uid}-title`} className="text-sm font-medium">
          Title
        </label>
        <Input
          id={`${uid}-title`}
          value={title}
          maxLength={120}
          onChange={(e) => setTitle(e.target.value)}
          aria-invalid={errors.title ? true : undefined}
          aria-describedby={errors.title ? `${uid}-title` : undefined}
        />
        {err('title')}
      </div>

      <ol className="flex flex-col gap-3">
        {questions.map((q, i) => (
          <li key={q.id}>
            <Card>
              <CardContent>
                <fieldset className="flex flex-col gap-3">
                  <legend className="mb-2 font-semibold">Question {i + 1}</legend>
                  <div className="flex flex-col gap-1">
                    <label htmlFor={`${uid}-${q.id}-label`} className="text-sm font-medium">
                      Question {i + 1} text
                    </label>
                    <Input
                      id={`${uid}-${q.id}-label`}
                      value={q.label}
                      maxLength={200}
                      onChange={(e) => update(i, { label: e.target.value })}
                      aria-invalid={errors[`questions.${i}.label`] ? true : undefined}
                      aria-describedby={
                        errors[`questions.${i}.label`] ? `${uid}-questions.${i}.label` : undefined
                      }
                    />
                    {err(`questions.${i}.label`)}
                  </div>
                  <div className="flex flex-col gap-1">
                    <label htmlFor={`${uid}-${q.id}-type`} className="text-sm font-medium">
                      Question {i + 1} answer type
                    </label>
                    <select
                      id={`${uid}-${q.id}-type`}
                      value={q.type}
                      onChange={(e) => update(i, { type: e.target.value as QuestionType })}
                      className="block min-h-11 rounded-control border border-input-border bg-surface px-3 text-base text-ink"
                    >
                      {(Object.keys(TYPE_LABEL) as QuestionType[]).map((t) => (
                        <option key={t} value={t}>
                          {TYPE_LABEL[t]}
                        </option>
                      ))}
                    </select>
                  </div>
                  {template.kind === 'intake' &&
                    (q.type === 'short_text' || q.type === 'long_text') && (
                      <div className="flex flex-col gap-1 sm:max-w-xs">
                        <label htmlFor={`${uid}-${q.id}-ctx`} className="text-sm font-medium">
                          Question {i + 1} fills the context card
                        </label>
                        <select
                          id={`${uid}-${q.id}-ctx`}
                          value={q.contextField ?? ''}
                          onChange={(e) =>
                            update(i, {
                              contextField: (e.target.value || undefined) as
                                ContextField | undefined,
                            })
                          }
                          className="block min-h-11 rounded-control border border-input-border bg-surface px-3 text-base text-ink"
                        >
                          <option value="">No</option>
                          <option value="goals">Goals</option>
                          <option value="motivation">Why they came</option>
                          <option value="scheduleNotes">Schedule</option>
                          <option value="equipmentNotes">Equipment</option>
                          <option value="preferences">Preferences</option>
                        </select>
                      </div>
                    )}
                  {q.type === 'number' && (
                    <div className="flex flex-col gap-1 sm:max-w-xs">
                      <label htmlFor={`${uid}-${q.id}-unit`} className="text-sm font-medium">
                        Question {i + 1} unit (optional)
                      </label>
                      <Input
                        id={`${uid}-${q.id}-unit`}
                        value={q.unit ?? ''}
                        maxLength={20}
                        placeholder="hours"
                        onChange={(e) => update(i, { unit: e.target.value })}
                      />
                    </div>
                  )}
                  {(q.type === 'single_choice' || q.type === 'multi_choice') && (
                    <div className="flex flex-col gap-1">
                      <label htmlFor={`${uid}-${q.id}-options`} className="text-sm font-medium">
                        Question {i + 1} options, one per line
                      </label>
                      <textarea
                        id={`${uid}-${q.id}-options`}
                        rows={4}
                        value={(q.options ?? []).join('\n')}
                        onChange={(e) => update(i, { options: e.target.value.split('\n') })}
                        aria-invalid={errors[`questions.${i}.options`] ? true : undefined}
                        aria-describedby={
                          errors[`questions.${i}.options`]
                            ? `${uid}-questions.${i}.options`
                            : undefined
                        }
                        className="rounded-control border border-input-border bg-surface px-3 py-2 text-base"
                      />
                      {err(`questions.${i}.options`)}
                    </div>
                  )}
                  {q.type === 'metric' && (
                    <div className="flex flex-col gap-1 sm:max-w-xs">
                      <label htmlFor={`${uid}-${q.id}-metric`} className="text-sm font-medium">
                        Question {i + 1} measurement
                      </label>
                      <select
                        id={`${uid}-${q.id}-metric`}
                        value={q.metric ?? ''}
                        onChange={(e) => update(i, { metric: e.target.value as BodyMetric })}
                        aria-invalid={errors[`questions.${i}.metric`] ? true : undefined}
                        className="block min-h-11 rounded-control border border-input-border bg-surface px-3 text-base text-ink"
                      >
                        <option value="">Choose…</option>
                        {BODY_METRICS.map((m) => (
                          <option key={m.key} value={m.key}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                      {err(`questions.${i}.metric`)}
                      <p className="text-sm text-secondary">
                        The answer is saved to the client&apos;s progress too.
                      </p>
                    </div>
                  )}
                  <ConditionEditor
                    index={i}
                    questions={questions}
                    value={q.showIf}
                    onChange={(showIf) => update(i, { showIf })}
                    error={errors[`questions.${i}.showIf`]}
                    uid={`${uid}-${q.id}`}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      className="min-h-11"
                      disabled={i === 0}
                      aria-label={`Move up question ${i + 1}`}
                      onClick={() => move(i, -1)}
                    >
                      Move up
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="min-h-11"
                      disabled={i === questions.length - 1}
                      aria-label={`Move down question ${i + 1}`}
                      onClick={() => move(i, 1)}
                    >
                      Move down
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="min-h-11"
                      disabled={questions.length === 1}
                      aria-label={`Remove question ${i + 1}`}
                      onClick={() => setQuestions((qs) => qs.filter((_, j) => j !== i))}
                    >
                      Remove
                    </Button>
                  </div>
                </fieldset>
              </CardContent>
            </Card>
          </li>
        ))}
      </ol>
      {err('questions')}
      <p className="text-sm text-secondary">Every question is optional for the client.</p>
      <div className="flex flex-wrap gap-3">
        <Button
          variant="secondary"
          disabled={questions.length >= MAX}
          onClick={() =>
            setQuestions((qs) => [
              ...qs,
              { id: newId(), type: 'short_text', label: '', optional: true },
            ])
          }
        >
          Add question
        </Button>
        <Button type="submit" disabled={busy}>
          Save questions
        </Button>
        {!template.isDefault && (
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const res = await call('PATCH', `/api/v1/checkin-templates/${template.id}`, {
                archived: true,
              });
              setBusy(false);
              if (res.ok) {
                toast.success('Template archived');
                router.push('/app/check-ins');
                router.refresh();
              } else toast.error(res.message);
            }}
          >
            Archive template
          </Button>
        )}
      </div>
      {formError && (
        <p role="alert" className="text-danger">
          {formError}
        </p>
      )}
    </form>
  );
}
