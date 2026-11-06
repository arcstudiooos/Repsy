'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { setAssistantEnabled } from '@/lib/assistant-api';

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
