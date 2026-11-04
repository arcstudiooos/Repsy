'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/components/ui/toast';
import { call } from '@/lib/checkin-api';

type State =
  | { kind: 'loading' }
  | { kind: 'off-platform' }
  | { kind: 'unsupported' }
  | { kind: 'blocked' }
  | { kind: 'ready'; publicKey: string; subscribed: boolean };

const keyBytes = (b64url: string) => {
  const s = atob(b64url.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  return navigator.serviceWorker.getRegistration('/portal').then((r) => r ?? null);
}

/**
 * PRD H11: notifications on this device, through the portal's service worker. They say only that something is new
 * (never what): messages and replies, and the reminders turned on above. Hidden while push is off on the server.
 */
export function PushToggle() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      const reg = await registration();
      const sub = await reg?.pushManager?.getSubscription().catch(() => null);
      const qs = sub ? `?${new URLSearchParams({ endpoint: sub.endpoint })}` : '';
      const res = await fetch(`/api/v1/push${qs}`, { credentials: 'same-origin' }).catch(
        () => null,
      );
      const data = res?.ok
        ? ((await res.json()) as { data: { publicKey: string | null; subscribed: boolean } }).data
        : null;
      if (!live) return;
      if (!data?.publicKey) return setState({ kind: 'off-platform' });
      if (!reg || !('PushManager' in window) || typeof Notification === 'undefined') {
        return setState({ kind: 'unsupported' });
      }
      if (Notification.permission === 'denied') return setState({ kind: 'blocked' });
      setState({ kind: 'ready', publicKey: data.publicKey, subscribed: data.subscribed });
    })();
    return () => {
      live = false;
    };
  }, []);

  if (state.kind === 'loading' || state.kind === 'off-platform') return null;

  async function turnOn(publicKey: string) {
    setBusy(true);
    try {
      if ((await Notification.requestPermission()) !== 'granted') {
        setState({ kind: 'blocked' });
        return;
      }
      const reg = await registration();
      if (!reg) throw new Error('no worker');
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes(publicKey),
        }));
      const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      const res = await call('POST', '/api/v1/push/subscriptions', {
        endpoint: json.endpoint,
        keys: json.keys,
      });
      if (!res.ok) throw new Error(res.message);
      setState({ kind: 'ready', publicKey, subscribed: true });
      toast.success('Notifications on for this device');
    } catch {
      toast.error("Couldn't turn notifications on. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function turnOff(publicKey: string) {
    setBusy(true);
    const reg = await registration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await call('POST', '/api/v1/push/unsubscribe', { endpoint: sub.endpoint });
      await sub.unsubscribe().catch(() => false);
    }
    setBusy(false);
    setState({ kind: 'ready', publicKey, subscribed: false });
    toast.success('Notifications off for this device');
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Notifications on this device</CardTitle>
        <CardDescription>
          A notice when your coach messages you, and the reminders you turned on. It never shows
          what the message says.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {state.kind === 'unsupported' ? (
          <p className="text-secondary">
            This browser can&apos;t show notifications. On iPhone, add Repsy to your home screen
            first.
          </p>
        ) : state.kind === 'blocked' ? (
          <p className="text-secondary">
            Notifications are blocked for Repsy in this browser&apos;s settings.
          </p>
        ) : state.subscribed ? (
          <Button variant="secondary" disabled={busy} onClick={() => void turnOff(state.publicKey)}>
            Turn off notifications
          </Button>
        ) : (
          <Button disabled={busy} onClick={() => void turnOn(state.publicKey)}>
            Turn on notifications
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
