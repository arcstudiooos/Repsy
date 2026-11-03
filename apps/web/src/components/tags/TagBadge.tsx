import type { TagColor, TagView } from '@kinetic/core';

/** Decorative dot colours; the tag name carries the meaning (text stays ink for contrast). */
export const TAG_DOT: Record<TagColor, string> = {
  teal: '#0D9488',
  blue: '#2F5FA8',
  purple: '#6B4CA6',
  orange: '#B0601A',
  red: '#B64743',
  gray: '#64748B',
};

export function TagBadge({ tag }: { tag: TagView }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2 py-0.5 text-xs leading-5 font-medium text-ink">
      <span
        aria-hidden
        className="size-2 rounded-full"
        style={{ background: TAG_DOT[tag.color] }}
      />
      {tag.name}
    </span>
  );
}
