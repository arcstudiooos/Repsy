import { apiHandler } from '@/server/api';
import { goalPatchRoute } from '@/server/routes/goals';

export const PATCH = apiHandler(goalPatchRoute);
