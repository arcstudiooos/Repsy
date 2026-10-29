import { apiHandler } from '@/server/api';
import { orgGetRoute, orgPatchRoute } from '@/server/routes/org';

export const GET = apiHandler(orgGetRoute);
export const PATCH = apiHandler(orgPatchRoute);
