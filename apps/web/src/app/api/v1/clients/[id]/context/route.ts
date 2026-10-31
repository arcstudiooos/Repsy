import { apiHandler } from '@/server/api';
import { contextGetRoute, contextPatchRoute } from '@/server/routes/context';

export const GET = apiHandler(contextGetRoute);
export const PATCH = apiHandler(contextPatchRoute);
