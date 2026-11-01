'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/components/ui/toast';

interface DeviceSession {
  id: string;
  current: boolean;
  device: string;
  createdAt: string;
  lastActiveAt: string;
}

const fmt = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));

async function fetchSessions(): Promise<DeviceSession[] | null> {
  try {
    const res = await fetch('/api/v1/me/sessions', { credentials: 'same-origin' });
    if (!res.ok) return null;
    return ((await res.json()) as { data: DeviceSession[] }).data;
  } catch {
    return null;
  }
}

/** Signed-in devices (PRD A9): sign out one, or every other device at once. This session stays. */
export function SecuritySection() {
  const [busy, setBusy] = useState(false);
  const [sessions, setSessions] = useState<DeviceSession[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    const data = await fetchSessions();
    setSessions(data);
    setLoadError(data === null);
  }, []);

  useEffect(() => {
    let alive = true;
    void fetchSessions().then((data) => {
      if (!alive) return;
      setSessions(data);
      setLoadError(data === null);
    });
    return () => {
      alive = false;
    };
  }, []);

  async function revokeAll() {
    setBusy(true);
    try {
      const res = await fetch('/api/v1/sessions/revoke-all', {
        method: 'POST',
        credentials: 'same-origin',
      });
      if (res.ok) toast.success('Signed out of all other devices');
      else toast.error("Couldn't sign out other devices. Try again.");
    } catch {
      toast.error('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
      void load();
    }
  }

  async function revokeOne(s: DeviceSession) {
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/me/sessions/${encodeURIComponent(s.id)}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      if (res.ok) toast.success(`Signed out ${s.device}`);
      else toast.error("Couldn't sign out that device. Try again.");
    } catch {
      toast.error('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
      void load();
    }
  }

  const others = sessions?.filter((s) => !s.current) ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Security</CardTitle>
        <CardDescription>
          Devices signed in to your account. Sign out any you don&apos;t recognise, or everywhere
          else if you lost a device or used a shared one. This device stays signed in.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {loadError && <p className="text-secondary">Couldn&apos;t load your devices.</p>}
        {sessions && (
          <ul className="flex flex-col divide-y divide-divider" aria-label="Signed-in devices">
            {sessions.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <span className="font-medium">{s.device}</span>
                  {s.current && <span className="ml-2 text-sm text-secondary">(this device)</span>}
                  <span className="block text-sm text-secondary">
                    Last active {fmt(s.lastActiveAt)} · signed in {fmt(s.createdAt)}
                  </span>
                </span>
                {!s.current && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => void revokeOne(s)}
                    aria-label={`Sign out ${s.device}, last active ${fmt(s.lastActiveAt)}`}
                  >
                    Sign out
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        <div>
          <Button
            type="button"
            variant="secondary"
            disabled={busy || (sessions !== null && others.length === 0)}
            onClick={() => void revokeAll()}
          >
            {busy ? 'Signing out...' : 'Sign out of all other devices'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
