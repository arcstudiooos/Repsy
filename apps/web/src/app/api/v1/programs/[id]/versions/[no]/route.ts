import { apiHandler } from '@/server/api';
import { programVersionGetRoute } from '@/server/routes/programs';

export const GET = apiHandler(programVersionGetRoute);
