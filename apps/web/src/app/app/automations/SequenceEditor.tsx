'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import type { SequenceTrigger, StepInput, StepType } from '@repsy/core';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { call } from '@/lib/checkin-api';

export interface EditorOptions {
  tags: { id: string; name: string }[];
  forms: { id: string; title: string }[];
  programs: { id: string; title: string }[];
  courses: { id: string; title: string }[];
}

const SELECT =
  'block min-h-11 max-w-full rounded-control border border-input-border bg-surface px-3 text-base text-ink';
const TRIGGERS: [SequenceTrigger, string][] = [
  ['manual', 'Started by hand'],
  ['invite_accepted', 'A client joins'],
  ['intake_submitted', 'A client sends their intake'],
  ['checkin_submitted', 'A client sends a check-in'],
  ['program_finished', 'A client finishes a program'],
  ['tag_added', 'A client gets a tag'],
  ['stage_changed', 'A client moves to a stage'],
];
const TYPES: [StepType, string][] = [
  ['message', 'Send a message'],
  ['form', 'Send a form'],
  ['habit', 'Assign a habit'],
  ['tag_add', 'Add a tag'],
  ['tag_remove', 'Remove a tag'],
  ['program', 'Assign a program'],
  ['followup', 'Create a follow-up for me'],
  ['course', 'Enrol in a course'],
];
const pickKey = (t: StepType) =>
  t === 'form'
    ? 'templateId'
    : t === 'program'
      ? 'templateProgramId'
      : t === 'course'
        ? 'courseId'
        : 'tagId';
const STAGES: [string, string][] = [
  ['onboarding', 'Onboarding'],
  ['active', 'Active'],
  ['at_renewal', 'At renewal'],
];
const blank = (): StepInput => ({
  dayOffset: 0,
  localTime: '09:00',
  type: 'message',
  config: { body: '' },
  askFirst: false,
});

/** PRD J1-J3, J7: an automation's trigger and its steps, each on day N after the start at the client's time. */
export function SequenceEditor({
  id: sequenceId,
  initial,
  options,
}: {
  id: string | null;
  initial: {
    name: string;
    trigger: SequenceTrigger;
    triggerValue: string | null;
    active: boolean;
    steps: StepInput[];
  };
  options: EditorOptions;
}) {
  const router = useRouter();
  const uid = useId();
  const [name, setName] = useState(initial.name);
  const [trigger, setTrigger] = useState<SequenceTrigger>(initial.trigger);
  const [triggerValue, setTriggerValue] = useState(initial.triggerValue ?? '');
  const [active, setActive] = useState(initial.active);
  const [steps, setSteps] = useState<StepInput[]>(initial.steps.length ? initial.steps : [blank()]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const update = (i: number, patch: Partial<StepInput>) =>
    setSteps((xs) => xs.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const conf = (i: number, key: string, value: string | number) =>
    setSteps((xs) =>
      xs.map((s, j) => (j === i ? { ...s, config: { ...s.config, [key]: value } } : s)),
    );

  async function save() {
    setBusy(true);
    setErrors({});
    const body = {
      name,
      trigger,
      triggerValue:
        trigger === 'tag_added' || trigger === 'stage_changed' ? triggerValue || null : null,
      active,
      steps,
    };
    const res = sequenceId
      ? await call('PUT', `/api/v1/automations/${sequenceId}`, body)
      : await call<{ id: string }>('POST', '/api/v1/automations', body);
    setBusy(false);
    if (!res.ok) {
      const fe = res.fieldErrors ?? {};
      setErrors({
        ...Object.fromEntries(Object.entries(fe).map(([k, v]) => [k, v[0] ?? ''])),
        form: Object.keys(fe).length ? 'Check the highlighted fields.' : res.message,
      });
      return;
    }
    toast.success('Automation saved');
    router.push('/app/automations');
    router.refresh();
  }

  const err = (k: string) =>
    errors[k] ? <p className="text-sm text-danger">{errors[k]}</p> : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <label htmlFor={`${uid}-name`} className="text-sm font-medium">
          Name
        </label>
        <Input
          id={`${uid}-name`}
          value={name}
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
        />
        {err('name')}
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor={`${uid}-trigger`} className="text-sm font-medium">
              Starts when
            </label>
            <select
              id={`${uid}-trigger`}
              value={trigger}
              onChange={(e) => setTrigger(e.target.value as SequenceTrigger)}
              className={SELECT}
            >
              {TRIGGERS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          {trigger === 'tag_added' && (
            <div className="flex flex-col gap-1">
              <label htmlFor={`${uid}-tv`} className="text-sm font-medium">
                Tag
              </label>
              <select
                id={`${uid}-tv`}
                value={triggerValue}
                onChange={(e) => setTriggerValue(e.target.value)}
                className={SELECT}
              >
                <option value="">Choose…</option>
                {options.tags.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {trigger === 'stage_changed' && (
            <div className="flex flex-col gap-1">
              <label htmlFor={`${uid}-tv`} className="text-sm font-medium">
                Stage
              </label>
              <select
                id={`${uid}-tv`}
                value={triggerValue}
                onChange={(e) => setTriggerValue(e.target.value)}
                className={SELECT}
              >
                <option value="">Any stage</option>
                {STAGES.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
          )}
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              className="size-5 accent-accent"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />
            On
          </label>
        </div>
        {err('triggerValue')}
      </div>

      <ol className="flex flex-col gap-3" aria-label="Steps">
        {steps.map((s, i) => {
          const n = i + 1;
          const k = (f: string) => `steps.${i}.${f}`;
          return (
            <li key={i}>
              <Card>
                <CardContent>
                  <fieldset className="flex flex-col gap-3">
                    <legend className="mb-1 font-semibold">Step {n}</legend>
                    <div className="flex flex-wrap items-end gap-3">
                      <div className="flex flex-col gap-1">
                        <label htmlFor={`${uid}-${i}-day`} className="text-sm font-medium">
                          Step {n} day
                        </label>
                        <Input
                          id={`${uid}-${i}-day`}
                          type="number"
                          min={0}
                          max={365}
                          className="w-24"
                          value={s.dayOffset}
                          onChange={(e) => update(i, { dayOffset: Number(e.target.value) })}
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label htmlFor={`${uid}-${i}-time`} className="text-sm font-medium">
                          Step {n} time
                        </label>
                        <Input
                          id={`${uid}-${i}-time`}
                          type="time"
                          className="w-32"
                          value={s.localTime}
                          onChange={(e) => update(i, { localTime: e.target.value })}
                        />
                      </div>
                      <div className="flex min-w-0 flex-col gap-1">
                        <label htmlFor={`${uid}-${i}-type`} className="text-sm font-medium">
                          Step {n} action
                        </label>
                        <select
                          id={`${uid}-${i}-type`}
                          value={s.type}
                          onChange={(e) =>
                            update(i, { type: e.target.value as StepType, config: {} })
                          }
                          className={SELECT}
                        >
                          {TYPES.map(([v, l]) => (
                            <option key={v} value={v}>
                              {l}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <p className="text-sm text-secondary">
                      Day 0 is the day it starts; times are the client&apos;s local time.
                    </p>
                    {err(k('dayOffset'))}
                    {err(k('localTime'))}
                    {(s.type === 'message' || s.type === 'followup') && (
                      <div className="flex flex-col gap-1">
                        <label htmlFor={`${uid}-${i}-text`} className="text-sm font-medium">
                          Step {n} {s.type === 'message' ? 'message' : 'follow-up'}
                        </label>
                        <textarea
                          id={`${uid}-${i}-text`}
                          rows={s.type === 'message' ? 3 : 1}
                          value={String(s.config[s.type === 'message' ? 'body' : 'title'] ?? '')}
                          onChange={(e) =>
                            conf(i, s.type === 'message' ? 'body' : 'title', e.target.value)
                          }
                          className="rounded-control border border-input-border bg-surface px-3 py-2 text-base"
                        />
                        {err(k(`config.${s.type === 'message' ? 'body' : 'title'}`))}
                      </div>
                    )}
                    {s.type === 'habit' && (
                      <div className="flex flex-wrap gap-3">
                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                          <label htmlFor={`${uid}-${i}-habit`} className="text-sm font-medium">
                            Step {n} habit
                          </label>
                          <Input
                            id={`${uid}-${i}-habit`}
                            value={String(s.config.title ?? '')}
                            onChange={(e) => conf(i, 'title', e.target.value)}
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <label htmlFor={`${uid}-${i}-days`} className="text-sm font-medium">
                            Days a week
                          </label>
                          <Input
                            id={`${uid}-${i}-days`}
                            type="number"
                            min={1}
                            max={7}
                            className="w-24"
                            value={Number(s.config.daysPerWeek ?? 7)}
                            onChange={(e) => conf(i, 'daysPerWeek', Number(e.target.value))}
                          />
                        </div>
                      </div>
                    )}
                    {(
                      ['form', 'tag_add', 'tag_remove', 'program', 'course'] as StepType[]
                    ).includes(s.type) && (
                      <div className="flex min-w-0 flex-col gap-1">
                        <label htmlFor={`${uid}-${i}-pick`} className="text-sm font-medium">
                          Step {n}{' '}
                          {s.type === 'form'
                            ? 'form'
                            : s.type === 'program'
                              ? 'program'
                              : s.type === 'course'
                                ? 'course'
                                : 'tag'}
                        </label>
                        <select
                          id={`${uid}-${i}-pick`}
                          value={String(s.config[pickKey(s.type)] ?? '')}
                          onChange={(e) => conf(i, pickKey(s.type), e.target.value)}
                          className={SELECT}
                        >
                          <option value="">Choose…</option>
                          {(s.type === 'form'
                            ? options.forms.map((f) => [f.id, f.title])
                            : s.type === 'program'
                              ? options.programs.map((p) => [p.id, p.title])
                              : s.type === 'course'
                                ? options.courses.map((c) => [c.id, c.title])
                                : options.tags.map((t) => [t.id, t.name])
                          ).map(([v, l]) => (
                            <option key={v} value={v}>
                              {l}
                            </option>
                          ))}
                        </select>
                        {Object.keys(errors).some((x) => x.startsWith(k('config'))) && (
                          <p className="text-sm text-danger">
                            {Object.entries(errors).find(([x]) => x.startsWith(k('config')))?.[1]}
                          </p>
                        )}
                      </div>
                    )}
                    <label className="flex min-h-11 items-center gap-2">
                      <input
                        type="checkbox"
                        className="size-5 accent-accent"
                        checked={s.askFirst}
                        onChange={(e) => update(i, { askFirst: e.target.checked })}
                      />
                      Ask me first (it waits in Review until you OK it)
                    </label>
                    <div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={steps.length === 1}
                        aria-label={`Remove step ${n}`}
                        onClick={() => setSteps((xs) => xs.filter((_, j) => j !== i))}
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
          disabled={steps.length >= 30}
          onClick={() =>
            setSteps((xs) => [...xs, { ...blank(), dayOffset: xs.at(-1)?.dayOffset ?? 0 }])
          }
        >
          Add step
        </Button>
        <Button type="button" disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save automation'}
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
