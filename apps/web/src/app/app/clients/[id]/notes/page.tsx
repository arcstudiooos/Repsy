import type { Metadata } from 'next';
import { listNotes } from '@repsy/core';
import { withServerTenant } from '@/server/serverActor';
import { loadClient } from '../data';
import { NotesPanel } from './NotesPanel';

export const metadata: Metadata = { title: 'Notes | Repsy' };

export default async function ClientNotesPage({ params }: { params: Promise<{ id: string }> }) {
  const client = await loadClient((await params).id);
  const notes = await withServerTenant((tx, actor) => listNotes(tx, actor, client.id));
  return (
    <NotesPanel
      key={notes.map((n) => `${n.id}:${n.updatedAt}`).join(',')}
      clientId={client.id}
      notes={notes}
    />
  );
}
