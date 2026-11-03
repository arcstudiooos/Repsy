'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { AiSettings } from '@kinetic/core';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/components/ui/toast';
import { send } from '@/lib/billing-api';

/**
 * PRD I14 (D-013 #14): the owner's switch for AI drafting. What it does and what it sends are spelled out here,
 * before anyone turns it on.
 */
export function AiSection({ settings, isOwner }: { settings: AiSettings; isOwner: boolean }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(settings.enabled);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    const res = await send('PUT', '/api/v1/ai/settings', { enabled });
    setBusy(false);
    if (res.ok) {
      toast.success(enabled ? 'AI drafting is on' : 'AI drafting is off');
      router.refresh();
    } else toast.error(res.message);
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">AI drafting</CardTitle>
        <CardDescription>
          Off unless you turn it on. Coaches can then ask for a draft program from pasted text or
          from one of your templates, and for highlights of a check-in. Everything it makes is a
          draft you check; nothing is sent to a client.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ul className="list-disc pl-5 text-sm text-secondary">
          <li>
            Sent to the AI provider (Anthropic): the pasted program text, your template&apos;s
            exercises and sets, or a check-in&apos;s questions and answers. Emails, phone numbers,
            links and your clients&apos; names are replaced first (best effort: please don&apos;t
            paste names).
          </li>
          <li>Anthropic does not train on this data.</li>
          <li>
            Lines about injuries, medical topics, medication or supplements are removed from drafts.
          </li>
          <li>
            Up to {settings.dailyCap} requests a day for the workspace ({settings.usedToday} used
            today).
          </li>
        </ul>
        {!settings.available && (
          <p className="text-sm text-secondary">AI drafting isn&apos;t set up on this site yet.</p>
        )}
        {isOwner ? (
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                className="size-5"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              Turn on AI drafting
            </label>
            <Button disabled={busy || enabled === settings.enabled} onClick={() => void save()}>
              Save
            </Button>
          </div>
        ) : (
          <p className="text-sm">
            {settings.enabled ? 'On.' : 'Off.'} Only the owner can change this.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
