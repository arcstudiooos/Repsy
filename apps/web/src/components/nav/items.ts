import {
  BookOpen,
  ChartColumn,
  ClipboardCheck,
  Dumbbell,
  Ellipsis,
  House,
  LayoutDashboard,
  MessageSquare,
  Settings,
  User,
  Users,
  CalendarCheck,
  Workflow,
  Inbox,
  GraduationCap,
  ScanLine,
  Salad,
  UsersRound,
  Trophy,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Match only the exact path (for index routes like /app). */
  exact?: boolean;
  /** Sidebar section heading this item sits under (coach desktop only). */
  group?: string;
}

/** Coach desktop left nav, in order. Settings is pinned at the bottom (see CoachNav). */
export const coachDesktopItems: NavItem[] = [
  { label: 'Overview', href: '/app', icon: LayoutDashboard, exact: true, group: 'Coaching' },
  { label: 'Clients', href: '/app/clients', icon: Users, group: 'Coaching' },
  { label: 'Programs', href: '/app/programs', icon: Dumbbell, group: 'Coaching' },
  { label: 'Review', href: '/app/review', icon: ClipboardCheck, group: 'Coaching' },
  { label: 'Messages', href: '/app/messages', icon: MessageSquare, group: 'Coaching' },
  { label: 'Analytics', href: '/app/analytics', icon: ChartColumn, group: 'Coaching' },
  { label: 'Resources', href: '/app/resources', icon: BookOpen, group: 'Content' },
  { label: 'Courses', href: '/app/courses', icon: GraduationCap, group: 'Content' },
  { label: 'Assessments', href: '/app/assessments', icon: ScanLine, group: 'Content' },
  { label: 'Meal plans', href: '/app/meal-plans', icon: Salad, group: 'Content' },
  { label: 'Groups', href: '/app/groups', icon: UsersRound, group: 'Community' },
  { label: 'Challenges', href: '/app/challenges', icon: Trophy, group: 'Community' },
  { label: 'Leads', href: '/app/leads', icon: Inbox, group: 'Business' },
  { label: 'Automations', href: '/app/automations', icon: Workflow, group: 'Business' },
];
export const coachSettingsItem: NavItem = { label: 'Settings', href: '/settings', icon: Settings };

/** Coach mobile bottom nav. "More" holds Programs, Analytics, Settings and Sign out. */
export const coachMobileItems: NavItem[] = [
  { label: 'Home', href: '/app', icon: House, exact: true },
  { label: 'Clients', href: '/app/clients', icon: Users },
  { label: 'Review', href: '/app/review', icon: ClipboardCheck },
  { label: 'Messages', href: '/app/messages', icon: MessageSquare },
  { label: 'More', href: '/app/more', icon: Ellipsis },
];

export const portalItems: NavItem[] = [
  { label: 'Home', href: '/portal', icon: House, exact: true },
  { label: 'Workouts', href: '/portal/workouts', icon: Dumbbell },
  { label: 'Check-ins', href: '/portal/check-ins', icon: CalendarCheck },
  { label: 'Messages', href: '/portal/messages', icon: MessageSquare },
  { label: 'Profile', href: '/portal/profile', icon: User },
];

export function isActive(pathname: string, item: NavItem): boolean {
  return item.exact
    ? pathname === item.href
    : pathname === item.href || pathname.startsWith(`${item.href}/`);
}
