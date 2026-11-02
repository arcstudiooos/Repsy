import { apiHandler } from '@/server/api';
import { groupsPostRoute } from '@/server/routes/groups';

export const POST = apiHandler(groupsPostRoute);
