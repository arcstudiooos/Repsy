/** PRD M13: the public changelog, newest first. Add an entry with each release. */
export const CHANGELOG: { date: string; title: string; items: string[] }[] = [
  {
    date: '2026-11-01',
    title: 'Release 2',
    items: [
      'Form library: recurring check-ins, one-off forms and intake forms that fill the context card.',
      'More check-in question types, including body measurements that reach progress.',
      'Supersets, circuits, intervals, AMRAP, EMOM and for-time blocks; workout sections.',
      'Extra workouts, a readiness check before Start, and exercise swaps.',
      'Two-step sign-in, signed-in devices, reminders and a daily coach digest.',
      'Bulk actions, sign-up links, client import and a self-serve trial.',
      'Progress trends, goals, habit heat map, calendar and anchored messages.',
    ],
  },
  {
    date: '2026-10-01',
    title: 'Release 1',
    items: [
      'Program builder with versions, assignments, workout logging that works offline once started.',
      'Weekly check-ins, messaging, review list, analytics, exports and data deletion.',
    ],
  },
];

/** PRD M13: what is planned next (the public roadmap). */
export const ROADMAP: { title: string; detail: string }[] = [
  {
    title: 'Progress photos and video',
    detail: 'Uploads with compare views and form-check videos.',
  },
  { title: 'Push notifications', detail: 'Messages and reminders on your phone.' },
  { title: 'Payments', detail: 'Take client payments inside Kinetic.' },
];
