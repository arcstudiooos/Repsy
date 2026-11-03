import { NoticeBanner } from '@/components/nav/NoticeBanner';
import { redirect } from 'next/navigation';
import { Suspense, type ReactNode } from 'react';
import { PortalBrand } from '@/components/nav/PortalBrand';
import { PortalNav } from '@/components/nav/PortalNav';
import { WorkspaceSwitchLink } from '@/components/nav/WorkspaceSwitchLink';
import { EmptyState } from '@/components/states/EmptyState';
import { LoadingState } from '@/components/states/LoadingState';
import { PortalDevice } from '@/portal/offline/PortalDevice';
import { ServiceWorker } from '@/portal/offline/ServiceWorker';
import { getServerActorOutcome, getServerSession, withServerTenant } from '@/server/serverActor';
import { shellRedirect } from '@/server/shellGate';
import { lapseState, paymentGateFor, pendingAgreements, recordPortalVisit } from '@kinetic/core';
import { PaymentGateNotice } from '@/portal/billing/PaymentGateNotice';
import { AgreementGate } from '@/portal/AgreementGate';

// May block on request data (session, params); opts out of Next instant-navigation validation, see HANDOFF.
export const instant = false;

/**
 * Portal gate (behind src/proxy.ts, which checks session + verified email):
 * the active org must give this user a `client` role AND a linked Client row.
 * Mirrors the coach shell: a coach role in the active org goes to /app; no chosen or a stale active org goes to
 * /select-org; no workspace at all goes to `/`.
 */
async function ClientGate({ children }: { children: ReactNode }) {
  const { user } = await getServerSession();
  if (!user) redirect('/login?next=%2Fportal');
  const target = shellRedirect('portal', await getServerActorOutcome(user));
  if (target) redirect(target);
  const { linked, owner, pending, coachName, gate, lapse } = await withServerTenant(
    async (tx, actor) => {
      const linked = await tx.client.findFirst({
        where: { userId: actor.userId },
        select: { id: true, status: true, timezone: true },
      });
      // PRD I4: one row per local day the client opens the portal.
      if (linked && linked.status !== 'archived') await recordPortalVisit(tx, linked);
      // PRD B14: terms and waivers still to accept (again, after a change).
      const pending = linked ? await pendingAgreements(tx, { ...actor, clientId: linked.id }) : [];
      // PRD K7 (D-013 #7): past due beyond the grace period, until paid or the coach lifts it.
      const gate =
        linked && !pending.length
          ? await paymentGateFor(tx, { ...actor, clientId: linked.id })
          : null;
      const org = await tx.organization.findFirst({
        select: { name: true, lapsedAt: true, plan: true, trialEndsAt: true },
      });
      return {
        linked,
        pending,
        gate,
        coachName: org?.name ?? 'Your coach',
        // PRD M12: read-only after a lapse, until the client's read window closes.
        lapse: org ? lapseState(org) : null,
        owner: { userId: actor.userId, orgId: actor.orgId },
      };
    },
  );
  // D-010 #4: archiving a client ends their access to this coach's organization.
  if (linked?.status === 'archived') {
    return (
      <EmptyState
        title="Your access has ended"
        body="Your coach has closed your account in this workspace. Contact them if you think this is a mistake."
      />
    );
  }
  // A client membership without a Client row is a data fault; redirecting to `/`
  // would loop straight back here, so say so instead.
  if (!linked) {
    return (
      <EmptyState
        title="Your profile isn't ready"
        body="We couldn't find your client profile. Ask your coach to send a new invite."
      />
    );
  }
  return (
    <>
      {/* Before the page, so the device store is bound to this user before the page reads it (PR #2 review C1). */}
      <PortalDevice userId={owner.userId} orgId={owner.orgId} />
      <Suspense fallback={null}>
        <NoticeBanner />
      </Suspense>
      {lapse?.lapsed && (
        <p role="status" className="mb-6 rounded-card border border-[#EBD3B5] bg-[#FDF6EC] p-4">
          {coachName}&apos;s workspace is read-only now: you can look at everything and export your
          data (Profile) until{' '}
          {new Intl.DateTimeFormat('en-GB', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
            timeZone: 'UTC',
          }).format(new Date(lapse.clientReadUntil!))}
          , but nothing new will be sent or saved.
        </p>
      )}
      {pending.length > 0 ? (
        <AgreementGate coachName={coachName} pending={pending} />
      ) : gate ? (
        <PaymentGateNotice coachName={coachName} gate={gate} />
      ) : (
        children
      )}
    </>
  );
}

/** Client portal shell: bottom tab bar on mobile, top bar from 768px up. */
export default function PortalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <ServiceWorker />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-control focus:bg-surface focus:px-4 focus:py-3"
      >
        Skip to content
      </a>
      <header className="border-b border-border bg-surface px-4 py-3 md:border-b-0 md:pb-1">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-2 md:px-8">
          <Suspense fallback={<p className="text-lg font-semibold">Kinetic</p>}>
            <PortalBrand />
          </Suspense>
          <Suspense fallback={null}>
            <WorkspaceSwitchLink className="text-sm" />
          </Suspense>
        </div>
      </header>
      {/* usePathname() is runtime data: keep it out of the prerendered shell for dynamic routes. */}
      <Suspense fallback={null}>
        <PortalNav />
      </Suspense>
      <main
        id="main"
        className="mx-auto w-full max-w-3xl flex-1 px-4 pt-6 pb-28 md:px-8 md:pt-8 md:pb-12"
      >
        <Suspense fallback={<LoadingState />}>
          <ClientGate>{children}</ClientGate>
        </Suspense>
      </main>
    </div>
  );
}
