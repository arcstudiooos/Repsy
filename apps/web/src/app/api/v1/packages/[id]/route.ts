import { apiHandler } from '@/server/api';
import { packagePutRoute } from '@/server/routes/billing';

export const PUT = apiHandler(packagePutRoute);
