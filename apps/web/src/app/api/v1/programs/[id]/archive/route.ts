import { apiHandler } from '@/server/api';
import { programArchiveRoute } from '@/server/routes/programs';

export const PUT = apiHandler(programArchiveRoute);
