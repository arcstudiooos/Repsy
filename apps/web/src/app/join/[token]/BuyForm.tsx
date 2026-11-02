'use client';

import { useActionState, useEffect, useId } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { checkoutAction, type CheckoutState } from './actions';

/** PRD K4: buy a package. Details here; the card or UPI step is the provider's hosted checkout. */
export function BuyForm({
  slug,
  packageId,
  title,
  asksRegion,
}: {
  slug: string;
  packageId: string;
  title: string;
  asksRegion: boolean;
}) {
  const id = useId();
  const [state, action, pending] = useActionState<CheckoutState, FormData>(checkoutAction, {});
  useEffect(() => {
    if (state.url) window.location.assign(state.url);
  }, [state.url]);
  const err = state.fieldErrors ?? {};
  const field = (name: string) =>
    err[name] ? { 'aria-invalid': true, 'aria-describedby': `${id}-${name}-err` } : {};
  const msg = (name: string) =>
    err[name] ? (
      <p id={`${id}-${name}-err`} className="text-sm text-danger">
        {err[name]}
      </p>
    ) : null;
  return (
    <form action={action} className="flex flex-col gap-3" aria-label={`Buy ${title}`}>
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="packageId" value={packageId} />
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-name`} className="text-sm font-medium">
          Your name
        </label>
        <Input
          id={`${id}-name`}
          name="name"
          required
          maxLength={120}
          autoComplete="name"
          {...field('name')}
        />
        {msg('name')}
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-email`} className="text-sm font-medium">
          Email
        </label>
        <Input
          id={`${id}-email`}
          name="email"
          type="email"
          required
          autoComplete="email"
          {...field('email')}
        />
        {msg('email')}
      </div>
      {asksRegion && (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-region`} className="text-sm font-medium">
            State or region
          </label>
          <Input
            id={`${id}-region`}
            name="region"
            required
            maxLength={60}
            autoComplete="address-level1"
            {...field('region')}
          />
          {msg('region')}
        </div>
      )}
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-coupon`} className="text-sm font-medium">
          Coupon (optional)
        </label>
        <Input
          id={`${id}-coupon`}
          name="coupon"
          maxLength={30}
          className="uppercase"
          {...field('coupon')}
        />
        {msg('coupon')}
      </div>
      {err.form && (
        <p role="alert" className="text-danger">
          {err.form}
        </p>
      )}
      <Button type="submit" disabled={pending || Boolean(state.url)}>
        {pending || state.url ? 'Going to checkout…' : 'Continue to payment'}
      </Button>
    </form>
  );
}
