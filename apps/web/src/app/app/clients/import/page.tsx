import type { Metadata } from 'next';
import { Breadcrumbs } from '@/components/nav/Breadcrumbs';
import { ImportClients } from './ImportClients';

// May block on request data (session, params); opts out of Next instant-navigation validation, see HANDOFF.
export const instant = false;

export const metadata: Metadata = { title: 'Import clients | Kinetic' };

/** Bring a roster over from another platform (PRD B17). */
export default function ImportClientsPage() {
  return (
    <>
      <Breadcrumbs items={[{ label: 'Clients', href: '/app/clients' }, { label: 'Import' }]} />
      <h1 className="mb-2 text-2xl font-semibold md:text-3xl">Import clients</h1>
      <p className="mb-6 max-w-prose text-secondary">
        Upload or paste a CSV exported from another coaching app or a spreadsheet. It needs a Name
        (or First and Last name) and an Email column. Goals, Time zone and Units (kg or lb) are
        optional. Imported clients are not invited: send invites from each client when you are
        ready.
      </p>
      <ImportClients />
    </>
  );
}
