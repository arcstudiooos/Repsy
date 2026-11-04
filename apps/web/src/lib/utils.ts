import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * tailwind-merge must know the design system's own scales (globals.css @theme), or it reads `text-micro` as a colour
 * and drops it next to `text-secondary`, and treats `shadow-e1` / `rounded-card` as unknown.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ['display', 'h1', 'h2', 'h3', 'body', 'caption', 'micro'],
      shadow: ['e1', 'e2', 'card'],
      radius: ['card', 'control'],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
