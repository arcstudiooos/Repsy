import { apiHandler } from '@/server/api';
import { groupMuteRoute } from '@/server/routes/groups';

export const PUT = apiHandler(groupMuteRoute);
