'use client';

import * as T from '@radix-ui/react-tooltip';
import type { ReactNode } from 'react';

/**
 * A hover/focus tooltip for supplementary text. Never the only place information lives (it is not reachable on
 * touch): put the same text in the accessible name or on the page.
 */
export function Tooltip({ content, children }: { content: ReactNode; children: ReactNode }) {
  return (
    <T.Provider delayDuration={200}>
      <T.Root>
        <T.Trigger asChild>{children}</T.Trigger>
        <T.Portal>
          <T.Content
            sideOffset={6}
            className="z-50 max-w-xs rounded-sm bg-midnight px-2.5 py-1.5 text-caption text-on-midnight shadow-e2"
          >
            {content}
            <T.Arrow className="fill-midnight" />
          </T.Content>
        </T.Portal>
      </T.Root>
    </T.Provider>
  );
}
