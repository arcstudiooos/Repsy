'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, type FormEvent } from 'react';
import type { CustomDomainView } from '@kinetic/core';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { firstError, send } from '@/lib/billing-api';

const STATUS: Record<CustomDomainView['status'], string> = {
  pending: 'Waiting for the DNS record',
  verified: 'Verified',
  failed: 'Not found yet: check the record',
};
const SENDING: Record<CustomDomainView['sendingStatus'], string> = {
  none: 'Starts once the domain is verified',
  pending: 'Waiting for the email records below',
  verified: 'Emails to your clients come from this domain',
  failed: 'The email records did not verify: check them',
};

/** PRD L4 (D-013 #15): your own domain for your public page and storefront, and branded emails from it. */
export function CustomDomainSection({
  domain,
  cnameTarget,
  canEdit,
}: {
  domain: CustomDomainView | null;
  cnameTarget: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const uid = useId();
  const [busy, setBusy] = useState(false);
  async function run(p: Promise<Awaited<ReturnType<typeof send>>>, ok: string) {
    setBusy(true);
    const res = await p;
    setBusy(false);
    if (res.ok) {
      toast.success(ok);
      router.refresh();
    } else toast.error(firstError(res));
  }
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const hostname = String(new FormData(e.currentTarget).get('hostname') ?? '');
    void run(send('POST', '/api/v1/domain', { hostname }), 'Domain added');
  }
  const record = (type: string, name: string, value: string) => (
    <tr key={`${type}-${name}`} className="border-t border-divider align-top">
      <td className="py-1 pr-3">{type}</td>
      <td className="py-1 pr-3 font-mono break-all">{name}</td>
      <td className="py-1 font-mono break-all">{value}</td>
    </tr>
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Your own domain</CardTitle>
        <CardDescription>
          Show your public page and packages at your own address, like coach.yourname.com. Sign-in
          and the client portal stay on this site.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!domain ? (
          canEdit ? (
            <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <label htmlFor={`${uid}-host`} className="text-sm font-medium">
                  Domain
                </label>
                <Input
                  id={`${uid}-host`}
                  name="hostname"
                  placeholder="coach.example.com"
                  required
                  maxLength={253}
                />
              </div>
              <Button type="submit" disabled={busy}>
                Add domain
              </Button>
            </form>
          ) : (
            <p className="text-secondary">No domain yet.</p>
          )
        ) : (
          <>
            <p>
              <strong className="break-all">{domain.hostname}</strong> · {STATUS[domain.status]}
            </p>
            <div
              className="overflow-x-auto"
              tabIndex={0}
              role="region"
              aria-label="DNS records to add"
            >
              <table className="w-full min-w-[30rem] text-left text-sm">
                <caption className="mb-1 text-left text-secondary">
                  Add these at your domain provider:
                </caption>
                <thead className="text-secondary">
                  <tr>
                    <th scope="col" className="py-1 pr-3 font-medium">
                      Type
                    </th>
                    <th scope="col" className="py-1 pr-3 font-medium">
                      Name
                    </th>
                    <th scope="col" className="py-1 font-medium">
                      Value
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {record('TXT', domain.txtName, domain.txtValue)}
                  {record('CNAME', domain.hostname, cnameTarget)}
                  {domain.sendingRecords.map((r) => record(r.type, r.name, r.value))}
                </tbody>
              </table>
            </div>
            <p className="text-sm text-secondary">
              Branded emails: {SENDING[domain.sendingStatus]}.
            </p>
            {canEdit && (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      send('POST', '/api/v1/domain/check'),
                      'Checking again in a few minutes',
                    )
                  }
                >
                  Check again
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void run(send('DELETE', '/api/v1/domain'), 'Domain removed')}
                >
                  Remove domain
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
