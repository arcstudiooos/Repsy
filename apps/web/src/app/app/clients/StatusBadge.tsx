import type { ClientStatus, InviteStatus } from '@kinetic/core';
import { CircleCheck, Mail, Pause, Archive } from 'lucide-react';
import { Badge, type BadgeTone } from '@/components/ui/badge';

const LABEL: Record<ClientStatus, string> = {
  invited: 'Invited',
  active: 'Active',
  paused: 'Paused',
  archived: 'Archived',
};

const STYLE: Record<ClientStatus, { tone: BadgeTone; icon: typeof Mail }> = {
  invited: { tone: 'info', icon: Mail },
  active: { tone: 'success', icon: CircleCheck },
  paused: { tone: 'warning', icon: Pause },
  archived: { tone: 'neutral', icon: Archive },
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
    <Badge tone={STYLE[status].tone} icon={STYLE[status].icon} className="text-sm">
      {suffix ? `${LABEL[status]} · ${suffix}` : LABEL[status]}
    </Badge>
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
