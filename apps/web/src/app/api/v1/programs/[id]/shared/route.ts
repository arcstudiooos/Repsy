import { apiHandler } from '@/server/api';
import { programSharedRoute } from '@/server/routes/programs';

export const PUT = apiHandler(programSharedRoute);
