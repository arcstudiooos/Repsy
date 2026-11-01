import { apiHandler } from '@/server/api';
import { resourcesListRoute, resourcesPostRoute } from '@/server/routes/resources';

export const GET = apiHandler(resourcesListRoute);
export const POST = apiHandler(resourcesPostRoute);
