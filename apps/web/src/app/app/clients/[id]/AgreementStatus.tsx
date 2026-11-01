import type { AcceptanceView } from '@kinetic/core';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const when = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );

/** PRD B14: which version of each agreement the client accepted, and when. */
export function AgreementStatus({ items }: { items: AcceptanceView[] }) {
  if (items.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Agreements</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-2">
          {items.map((a) => (
            <li key={a.agreementId}>
              <span className="font-medium">{a.title}</span>
              {' · '}
              {a.acceptedVersion === a.version && a.acceptedAt ? (
                <span>
                  accepted version {a.version} on {when(a.acceptedAt)}
                </span>
              ) : a.acceptedVersion ? (
                <span className="text-secondary">
                  accepted version {a.acceptedVersion}; asked to accept version {a.version}
                </span>
              ) : (
                <span className="text-secondary">not accepted yet</span>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
