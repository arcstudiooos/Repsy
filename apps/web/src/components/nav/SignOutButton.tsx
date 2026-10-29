'use client';

import { LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { authClient } from '@/lib/auth-client';

export function SignOutButton({ className }: { className?: string }) {
  const router = useRouter();
  return (
    <Button
      type="button"
      variant="ghost"
      className={className ?? 'w-full justify-start px-3 text-secondary'}
      onClick={() =>
        void authClient.signOut().then(() => {
          router.replace('/login');
          router.refresh();
        })
      }
    >
      <LogOut aria-hidden className="size-5" />
      Sign out
    </Button>
  );
}
