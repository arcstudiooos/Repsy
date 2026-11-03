import type { Metadata } from 'next';
// NOTE (slice merge): the parent adds these names to '@kinetic/core' first
// (see SLICE_REPORT_SCHEDULING.md); the page then compiles unchanged.
import { listCustomDomains, MANAGER_ROLES } from '@kinetic/core';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  BrandedSenderForm,
  RequestDomainForm,
  VerifyDomainButton,
} from '@/components/domains/DomainForms';
import { withServerTenant } from '@/server/serverActor';

export const metadata: Metadata = { title: 'Custom domains | Kinetic' };

/** PRD L4: custom domains for the portal and join pages, plus branded sending addresses. */
export default async function DomainsPage() {
  const { domains, canManage } = await withServerTenant(async (tx, actor) => ({
    domains: await listCustomDomains(tx, actor),
    canManage: (MANAGER_ROLES as readonly string[]).includes(actor.role),
  }));
  const verified = domains.filter((d) => d.status === 'verified');
  if (!canManage) {
    return (
      <>
        <h1 className="mb-6 text-2xl font-semibold md:text-3xl">Custom domains</h1>
        <p className="text-secondary">Only workspace managers can manage custom domains.</p>
      </>
    );
  }
  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold md:text-3xl">Custom domains</h1>
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle as="h2">Your domains</CardTitle>
          </CardHeader>
          <CardContent>
            {domains.length === 0 ? (
              <p className="text-secondary">No custom domains yet.</p>
            ) : (
              <ul className="flex flex-col gap-4">
                {domains.map((d) => (
                  <li key={d.id}>
                    <p>
                      <strong>{d.hostname}</strong> — {d.status}
                      {d.brandedFromAddress ? ` — sends as ${d.brandedFromAddress}` : ''}
                    </p>
                    {d.status === 'requested' && d.verificationToken && (
                      <>
                        <p className="text-secondary">
                          Add this TXT record, then mark it verified: name{' '}
                          <code>_kinetic.{d.hostname}</code>, value{' '}
                          <code>{d.verificationToken}</code>
                        </p>
                        <VerifyDomainButton domainId={d.id} />
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-4 text-secondary">
              Note: marking a domain verified records your attestation that the DNS record is set.
              This slice does not check DNS itself; a real DNS check is a follow-up before verified
              domains are trusted for routing or sending.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle as="h2">Request a domain</CardTitle>
          </CardHeader>
          <CardContent>
            <RequestDomainForm />
          </CardContent>
        </Card>
        {verified.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle as="h2">Branded sending address</CardTitle>
            </CardHeader>
            <CardContent>
              <BrandedSenderForm
                domains={verified.map((d) => ({ id: d.id, hostname: d.hostname }))}
              />
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
