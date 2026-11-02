import { apiHandler } from '@/server/api';
import { groupPostRoute } from '@/server/routes/groups';

export const POST = apiHandler(groupPostRoute);
