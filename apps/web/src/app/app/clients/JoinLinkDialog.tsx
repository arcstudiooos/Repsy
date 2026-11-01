'use client';

import { useCallback, useId, useState } from 'react';
import type { JoinLinkView } from '@kinetic/core';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { call } from '@/lib/checkin-api';

const fmt = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(new Date(iso));

/**
 * PRD B3: a reusable sign-up link for in-person sign-ups, capped and revocable. The link is shown once, right after
 * it is made (only its hash is stored); people who use it get the usual invite email.
 */
export function JoinLinkDialog() {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [links, setLinks] = useState<JoinLinkView[] | null>(null);
  const [maxUses, setMaxUses] = useState(25);
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/v1/join-links', { credentials: 'same-origin' });
    if (res.ok) setLinks(((await res.json()) as { data: JoinLinkView[] }).data);
  }, []);

  async function create() {
    setBusy(true);
    const res = await call<JoinLinkView & { token: string }>('POST', '/api/v1/join-links', {
      maxUses,
    });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    setFresh(`${window.location.origin}/join/${res.data.token}`);
    void load();
  }

  async function revoke(link: JoinLinkView) {
    const res = await fetch(`/api/v1/join-links/${link.id}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    });
    if (res.ok) {
      toast.success('Link turned off');
      void load();
    } else toast.error("Couldn't turn the link off. Try again.");
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) void load();
        else setFresh(null);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary">Invite link</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sign-up link</DialogTitle>
          <DialogDescription>
            Share one link (at the gym, on a poster). Each person enters their name and email and
            gets their own invite email. Links last 30 days.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {fresh ? (
            <div className="flex flex-col gap-2">
              <label htmlFor={`${id}-link`} className="text-sm font-medium">
                Your new link (copy it now; it isn&apos;t shown again)
              </label>
              <Input id={`${id}-link`} readOnly value={fresh} onFocus={(e) => e.target.select()} />
              <div>
                <Button
                  type="button"
                  onClick={() =>
                    void navigator.clipboard
                      ?.writeText(fresh)
                      .then(() => toast.success('Link copied'))
                      .catch(() => toast.error('Select the link and copy it.'))
                  }
                >
                  Copy link
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1">
                <label htmlFor={`${id}-max`} className="text-sm font-medium">
                  Up to
                </label>
                <select
                  id={`${id}-max`}
                  value={maxUses}
                  onChange={(e) => setMaxUses(Number(e.target.value))}
                  className="block min-h-11 rounded-control border border-input-border bg-surface px-3 text-base text-ink"
                >
                  {[10, 25, 50, 100].map((n) => (
                    <option key={n} value={n}>
                      {n} sign-ups
                    </option>
                  ))}
                </select>
              </div>
              <Button type="button" disabled={busy} onClick={() => void create()}>
                Make a link
              </Button>
            </div>
          )}
          {links && links.length > 0 && (
            <ul aria-label="Sign-up links" className="flex flex-col divide-y divide-divider">
              {links.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="text-sm">
                    Made {fmt(l.createdAt)} · {l.uses} of {l.maxUses} used ·{' '}
                    {l.active ? `until ${fmt(l.expiresAt)}` : 'closed'}
                  </span>
                  {l.active && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Turn off the link made ${fmt(l.createdAt)}`}
                      onClick={() => void revoke(l)}
                    >
                      Turn off
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
