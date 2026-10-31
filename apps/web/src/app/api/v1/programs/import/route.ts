import { apiHandler } from '@/server/api';
import { programImportRoute } from '@/server/routes/programs';

export const POST = apiHandler(programImportRoute);
