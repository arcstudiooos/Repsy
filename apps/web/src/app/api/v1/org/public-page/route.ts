import { apiHandler } from '@/server/api';
import { publicPagePutRoute } from '@/server/routes/leads';

export const PUT = apiHandler(publicPagePutRoute);
