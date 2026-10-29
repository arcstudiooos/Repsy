import type { Metadata } from 'next';
import { SignOutButton } from './SignOutButton';

export const metadata: Metadata = { title: 'Dashboard | Kinetic' };

// Access is enforced by src/proxy.ts (signed-in, verified email).
export default function AppHome() {
  return (
    <main className="min-h-screen bg-[#F7F8F6] px-4 py-8 text-[#152825]">
      <div className="mx-auto max-w-3xl">
        <h1 className="mb-4 text-2xl font-semibold sm:text-3xl">Coach dashboard</h1>
        <SignOutButton />
      </div>
    </main>
  );
}
