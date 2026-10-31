'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, type FormEvent } from 'react';
import type { OptInRule, ReviewRuleSettings } from '@kinetic/core';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/components/ui/toast';
import { call } from '@/lib/checkin-api';

const RULES: { key: OptInRule; label: string; help: string }[] = [
  {
    key: 'program_ending',
    label: 'Program ends soon',
    help: "A client's last planned workout is within 7 days and nothing comes after it.",
  },
  {
    key: 'habit_low',
    label: 'Habit slipping',
    help: 'A habit was done on under half of its days in each of the last two weeks.',
  },
  {
    key: 'reply_overdue',
    label: 'Reply time missed',
    help: 'A client message is still unread after your usual reply time (set under Messaging).',
  },
  {
    key: 'weight_change',
    label: 'Weight change',
    help: 'Body weight changed by more than the percentage below over about two weeks.',
  },
];

/** Opt-in review rules (PRD I3): each adds items to the review queue when it is on. */
export function ReviewRulesSection({
  settings,
  canEdit,
}: {
  settings: ReviewRuleSettings;
  canEdit: boolean;
}) {
  const router = useRouter();
  const id = useId();
  const [enabled, setEnabled] = useState<OptInRule[]>(settings.enabled);
  const [band, setBand] = useState(settings.weightChangeBandPct?.toString() ?? '3');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await call<ReviewRuleSettings>('PUT', '/api/v1/org/review-rules', {
      enabled,
      weightChangeBandPct: band.trim() === '' ? null : Number(band),
    });
    setBusy(false);
    if (!res.ok) {
      setError(
        res.fieldErrors?.weightChangeBandPct?.[0] ?? res.fieldErrors?.enabled?.[0] ?? res.message,
      );
      return;
    }
    toast.success('Review rules saved.');
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Review rules</CardTitle>
        <CardDescription>
          Missed workouts, overdue and new check-ins are always reviewed. Turn on more rules here;
          each adds items to your review queue.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} aria-label="Review rules" noValidate className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-3" disabled={!canEdit}>
            <legend className="sr-only">Optional rules</legend>
            {RULES.map((r) => (
              <div key={r.key} className="flex items-start gap-3">
                <input
                  id={`${id}-${r.key}`}
                  type="checkbox"
                  className="mt-1 size-5"
                  checked={enabled.includes(r.key)}
                  onChange={(e) =>
                    setEnabled((cur) =>
                      e.target.checked ? [...cur, r.key] : cur.filter((k) => k !== r.key),
                    )
                  }
                  aria-describedby={`${id}-${r.key}-help`}
                />
                <div>
                  <label htmlFor={`${id}-${r.key}`} className="font-medium">
                    {r.label}
                  </label>
                  <p id={`${id}-${r.key}-help`} className="text-sm text-secondary">
                    {r.help}
                    {r.key === 'reply_overdue' &&
                      settings.replyTargetHours === null &&
                      ' No reply time is set yet, so this rule has nothing to check.'}
                  </p>
                </div>
              </div>
            ))}
            <div className="flex flex-col gap-1 sm:max-w-xs">
              <label htmlFor={`${id}-band`} className="text-sm font-medium">
                Weight change band (%)
              </label>
              <input
                id={`${id}-band`}
                type="number"
                inputMode="numeric"
                min={1}
                max={20}
                step={1}
                value={band}
                onChange={(e) => setBand(e.target.value)}
                className="min-h-11 rounded-control border border-input-border bg-surface px-3 text-base"
              />
            </div>
          </fieldset>
          {error && (
            <p role="alert" className="text-danger">
              {error}
            </p>
          )}
          {canEdit ? (
            <div>
              <Button type="submit" disabled={busy}>
                {busy ? 'Saving…' : 'Save review rules'}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-secondary">Only the workspace owner can change these.</p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
