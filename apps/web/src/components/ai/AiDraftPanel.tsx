'use client';

import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { send } from '@/lib/billing-api';

export interface AiDraftResult {
  text: string;
  note: string | null;
  redactions: number;
}

/**
 * PRD I10, I11 (D-013 #14): ask for a draft, either by tidying the text in the box below or by adapting one of
 * your templates. The draft lands in the import box for the usual review; nothing is saved until you save it.
 */
export function AiDraftPanel({
  templates,
  units,
  pasted,
  onDraft,
}: {
  templates: { id: string; title: string }[];
  units: 'kg' | 'lb';
  pasted: string;
  onDraft: (d: AiDraftResult) => void;
}) {
  const uid = useId();
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? '');
  const [request, setRequest] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask(path: string, body: unknown) {
    setBusy(true);
    setError(null);
    const res = await send<AiDraftResult>('POST', path, body);
    setBusy(false);
    if (res.ok && res.data) onDraft(res.data);
    else if (!res.ok) setError(res.message);
  }

  return (
    <section
      aria-labelledby={`${uid}-h`}
      className="rounded-card border border-input-border bg-surface p-4 md:p-6"
    >
      <h2 id={`${uid}-h`} className="mb-1 text-lg font-semibold">
        Draft with AI
      </h2>
      <p className="mb-4 text-sm text-secondary">
        A starting point you check line by line. Leave client names out of what you paste: contact
        details and your clients&apos; names are replaced before sending, and lines that look like
        injury, medical or supplement advice are removed from the draft.
      </p>
      <div className="flex flex-col gap-4">
        <div>
          <Button
            variant="secondary"
            disabled={busy || pasted.trim().length === 0}
            onClick={() => void ask('/api/v1/ai/program-from-text', { text: pasted, units })}
          >
            Tidy the pasted text into a draft
          </Button>
          {pasted.trim().length === 0 && (
            <p className="mt-1 text-sm text-secondary">Paste a program in the box below first.</p>
          )}
        </div>
        {templates.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
            <div className="flex flex-col gap-1">
              <label htmlFor={`${uid}-tpl`} className="text-sm font-medium">
                Like my template
              </label>
              <select
                id={`${uid}-tpl`}
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
                className="min-h-11 rounded-control border border-input-border bg-surface px-3 text-base"
              >
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={`${uid}-req`} className="text-sm font-medium">
                But
              </label>
              <input
                id={`${uid}-req`}
                value={request}
                maxLength={500}
                placeholder="4 days, dumbbells only, 6 weeks"
                onChange={(e) => setRequest(e.target.value)}
                className="min-h-11 rounded-control border border-input-border bg-surface px-3 text-base"
              />
            </div>
            <Button
              variant="secondary"
              disabled={busy || !templateId || request.trim().length < 3}
              onClick={() =>
                void ask('/api/v1/ai/program-from-template', { templateId, request, units })
              }
            >
              Draft it
            </Button>
          </div>
        )}
        {busy && (
          <p role="status" className="text-sm text-secondary">
            Drafting… this can take up to a minute.
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
