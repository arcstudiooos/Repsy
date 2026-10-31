import { apiHandler } from '@/server/api';
import { clientTagsPutRoute } from '@/server/routes/tags';

export const PUT = apiHandler(clientTagsPutRoute);
