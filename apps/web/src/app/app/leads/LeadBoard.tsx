'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import type { LeadStatus, LeadView } from '@repsy/core';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { call } from '@/lib/checkin-api';

const STAGE: Record<LeadStatus, string> = {
  new: 'New',
  contacted: 'Contacted',
  call_booked: 'Call booked',
  won: 'Won',
  lost: 'Lost',
};
const day = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(new Date(iso));

function LeadCard({ lead }: { lead: LeadView }) {
  const router = useRouter();
  const id = useId();
  const [notes, setNotes] = useState(lead.notes);
  const [busy, setBusy] = useState(false);
  async function patch(body: Record<string, string>, done: string) {
    setBusy(true);
    const res = await call('PATCH', `/api/v1/leads/${lead.id}`, body);
    setBusy(false);
    if (res.ok) {
      toast.success(done);
      router.refresh();
    } else toast.error(res.message);
  }
  async function convert() {
    setBusy(true);
    const res = await call<{ clientId: string }>('POST', `/api/v1/leads/${lead.id}/convert`, {});
    setBusy(false);
    if (res.ok) {
      toast.success(`${lead.name} is now a client and has been invited`);
      router.refresh();
    } else toast.error(res.message);
  }
  return (
    <li className="flex flex-col gap-2 rounded-card bg-surface p-4 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold">{lead.name}</p>
          <p className="text-sm break-all text-secondary">
            {lead.email}
            {lead.phone && ` · ${lead.phone}`} · applied {day(lead.createdAt)}
          </p>
        </div>
        <label htmlFor={`${id}-stage`} className="sr-only">
          Stage for {lead.name}
        </label>
        <select
          id={`${id}-stage`}
          value={lead.status}
          disabled={busy}
          onChange={(e) => void patch({ status: e.target.value }, 'Stage changed')}
          className="block min-h-11 rounded-control border border-input-border bg-surface px-3 text-base text-ink"
        >
          {(Object.keys(STAGE) as LeadStatus[]).map((s) => (
            <option key={s} value={s}>
              {STAGE[s]}
            </option>
          ))}
        </select>
      </div>
      {lead.message && <p className="whitespace-pre-line">{lead.message}</p>}
      <label htmlFor={`${id}-notes`} className="text-sm font-medium">
        Notes on {lead.name}
      </label>
      <textarea
        id={`${id}-notes`}
        rows={2}
        value={notes}
        maxLength={4000}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={() => notes !== lead.notes && void patch({ notes }, 'Notes saved')}
        className="rounded-control border border-input-border bg-surface px-3 py-2 text-base"
      />
      {!lead.convertedClientId ? (
        <div>
          <Button
            size="sm"
            disabled={busy}
            aria-label={`Convert to client: ${lead.name}`}
            onClick={() => void convert()}
          >
            Convert to client
          </Button>
        </div>
      ) : (
        <p className="text-sm text-secondary">Now a client.</p>
      )}
    </li>
  );
}

/** PRD B16: the lead pipeline, by stage. */
export function LeadBoard({ leads }: { leads: LeadView[] }) {
  return (
    <div className="flex flex-col gap-6">
      {(Object.keys(STAGE) as LeadStatus[]).map((s) => {
        const items = leads.filter((l) => l.status === s);
        if (items.length === 0) return null;
        return (
          <section key={s} aria-labelledby={`stage-${s}`} className="flex flex-col gap-3">
            <h2 id={`stage-${s}`} className="text-lg font-semibold">
              {STAGE[s]} ({items.length})
            </h2>
            <ul className="flex flex-col gap-3">
              {items.map((l) => (
                <LeadCard key={l.id} lead={l} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
