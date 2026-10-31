import { apiHandler } from '@/server/api';
import { programDuplicateRoute } from '@/server/routes/programs';

export const POST = apiHandler(programDuplicateRoute);
