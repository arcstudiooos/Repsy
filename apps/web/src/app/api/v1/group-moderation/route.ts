import { apiHandler } from '@/server/api';
import { groupModerateRoute } from '@/server/routes/groups';

export const PUT = apiHandler(groupModerateRoute);
