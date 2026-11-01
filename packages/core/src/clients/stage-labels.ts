/** PRD B20: lifecycle stage names and labels. Pure: safe in the browser. */
export const LIFECYCLE_STAGES = ['onboarding', 'active', 'at_renewal', 'paused', 'alumni'] as const;
export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];
export const SETTABLE_STAGES = ['onboarding', 'active', 'at_renewal'] as const;
export type SettableStage = (typeof SETTABLE_STAGES)[number];

export const STAGE_LABEL: Record<LifecycleStage, string> = {
  onboarding: 'Onboarding',
  active: 'Active',
  at_renewal: 'At renewal',
  paused: 'Paused',
  alumni: 'Alumni',
};
