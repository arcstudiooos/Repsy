import { apiHandler } from '@/server/api';
import {
  checkinTemplateByIdGetRoute,
  checkinTemplateByIdPatchRoute,
} from '@/server/routes/checkins';

export const GET = apiHandler(checkinTemplateByIdGetRoute);
export const PATCH = apiHandler(checkinTemplateByIdPatchRoute);
