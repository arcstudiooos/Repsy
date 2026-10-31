import { apiHandler } from '@/server/api';
import { metricsListRoute, metricsPostRoute } from '@/server/routes/metrics';

export const GET = apiHandler(metricsListRoute);
export const POST = apiHandler(metricsPostRoute);
