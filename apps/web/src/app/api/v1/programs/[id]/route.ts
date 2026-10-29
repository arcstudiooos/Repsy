import { apiHandler } from '@/server/api';
import { programGetRoute, programPatchRoute } from '@/server/routes/programs';

export const GET = apiHandler(programGetRoute);
export const PATCH = apiHandler(programPatchRoute);
