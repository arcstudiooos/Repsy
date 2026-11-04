import type { Metadata } from 'next';
import Link from 'next/link';
import { SignOutButton } from '@/components/nav/SignOutButton';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { Card } from '@/components/ui/card';

export const metadata: Metadata = { title: 'More | Repsy' };

const links = [
  { label: 'Programs', href: '/app/programs' },
  { label: 'Check-in questions', href: '/app/check-ins' },
  { label: 'Analytics', href: '/app/analytics' },
  { label: 'Resources', href: '/app/resources' },
  { label: 'Courses', href: '/app/courses' },
  { label: 'Assessments', href: '/app/assessments' },
  { label: 'Meal plans', href: '/app/meal-plans' },
  { label: 'Groups', href: '/app/groups' },
  { label: 'Challenges', href: '/app/challenges' },
  { label: 'Leads', href: '/app/leads' },
  { label: 'Automations', href: '/app/automations' },
  { label: 'Team', href: '/app/team' },
  { label: 'Audit log', href: '/app/audit' },
  { label: 'Settings', href: '/settings' },
];

/** Mobile destination for items that do not fit the five-slot bottom nav. */
export default function MorePage() {
  return (
    <>
      <h1 className="mb-6 text-h1 font-semibold md:text-display">More</h1>
      <Card>
        <ul className="flex flex-col">
          {links.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className="flex min-h-11 items-center rounded-control px-3 text-base hover:bg-surface-2"
              >
                {link.label}
              </Link>
            </li>
          ))}
          <li>
            <SignOutButton />
          </li>
        </ul>
      </Card>
      <Card className="mt-4">
        <h2 className="mb-3 text-h3 font-semibold">Theme</h2>
        <ThemeToggle />
      </Card>
    </>
  );
}
