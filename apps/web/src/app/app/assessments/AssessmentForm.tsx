'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import type { Guide } from '@repsy/core';
import { GUIDE_LABEL, GuideOverlay } from '@/components/assessments/GuideOverlay';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { call } from '@/lib/checkin-api';

const SELECT =
  'block min-h-11 max-w-full rounded-control border border-input-border bg-surface px-3 text-base text-ink';

/** PRD E5: what to photograph, the guide lines, and how often to retest. */
export function AssessmentForm({
  initial,
}: {
  initial?: { id: string; title: string; instructions: string; guide: Guide; everyWeeks: number };
}) {
  const router = useRouter();
  const uid = useId();
  const [title, setTitle] = useState(initial?.title ?? '');
  const [instructions, setInstructions] = useState(initial?.instructions ?? '');
  const [guide, setGuide] = useState<Guide>(initial?.guide ?? 'posture_grid');
  const [everyWeeks, setEveryWeeks] = useState(initial?.everyWeeks ?? 4);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const name = initial ? initial.title : 'new assessment';

  async function save() {
    setBusy(true);
    setErrors({});
    const body = { title, instructions, guide, everyWeeks };
    const res = await call<{ id: string }>(
      initial ? 'PUT' : 'POST',
      initial ? `/api/v1/assessments/${initial.id}` : '/api/v1/assessments',
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
    toast.success('Assessment saved');
    if (!initial) {
      setTitle('');
      setInstructions('');
    }
    router.refresh();
  }
  const err = (k: string) =>
    errors[k] ? <p className="text-sm text-danger">{errors[k]}</p> : null;

  return (
    <div className="flex flex-col gap-3">
      <label htmlFor={`${uid}-title`} className="text-sm font-medium">
        Assessment name{initial ? ` for ${initial.title}` : ''}
      </label>
      <Input
        id={`${uid}-title`}
        value={title}
        maxLength={120}
        placeholder="Standing posture (side)"
        onChange={(e) => setTitle(e.target.value)}
      />
      {err('title')}
      <label htmlFor={`${uid}-instr`} className="text-sm font-medium">
        How to take the photo
      </label>
      <textarea
        id={`${uid}-instr`}
        rows={3}
        maxLength={2000}
        value={instructions}
        placeholder="Side-on to the camera, arms relaxed, feet hip-width apart. Camera at hip height, 2 m away."
        onChange={(e) => setInstructions(e.target.value)}
        className="rounded-control border border-input-border bg-surface px-3 py-2 text-base"
      />
      {err('instructions')}
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor={`${uid}-guide`} className="text-sm font-medium">
            Guide lines
          </label>
          <select
            id={`${uid}-guide`}
            value={guide}
            onChange={(e) => setGuide(e.target.value as Guide)}
            className={SELECT}
          >
            {(Object.keys(GUIDE_LABEL) as Guide[]).map((g) => (
              <option key={g} value={g}>
                {GUIDE_LABEL[g]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${uid}-every`} className="text-sm font-medium">
            Retest every (weeks, 0 for once)
          </label>
          <Input
            id={`${uid}-every`}
            type="number"
            min={0}
            max={52}
            className="w-28"
            value={everyWeeks}
            onChange={(e) => setEveryWeeks(Number(e.target.value))}
          />
        </div>
        {guide !== 'none' && (
          <div
            className="relative h-28 w-20 rounded-control border border-divider bg-canvas"
            title={GUIDE_LABEL[guide]}
          >
            <GuideOverlay guide={guide} />
          </div>
        )}
      </div>
      {err('everyWeeks')}
      {err('guide')}
      <div>
        <Button
          type="button"
          disabled={busy}
          aria-label={initial ? `Save ${name}` : undefined}
          onClick={() => void save()}
        >
          {initial ? 'Save' : 'Create assessment'}
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

export function ArchiveAssessment({ id, title }: { id: string; title: string }) {
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={`Delete the assessment ${title}`}
      onClick={async () => {
        if (!window.confirm(`Delete "${title}"? Clients stop being asked; photos stay.`)) return;
        const res = await fetch(`/api/v1/assessments/${id}`, {
          method: 'DELETE',
          credentials: 'same-origin',
        });
        if (res.ok) {
          toast.success('Assessment deleted');
          router.refresh();
        } else toast.error("Couldn't delete it. Try again.");
      }}
    >
      Delete
    </Button>
  );
}
