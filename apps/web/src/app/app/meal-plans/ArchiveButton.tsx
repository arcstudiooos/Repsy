'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';

/** Deletes (archives) a recipe or a meal plan after confirming. */
export function ArchiveButton({
  path,
  what,
  name,
}: {
  path: string;
  what: 'recipe' | 'meal plan';
  name: string;
}) {
  const router = useRouter();
  return (
    <Button
      variant="secondary"
      aria-label={`Delete the ${what} ${name}`}
      onClick={async () => {
        if (!window.confirm(`Delete "${name}"?`)) return;
        const res = await fetch(path, { method: 'DELETE', credentials: 'same-origin' });
        if (res.ok) {
          toast.success(what === 'recipe' ? 'Recipe deleted' : 'Meal plan deleted');
          router.push('/app/meal-plans');
          router.refresh();
        } else toast.error("Couldn't delete it. Try again.");
      }}
    >
      Delete
    </Button>
  );
}
