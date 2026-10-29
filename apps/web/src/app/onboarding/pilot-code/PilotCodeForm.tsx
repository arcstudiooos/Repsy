'use client';

import { useActionState } from 'react';
import { AuthShell, buttonClass, Field, FormMessage } from '@/components/auth-ui';
import { redeemPilotCodeAction, type RedeemState } from './actions';

export function PilotCodeForm() {
  const [state, action, pending] = useActionState<RedeemState, FormData>(redeemPilotCodeAction, {});
  const errors = state.fieldErrors ?? {};
  const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <AuthShell title="Enter your pilot code">
      <p className="mb-4 text-base">
        Your account is verified but has no coaching workspace yet. Enter your pilot code to create
        one.
      </p>
      <form action={action}>
        {errors.form && <FormMessage tone="error">{errors.form}</FormMessage>}
        <Field label="Pilot code" name="pilotCode" error={errors.pilotCode} />
        <Field label="Business name" name="orgName" error={errors.orgName} />
        <Field
          label="Time zone"
          name="timezone"
          defaultValue={browserZone}
          hint="For example Europe/London."
          error={errors.timezone}
        />
        <button type="submit" className={buttonClass} disabled={pending}>
          {pending ? 'Creating workspace' : 'Create workspace'}
        </button>
      </form>
    </AuthShell>
  );
}
