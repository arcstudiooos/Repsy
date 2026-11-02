'use client';

import { useActionState, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { applyAction, type LeadState } from './actions';

/** PRD B15: the application form on a coach's public page. `website` is a honeypot people never see. */
export function ApplyForm({ slug, orgName }: { slug: string; orgName: string }) {
  const id = useId();
  const [loadedAt] = useState(() => Date.now());
  const [state, action, pending] = useActionState<LeadState, FormData>(applyAction, {});
  if (state.status === 'sent') {
    return (
      <p role="status" className="text-base">
        Thanks! {orgName} has your application and will be in touch by email.
      </p>
    );
  }
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="loadedAt" value={loadedAt} />
      <div className="absolute -left-[9999px]" aria-hidden>
        <label htmlFor={`${id}-website`}>Website</label>
        <input id={`${id}-website`} name="website" tabIndex={-1} autoComplete="off" />
      </div>
      <label htmlFor={`${id}-name`} className="text-sm font-medium">
        Your name
      </label>
      <Input
        id={`${id}-name`}
        name="name"
        autoComplete="name"
        aria-invalid={fe.name ? true : undefined}
      />
      {fe.name && <p className="text-sm text-danger">{fe.name}</p>}
      <label htmlFor={`${id}-email`} className="text-sm font-medium">
        Email
      </label>
      <Input
        id={`${id}-email`}
        name="email"
        type="email"
        autoComplete="email"
        aria-invalid={fe.email ? true : undefined}
      />
      {fe.email && <p className="text-sm text-danger">{fe.email}</p>}
      <label htmlFor={`${id}-phone`} className="text-sm font-medium">
        Phone (optional)
      </label>
      <Input id={`${id}-phone`} name="phone" type="tel" autoComplete="tel" />
      <label htmlFor={`${id}-message`} className="text-sm font-medium">
        What would you like help with?
      </label>
      <textarea
        id={`${id}-message`}
        name="message"
        rows={4}
        maxLength={4000}
        className="rounded-control border border-input-border bg-surface px-3 py-2 text-base"
      />
      {fe.form && (
        <p role="alert" className="text-danger">
          {fe.form}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? 'Sending…' : 'Apply'}
      </Button>
      <p className="text-sm text-secondary">Your details go only to {orgName}.</p>
    </form>
  );
}
