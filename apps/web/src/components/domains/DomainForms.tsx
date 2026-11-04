'use client';

import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { call } from '@/lib/checkin-api';

const SELECT =
  'block min-h-11 max-w-full rounded-control border border-input-border bg-surface px-3 text-base text-ink';
const LABEL = 'block text-sm font-medium';

/** Manager: request a custom domain and receive its TXT verification token (PRD L4). */
export function RequestDomainForm() {
  const id = useId();
  const [hostname, setHostname] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const res = await call('POST', '/api/v1/domains', { hostname });
        setBusy(false);
        if (!res.ok) setError(res.message);
        else window.location.reload();
      }}
    >
      <div>
        <label className={LABEL} htmlFor={`${id}-hostname`}>
          Custom domain
        </label>
        <Input
          id={`${id}-hostname`}
          value={hostname}
          onChange={(e) => setHostname(e.target.value)}
          placeholder="coach.example.com"
          required
        />
      </div>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      <Button type="submit" disabled={busy}>
        {busy ? 'Requesting…' : 'Request domain'}
      </Button>
    </form>
  );
}

/** Manager: record that DNS is set (attested, NOT checked — see the L4 note on the page). */
export function VerifyDomainButton({ domainId }: { domainId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <span className="inline-flex flex-col gap-1">
      <Button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const res = await call('POST', `/api/v1/domains/${domainId}/verify`, {});
          setBusy(false);
          if (!res.ok) setError(res.message);
          else window.location.reload();
        }}
      >
        {busy ? 'Marking…' : 'I have set the DNS record'}
      </Button>
      {error && (
        <span role="alert" className="text-danger">
          {error}
        </span>
      )}
    </span>
  );
}

/** Manager: branded sending address on a verified domain (PRD L4). */
export function BrandedSenderForm({ domains }: { domains: { id: string; hostname: string }[] }) {
  const id = useId();
  const [domainId, setDomainId] = useState(domains[0]?.id ?? '');
  const [local, setLocal] = useState('hello');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const res = await call('POST', '/api/v1/domains/sender', {
          domainId,
          brandedFromLocal: local,
        });
        setBusy(false);
        if (!res.ok) setError(res.message);
        else window.location.reload();
      }}
    >
      <div>
        <label className={LABEL} htmlFor={`${id}-domain`}>
          Verified domain
        </label>
        <select
          id={`${id}-domain`}
          className={SELECT}
          value={domainId}
          onChange={(e) => setDomainId(e.target.value)}
          required
        >
          {domains.map((d) => (
            <option key={d.id} value={d.id}>
              {d.hostname}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={LABEL} htmlFor={`${id}-local`}>
          Sending name (before @)
        </label>
        <Input
          id={`${id}-local`}
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          required
        />
      </div>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      <Button type="submit" disabled={busy}>
        {busy ? 'Saving…' : 'Set sending address'}
      </Button>
    </form>
  );
}
