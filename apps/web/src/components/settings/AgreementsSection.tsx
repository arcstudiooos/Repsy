'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, type FormEvent } from 'react';
import type { AgreementView } from '@repsy/core';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { call } from '@/lib/checkin-api';

const AREA =
  'min-h-40 rounded-control border border-input-border bg-surface px-3 py-2 text-base aria-invalid:border-danger';

function AgreementForm({
  initial,
  onDone,
  submitLabel,
}: {
  initial?: AgreementView;
  onDone: () => void;
  submitLabel: string;
}) {
  const id = useId();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setBusy(true);
    const payload = {
      title: String(data.get('title') ?? ''),
      body: String(data.get('body') ?? ''),
    };
    const res = initial
      ? await call('PATCH', `/api/v1/agreements/${initial.id}`, payload)
      : await call('POST', '/api/v1/agreements', payload);
    setBusy(false);
    if (!res.ok) {
      const fe = res.fieldErrors ?? {};
      setErrors({
        title: fe.title?.[0] ?? '',
        body: fe.body?.[0] ?? '',
        form: Object.keys(fe).length ? '' : res.message,
      });
      return;
    }
    toast.success(initial ? 'Agreement saved' : 'Agreement published');
    onDone();
  }
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3">
      <label htmlFor={`${id}-title`} className="text-sm font-medium">
        Title
      </label>
      <Input
        id={`${id}-title`}
        name="title"
        maxLength={120}
        defaultValue={initial?.title ?? ''}
        aria-invalid={errors.title ? true : undefined}
      />
      {errors.title && <p className="text-sm text-danger">{errors.title}</p>}
      <label htmlFor={`${id}-body`} className="text-sm font-medium">
        Text clients read and accept
      </label>
      <textarea
        id={`${id}-body`}
        name="body"
        maxLength={20000}
        defaultValue={initial?.body ?? ''}
        aria-invalid={errors.body ? true : undefined}
        className={AREA}
      />
      {errors.body && <p className="text-sm text-danger">{errors.body}</p>}
      {initial && (
        <p className="text-sm text-secondary">
          Changing the text makes a new version: every client is asked to accept it again.
        </p>
      )}
      {errors.form && (
        <p role="alert" className="text-sm text-danger">
          {errors.form}
        </p>
      )}
      <div>
        <Button type="submit" disabled={busy}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

/** PRD B14: terms and waivers clients accept in the portal. The owner edits; other coaches read. */
export function AgreementsSection({
  agreements,
  canEdit,
}: {
  agreements: AgreementView[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const done = () => {
    setEditing(null);
    setAdding(false);
    router.refresh();
  };
  async function archive(a: AgreementView) {
    const res = await fetch(`/api/v1/agreements/${a.id}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    });
    if (res.ok) {
      toast.success('Agreement removed');
      router.refresh();
    } else toast.error("Couldn't remove it. Try again.");
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Agreements and waivers</CardTitle>
        <CardDescription>
          Clients read and accept these before their portal opens, with the time and where they
          accepted from kept on record.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {agreements.length === 0 && !adding && (
          <p className="text-secondary">No agreements. Clients go straight to their portal.</p>
        )}
        <ul className="flex flex-col gap-3">
          {agreements.map((a) => (
            <li key={a.id} className="rounded-control border border-divider p-3">
              {editing === a.id ? (
                <AgreementForm initial={a} onDone={done} submitLabel="Save agreement" />
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p>
                    <span className="font-medium">{a.title}</span>{' '}
                    <span className="text-sm text-secondary">· version {a.version}</span>
                  </p>
                  {canEdit && (
                    <div className="flex gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        aria-label={`Edit ${a.title}`}
                        onClick={() => setEditing(a.id)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Remove ${a.title}`}
                        onClick={() => void archive(a)}
                      >
                        Remove
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
        {canEdit &&
          (adding ? (
            <AgreementForm onDone={done} submitLabel="Publish" />
          ) : (
            <div>
              <Button variant="secondary" onClick={() => setAdding(true)}>
                Add an agreement
              </Button>
            </div>
          ))}
      </CardContent>
    </Card>
  );
}
