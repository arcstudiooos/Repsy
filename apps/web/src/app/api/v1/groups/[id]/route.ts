import { apiHandler } from '@/server/api';
import { groupDeleteRoute, groupPutRoute } from '@/server/routes/groups';

export const PUT = apiHandler(groupPutRoute);
export const DELETE = apiHandler(groupDeleteRoute);
