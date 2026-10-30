'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { call } from '@/lib/checkin-api';

async function send(method: 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown) {
  // PATCH and DELETE answer 204 with no body.
  if (method !== 'POST') {
    const res = await fetch(path, {
      method,
      credentials: 'same-origin',
      ...(body !== undefined
        ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
        : {}),
    }).catch(() => null);
    if (res?.ok) return { ok: true } as const;
    const json = (await res?.json().catch(() => null)) as { error?: { message?: string } } | null;
    return { ok: false, message: json?.error?.message ?? 'That did not work. Try again.' } as const;
  }
  const res = await call<unknown>(method, path, body ?? {});
  return res.ok
    ? ({ ok: true, data: res.data } as const)
    : ({ ok: false, message: res.message } as const);
}

/** Creates a pilot code and shows it once. */
export function PilotCodeCreator() {
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="secondary"
        className="self-start"
        onClick={async () => {
          setError(null);
          const res = await send('POST', '/api/v1/admin/pilot-codes', { days: 30 });
          if (res.ok) setCode((res.data as { code: string }).code);
          else setError(res.message);
        }}
      >
        Create pilot code (30 days)
      </Button>
      {code && (
        <p role="status">
          New code (shown once): <code className="font-mono font-semibold">{code}</code>
        </p>
      )}
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** Verify, reject (with a reason) or put on legal hold. */
export function DeletionActions({
  id,
  status,
  legalHold,
}: {
  id: string;
  status: string;
  legalHold: boolean;
}) {
  const router = useRouter();
  const uid = useId();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const act = async (body: unknown, done: string) => {
    setError(null);
    const res = await send('PATCH', `/api/v1/admin/deletions/${id}`, body);
    if (res.ok) {
      toast.success(done);
      router.refresh();
    } else setError(res.message);
  };
  const open = status === 'requested' || status === 'verified';
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {status === 'requested' && (
          <Button
            size="sm"
            className="min-h-11"
            onClick={() => void act({ action: 'verify' }, 'Verified: the worker will run it')}
          >
            Verify and run
          </Button>
        )}
        {open && (
          <Button
            size="sm"
            variant="secondary"
            className="min-h-11"
            onClick={() =>
              void act(
                { action: 'hold', on: !legalHold },
                legalHold ? 'Legal hold cleared' : 'Legal hold set',
              )
            }
          >
            {legalHold ? 'Clear legal hold' : 'Set legal hold'}
          </Button>
        )}
      </div>
      {open && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void act({ action: 'reject', reason }, 'Rejected');
          }}
        >
          <div className="flex flex-col gap-1">
            <label htmlFor={`${uid}-reason`} className="text-sm">
              Reject reason
            </label>
            <Input
              id={`${uid}-reason`}
              value={reason}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <Button type="submit" size="sm" variant="ghost" className="min-h-11">
            Reject
          </Button>
        </form>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** Grants 24-hour support access to one client, with a reason. */
export function GrantForm() {
  const router = useRouter();
  const uid = useId();
  const [clientId, setClientId] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        const res = await send('POST', '/api/v1/admin/support-grants', {
          clientId: clientId.trim(),
          reason,
        });
        if (res.ok) {
          toast.success('Access granted for 24 hours');
          router.refresh();
        } else setError(res.message);
      }}
    >
      <label htmlFor={`${uid}-client`} className="text-sm font-medium">
        Client id
      </label>
      <Input id={`${uid}-client`} value={clientId} onChange={(e) => setClientId(e.target.value)} />
      <label htmlFor={`${uid}-why`} className="text-sm font-medium">
        Reason
      </label>
      <Input
        id={`${uid}-why`}
        value={reason}
        maxLength={500}
        onChange={(e) => setReason(e.target.value)}
      />
      <Button type="submit" variant="secondary" className="self-start">
        Grant access (24 hours)
      </Button>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </form>
  );
}

export function RevokeGrant({ id }: { id: string }) {
  const router = useRouter();
  return (
    <Button
      size="sm"
      variant="ghost"
      className="min-h-11"
      onClick={async () => {
        const res = await send('DELETE', `/api/v1/admin/support-grants/${id}`);
        if (res.ok) {
          toast.success('Access revoked');
          router.refresh();
        } else toast.error(res.message);
      }}
    >
      Revoke
    </Button>
  );
}
