'use client';

import { createContext, useContext } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import type { EquipmentGuide } from '@repsy/core';
import { outsideKit } from '@repsy/core/exercise-options';
import { Button } from '@/components/ui/button';
import type { EditorValues } from './editorSchema';

/** The client's kit and swaps when the builder edits a client's own program (PRD B13). */
export const EquipmentGuideContext = createContext<EquipmentGuide | null>(null);

/** "Not in Ana's kit: Barbell", with one-click swaps to the coach's alternatives that fit. */
export function KitWarning({ base, name }: { base: string; name: string }) {
  const guide = useContext(EquipmentGuideContext);
  const { control, setValue } = useFormContext<EditorValues>();
  const exerciseId = useWatch({
    control,
    name: `${base}.exerciseId` as never,
  }) as unknown as string;
  const info = guide?.exercises[exerciseId];
  if (!guide || !info || !outsideKit(info.equipment, guide.kit)) return null;
  const first = guide.clientName.trim().split(/\s+/)[0] || guide.clientName;
  return (
    <div
      role="note"
      className="flex flex-col gap-2 rounded-control bg-canvas p-3 text-sm ring-1 ring-warning"
    >
      <p>
        <span className="font-medium">Not in {first}&apos;s kit:</span> {info.equipment}. They have{' '}
        {guide.kit.join(', ')}.
      </p>
      {info.fits.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {info.fits.map((alt) => (
            <Button
              key={alt.exerciseId}
              type="button"
              variant="secondary"
              size="sm"
              aria-label={`Use ${alt.name} instead of ${name}`}
              onClick={() => {
                setValue(`${base}.exerciseId` as never, alt.exerciseId as never, {
                  shouldDirty: true,
                });
                setValue(`${base}.exerciseName` as never, alt.name as never, { shouldDirty: true });
              }}
            >
              Use {alt.name}
            </Button>
          ))}
        </div>
      ) : (
        <p className="text-secondary">
          No alternative that fits is set for this exercise. Add one in the exercise library, or
          replace it.
        </p>
      )}
    </div>
  );
}
