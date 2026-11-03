import type { ClientStatus, InviteStatus } from '@kinetic/core';
import { Pill, type PillTone } from '@/components/ui/pill';

const LABEL: Record<ClientStatus, string> = {
  invited: 'Invited',
  active: 'Active',
  paused: 'Paused',
  archived: 'Archived',
};

const TONE: Record<ClientStatus, PillTone> = {
  invited: 'accent',
  active: 'success',
  paused: 'warning',
  archived: 'neutral',
};

/** Text label always shown, so status never relies on color alone. */
const INVITE_SUFFIX: Partial<Record<InviteStatus, string>> = {
  none: 'not sent',
  pending: 'pending',
  expired: 'expired',
};

export function StatusBadge({
  status,
  inviteStatus,
}: {
  status: ClientStatus;
  inviteStatus?: InviteStatus;
}) {
  const suffix = status === 'invited' && inviteStatus ? INVITE_SUFFIX[inviteStatus] : undefined;
  return (
    <Pill tone={TONE[status]} dot>
      {suffix ? `${LABEL[status]} · ${suffix}` : LABEL[status]}
    </Pill>
  );
}

export function formatDate(date: string | null): string {
  if (!date) return '-';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
}
