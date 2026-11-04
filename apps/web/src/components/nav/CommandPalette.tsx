'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { Command } from 'cmdk';
import { Dumbbell, Search, User } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { coachDesktopItems, coachSettingsItem } from './items';

interface Hit {
  id: string;
  label: string;
  href: string;
  kind: 'client' | 'program';
}

/**
 * ⌘K / Ctrl+K for coaches (plan §4.1): jump to a page, a client or a program. Clients and programs come from the
 * existing list APIs (tenant-scoped, the same results the Clients and Programs pages show).
 */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const term = q.trim();
    if (!open || term.length < 2) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      const get = async (url: string) => {
        const r = await fetch(url, {
          signal: ctrl.signal,
          headers: { accept: 'application/json' },
        });
        if (!r.ok) return [];
        const body = (await r.json()) as {
          data?: Array<{ id: string; name?: string; title?: string }>;
        };
        return body.data ?? [];
      };
      try {
        const [clients, programs] = await Promise.all([
          get(`/api/v1/clients?q=${encodeURIComponent(term)}`),
          get(`/api/v1/programs?q=${encodeURIComponent(term)}`),
        ]);
        setHits([
          ...clients
            .slice(0, 6)
            .map((c) => ({
              id: c.id,
              label: c.name ?? '',
              href: `/app/clients/${c.id}`,
              kind: 'client' as const,
            })),
          ...programs
            .slice(0, 6)
            .map((p) => ({
              id: p.id,
              label: p.title ?? '',
              href: `/app/programs/${p.id}/edit`,
              kind: 'program' as const,
            })),
        ]);
      } catch {
        // Aborted or offline: keep the page results only.
      }
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, open]);

  const go = (href: string) => {
    setOpen(false);
    setQ('');
    router.push(href);
  };
  const pages = [...coachDesktopItems, coachSettingsItem];
  const shown = q.trim().length < 2 ? [] : hits;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-10 w-full items-center gap-2 rounded-md bg-midnight-2 px-3 text-sm text-on-midnight-muted transition-colors hover:text-on-midnight"
      >
        <Search aria-hidden className="size-4" />
        <span className="flex-1 text-left">Search</span>
        <kbd className="rounded-sm border border-white/15 px-1.5 text-micro">⌘K</kbd>
      </button>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-midnight/50 backdrop-blur-[2px]" />
          <Dialog.Content
            aria-describedby={undefined}
            className="fixed top-[12vh] left-1/2 z-50 w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-surface text-ink shadow-e2"
          >
            <Dialog.Title className="sr-only">Search Repsy</Dialog.Title>
            <Command label="Search Repsy" shouldFilter={false}>
              <div className="flex items-center gap-2 border-b border-border px-4">
                <Search aria-hidden className="size-4 text-secondary" />
                <Command.Input
                  value={q}
                  onValueChange={setQ}
                  placeholder="Jump to a page, client or program"
                  className="min-h-14 flex-1 bg-transparent text-base outline-none placeholder:text-secondary"
                />
              </div>
              <Command.List className="max-h-[60vh] overflow-y-auto p-2">
                <Command.Empty className="px-3 py-6 text-center text-sm text-secondary">
                  Nothing matches.
                </Command.Empty>
                {shown.length > 0 && (
                  <Command.Group
                    heading="Clients and programs"
                    className="[&_[cmdk-group-heading]]:label-micro [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-secondary"
                  >
                    {shown.map((h) => (
                      <Command.Item
                        key={`${h.kind}-${h.id}`}
                        value={`${h.kind}-${h.id}`}
                        onSelect={() => go(h.href)}
                        className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-3 text-base data-[selected=true]:bg-surface-2"
                      >
                        {h.kind === 'client' ? (
                          <User aria-hidden className="size-4 text-secondary" />
                        ) : (
                          <Dumbbell aria-hidden className="size-4 text-secondary" />
                        )}
                        {h.label}
                        <span className="ml-auto text-caption text-secondary">
                          {h.kind === 'client' ? 'Client' : 'Program'}
                        </span>
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}
                <Command.Group
                  heading="Pages"
                  className="[&_[cmdk-group-heading]]:label-micro [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-secondary"
                >
                  {pages
                    .filter((p) => p.label.toLowerCase().includes(q.trim().toLowerCase()))
                    .map((p) => (
                      <Command.Item
                        key={p.href}
                        value={p.href}
                        onSelect={() => go(p.href)}
                        className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-3 text-base data-[selected=true]:bg-surface-2"
                      >
                        <p.icon aria-hidden className="size-4 text-secondary" />
                        {p.label}
                      </Command.Item>
                    ))}
                </Command.Group>
              </Command.List>
            </Command>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
