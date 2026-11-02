import { apiHandler } from '@/server/api';
import { groupReactRoute } from '@/server/routes/groups';

export const PUT = apiHandler(groupReactRoute);
