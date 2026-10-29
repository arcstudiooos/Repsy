'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/components/ui/toast';

/** Signs out every other device; this session stays. */
export function SecuritySection() {
  const [busy, setBusy] = useState(false);

  async function revoke() {
    setBusy(true);
    try {
      const res = await fetch('/api/v1/sessions/revoke-all', {
        method: 'POST',
        credentials: 'same-origin',
      });
      if (res.ok) toast.success('Signed out of all other devices');
      else toast.error("Couldn't sign out other devices. Try again.");
    } catch {
      toast.error('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Security</CardTitle>
        <CardDescription>
          Sign out everywhere else if you lost a device or used a shared one. This device stays
          signed in.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button type="button" variant="secondary" disabled={busy} onClick={() => void revoke()}>
          {busy ? 'Signing out...' : 'Sign out of all other devices'}
        </Button>
      </CardContent>
    </Card>
  );
}
