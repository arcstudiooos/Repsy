import type { TagColor, TagView } from '@repsy/core';

/** Decorative dot colours; the tag name carries the meaning (text stays ink for contrast). */
export const TAG_DOT: Record<TagColor, string> = {
  teal: '#0A7C8C',
  blue: '#2F6FD8',
  purple: '#7B61FF',
  orange: '#E8552D',
  red: '#C0283C',
  gray: '#8C847C',
};

export function TagBadge({ tag }: { tag: TagView }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2 py-0.5 text-caption font-medium text-ink">
      <span
        aria-hidden
        className="size-2 rounded-full"
        style={{ background: TAG_DOT[tag.color] }}
      />
      {tag.name}
    </span>
  );
}
