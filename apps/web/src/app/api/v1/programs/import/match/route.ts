import { apiHandler } from '@/server/api';
import { programImportMatchRoute } from '@/server/routes/programs';

export const POST = apiHandler(programImportMatchRoute);
