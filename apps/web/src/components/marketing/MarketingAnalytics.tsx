'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';

/**
 * Google Tag Manager on the public home page only, and only after the visitor accepts analytics cookies
 * (D-023). Declining (or not choosing) loads nothing from Google. App and portal pages never load it: their
 * URLs and titles carry client details. The container id is read from NEXT_PUBLIC_GTM_ID on the server at request
 * time and passed in as a prop (see gtmContainerId), so setting it on Render works without a rebuild of the client
 * bundle. A build-time-only read left the banner off in production while the server rendered "Cookie settings".
 */
const CONSENT_KEY = 'repsy-analytics-consent';
type Choice = 'granted' | 'denied';

declare global {
  interface Window {
    dataLayer?: unknown[];
  }
}

function readChoice(): Choice | null {
  try {
    const v = window.localStorage.getItem(CONSENT_KEY);
    return v === 'granted' || v === 'denied' ? v : null;
  } catch {
    return null;
  }
}

/** Fallback when storage is blocked: the choice lasts for this page view only. */
let memoryChoice: Choice | null = null;
const CHANGE_EVENT = 'repsy:analytics-consent-change';

function saveChoice(choice: Choice | null) {
  memoryChoice = choice;
  try {
    if (choice) window.localStorage.setItem(CONSENT_KEY, choice);
    else window.localStorage.removeItem(CONSENT_KEY);
  } catch {
    // Private mode or blocked storage: memoryChoice covers this page view.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

const subscribe = (onChange: () => void) => {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
};
/** 'unset' shows the banner; the server renders nothing ('pending') until the browser has read the choice. */
const snapshot = (): Choice | 'unset' => readChoice() ?? memoryChoice ?? 'unset';
const serverSnapshot = (): 'pending' => 'pending';

const GTM_ID_PATTERN = /^GTM-[A-Z0-9]+$/;

let gtmLoaded = false;
let mounted = 0;

function loadGtm(id: string) {
  if (gtmLoaded || !GTM_ID_PATTERN.test(id)) return;
  gtmLoaded = true;
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(id)}`;
  document.head.appendChild(script);
}

export function MarketingAnalytics({ gtmId }: { gtmId: string }) {
  const choice = useSyncExternalStore(subscribe, snapshot, serverSnapshot);

  useEffect(() => {
    if (gtmId && choice === 'granted') loadGtm(gtmId);
  }, [gtmId, choice]);

  useEffect(() => {
    if (!gtmId) return;
    mounted += 1;
    return () => {
      mounted -= 1;
      // Leaving the home page inside the app (client navigation): reload so Google's script does not keep
      // running on app pages. Deferred so a development double-mount does not trigger it.
      setTimeout(() => {
        if (mounted === 0 && gtmLoaded) window.location.reload();
      }, 0);
    };
  }, [gtmId]);

  if (!gtmId || choice !== 'unset') return null;

  const decide = (next: Choice) => {
    saveChoice(next);
    if (next === 'denied' && gtmLoaded) window.location.reload();
  };

  return (
    <section
      aria-label="Cookie choice"
      className="fixed inset-x-4 bottom-4 z-[60] mx-auto max-w-xl rounded-card border border-border bg-surface p-4 text-sm shadow-e2"
    >
      <p>
        We would like to use Google Analytics cookies on this page to see how visitors find Repsy.
        They are off unless you accept. The app itself never uses them.{' '}
        <a href="/privacy#cookies" className="underline">
          Privacy Policy
        </a>
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={() => decide('granted')}>Accept</Button>
        <Button variant="secondary" onClick={() => decide('denied')}>
          Decline
        </Button>
      </div>
    </section>
  );
}

/** Footer link that reopens the cookie choice. Hidden when analytics is not configured. */
export function CookieSettingsLink({ gtmId, className }: { gtmId: string; className?: string }) {
  if (!gtmId) return null;
  return (
    <button type="button" className={className} onClick={() => saveChoice(null)}>
      Cookie settings
    </button>
  );
}
