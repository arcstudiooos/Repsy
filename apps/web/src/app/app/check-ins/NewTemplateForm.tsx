'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import type { CheckinTemplateView } from '@kinetic/core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { call } from '@/lib/checkin-api';

/** PRD F2: a new template, started with one question. */
export function NewTemplateForm() {
  const router = useRouter();
  const id = useId();
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState('form');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      aria-label="New template"
      noValidate
      className="flex flex-col gap-2 rounded-card bg-surface p-4 shadow-card"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const res = await call<CheckinTemplateView>('POST', '/api/v1/checkin-templates', {
          title,
          kind,
          questions: [
            {
              id: `q-${crypto.randomUUID().slice(0, 8)}`,
              type: 'short_text',
              label: 'Anything you want me to know?',
              optional: true,
            },
          ],
        });
        setBusy(false);
        if (!res.ok) {
          setError(res.fieldErrors?.title?.[0] ?? res.message);
          return;
        }
        toast.success('Template created');
        setTitle('');
        router.push(`/app/check-ins?template=${res.data.id}`);
      }}
    >
      <h2 className="font-semibold">New template</h2>
      <label htmlFor={`${id}-title`} className="text-sm font-medium">
        Name
      </label>
      <Input
        id={`${id}-title`}
        value={title}
        maxLength={120}
        onChange={(e) => setTitle(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
      />
      <label htmlFor={`${id}-kind`} className="text-sm font-medium">
        Kind
      </label>
      <select
        id={`${id}-kind`}
        value={kind}
        onChange={(e) => setKind(e.target.value)}
        className="block min-h-11 rounded-control border border-input-border bg-surface px-3 text-base text-ink"
      >
        <option value="form">One-off form</option>
        <option value="intake">Intake form (sent with an invite)</option>
        <option value="checkin">Recurring check-in</option>
      </select>
      {error && (
        <p id={`${id}-err`} role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div>
        <Button type="submit" variant="secondary" disabled={busy}>
          Create template
        </Button>
      </div>
    </form>
  );
}
