'use client';

import { useEffect } from 'react';
import { keepUpcomingWorkouts } from './registerSw';

/** PRD D4: on the portal home, online, the next 7 days of workouts are stored for offline use. Renders nothing. */
export function KeepUpcoming({ sessionIds }: { sessionIds: string[] }) {
  const key = sessionIds.join(',');
  useEffect(() => {
    if (navigator.onLine) keepUpcomingWorkouts(key ? key.split(',') : []);
  }, [key]);
  return null;
}
