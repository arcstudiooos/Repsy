import type { Metadata } from 'next';
import Link from 'next/link';
import { SignOutButton } from '@/components/nav/SignOutButton';
import { Card } from '@/components/ui/card';

export const metadata: Metadata = { title: 'More | Kinetic' };

const links = [
  { label: 'Programs', href: '/app/programs' },
  { label: 'Check-in questions', href: '/app/check-ins' },
  { label: 'Analytics', href: '/app/analytics' },
  { label: 'Resources', href: '/app/resources' },
  { label: 'Settings', href: '/settings' },
];

/** Mobile destination for items that do not fit the five-slot bottom nav. */
export default function MorePage() {
  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold md:text-3xl">More</h1>
      <Card>
        <ul className="flex flex-col">
          {links.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className="flex min-h-11 items-center rounded-control px-3 text-base hover:bg-canvas"
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
    </>
  );
}
