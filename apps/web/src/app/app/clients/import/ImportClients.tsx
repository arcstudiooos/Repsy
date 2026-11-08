'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useState, type ChangeEvent } from 'react';
import type { ImportResult } from '@repsy/core';
import { Button } from '@/components/ui/button';
import { call } from '@/lib/checkin-api';
import { parseRoster, type ColumnMapping, type RosterRow } from '@/lib/csv-import';

const MAX_ROWS = 500;
const MAX_FILE_BYTES = 1_048_576;

const FIELD_LABEL = {
  name: 'Name',
  email: 'Email',
  goals: 'Goals',
  timezone: 'Time zone',
  units: 'Units',
} as const;

export function ImportClients() {
  const router = useRouter();
  const textId = useId();
  const fileId = useId();
  const [text, setText] = useState('');
  const [rows, setRows] = useState<RosterRow[] | null>(null);
  const [columns, setColumns] = useState<Partial<Record<keyof typeof FIELD_LABEL, string>>>({});
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [done, setDone] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // PRD M4: the file's headers, and the coach's own choice of column per field.
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const mapId = useId();

  function reset() {
    setRows(null);
    setPreview(null);
    setDone(null);
    setError(null);
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    reset();
    if (file.size > MAX_FILE_BYTES) {
      setError('That file is over 1 MB. Split it into smaller files.');
      return;
    }
    setHeaders([]);
    setMapping({});
    setText(await file.text());
  }

  async function check() {
    reset();
    const parsed = parseRoster(text, mapping);
    setHeaders(parsed.headers);
    setColumns(parsed.columns);
    if (parsed.error) {
      setError(parsed.error);
      return;
    }
    if (parsed.rows.length > MAX_ROWS) {
      setError(`The file has ${parsed.rows.length} clients. Import at most ${MAX_ROWS} at a time.`);
      return;
    }
    setBusy(true);
    const res = await call<ImportResult>('POST', '/api/v1/clients/import', {
      rows: parsed.rows,
      dryRun: true,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setRows(parsed.rows);
    setColumns(parsed.columns);
    setPreview(res.data);
  }

  async function runImport() {
    if (!rows) return;
    setBusy(true);
    const res = await call<ImportResult>('POST', '/api/v1/clients/import', { rows });
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setDone(res.data);
    setPreview(null);
    router.refresh();
  }

  const shown = done ?? preview;

  return (
    <div className="space-y-6">
      <section
        aria-labelledby="source-heading"
        className="rounded-card bg-surface p-4 shadow-card md:p-6"
      >
        <h2 id="source-heading" className="mb-4 text-lg font-semibold">
          Your file
        </h2>
        <div className="mb-4">
          <label htmlFor={fileId} className="mb-1 block text-sm font-medium">
            Upload a CSV file
          </label>
          <input
            id={fileId}
            type="file"
            accept=".csv,.tsv,.txt,text/csv,text/plain"
            onChange={onFile}
            className="block w-full max-w-full text-base file:mr-3 file:min-h-11 file:rounded-control file:border file:border-input-border file:bg-surface file:px-4 file:text-base"
          />
        </div>
        <label htmlFor={textId} className="mb-1 block text-sm font-medium">
          Or paste it here
        </label>
        <textarea
          id={textId}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setHeaders([]);
            setMapping({});
            reset();
          }}
          rows={8}
          spellCheck={false}
          placeholder={'Name,Email,Goals\nAna Silva,ana@example.com,Run a 10k'}
          className="w-full rounded-control border border-input-border bg-surface p-3 font-mono text-sm"
        />
        <p className="mt-2 text-sm text-secondary">
          Exported from another app? Most columns are matched by name.{' '}
          <a href="/templates/repsy-clients.csv" download className="text-accent underline">
            Download a CSV template
          </a>
          , or{' '}
          <Link href="/app/support?topic=migration" className="text-accent underline">
            ask us to move your clients and programs for you
          </Link>
          .
        </p>
        {error && (
          <p role="alert" className="mt-2 text-danger">
            {error}
          </p>
        )}
        {headers.length > 0 && (
          <fieldset className="mt-4 rounded-card border border-divider p-3">
            <legend className="px-1 text-sm font-medium">Match your columns</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {(Object.keys(FIELD_LABEL) as (keyof typeof FIELD_LABEL)[]).map((f) => {
                const current = mapping[f] ?? headers.indexOf(columns[f] ?? '');
                return (
                  <div key={f} className="flex flex-col gap-1">
                    <label htmlFor={`${mapId}-${f}`} className="text-sm">
                      {FIELD_LABEL[f]}
                      {f === 'name' || f === 'email' ? '' : ' (optional)'}
                    </label>
                    <select
                      id={`${mapId}-${f}`}
                      value={mapping[f] === null || current < 0 ? '' : String(current)}
                      onChange={(e) => {
                        const v = e.target.value;
                        setMapping((m) => ({ ...m, [f]: v === '' ? null : Number(v) }));
                        setPreview(null);
                        setRows(null);
                      }}
                      className="block min-h-11 rounded-control border border-input-border bg-surface px-3 text-base text-ink"
                    >
                      <option value="">Not in this file</option>
                      {headers.map((h, i) => (
                        <option key={`${i}-${h}`} value={i}>
                          {h || `Column ${i + 1}`}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
          </fieldset>
        )}
        <div className="mt-4 flex flex-wrap gap-3">
          <Button onClick={check} disabled={busy || text.trim() === ''}>
            {busy && !preview ? 'Checking…' : 'Check file'}
          </Button>
          <Button asChild variant="secondary">
            <Link href="/app/clients">Cancel</Link>
          </Button>
        </div>
      </section>

      {shown && (
        <section aria-labelledby="preview-heading" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="preview-heading" className="text-lg font-semibold">
              {done ? 'Import finished' : 'Preview'}
            </h2>
            {preview && preview.created > 0 && (
              <Button onClick={runImport} disabled={busy}>
                {busy
                  ? 'Importing…'
                  : `Import ${preview.created} ${preview.created === 1 ? 'client' : 'clients'}`}
              </Button>
            )}
            {done && (
              <Button asChild variant="secondary">
                <Link href="/app/clients">Go to clients</Link>
              </Button>
            )}
          </div>
          <p role="status" className="text-secondary">
            {done
              ? `Imported ${done.created} ${done.created === 1 ? 'client' : 'clients'}.`
              : `${preview!.created} ready to import.`}
            {shown.skipped > 0 &&
              ` ${shown.skipped} ${shown.skipped === 1 ? 'row' : 'rows'} ${done ? 'skipped' : 'will be skipped'}: fix ${shown.skipped === 1 ? 'it' : 'them'} in your file and import again.`}
          </p>
          {!done && (
            <p className="text-sm text-secondary">
              Columns used:{' '}
              {(Object.keys(FIELD_LABEL) as (keyof typeof FIELD_LABEL)[])
                .filter((f) => columns[f])
                .map((f) => `${FIELD_LABEL[f]} ← “${columns[f]}”`)
                .join(', ')}
            </p>
          )}
          <div
            role="region"
            aria-labelledby="preview-heading"
            tabIndex={0}
            className="overflow-x-auto rounded-card bg-surface shadow-card"
          >
            <table className="w-full text-left text-base">
              <thead className="border-b border-divider text-sm text-secondary">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Line
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Name
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Email
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Result
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.rows.map((r) => (
                  <tr key={r.row} className="border-b border-divider last:border-0">
                    <td className="px-4 py-3 tabular-nums">{r.row + 1}</td>
                    <td className="px-4 py-3 break-words">{r.name || '–'}</td>
                    <td className="px-4 py-3 break-all">{r.email || '–'}</td>
                    <td className={`px-4 py-3 ${r.ok ? '' : 'text-danger'}`}>
                      {r.ok ? (
                        r.clientId ? (
                          <Link
                            href={`/app/clients/${r.clientId}`}
                            className="text-accent underline"
                          >
                            Imported
                          </Link>
                        ) : (
                          'Ready'
                        )
                      ) : (
                        `Skipped: ${r.error}`
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
