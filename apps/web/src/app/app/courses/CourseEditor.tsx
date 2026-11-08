'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import type { CourseCadence } from '@repsy/core';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { call } from '@/lib/checkin-api';

interface Lesson {
  id?: string;
  title: string;
  body: string;
  url: string;
}

const SELECT =
  'block min-h-11 max-w-full rounded-control border border-input-border bg-surface px-3 text-base text-ink';
const TEXTAREA = 'rounded-control border border-input-border bg-surface px-3 py-2 text-base';

/** PRD G4: a course's details and its lessons, in the order they unlock. */
export function CourseEditor({
  id: courseId,
  initial,
}: {
  id: string | null;
  initial: {
    title: string;
    description: string;
    cadence: CourseCadence;
    lessons: { id?: string; title: string; body: string; url: string | null }[];
  };
}) {
  const router = useRouter();
  const uid = useId();
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const [cadence, setCadence] = useState<CourseCadence>(initial.cadence);
  const [lessons, setLessons] = useState<Lesson[]>(
    initial.lessons.length
      ? initial.lessons.map((l) => ({ ...l, url: l.url ?? '' }))
      : [{ title: '', body: '', url: '' }],
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const update = (i: number, patch: Partial<Lesson>) =>
    setLessons((xs) => xs.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const move = (i: number, by: number) =>
    setLessons((xs) => {
      const next = [...xs];
      const [l] = next.splice(i, 1);
      next.splice(i + by, 0, l!);
      return next;
    });

  async function save() {
    setBusy(true);
    setErrors({});
    const body = {
      title,
      description,
      cadence,
      lessons: lessons.map((l) => ({
        ...(l.id ? { id: l.id } : {}),
        title: l.title,
        body: l.body,
        url: l.url.trim() || null,
      })),
    };
    const res = await call<{ id: string }>(
      courseId ? 'PUT' : 'POST',
      courseId ? `/api/v1/courses/${courseId}` : '/api/v1/courses',
      body,
    );
    setBusy(false);
    if (!res.ok) {
      const fe = res.fieldErrors ?? {};
      setErrors({
        ...Object.fromEntries(Object.entries(fe).map(([k, v]) => [k, v[0] ?? ''])),
        form: Object.keys(fe).length ? 'Check the highlighted fields.' : res.message,
      });
      return;
    }
    toast.success('Course saved');
    router.push(`/app/courses/${res.data.id}`);
    router.refresh();
  }

  const err = (k: string) =>
    errors[k] ? <p className="text-sm text-danger">{errors[k]}</p> : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <label htmlFor={`${uid}-title`} className="text-sm font-medium">
          Course title
        </label>
        <Input
          id={`${uid}-title`}
          value={title}
          maxLength={120}
          onChange={(e) => setTitle(e.target.value)}
        />
        {err('title')}
        <label htmlFor={`${uid}-desc`} className="text-sm font-medium">
          Description (optional)
        </label>
        <textarea
          id={`${uid}-desc`}
          rows={2}
          maxLength={2000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className={TEXTAREA}
        />
        {err('description')}
        <label htmlFor={`${uid}-cadence`} className="text-sm font-medium">
          New lesson every
        </label>
        <select
          id={`${uid}-cadence`}
          value={cadence}
          onChange={(e) => setCadence(e.target.value as CourseCadence)}
          className={SELECT}
        >
          <option value="daily">Day</option>
          <option value="weekly">Week</option>
        </select>
        <p className="text-sm text-secondary">
          Lesson 1 opens on the day a client starts; the next opens a{' '}
          {cadence === 'daily' ? 'day' : 'week'} later, and so on.
        </p>
      </div>
      <h2 className="text-lg font-semibold">Lessons</h2>
      {err('lessons')}
      <ol className="flex flex-col gap-4">
        {lessons.map((l, i) => {
          const n = i + 1;
          return (
            <li key={l.id ?? `new-${i}`}>
              <Card>
                <CardContent>
                  <fieldset className="flex flex-col gap-3">
                    <legend className="mb-1 font-semibold">Lesson {n}</legend>
                    <label htmlFor={`${uid}-${i}-title`} className="text-sm font-medium">
                      Lesson {n} title
                    </label>
                    <Input
                      id={`${uid}-${i}-title`}
                      value={l.title}
                      maxLength={120}
                      onChange={(e) => update(i, { title: e.target.value })}
                    />
                    {err(`lessons.${i}.title`)}
                    <label htmlFor={`${uid}-${i}-body`} className="text-sm font-medium">
                      Lesson {n} text
                    </label>
                    <textarea
                      id={`${uid}-${i}-body`}
                      rows={5}
                      maxLength={20000}
                      value={l.body}
                      onChange={(e) => update(i, { body: e.target.value })}
                      className={TEXTAREA}
                    />
                    {err(`lessons.${i}.body`)}
                    <label htmlFor={`${uid}-${i}-url`} className="text-sm font-medium">
                      Lesson {n} video or PDF link (optional)
                    </label>
                    <Input
                      id={`${uid}-${i}-url`}
                      type="url"
                      inputMode="url"
                      placeholder="https://"
                      value={l.url}
                      onChange={(e) => update(i, { url: e.target.value })}
                    />
                    {err(`lessons.${i}.url`)}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={i === 0}
                        aria-label={`Move up lesson ${n}`}
                        onClick={() => move(i, -1)}
                      >
                        Move up
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={i === lessons.length - 1}
                        aria-label={`Move down lesson ${n}`}
                        onClick={() => move(i, 1)}
                      >
                        Move down
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={lessons.length === 1}
                        aria-label={`Remove lesson ${n}`}
                        onClick={() => setLessons((xs) => xs.filter((_, j) => j !== i))}
                      >
                        Remove
                      </Button>
                    </div>
                  </fieldset>
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          variant="secondary"
          disabled={lessons.length >= 60}
          onClick={() => setLessons((xs) => [...xs, { title: '', body: '', url: '' }])}
        >
          Add a lesson
        </Button>
        <Button type="button" disabled={busy} onClick={() => void save()}>
          Save course
        </Button>
      </div>
      {errors.form && (
        <p role="alert" className="text-danger">
          {errors.form}
        </p>
      )}
    </div>
  );
}
