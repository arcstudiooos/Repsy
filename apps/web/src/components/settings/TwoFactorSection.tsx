'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { authClient } from '@/lib/auth-client';

/** The setup key from an otpauth:// URI, in groups of four for typing into an app. */
function setupKey(uri: string): string {
  try {
    const secret = new URL(uri).searchParams.get('secret') ?? '';
    return secret.replace(/(.{4})/g, '$1 ').trim();
  } catch {
    return '';
  }
}

const WRONG_PASSWORD = 'That password is incorrect.';

/**
 * Two-step sign-in (PRD A8): an authenticator app code after the password, with one-time backup codes. Turning it on
 * takes the password, then a code from the app, so a mistyped setup can never lock the account.
 */
export function TwoFactorSection({ enabled, required }: { enabled: boolean; required: boolean }) {
  const router = useRouter();
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setup, setSetup] = useState<{ uri: string; backupCodes: string[] } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);

  async function start(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const password = String(new FormData(e.currentTarget).get('password'));
    setBusy(true);
    setError(null);
    const { data, error: failure } = await authClient.twoFactor.enable({ password });
    setBusy(false);
    if (failure || !data || !('totpURI' in data)) {
      setError(failure?.status === 400 || failure?.status === 401 ? WRONG_PASSWORD : 'Try again.');
      return;
    }
    setSetup({ uri: data.totpURI, backupCodes: data.backupCodes });
  }

  async function confirm(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = String(new FormData(e.currentTarget).get('code')).replace(/\s+/g, '');
    setBusy(true);
    setError(null);
    const { error: failure } = await authClient.twoFactor.verifyTotp({ code });
    setBusy(false);
    if (failure) {
      setError("That code didn't work. Check the time on your phone and try the newest code.");
      return;
    }
    setSetup(null);
    toast.success('Two-step sign-in is on');
    router.refresh();
  }

  async function turnOff(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const password = String(new FormData(e.currentTarget).get('password'));
    setBusy(true);
    setError(null);
    const { error: failure } = await authClient.twoFactor.disable({ password });
    setBusy(false);
    if (failure) {
      setError(failure.status === 400 || failure.status === 401 ? WRONG_PASSWORD : 'Try again.');
      return;
    }
    toast.success('Two-step sign-in is off');
    router.refresh();
  }

  async function newCodes(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const password = String(new FormData(form).get('password'));
    setBusy(true);
    setError(null);
    const { data, error: failure } = await authClient.twoFactor.generateBackupCodes({ password });
    setBusy(false);
    if (failure || !data) {
      setError(failure?.status === 400 || failure?.status === 401 ? WRONG_PASSWORD : 'Try again.');
      return;
    }
    form.reset();
    setCodes(data.backupCodes);
  }

  const passwordField = (suffix: string) => (
    <div className="flex flex-col gap-1">
      <label htmlFor={`${id}-${suffix}`} className="text-sm font-medium">
        Your password
      </label>
      <Input
        id={`${id}-${suffix}`}
        name="password"
        type="password"
        autoComplete="current-password"
        required
      />
    </div>
  );

  const codeList = (list: string[]) => (
    <div className="flex flex-col gap-2">
      <p className="text-sm">
        Save these backup codes somewhere safe. Each one signs you in once if you lose your phone.
      </p>
      <ul
        aria-label="Backup codes"
        className="grid grid-cols-2 gap-1 rounded-control bg-canvas p-3 font-mono text-sm"
      >
        {list.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Two-step sign-in</CardTitle>
        <CardDescription>
          After your password, enter a code from an authenticator app (such as Google Authenticator,
          1Password or Authy).
          {required &&
            ' Your workspace has more than one coach, so the owner must use two-step sign-in.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
        {enabled ? (
          <>
            <p className="font-medium">Two-step sign-in is on.</p>
            {codes && codeList(codes)}
            <form
              method="post"
              onSubmit={newCodes}
              className="flex flex-col gap-3"
              aria-label="New backup codes"
            >
              {passwordField('codes')}
              <div>
                <Button type="submit" variant="secondary" disabled={busy}>
                  Make new backup codes
                </Button>
              </div>
            </form>
            {!required && (
              <form
                onSubmit={turnOff}
                className="flex flex-col gap-3"
                aria-label="Turn off two-step sign-in"
              >
                {passwordField('off')}
                <div>
                  <Button type="submit" variant="ghost" disabled={busy}>
                    Turn off two-step sign-in
                  </Button>
                </div>
              </form>
            )}
          </>
        ) : setup ? (
          <>
            <ol className="flex list-decimal flex-col gap-3 pl-5">
              <li>
                Add Repsy to your authenticator app.{' '}
                <a href={setup.uri} className="text-accent underline">
                  Open in your authenticator app
                </a>
                , or type this setup key:
                <span className="mt-1 block font-mono text-base break-all">
                  {setupKey(setup.uri)}
                </span>
              </li>
              <li>{codeList(setup.backupCodes)}</li>
              <li>Enter the 6-digit code the app shows.</li>
            </ol>
            <form
              method="post"
              onSubmit={confirm}
              className="flex flex-col gap-3"
              aria-label="Confirm the code"
            >
              <div className="flex flex-col gap-1 sm:max-w-xs">
                <label htmlFor={`${id}-code`} className="text-sm font-medium">
                  Code from the app
                </label>
                <Input
                  id={`${id}-code`}
                  name="code"
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  required
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={busy}>
                  Turn on
                </Button>
                <Button type="button" variant="ghost" onClick={() => setSetup(null)}>
                  Cancel
                </Button>
              </div>
            </form>
          </>
        ) : (
          <form
            onSubmit={start}
            className="flex flex-col gap-3"
            aria-label="Set up two-step sign-in"
          >
            {passwordField('on')}
            <div>
              <Button type="submit" disabled={busy}>
                Set up two-step sign-in
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
