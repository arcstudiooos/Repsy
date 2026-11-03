'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { call } from '@/lib/checkin-api';

export interface AiDraftItem {
  id: string;
  kind: string;
  title: string;
  weeks: {
    days: {
      title: string;
      exercises: { name: string; exerciseId: string | null; sets: unknown[] }[];
    }[];
  }[];
  unmatched: { dayTitle: string; name: string; reason: string }[];
  createdAt: string;
}

export interface AiHighlightItem {
  questionId: string;
  label: string;
  previous: unknown;
  current: unknown;
  change: string;
  previousSourceUrl: string | null;
  currentSourceUrl: string | null;
}

function formatAnswer(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

function formatSets(sets: unknown[]): string {
  return sets
    .map((s) => {
      const set = s as Record<string, number | undefined>;
      if (set.durationSec !== undefined) return `${set.durationSec}s`;
      if (set.distanceM !== undefined) return `${set.distanceM}m`;
      const reps = set.repsMax !== undefined ? `${set.reps}-${set.repsMax}` : `${set.reps ?? ''}`;
      const load = set.loadKg !== undefined ? ` @ ${set.loadKg}kg` : '';
      const rpe = set.rpe !== undefined ? ` RPE ${set.rpe}` : '';
      return `${reps}${load}${rpe}`;
    })
    .join(', ');
}

export function AiDraftsClient({
  aiEnabled,
  canManageSetting,
  canDraft,
  drafts,
  templates,
}: {
  aiEnabled: boolean;
  canManageSetting: boolean;
  canDraft: boolean;
  drafts: AiDraftItem[];
  templates: { id: string; title: string }[];
}) {
  const router = useRouter();
  const id = useId();
  const [enabled, setEnabled] = useState(aiEnabled);
  const [paste, setPaste] = useState('');
  const [pasteTitle, setPasteTitle] = useState('');
  const [equipment, setEquipment] = useState('');
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? '');
  const [instruction, setInstruction] = useState('');
  const [clientId, setClientId] = useState('');
  const [previousId, setPreviousId] = useState('');
  const [currentId, setCurrentId] = useState('');
  const [highlights, setHighlights] = useState<AiHighlightItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toggle = async (next: boolean) => {
    setBusy(true);
    setError(null);
    const res = await call<{ aiEnabled: boolean }>('PUT', '/api/v1/ai-settings', {
      aiEnabled: next,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setEnabled(next);
    router.refresh();
  };

  const createDraft = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    const res = await call('POST', '/api/v1/ai-drafts', body);
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    router.refresh();
  };

  const loadHighlights = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setHighlights(null);
    try {
      const q = new URLSearchParams({ clientId, previousId, currentId });
      const res = await fetch(`/api/v1/ai-drafts/highlights?${q.toString()}`, {
        credentials: 'same-origin',
      });
      const json = (await res.json().catch(() => null)) as {
        data?: AiHighlightItem[];
        error?: { message?: string };
      } | null;
      if (!res.ok || !json || !('data' in json) || !json.data) {
        setError(json?.error?.message ?? 'Could not load highlights. Use two submitted check-ins.');
      } else {
        setHighlights(json.data);
      }
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    }
    setBusy(false);
  };

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle as="h2">AI drafting</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <p className="text-secondary">
            Drafts only, off by default. Nothing here saves a program or sends anything: every draft
            is labelled “Drafted with AI” and waits for you to save it. No client names are sent to
            any AI provider, and AI drafts never give medical, injury or supplement advice.
          </p>
          {canManageSetting ? (
            <label className="flex items-center gap-2" htmlFor={`${id}-toggle`}>
              <input
                id={`${id}-toggle`}
                type="checkbox"
                checked={enabled}
                disabled={busy}
                onChange={(e) => toggle(e.target.checked)}
              />
              Turn on AI drafting for this workspace
            </label>
          ) : (
            <p className="text-secondary">
              AI drafting is {enabled ? 'on' : 'off'} for this workspace. Only an owner or admin can
              change it.
            </p>
          )}
        </CardContent>
      </Card>

      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}

      {canDraft && (
        <>
          <Card>
            <CardHeader>
              <CardTitle as="h2">Paste to program</CardTitle>
            </CardHeader>
            <CardContent>
              <form
                className="flex flex-col gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  createDraft({
                    kind: 'paste',
                    sourceText: paste,
                    title: pasteTitle || undefined,
                    equipmentFilter: equipment
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  });
                }}
              >
                <label htmlFor={`${id}-paste-title`}>Draft title (optional)</label>
                <Input
                  id={`${id}-paste-title`}
                  value={pasteTitle}
                  onChange={(e) => setPasteTitle(e.target.value)}
                  placeholder="Pasted program"
                />
                <label htmlFor={`${id}-paste`}>
                  Paste text or a spreadsheet (one exercise per line, like “Bench press 3x8 @ 60kg”)
                </label>
                <textarea
                  id={`${id}-paste`}
                  className="min-h-40 rounded-control border border-input-border bg-surface px-3 py-2 text-base text-ink"
                  value={paste}
                  onChange={(e) => setPaste(e.target.value)}
                  disabled={!enabled}
                  placeholder={'Day 1: Upper\nBench press 3x8 @ 60kg'}
                />
                <label htmlFor={`${id}-equipment`}>
                  Only this equipment (optional, comma-separated, e.g. Dumbbell)
                </label>
                <Input
                  id={`${id}-equipment`}
                  value={equipment}
                  onChange={(e) => setEquipment(e.target.value)}
                  placeholder="Dumbbell"
                />
                <Button type="submit" disabled={busy || !enabled}>
                  Create paste draft
                </Button>
                {!enabled && <p className="text-secondary">Turn AI drafting on above first.</p>}
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle as="h2">Draft from a template</CardTitle>
            </CardHeader>
            <CardContent>
              <form
                className="flex flex-col gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  createDraft({ kind: 'template', templateProgramId: templateId, instruction });
                }}
              >
                <label htmlFor={`${id}-template`}>Template</label>
                <select
                  id={`${id}-template`}
                  className="block min-h-11 max-w-full rounded-control border border-input-border bg-surface px-3 text-base text-ink"
                  value={templateId}
                  onChange={(e) => setTemplateId(e.target.value)}
                >
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
                </select>
                <label htmlFor={`${id}-instruction`}>
                  Describe the draft (for example: “Like my template Strength Base, 4 days,
                  dumbbells only, 6 weeks”)
                </label>
                <Input
                  id={`${id}-instruction`}
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  placeholder="4 days, dumbbells only, 6 weeks"
                />
                <Button type="submit" disabled={busy || !enabled || !templateId}>
                  Create template draft
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle as="h2">Check-in highlights</CardTitle>
            </CardHeader>
            <CardContent>
              <form className="flex flex-col gap-3" onSubmit={loadHighlights}>
                <label htmlFor={`${id}-client`}>Client ID</label>
                <Input
                  id={`${id}-client`}
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder="Paste the client ID from their page"
                />
                <label htmlFor={`${id}-previous`}>Earlier submitted check-in ID</label>
                <Input
                  id={`${id}-previous`}
                  value={previousId}
                  onChange={(e) => setPreviousId(e.target.value)}
                />
                <label htmlFor={`${id}-current`}>Later submitted check-in ID</label>
                <Input
                  id={`${id}-current`}
                  value={currentId}
                  onChange={(e) => setCurrentId(e.target.value)}
                />
                <Button type="submit" disabled={busy}>
                  Show what changed
                </Button>
              </form>
              {highlights !== null &&
                (highlights.length === 0 ? (
                  <p className="mt-3 text-secondary">
                    Nothing changed between those two check-ins.
                  </p>
                ) : (
                  <ul className="mt-3 flex flex-col gap-3">
                    {highlights.map((h) => (
                      <li key={h.questionId}>
                        <strong>{h.label}</strong>: {formatAnswer(h.previous)} →{' '}
                        {formatAnswer(h.current)}
                        <span className="ml-2">
                          {h.previousSourceUrl && <a href={h.previousSourceUrl}>Earlier answer</a>}
                          {h.previousSourceUrl && h.currentSourceUrl && ' · '}
                          {h.currentSourceUrl && <a href={h.currentSourceUrl}>Later answer</a>}
                        </span>
                      </li>
                    ))}
                  </ul>
                ))}
            </CardContent>
          </Card>
        </>
      )}

      <Card>
        <CardHeader>
          <CardTitle as="h2">Drafts</CardTitle>
        </CardHeader>
        <CardContent>
          {drafts.length === 0 ? (
            <p className="text-secondary">No AI drafts yet.</p>
          ) : (
            <ul className="flex flex-col gap-6">
              {drafts.map((d) => (
                <li key={d.id}>
                  <p>
                    <strong>{d.title}</strong>{' '}
                    <span aria-label="AI draft label">Drafted with AI</span> · {d.kind} ·{' '}
                    {d.weeks.length} {d.weeks.length === 1 ? 'week' : 'weeks'}
                  </p>
                  {d.unmatched.length > 0 && (
                    <p className="text-secondary">
                      Needs your attention: {d.unmatched.map((u) => u.name).join(', ')} could not be
                      matched to your exercise library.
                    </p>
                  )}
                  {d.weeks.map((w, wi) => (
                    <div key={wi} className="mt-2">
                      <p>Week {wi + 1}</p>
                      {w.days.map((day, di) => (
                        <div key={di} className="ml-3">
                          <p>{day.title}</p>
                          <ul className="ml-3">
                            {day.exercises.map((ex, ei) => (
                              <li key={ei}>
                                {ex.name} {formatSets(ex.sets)}
                                {ex.exerciseId === null && ' (unmatched — pick an exercise)'}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  ))}
                  <p className="text-secondary">
                    This is a draft, not a program. Save it from the program builder when it looks
                    right.
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
