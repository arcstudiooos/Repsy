'use client';

import type { AiActionView } from '@kinetic/core';
import { Check, Loader2, X } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { cancelAction, confirmAction } from '@/lib/assistant-api';

type Macros = { calories: number; proteinG: number; carbsG: number; fatG: number };

const TITLES: Record<AiActionView['kind'], string> = {
  assign_program: 'Assign a program',
  set_nutrition_targets: 'Set daily nutrition targets',
  meal_plan: 'Create and give a meal plan',
  assign_meal_plan: 'Give a meal plan',
};

const STATUS: Record<
  AiActionView['status'],
  { label: string; tone: 'success' | 'neutral' | 'danger' | 'warning' }
> = {
  proposed: { label: 'Waiting for you', tone: 'warning' },
  applied: { label: 'Done', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  failed: { label: 'Failed', tone: 'danger' },
  expired: { label: 'Expired', tone: 'neutral' },
};

const fmt = (m: Macros) =>
  `${m.calories} kcal · P ${m.proteinG} g · C ${m.carbsG} g · F ${m.fatG} g`;

function Details({ action }: { action: AiActionView }) {
  const d = (action.details ?? {}) as Record<string, unknown>;
  if (action.kind === 'meal_plan') {
    const preview = (d.preview ?? []) as { name: string; totals: Macros; meals: string[] }[];
    return (
      <div className="mt-3 flex flex-col gap-2">
        <p className="text-sm">
          Daily targets: <span className="font-medium">{fmt(d.targets as Macros)}</span>
        </p>
        <ul className="flex flex-col gap-2">
          {preview.map((day) => (
            <li key={day.name} className="rounded-control bg-surface-2 p-3 text-sm">
              <details>
                <summary className="cursor-pointer">
                  <span className="font-medium">{day.name}</span>{' '}
                  <span className="text-secondary">{fmt(day.totals)}</span>
                </summary>
                <ul className="mt-2 list-disc pl-5">
                  {day.meals.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </details>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (action.kind === 'set_nutrition_targets') {
    return <p className="mt-2 text-sm font-medium">{fmt(d.targets as Macros)}</p>;
  }
  return null;
}

/** PRD I15 actions: a change the assistant proposed. Nothing happens until the coach presses Confirm. */
export function ActionCard({
  action,
  onChange,
}: {
  action: AiActionView;
  onChange: (next: AiActionView) => void;
}) {
  const [busy, setBusy] = useState<'confirm' | 'cancel' | null>(null);
  const status = STATUS[action.status];

  async function decide(kind: 'confirm' | 'cancel') {
    setBusy(kind);
    const res = await (kind === 'confirm' ? confirmAction(action.id) : cancelAction(action.id));
    setBusy(null);
    if (!res.ok) {
      toast.error(res.message);
      if (kind === 'confirm') {
        onChange({ ...action, status: 'failed', error: res.message });
      }
      return;
    }
    onChange(res.data);
    toast.success(kind === 'confirm' ? 'Done.' : 'Cancelled.');
  }

  return (
    <div className="mt-3 rounded-card border border-border bg-surface p-4 shadow-e1">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold">{TITLES[action.kind]}</p>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>
      <p className="mt-1 text-sm">{action.summary}</p>
      <Details action={action} />
      {action.error && <p className="mt-2 text-sm text-danger">{action.error}</p>}
      {action.status === 'proposed' && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" disabled={busy !== null} onClick={() => decide('confirm')}>
            {busy === 'confirm' ? (
              <Loader2 aria-hidden className="animate-spin" />
            ) : (
              <Check aria-hidden />
            )}
            Confirm
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy !== null}
            onClick={() => decide('cancel')}
          >
            <X aria-hidden /> Cancel
          </Button>
        </div>
      )}
      {action.kind === 'meal_plan' && action.status === 'proposed' && (
        <p className="mt-2 text-caption text-secondary">
          Macros are AI estimates. Check them before confirming.
        </p>
      )}
    </div>
  );
}
