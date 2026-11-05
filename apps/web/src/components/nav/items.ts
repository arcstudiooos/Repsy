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
  CalendarClock,
  CreditCard,
  Sparkles,
  LifeBuoy,
  MessageSquareText,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Match only the exact path (for index routes like /app). */
  exact?: boolean;
  /** Shows a count badge (open review items, unread messages). */
  badge?: 'review' | 'messages';
}

export interface NavGroup {
  /** Micro-label above the group; none for the main group. */
  label?: string;
  /** Collapsible groups start closed and remember their state per device. */
  collapsible?: boolean;
  items: NavItem[];
}

/**
 * Coach sidebar, grouped by how often each page is used (D-018): the daily loop first, then the business pages,
 * then the content library (collapsible, so no more than about nine links show at once).
 */
export const coachNavGroups: NavGroup[] = [
  {
    items: [
      { label: 'Overview', href: '/app', icon: LayoutDashboard, exact: true },
      { label: 'Clients', href: '/app/clients', icon: Users },
      { label: 'Review', href: '/app/review', icon: ClipboardCheck, badge: 'review' },
      { label: 'Messages', href: '/app/messages', icon: MessageSquare, badge: 'messages' },
      { label: 'Programs', href: '/app/programs', icon: Dumbbell },
      { label: 'Check-ins', href: '/app/check-ins', icon: MessageSquareText },
      { label: 'Analytics', href: '/app/analytics', icon: ChartColumn },
    ],
  },
  {
    label: 'Business',
    items: [
      { label: 'Scheduling', href: '/app/scheduling', icon: CalendarClock },
      { label: 'Payments', href: '/app/billing', icon: CreditCard },
      { label: 'Leads', href: '/app/leads', icon: Inbox },
      { label: 'AI drafting', href: '/app/ai-drafts', icon: Sparkles },
      { label: 'Automations', href: '/app/automations', icon: Workflow },
    ],
  },
  {
    label: 'Library',
    collapsible: true,
    items: [
      { label: 'Resources', href: '/app/resources', icon: BookOpen },
      { label: 'Courses', href: '/app/courses', icon: GraduationCap },
      { label: 'Assessments', href: '/app/assessments', icon: ScanLine },
      { label: 'Meal plans', href: '/app/meal-plans', icon: Salad },
      { label: 'Groups', href: '/app/groups', icon: UsersRound },
      { label: 'Challenges', href: '/app/challenges', icon: Trophy },
    ],
  },
];

/** Every primary sidebar link, in order (the command palette and the mobile "More" sheet use this). */
export const coachDesktopItems: NavItem[] = coachNavGroups.flatMap((g) => g.items);

/** Pinned under the groups. */
export const coachSecondaryItems: NavItem[] = [
  { label: 'Settings', href: '/settings', icon: Settings },
  { label: 'Help', href: '/app/support', icon: LifeBuoy },
];
export const coachSettingsItem: NavItem = coachSecondaryItems[0]!;

/** Coach mobile bottom nav. "More" opens a sheet with every other page and the user menu. */
export const coachMobileItems: NavItem[] = [
  { label: 'Home', href: '/app', icon: House, exact: true },
  { label: 'Clients', href: '/app/clients', icon: Users },
  { label: 'Review', href: '/app/review', icon: ClipboardCheck, badge: 'review' },
  { label: 'Messages', href: '/app/messages', icon: MessageSquare, badge: 'messages' },
  { label: 'More', href: '/app/more', icon: Ellipsis },
];

/** Portal tab bar. Workouts sits in the centre as the raised primary action on phones. */
export const portalItems: NavItem[] = [
  { label: 'Home', href: '/portal', icon: House, exact: true },
  { label: 'Check-ins', href: '/portal/check-ins', icon: CalendarCheck },
  { label: 'Workouts', href: '/portal/workouts', icon: Dumbbell },
  { label: 'Messages', href: '/portal/messages', icon: MessageSquare },
  { label: 'Profile', href: '/portal/profile', icon: User },
];

/** The raised centre tab on phones. */
export const PORTAL_PRIMARY_HREF = '/portal/workouts';

export function isActive(pathname: string, item: NavItem): boolean {
  return item.exact
    ? pathname === item.href
    : pathname === item.href || pathname.startsWith(`${item.href}/`);
}
