'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { CheckinAnswers, CheckinQuestion, CheckinView } from '@kinetic/core';
import {
  metricDef,
  metricFromCanonical,
  metricToCanonical,
  metricUnit,
} from '@kinetic/core/metric-catalog';
import { shownQuestionIds } from '@kinetic/core/checkin-conditions';
import type { Units } from '@kinetic/core/units';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { saveCheckinDraft, submitCheckin } from '@/lib/checkin-api';
import { CheckinAnswersList } from './CheckinAnswersList';

const AUTOSAVE_MS = 800;
const deviceKey = (id: string) => `kinetic:checkin-draft:${id}`;

/** The device copy of an unsent draft (per-viewer convenience; the server draft is the durable one). */
function readDevice(id: string): { answers: CheckinAnswers; at: number } | null {
  try {
    const raw = localStorage.getItem(deviceKey(id));
    return raw ? (JSON.parse(raw) as { answers: CheckinAnswers; at: number }) : null;
  } catch {
    return null;
  }
}
function writeDevice(id: string, answers: CheckinAnswers | null) {
  try {
    if (answers) localStorage.setItem(deviceKey(id), JSON.stringify({ answers, at: Date.now() }));
    else localStorage.removeItem(deviceKey(id));
  } catch {
    // Storage unavailable (private window): the server draft still saves.
  }
}

type SaveState = 'idle' | 'saving' | 'saved' | 'device' | 'error';
const SAVE_LABEL: Record<SaveState, string> = {
  idle: '',
  saving: 'Saving draft',
  saved: 'Draft saved',
  device: 'Draft saved on this device',
  error: "The draft couldn't be saved. Your answers are still here.",
};

/** PRD F3: a body measurement typed in the client's units, kept canonical (kg, cm...). */
function MetricInput({
  id,
  q,
  value,
  units,
  describedBy,
  onChange,
}: {
  id: string;
  q: CheckinQuestion;
  value: number | undefined;
  units: Units;
  describedBy?: string;
  onChange(v: number | undefined): void;
}) {
  const def = metricDef(q.metric!);
  const [text, setText] = useState(
    value === undefined ? '' : String(metricFromCanonical(def.kind, value, units)),
  );
  return (
    <div className="flex items-center gap-2 sm:max-w-xs">
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        step="any"
        value={text}
        aria-describedby={describedBy}
        onChange={(e) => {
          setText(e.target.value);
          const n = e.target.value === '' ? NaN : Number(e.target.value);
          onChange(Number.isFinite(n) ? metricToCanonical(def.kind, n, units) : undefined);
        }}
      />
      <span className="text-secondary">{metricUnit(def.kind, units)}</span>
    </div>
  );
}

function QuestionField({
  q,
  value,
  error,
  units,
  onChange,
}: {
  q: CheckinQuestion;
  value: CheckinAnswers[string] | undefined;
  error?: string;
  units: Units;
  onChange(v: CheckinAnswers[string] | undefined): void;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  const err = error ? (
    <p id={errorId} className="text-sm text-danger">
      {error}
    </p>
  ) : null;
  const label = (
    <label htmlFor={id} className="font-medium">
      {q.label} <span className="text-sm font-normal text-secondary">(optional)</span>
    </label>
  );
  if (q.type === 'number') {
    return (
      <div className="flex flex-col gap-1">
        {label}
        <div className="flex items-center gap-2 sm:max-w-xs">
          <Input
            id={id}
            type="number"
            inputMode="decimal"
            step="any"
            value={typeof value === 'number' ? value : ''}
            onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
          />
          {q.unit && <span className="text-secondary">{q.unit}</span>}
        </div>
        {err}
      </div>
    );
  }
  if (q.type === 'metric' && q.metric) {
    return (
      <div className="flex flex-col gap-1">
        {label}
        <MetricInput
          id={id}
          q={q}
          units={units}
          value={typeof value === 'number' ? value : undefined}
          describedBy={error ? errorId : undefined}
          onChange={onChange}
        />
        <p className="text-sm text-secondary">Also saved to your progress.</p>
        {err}
      </div>
    );
  }
  if (q.type === 'date') {
    return (
      <div className="flex flex-col gap-1">
        {label}
        <Input
          id={id}
          type="date"
          className="sm:max-w-xs"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
        />
        {err}
      </div>
    );
  }
  if (q.type === 'multi_choice') {
    const chosen = Array.isArray(value) ? value : [];
    return (
      <fieldset className="flex flex-col gap-2" aria-describedby={error ? errorId : undefined}>
        <legend className="mb-1 font-medium">
          {q.label} <span className="text-sm font-normal text-secondary">(optional)</span>
        </legend>
        <p className="text-sm text-secondary">Pick any that apply.</p>
        <div className="flex flex-col gap-1">
          {(q.options ?? []).map((o) => (
            <label key={o} className="flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                className="size-5 accent-accent"
                checked={chosen.includes(o)}
                onChange={(e) => {
                  const next = e.target.checked ? [...chosen, o] : chosen.filter((x) => x !== o);
                  onChange(next.length ? next : undefined);
                }}
              />
              {o}
            </label>
          ))}
        </div>
        {err}
      </fieldset>
    );
  }
  if (q.type === 'short_text' || q.type === 'long_text') {
    return (
      <div className="flex flex-col gap-1">
        <label htmlFor={id} className="font-medium">
          {q.label} <span className="text-sm font-normal text-secondary">(optional)</span>
        </label>
        <textarea
          id={id}
          rows={q.type === 'long_text' ? 6 : 3}
          maxLength={q.type === 'long_text' ? 5000 : 2000}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className="rounded-control border border-input-border bg-surface px-3 py-2 text-base aria-invalid:border-danger"
        />
        {err}
      </div>
    );
  }
  const options: { label: string; value: number | boolean | string }[] =
    q.type === 'scale_1_5'
      ? [1, 2, 3, 4, 5].map((n) => ({ label: String(n), value: n }))
      : q.type === 'single_choice'
        ? (q.options ?? []).map((o) => ({ label: o, value: o }))
        : [
            { label: 'Yes', value: true },
            { label: 'No', value: false },
          ];
  return (
    <fieldset className="flex flex-col gap-2" aria-describedby={error ? errorId : undefined}>
      <legend className="mb-1 font-medium">
        {q.label} <span className="text-sm font-normal text-secondary">(optional)</span>
      </legend>
      {q.type === 'scale_1_5' && (
        <p className="text-sm text-secondary">1 is the lowest, 5 the highest.</p>
      )}
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <label
            key={o.label}
            className="flex min-h-11 min-w-11 cursor-pointer items-center justify-center gap-2 rounded-control border border-input-border px-3 has-checked:border-accent has-checked:bg-canvas"
          >
            <input
              type="radio"
              name={id}
              className="size-5"
              checked={value === o.value}
              onChange={() => onChange(o.value)}
            />
            {o.label}
          </label>
        ))}
        {value !== undefined && (
          <Button variant="ghost" className="min-h-11" onClick={() => onChange(undefined)}>
            Clear
          </Button>
        )}
      </div>
      {err}
    </fieldset>
  );
}

/** The client's weekly check-in (S4-1): every question optional, the draft autosaves, one submission. */
export function CheckinForm({
  initial,
  units = 'kg',
}: {
  initial: CheckinView;
  /** The client's units, for body measurement questions (PRD F3). */
  units?: Units;
}) {
  const [checkin, setCheckin] = useState(initial);
  // A device copy (saved offline, or the tab closed mid-save) is newer than the server draft. This component only
  // renders in the browser (CheckinFormLoader), so localStorage is readable here.
  const [device] = useState(() => (initial.status === 'submitted' ? null : readDevice(initial.id)));
  const [answers, setAnswers] = useState<CheckinAnswers>(device?.answers ?? initial.draft ?? {});
  const [save, setSave] = useState<SaveState>('idle');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [key] = useState(() => crypto.randomUUID());
  const timer = useRef<number | undefined>(undefined);
  // A device copy still has to reach the server.
  const dirty = useRef(device !== null);

  useEffect(() => {
    if (!dirty.current || checkin.status === 'submitted') return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      setSave('saving');
      const res = await saveCheckinDraft(checkin.id, answers);
      if (res.ok) {
        writeDevice(checkin.id, null);
        setSave('saved');
      } else {
        setSave(res.status === 0 ? 'device' : 'error');
      }
    }, AUTOSAVE_MS);
    return () => window.clearTimeout(timer.current);
  }, [answers, checkin.id, checkin.status]);

  if (checkin.status === 'submitted') {
    return (
      <div className="flex flex-col gap-4">
        <p role="status" className="rounded-card border border-accent bg-surface p-4">
          Check-in sent to your coach. Thank you.
        </p>
        <CheckinAnswersList
          questions={checkin.questions}
          answers={checkin.answers ?? {}}
          units={units}
        />
      </div>
    );
  }

  const change = (id: string, v: CheckinAnswers[string] | undefined) => {
    dirty.current = true;
    setErrors((e) => ({ ...e, [id]: '' }));
    setAnswers((a) => {
      const next = { ...a };
      if (v === undefined) delete next[id];
      else next[id] = v;
      writeDevice(checkin.id, next);
      return next;
    });
  };

  async function onSubmit() {
    setSubmitting(true);
    setFormError(null);
    window.clearTimeout(timer.current);
    const res = await submitCheckin(checkin.id, answers, key);
    setSubmitting(false);
    if (res.ok) {
      writeDevice(checkin.id, null);
      setCheckin(res.data);
      return;
    }
    const fe = res.fieldErrors ?? {};
    const mapped = Object.fromEntries(
      Object.entries(fe)
        .filter(([k]) => k.startsWith('answers.'))
        .map(([k, v]) => [k.slice('answers.'.length), v[0] ?? '']),
    );
    setErrors(mapped);
    setFormError(Object.keys(mapped).length ? 'Check the highlighted answers.' : res.message);
  }

  return (
    <form
      className="flex flex-col gap-6"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit();
      }}
    >
      <p className="text-secondary">Every question is optional. Your answers save as you go.</p>
      {/* PRD F11: a follow-up appears once the answer it depends on matches. */}
      {checkin.questions
        .filter((q) => shownQuestionIds(checkin.questions, answers).has(q.id))
        .map((q) => (
          <QuestionField
            key={q.id}
            q={q}
            value={answers[q.id]}
            error={errors[q.id] || undefined}
            units={units}
            onChange={(v) => change(q.id, v)}
          />
        ))}
      <p role="status" className="min-h-6 text-sm text-secondary">
        {SAVE_LABEL[save]}
      </p>
      {formError && (
        <p role="alert" className="text-danger">
          {formError}
        </p>
      )}
      <Button type="submit" className="min-h-14 w-full text-lg" disabled={submitting}>
        {submitting ? 'Sending…' : 'Send check-in'}
      </Button>
    </form>
  );
}
