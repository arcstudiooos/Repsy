'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { call } from '@/lib/checkin-api';

const SELECT = 'min-h-11 rounded-control border border-input-border bg-surface px-3 text-base';

/** Share a link or a short text with all clients, a tag or one client (PRD G5). */
export function NewResourceForm({
  tags,
  clients,
}: {
  tags: { id: string; name: string }[];
  clients: { id: string; name: string }[];
}) {
  const router = useRouter();
  const id = useId();
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<'all' | 'tag' | 'client'>('all');
  const [tagId, setTagId] = useState(tags[0]?.id ?? '');
  const [clientId, setClientId] = useState(clients[0]?.id ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    const res = await call('POST', '/api/v1/resources', {
      title,
      ...(url.trim() ? { url: url.trim() } : {}),
      ...(body.trim() ? { body } : {}),
      audience,
      ...(audience === 'tag' ? { tagId } : {}),
      ...(audience === 'client' ? { clientId } : {}),
    });
    setBusy(false);
    if (!res.ok) {
      const fe = res.fieldErrors ?? {};
      setErrors(Object.fromEntries(Object.entries(fe).map(([k, v]) => [k, v[0] ?? ''])));
      if (Object.keys(fe).length === 0) toast.error(res.message);
      return;
    }
    toast.success('Resource shared.');
    setTitle('');
    setUrl('');
    setBody('');
    router.refresh();
  }

  const err = (k: string) =>
    errors[k] ? (
      <p id={`${id}-${k}-err`} className="text-sm text-danger">
        {errors[k]}
      </p>
    ) : null;
  const desc = (k: string) => (errors[k] ? `${id}-${k}-err` : undefined);

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-label="Share a resource"
      className="grid gap-3 sm:grid-cols-2"
    >
      <div className="flex flex-col gap-1 sm:col-span-2">
        <label htmlFor={`${id}-title`} className="text-sm font-medium">
          Title
        </label>
        <Input
          id={`${id}-title`}
          value={title}
          maxLength={120}
          onChange={(e) => setTitle(e.target.value)}
          aria-invalid={errors.title ? true : undefined}
          aria-describedby={desc('title')}
        />
        {err('title')}
      </div>
      <div className="flex flex-col gap-1 sm:col-span-2">
        <label htmlFor={`${id}-url`} className="text-sm font-medium">
          Link (https, optional)
        </label>
        <Input
          id={`${id}-url`}
          type="url"
          inputMode="url"
          value={url}
          placeholder="https://"
          onChange={(e) => setUrl(e.target.value)}
          aria-invalid={errors.url ? true : undefined}
          aria-describedby={desc('url')}
        />
        {err('url')}
      </div>
      <div className="flex flex-col gap-1 sm:col-span-2">
        <label htmlFor={`${id}-body`} className="text-sm font-medium">
          Text (optional)
        </label>
        <textarea
          id={`${id}-body`}
          value={body}
          rows={3}
          maxLength={4000}
          onChange={(e) => setBody(e.target.value)}
          aria-invalid={errors.body ? true : undefined}
          aria-describedby={desc('body')}
          className="w-full rounded-control border border-input-border bg-surface p-3 text-base"
        />
        {err('body')}
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-aud`} className="text-sm font-medium">
          Share with
        </label>
        <select
          id={`${id}-aud`}
          value={audience}
          onChange={(e) => setAudience(e.target.value as 'all' | 'tag' | 'client')}
          className={SELECT}
        >
          <option value="all">All clients</option>
          <option value="tag" disabled={tags.length === 0}>
            A tag{tags.length === 0 ? ' (none yet)' : ''}
          </option>
          <option value="client" disabled={clients.length === 0}>
            One client
          </option>
        </select>
      </div>
      {audience === 'tag' && (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-tag`} className="text-sm font-medium">
            Tag
          </label>
          <select
            id={`${id}-tag`}
            value={tagId}
            onChange={(e) => setTagId(e.target.value)}
            className={SELECT}
          >
            {tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {audience === 'client' && (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-client`} className="text-sm font-medium">
            Client
          </label>
          <select
            id={`${id}-client`}
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            className={SELECT}
          >
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="sm:col-span-2">
        <Button type="submit" disabled={busy}>
          {busy ? 'Sharing…' : 'Share resource'}
        </Button>
      </div>
    </form>
  );
}
