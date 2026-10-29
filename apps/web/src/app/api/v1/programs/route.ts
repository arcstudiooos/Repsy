import { apiHandler } from '@/server/api';
import { programsListRoute, programsPostRoute } from '@/server/routes/programs';

export const GET = apiHandler(programsListRoute);
export const POST = apiHandler(programsPostRoute);
