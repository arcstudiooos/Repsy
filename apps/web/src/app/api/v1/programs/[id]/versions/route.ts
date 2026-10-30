import { apiHandler } from '@/server/api';
import { programVersionsListRoute } from '@/server/routes/programs';

export const GET = apiHandler(programVersionsListRoute);
