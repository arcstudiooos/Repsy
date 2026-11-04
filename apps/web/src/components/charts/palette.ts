/** Chart colours come only from tokens (CSS variables), so both themes work. Order = plan §2.1 chart palette. */
export const SERIES = [
  'var(--k-chart-1)',
  'var(--k-chart-2)',
  'var(--k-chart-3)',
  'var(--k-chart-4)',
  'var(--k-chart-5)',
  'var(--k-chart-6)',
] as const;

export const GRID = 'var(--k-border)';
export const AXIS = 'var(--k-secondary)';

/** Session-state colours, always shown with their label (legend or text), never alone. */
export const STATE_COLOR = {
  completed: 'var(--k-success)',
  skipped: 'var(--k-warning-fill)',
  notFinished: 'var(--k-chart-4)',
  missed: 'var(--k-danger)',
  due: 'var(--k-surface-2)',
} as const;

export const STATE_LABEL: Record<keyof typeof STATE_COLOR, string> = {
  completed: 'Completed',
  skipped: 'Skipped',
  notFinished: 'Not finished',
  missed: 'Missed',
  due: 'Due',
};

export type SessionStateKey = keyof typeof STATE_COLOR;
