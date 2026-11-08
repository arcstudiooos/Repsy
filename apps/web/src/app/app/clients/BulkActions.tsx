'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, type FormEvent } from 'react';
import type { TagView } from '@repsy/core';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { todayInZone, WEEKDAYS } from '@/lib/assign-form';
import { call } from '@/lib/checkin-api';

export interface BulkClient {
  id: string;
  name: string;
}

export interface BulkTemplate {
  id: string;
  title: string;
  daysPerWeek: number;
}

const select =
  'block min-h-11 rounded-control border border-input-border bg-surface px-3 text-base text-ink';

/**
 * Bulk actions on the selected clients (PRD B5): add a tag, send a message, or assign a program. Every client gets
 * their own copy (a tag link, a message in their own thread, their own program); nothing is shared between them.
 */
export function BulkActions({
  selected,
  tags,
  templates,
  onClear,
}: {
  selected: BulkClient[];
  tags: TagView[];
  templates: BulkTemplate[];
  onClear: () => void;
}) {
  const router = useRouter();
  const id = useId();
  const [tagId, setTagId] = useState(tags[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const ids = selected.map((c) => c.id);
  const n = selected.length;
  const who = n === 1 ? '1 client' : `${n} clients`;

  async function addTag() {
    setBusy(true);
    const res = await call<{ tagged: number; skipped: number }>(
      'POST',
      `/api/v1/tags/${tagId}/clients`,
      { clientIds: ids },
    );
    setBusy(false);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    toast.success(
      res.data.skipped > 0
        ? `Tagged ${res.data.tagged}; ${res.data.skipped} already have the most tags`
        : `Tagged ${who}`,
    );
    router.refresh();
  }

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="flex flex-col gap-3 rounded-card bg-surface p-4 shadow-card ring-1 ring-accent"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`${id}-title`} className="font-semibold">
          {who} selected
        </h2>
        <Button type="button" variant="ghost" size="sm" onClick={onClear}>
          Clear selection
        </Button>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        {tags.length > 0 && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <label htmlFor={`${id}-tag`} className="text-sm font-medium">
                Tag to add
              </label>
              <select
                id={`${id}-tag`}
                value={tagId}
                onChange={(e) => setTagId(e.target.value)}
                className={select}
              >
                {tags.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <Button
              type="button"
              variant="secondary"
              disabled={busy || !tagId}
              onClick={() => void addTag()}
            >
              Add tag
            </Button>
          </div>
        )}
        <BulkMessage ids={ids} who={who} />
        {templates.length > 0 && (
          <BulkAssign clients={selected} templates={templates} who={who} onDone={onClear} />
        )}
      </div>
    </section>
  );
}

function BulkMessage({ ids, who }: { ids: string[]; who: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function send(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const body = String(new FormData(e.currentTarget).get('body') ?? '');
    setBusy(true);
    setError(null);
    const res = await call<{ sent: number }>('POST', '/api/v1/messages/broadcast', {
      audience: 'selected',
      clientIds: ids,
      body,
      idempotencyKey: crypto.randomUUID(),
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.fieldErrors?.body?.[0] ?? res.fieldErrors?.audience?.[0] ?? res.message);
      return;
    }
    setOpen(false);
    toast.success(`Sent to ${res.data.sent === 1 ? '1 client' : `${res.data.sent} clients`}`);
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="secondary">
          Message
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Message {who}</DialogTitle>
          <DialogDescription>
            Each client gets it in their own thread, so replies stay private. Clients who
            haven&apos;t joined yet are skipped.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={send} className="flex flex-col gap-3">
          <label htmlFor={`${id}-body`} className="text-sm font-medium">
            Message
          </label>
          <textarea
            id={`${id}-body`}
            name="body"
            rows={4}
            maxLength={4000}
            required
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-err` : undefined}
            className="rounded-control border border-input-border bg-surface px-3 py-2 text-base"
          />
          {error && (
            <p id={`${id}-err`} role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={busy}>
              {busy ? 'Sending...' : 'Send'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function BulkAssign({
  clients,
  templates,
  who,
  onDone,
}: {
  clients: BulkClient[];
  templates: BulkTemplate[];
  who: string;
  onDone: () => void;
}) {
  const router = useRouter();
  const id = useId();
  const today = todayInZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [open, setOpen] = useState(false);
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? '');
  const [start, setStart] = useState(today);
  const [days, setDays] = useState<number[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    assigned: string[];
    skipped: { clientId: string; reason: string }[];
  } | null>(null);
  const template = templates.find((t) => t.id === templateId);
  const name = (cid: string) => clients.find((c) => c.id === cid)?.name ?? 'A client';

  async function assign(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!template) return;
    if (days.length !== template.daysPerWeek) {
      setError(`Choose ${template.daysPerWeek} training days.`);
      return;
    }
    setBusy(true);
    setError(null);
    const res = await call<{ assigned: string[]; skipped: { clientId: string; reason: string }[] }>(
      'POST',
      `/api/v1/programs/${template.id}/assign-many`,
      {
        clientIds: clients.map((c) => c.id),
        startLocalDate: start,
        weekdays: days,
        readinessConfirmed: ready,
      },
    );
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setResult(res.data);
    if (res.data.assigned.length > 0) router.refresh();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o && result) {
          setResult(null);
          if (result.assigned.length > 0) onDone();
        }
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="secondary">
          Assign program
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign a program to {who}</DialogTitle>
          <DialogDescription>
            Each client gets their own copy to adjust later. Clients who already have a program are
            skipped; change theirs from their own page.
          </DialogDescription>
        </DialogHeader>
        {result ? (
          <div className="flex flex-col gap-2" role="status">
            <p className="font-medium">
              Assigned to{' '}
              {result.assigned.length === 1 ? '1 client' : `${result.assigned.length} clients`}.
            </p>
            {result.skipped.length > 0 && (
              <ul aria-label="Skipped clients" className="flex flex-col gap-1 text-sm">
                {result.skipped.map((s) => (
                  <li key={s.clientId}>
                    <span className="font-medium">{name(s.clientId)}</span>: {s.reason}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <form onSubmit={assign} className="flex flex-col gap-3" noValidate>
            <div className="flex flex-col gap-1">
              <label htmlFor={`${id}-tpl`} className="text-sm font-medium">
                Program
              </label>
              <select
                id={`${id}-tpl`}
                value={templateId}
                onChange={(e) => {
                  setTemplateId(e.target.value);
                  setDays([]);
                }}
                className={select}
              >
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title} ({t.daysPerWeek} {t.daysPerWeek === 1 ? 'day' : 'days'} a week)
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={`${id}-start`} className="text-sm font-medium">
                Start date
              </label>
              <Input
                id={`${id}-start`}
                type="date"
                min={today}
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </div>
            <fieldset>
              <legend className="mb-1 text-sm font-medium">
                Training days (choose {template?.daysPerWeek ?? 0})
              </legend>
              <div className="flex flex-wrap gap-2">
                {WEEKDAYS.map((d) => (
                  <label key={d.value} className="flex min-h-11 items-center gap-2">
                    <input
                      type="checkbox"
                      className="size-5 accent-accent"
                      checked={days.includes(d.value)}
                      onChange={(e) =>
                        setDays((all) =>
                          e.target.checked ? [...all, d.value] : all.filter((x) => x !== d.value),
                        )
                      }
                    />
                    <span>
                      <span aria-hidden>{d.short}</span>
                      <span className="sr-only">{d.long}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                className="size-5 accent-accent"
                checked={ready}
                onChange={(e) => setReady(e.target.checked)}
              />
              I&apos;ve confirmed these clients are ready to start this program.
            </label>
            {error && (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button type="submit" disabled={busy}>
                {busy ? 'Assigning...' : 'Assign'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
