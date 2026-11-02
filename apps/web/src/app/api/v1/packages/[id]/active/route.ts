import { apiHandler } from '@/server/api';
import { packageActiveRoute } from '@/server/routes/billing';

export const PUT = apiHandler(packageActiveRoute);
