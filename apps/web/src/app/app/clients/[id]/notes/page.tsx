import type { Metadata } from 'next';
import { listNotes } from '@kinetic/core';
import { withServerTenant } from '@/server/serverActor';
import { loadClient } from '../data';
import { NotesPanel } from './NotesPanel';

// May block on request data (session, params); opts out of Next instant-navigation validation, see HANDOFF.
export const instant = false;

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
