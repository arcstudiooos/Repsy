/** PRD I7: why coaching ended, chosen from a fixed list (never free text). Pure, for browser components too. */
export const CHURN_REASONS = [
  'goal_reached',
  'cost',
  'time',
  'results',
  'moved_on',
  'health',
  'other',
] as const;
export type ChurnReason = (typeof CHURN_REASONS)[number];

export const CHURN_LABEL: Record<ChurnReason, string> = {
  goal_reached: 'Reached their goal',
  cost: 'Cost',
  time: 'No time',
  results: 'Not happy with results',
  moved_on: 'Moved to another coach or programme',
  health: 'Health or injury',
  other: 'Other',
};
