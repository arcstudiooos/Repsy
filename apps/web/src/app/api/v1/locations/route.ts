import { apiHandler } from '@/server/api';
import { locationsListRoute, locationsPostRoute } from '@/server/routes/locationsClasses';

export const GET = apiHandler(locationsListRoute);
export const POST = apiHandler(locationsPostRoute);
