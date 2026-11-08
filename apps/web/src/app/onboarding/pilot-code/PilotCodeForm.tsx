'use client';

import { useActionState } from 'react';
import { AuthShell, buttonClass, Field, FormMessage } from '@/components/auth-ui';
import { TimezoneSelect } from '@/components/TimezoneSelect';
import { redeemPilotCodeAction, type RedeemState } from './actions';

export function PilotCodeForm() {
  const [state, action, pending] = useActionState<RedeemState, FormData>(redeemPilotCodeAction, {});
  const errors = state.fieldErrors ?? {};
  return (
    <AuthShell title="Set up your workspace">
      <p className="mb-4 text-base">
        Your account is ready. Add your business details to create your coaching workspace.
      </p>
      <form action={action}>
        {errors.form && <FormMessage tone="error">{errors.form}</FormMessage>}
        <Field
          label="Pilot code (optional)"
          name="pilotCode"
          required={false}
          hint="No code? You get a free 7-day trial for up to 3 clients."
          error={errors.pilotCode}
        />
        <Field label="Business name" name="orgName" error={errors.orgName} />
        <TimezoneSelect
          label="Time zone"
          name="timezone"
          hint="Used for reminders and check-in times. We picked yours from this device."
          error={errors.timezone}
        />
        <button type="submit" className={buttonClass} disabled={pending}>
          {pending ? 'Creating workspace' : 'Create workspace'}
        </button>
      </form>
    </AuthShell>
  );
}
