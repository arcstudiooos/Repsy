import type { TagColor, TagView } from '@kinetic/core';

/** Decorative dot colours; the tag name carries the meaning (text stays ink for contrast). */
export const TAG_DOT: Record<TagColor, string> = {
  teal: '#1C7666',
  blue: '#2F5FA8',
  purple: '#6B4CA6',
  orange: '#B0601A',
  red: '#B64743',
  gray: '#60716E',
};

export function TagBadge({ tag }: { tag: TagView }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-input-border bg-surface px-2 py-0.5 text-sm text-ink">
      <span
        aria-hidden
        className="size-2 rounded-full"
        style={{ background: TAG_DOT[tag.color] }}
      />
      {tag.name}
    </span>
  );
}
