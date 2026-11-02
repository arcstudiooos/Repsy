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
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Match only the exact path (for index routes like /app). */
  exact?: boolean;
}

/** Coach desktop left nav, in order. Settings is pinned at the bottom (see CoachNav). */
export const coachDesktopItems: NavItem[] = [
  { label: 'Overview', href: '/app', icon: LayoutDashboard, exact: true },
  { label: 'Clients', href: '/app/clients', icon: Users },
  { label: 'Programs', href: '/app/programs', icon: Dumbbell },
  { label: 'Review', href: '/app/review', icon: ClipboardCheck },
  { label: 'Messages', href: '/app/messages', icon: MessageSquare },
  { label: 'Analytics', href: '/app/analytics', icon: ChartColumn },
  { label: 'Resources', href: '/app/resources', icon: BookOpen },
  { label: 'Courses', href: '/app/courses', icon: GraduationCap },
  { label: 'Assessments', href: '/app/assessments', icon: ScanLine },
  { label: 'Leads', href: '/app/leads', icon: Inbox },
  { label: 'Automations', href: '/app/automations', icon: Workflow },
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
