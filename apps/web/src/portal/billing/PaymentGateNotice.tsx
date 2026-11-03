import type { PaymentGate } from '@kinetic/core';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { formatDay } from '@/lib/billing-format';
import { PlanActions } from './PlanActions';

/**
 * PRD K7 (D-013 #7): after a failed payment's grace period the portal asks the client to update their card before
 * it opens again. Nothing they have done is changed; paying (or the coach) opens it again.
 */
export function PaymentGateNotice({ coachName, gate }: { coachName: string; gate: PaymentGate }) {
  return (
    <Card>
      <CardHeader>
        <h1 className="text-xl font-semibold">Your payment didn&apos;t go through</h1>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p>
          The payment for {gate.packageTitle} has failed since {formatDay(gate.pastDueSince)}.
          Update your card to keep coaching with {coachName}. Your workouts and history are safe.
        </p>
        <PlanActions purchaseId={gate.purchaseId} card cancellable={false} />
        <p className="text-sm text-secondary">
          Paid another way? Ask {coachName} to reopen your portal.
        </p>
      </CardContent>
    </Card>
  );
}
