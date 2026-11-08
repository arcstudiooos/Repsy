'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import type { ReplyExpectations, SavedReplyView } from '@repsy/core';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { addSavedReply, removeSavedReply, saveExpectations } from '@/lib/messaging-tools-api';

const TARGETS = [4, 12, 24, 48, 72];

/** Reply expectations clients see (PRD H16) and the workspace's saved replies (PRD H4). */
export function MessagingSection({
  expectations,
  replies,
  canEdit,
}: {
  expectations: ReplyExpectations;
  replies: SavedReplyView[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const id = useId();
  const [target, setTarget] = useState(expectations.replyTargetHours?.toString() ?? '');
  const [hours, setHours] = useState(expectations.officeHours ?? '');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [replyError, setReplyError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Messaging</CardTitle>
        <CardDescription>
          Clients see your usual reply time and office hours on their Messages page.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <form
          noValidate
          aria-label="Reply expectations"
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const res = await saveExpectations({
              replyTargetHours: target ? Number(target) : null,
              officeHours: hours,
            });
            setBusy(false);
            if (!res.ok) {
              toast.error(res.fieldErrors?.officeHours?.[0] ?? res.message);
              return;
            }
            toast.success('Reply expectations saved.');
            router.refresh();
          }}
        >
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-target`} className="text-sm font-medium">
              Usual reply time
            </label>
            <select
              id={`${id}-target`}
              value={target}
              disabled={!canEdit}
              onChange={(e) => setTarget(e.target.value)}
              className="min-h-11 rounded-control border border-input-border bg-surface px-3 text-base text-ink"
            >
              <option value="">Not shown</option>
              {TARGETS.map((h) => (
                <option key={h} value={h}>
                  Within {h} hours
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-hours`} className="text-sm font-medium">
              Office hours
            </label>
            <Input
              id={`${id}-hours`}
              value={hours}
              maxLength={200}
              disabled={!canEdit}
              placeholder="e.g. Mon-Fri 8:00-18:00"
              onChange={(e) => setHours(e.target.value)}
            />
          </div>
          {canEdit ? (
            <div className="sm:col-span-2">
              <Button type="submit" variant="secondary" disabled={busy}>
                Save reply expectations
              </Button>
            </div>
          ) : (
            <p className="text-sm text-secondary sm:col-span-2">Only the owner can change these.</p>
          )}
        </form>

        <section aria-labelledby={`${id}-replies`} className="flex flex-col gap-3">
          <h3 id={`${id}-replies`} className="font-semibold">
            Saved replies
          </h3>
          <p className="text-sm text-secondary">
            Shared with your workspace&apos;s coaches. Insert one from the message box and these
            fill in from the client&apos;s data: <code>{'{first_name}'}</code>,{' '}
            <code>{'{workouts_done}'}</code> and <code>{'{workouts_planned}'}</code> (this week),{' '}
            <code>{'{weight}'}</code>, <code>{'{streak}'}</code> (on-time check-ins) and{' '}
            <code>{'{next_workout}'}</code>. One with no data stays as written. Nothing sends on its
            own.
          </p>
          {replies.length > 0 && (
            <ul className="flex flex-col divide-y divide-divider">
              {replies.map((r) => (
                <li key={r.id} className="flex items-start justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="font-medium break-words">{r.title}</p>
                    <p className="line-clamp-2 text-sm whitespace-pre-line text-secondary">
                      {r.body}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Delete saved reply ${r.title}`}
                    onClick={async () => {
                      const res = await removeSavedReply(r.id);
                      if (!res.ok) toast.error(res.message);
                      else router.refresh();
                    }}
                  >
                    Delete
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <form
            noValidate
            aria-label="New saved reply"
            className="flex flex-col gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const res = await addSavedReply(title, body);
              if (!res.ok) {
                setReplyError(
                  res.fieldErrors?.title?.[0] ?? res.fieldErrors?.body?.[0] ?? res.message,
                );
                return;
              }
              setReplyError(null);
              setTitle('');
              setBody('');
              toast.success('Saved reply added.');
              router.refresh();
            }}
          >
            <label htmlFor={`${id}-title`} className="text-sm font-medium">
              Title
            </label>
            <Input
              id={`${id}-title`}
              value={title}
              maxLength={60}
              onChange={(e) => setTitle(e.target.value)}
            />
            <label htmlFor={`${id}-body`} className="text-sm font-medium">
              Reply
            </label>
            <textarea
              id={`${id}-body`}
              rows={3}
              maxLength={2000}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              aria-invalid={replyError ? true : undefined}
              aria-describedby={replyError ? `${id}-reply-error` : undefined}
              className="rounded-control border border-input-border bg-surface px-3 py-2 text-base"
            />
            {replyError && (
              <p id={`${id}-reply-error`} role="alert" className="text-sm text-danger">
                {replyError}
              </p>
            )}
            <Button type="submit" variant="secondary" className="self-start">
              Add saved reply
            </Button>
          </form>
        </section>
      </CardContent>
    </Card>
  );
}
