'use client';

import { useState } from 'react';
import type { ShoppingItem } from '@kinetic/core';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const fmt = (i: ShoppingItem) =>
  i.amount === null ? i.name : `${i.name}: ${i.amount}${i.unit ? ` ${i.unit}` : ''}`;

/** PRD G8: everything the first option of each meal needs, scaled to its servings. Ticks stay on this screen. */
export function ShoppingList({ items }: { items: ShoppingItem[] }) {
  const [got, setGot] = useState<Set<number>>(new Set());
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Shopping list</CardTitle>
        <CardDescription>For the first option of every meal in the plan.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul aria-label="Shopping list" className="flex flex-col">
          {items.map((i, n) => (
            <li key={n}>
              <label className="flex min-h-11 items-center gap-3">
                <input
                  type="checkbox"
                  className="size-5 accent-accent"
                  checked={got.has(n)}
                  onChange={(e) =>
                    setGot((s) => {
                      const next = new Set(s);
                      if (e.target.checked) next.add(n);
                      else next.delete(n);
                      return next;
                    })
                  }
                />
                <span className={got.has(n) ? 'text-secondary line-through' : ''}>{fmt(i)}</span>
              </label>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
