import { apiHandler } from '@/server/api';
import { groupMembersPutRoute } from '@/server/routes/groups';

export const PUT = apiHandler(groupMembersPutRoute);
