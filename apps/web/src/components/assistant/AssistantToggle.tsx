'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { setAssistantActionsEnabled, setAssistantEnabled } from '@/lib/assistant-api';

/** Owner/admin switch for the workspace's AI assistant (PRD I15, off by default). */
export function AssistantToggle({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function flip() {
    setBusy(true);
    const res = await setAssistantEnabled(!enabled);
    setBusy(false);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    toast.success(enabled ? 'AI assistant turned off.' : 'AI assistant turned on.');
    router.refresh();
  }
  return (
    <Button variant={enabled ? 'secondary' : 'default'} disabled={busy} onClick={flip}>
      {enabled ? 'Turn off the assistant' : 'Turn on the assistant'}
    </Button>
  );
}

/**
 * Owner/admin switch letting the assistant propose changes (assign programs, nutrition targets, meal plans).
 * Off by default; every proposal still waits for the coach's Confirm.
 */
export function AssistantActionsToggle({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function flip() {
    if (
      !enabled &&
      !window.confirm(
        'Let the assistant propose changes? It can suggest assigning programs, setting nutrition targets and creating meal plans. Nothing changes until the coach who asked presses Confirm.',
      )
    ) {
      return;
    }
    setBusy(true);
    const res = await setAssistantActionsEnabled(!enabled);
    setBusy(false);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    toast.success(
      enabled ? 'The assistant can only read now.' : 'The assistant can propose changes.',
    );
    router.refresh();
  }
  return (
    <Button variant="secondary" disabled={busy} onClick={flip}>
      {enabled ? 'Stop proposing changes' : 'Let it propose changes'}
    </Button>
  );
}
