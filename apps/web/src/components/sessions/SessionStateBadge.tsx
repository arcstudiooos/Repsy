import type { SessionState } from '@kinetic/core';
import {
  AlarmClock,
  Ban,
  CalendarClock,
  CheckCircle2,
  CircleDashed,
  CircleSlash,
  CircleX,
  Pause,
  PencilLine,
  Play,
  Plus,
  UserCheck,
  type LucideIcon,
} from 'lucide-react';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { sessionStateLabel } from '@/lib/session-format';

const STATE: Record<SessionState, { tone: BadgeTone; icon: LucideIcon }> = {
  scheduled: { tone: 'info', icon: CalendarClock },
  in_progress: { tone: 'brand', icon: Play },
  completed: { tone: 'success', icon: CheckCircle2 },
  skipped: { tone: 'warning', icon: CircleSlash },
  missed: { tone: 'danger', icon: CircleX },
  incomplete: { tone: 'warning', icon: CircleDashed },
  cancelled: { tone: 'neutral', icon: Ban },
  paused: { tone: 'neutral', icon: Pause },
} as Record<SessionState, { tone: BadgeTone; icon: LucideIcon }>;

/** Icon + text + colour; the text always names the state. */
export function SessionStateBadge({ state, overdue }: { state: SessionState; overdue: boolean }) {
  const label = sessionStateLabel(state, overdue);
  const s =
    label === 'Overdue'
      ? { tone: 'warning' as const, icon: AlarmClock }
      : (STATE[state] ?? { tone: 'neutral' as const, icon: CalendarClock });
  return (
    <Badge tone={s.tone} icon={s.icon} className="text-sm">
      {label}
    </Badge>
  );
}

/** D-008 #7: shown to the coach and the client alike. */
export function LoggedByCoachBadge() {
  return (
    <Badge tone="outline" icon={UserCheck} className="text-sm">
      Logged by coach
    </Badge>
  );
}

/** PRD D13: logged unplanned by the client; not part of adherence. */
export function ExtraWorkoutBadge() {
  return (
    <Badge tone="outline" icon={Plus} className="text-sm">
      Extra
    </Badge>
  );
}

/** S3-4: a set changed after the workout was finished ("Edited", "Corrected by your coach"). */
export function RevisionMark({ label }: { label: string }) {
  return (
    <Badge tone="neutral" icon={PencilLine} className="text-sm">
      {label}
    </Badge>
  );
}
