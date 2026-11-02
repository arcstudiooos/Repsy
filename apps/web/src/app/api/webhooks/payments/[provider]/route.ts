import { applyWebhook, logger, WebhookSignatureError, type ProviderName } from '@kinetic/core';
import { prisma, withTenant } from '@kinetic/db';
import { openAccount, portFor, razorpayPort, stripePort, fakePort } from '@/server/payments';

/**
 * `POST /api/webhooks/payments/<provider>` (D-013 #3): the provider's signed events. Public by design; the signature
 * is the credential. Events are stored once by id and applied in the workspace their connected account belongs to.
 * Unknown accounts and replays answer 200 so the provider stops retrying; a bad signature is a 400.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const name = (await params).provider;
  const port =
    name === 'stripe'
      ? stripePort()
      : name === 'razorpay'
        ? razorpayPort()
        : name === 'fake'
          ? fakePort()
          : null;
  if (!port) return new Response('Not found', { status: 404 });
  const provider = name as ProviderName;
  const raw = await request.text();
  if (raw.length > 512_000) return new Response('Too large', { status: 413 });
  let batch;
  try {
    batch = port.parseWebhook(raw, request.headers, new Date());
  } catch (error) {
    if (error instanceof WebhookSignatureError)
      return new Response('Bad signature', { status: 400 });
    throw error;
  }
  if (!batch.accountRef) return new Response('ok');
  const result = await applyWebhook(prisma, provider, batch);
  // A plan's last instalment: stop the provider's subscription now that its rows are committed.
  if (result.orgId && result.cancelSubscriptions.length > 0) {
    const row = await withTenant(result.orgId, (tx) =>
      tx.paymentAccount.findFirst({
        where: { provider, status: 'active' },
        select: { provider: true, accountRef: true, tokenCiphertext: true },
      }),
    );
    if (row) {
      const account = openAccount(row);
      for (const ref of result.cancelSubscriptions) {
        await portFor(provider)
          .cancelSubscription(account, ref, true)
          .catch((e: unknown) =>
            logger.error({ event: 'plan_cancel_failed', provider, errName: (e as Error).name }),
          );
      }
    }
  }
  return new Response('ok');
}
