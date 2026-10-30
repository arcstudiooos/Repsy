'use client';

import { Button } from '@/components/ui/button';
import { AUTOSAVE_LABEL, type AutosaveStatus } from './useDraftAutosave';

/** The sticky footer: "Save changes" plus the autosave indicator (one live status region). */
export function SaveBar({
  status,
  dirty,
  saving,
  savedAs,
}: {
  status: AutosaveStatus;
  /** Unsaved changes relative to the last committed version. */
  dirty: boolean;
  saving: boolean;
  /** The version the last "Save changes" in this tab committed. */
  savedAs: number | null;
}) {
  const message = dirty
    ? AUTOSAVE_LABEL[status]
    : savedAs !== null
      ? `Saved as version ${savedAs}`
      : '';
  return (
    <div className="sticky bottom-16 flex flex-wrap items-center gap-3 rounded-card bg-surface p-4 shadow-card md:bottom-0">
      <Button type="submit" disabled={saving || !dirty}>
        {saving ? 'Saving...' : 'Save changes'}
      </Button>
      <p
        role="status"
        className={status === 'error' && dirty ? 'text-sm text-danger' : 'text-sm text-secondary'}
      >
        {message}
      </p>
    </div>
  );
}
