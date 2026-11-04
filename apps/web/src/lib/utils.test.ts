import { describe, expect, it } from 'vitest';
import { cn } from './utils';

describe('cn', () => {
  it('keeps design-system font sizes next to text colours', () => {
    expect(cn('text-micro', 'text-secondary')).toBe('text-micro text-secondary');
    expect(cn('text-h1 text-ink')).toBe('text-h1 text-ink');
  });
  it('still lets a later size or shadow win', () => {
    expect(cn('text-micro', 'text-sm')).toBe('text-sm');
    expect(cn('shadow-e1', 'shadow-e2')).toBe('shadow-e2');
    expect(cn('rounded-card', 'rounded-md')).toBe('rounded-md');
  });
});
