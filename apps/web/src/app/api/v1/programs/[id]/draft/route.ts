import { apiHandler } from '@/server/api';
import {
  programDraftDeleteRoute,
  programDraftGetRoute,
  programDraftPutRoute,
} from '@/server/routes/programs';

export const GET = apiHandler(programDraftGetRoute);
export const PUT = apiHandler(programDraftPutRoute);
export const DELETE = apiHandler(programDraftDeleteRoute);
