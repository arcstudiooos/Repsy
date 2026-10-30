'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import type { CheckinQuestion, CheckinTemplateView, QuestionType } from '@kinetic/core';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { updateCheckinTemplate } from '@/lib/checkin-api';

const TYPE_LABEL: Record<QuestionType, string> = {
  scale_1_5: 'Scale 1 to 5',
  short_text: 'Short text',
  yes_no: 'Yes or no',
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
    const res = await updateCheckinTemplate({ title, questions });
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
      </div>
      {formError && (
        <p role="alert" className="text-danger">
          {formError}
        </p>
      )}
    </form>
  );
}
