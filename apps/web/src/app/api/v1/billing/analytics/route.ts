import { apiHandler } from '@/server/api';
import { billingAnalyticsGetRoute } from '@/server/routes/billing';

export const GET = apiHandler(billingAnalyticsGetRoute);
