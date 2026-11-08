/** Browser-side calls to the body metrics API (same-origin, so the CSRF Origin check passes). */
import type { MetricEntryView } from '@repsy/core';
import { call } from './checkin-api';

export const recordMetricValue = (
  clientId: string,
  body: { metric: string; measuredOn: string; value: number; reason?: string },
) => call<MetricEntryView>('POST', `/api/v1/clients/${encodeURIComponent(clientId)}/metrics`, body);
