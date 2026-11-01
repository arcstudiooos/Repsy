'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { call } from '@/lib/checkin-api';

/** PRD F2: send a one-off (or intake) form from the library; open for 7 days. */
export function SendForm({
  clientId,
  forms,
}: {
  clientId: string;
  forms: { id: string; title: string }[];
}) {
  const router = useRouter();
  const id = useId();
  const [form, setForm] = useState(forms[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  if (forms.length === 0) {
    return (
      <p className="text-sm text-secondary">
        Need a one-off questionnaire?{' '}
        <Link href="/app/check-ins" className="text-accent underline">
          Make a form
        </Link>
        .
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        Send a form
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <select
          id={id}
          value={form}
          onChange={(e) => setForm(e.target.value)}
          className="block min-h-11 rounded-control border border-input-border bg-surface px-3 text-base text-ink"
        >
          {forms.map((f) => (
            <option key={f.id} value={f.id}>
              {f.title}
            </option>
          ))}
        </select>
        <Button
          variant="secondary"
          disabled={busy || !form}
          onClick={async () => {
            setBusy(true);
            const res = await call('POST', `/api/v1/clients/${clientId}/forms`, {
              templateId: form,
            });
            setBusy(false);
            if (res.ok) {
              toast.success('Form sent');
              router.refresh();
            } else toast.error(res.message);
          }}
        >
          Send form
        </Button>
      </div>
      <p className="text-sm text-secondary">
        Open for 7 days. Clients who have joined get an email.
      </p>
    </div>
  );
}
